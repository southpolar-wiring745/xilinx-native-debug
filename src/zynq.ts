/**
 * XSDBZynqSession
 *
 * Extends GDBDebugSession to add an XSDB init sequence before GDB
 * starts.  This handles FPGA bitstream programming, PS initialization,
 * board reset, and keeps XSDB alive for runtime commands during the
 * debug session (memory / register access, free-form Tcl commands).
 */

import { MI2DebugSession, RunCommand } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2, escape } from "./backend/mi2/mi2";
import { MINode } from './backend/mi_parse';
import { SSHArguments, ValuesFormattingMode } from './backend/backend';
import { XSDBClient } from './backend/xsdb/xsdb';
import { BoardFamily, BOARD_PRESETS, detectBoardFamily } from './backend/xsdb/board_presets';
import { RegisterPreset, RegisterArchitecture, inferRegisterArchitecture, getRegisterGroups, getPeripheralGroups, RegisterGroupDef, PeripheralGroupDef } from './backend/xsdb/zynq_registers';
import { XSDBRegisterEntry } from './backend/xsdb/xsdb_parse';
import { detectFreeRTOS, getFreeRTOSTasks, FreeRTOSTask } from './backend/xsdb/freertos';
import { parseLinkerMap, MemoryMap } from './backend/xsdb/memory_map';
import { getClockRegistersForPlatform } from './backend/xsdb/clock_registers';
import { decodeZynq7000Clocks, decodeZynqMPClocks, decodeVersalClocks, ClockInfo } from './backend/xsdb/clock_decoder';
import { getPowerRegistersForPlatform, decodeZynqMPPowerStatus, PowerDomainInfo } from './backend/xsdb/power_status';
import { decodeAArch32Fault, decodeAArch64Fault, formatCrashReport } from './backend/xsdb/crash_analyzer';
import { analyzeFreeRTOSCrash, formatFreeRTOSCrashReport } from './backend/xsdb/freertos_crash_analyzer';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------
// Launch / Attach argument interfaces
// -----------------------------------------------------------------------

export interface XSDBGDBLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	cwd: string;
	target: string;
	gdbpath: string;
	env: any;
	debugger_args: string[];
	pathSubstitutions: { [index: string]: string };
	arguments: string;
	terminal: string;
	autorun: string[];
	stopAtEntry: boolean | string;
	ssh: SSHArguments;
	valuesFormatting: ValuesFormattingMode;
	frameFilters: boolean;
	printCalls: boolean;
	showDevDebugOutput: boolean;
	registerLimit: string;

	// --- XSDB-specific properties ---
	xsdbPath: string;
	hwServerUrl: string;
	bitstreamPath: string;
	ltxPath: string;
	hwDesignPath: string;
	loadhwMemRanges: string[];
	psInitScript: string;
	initScript: string;
	initTargetFilter: string;
	targetFilter: string;
	jtagCableName: string;
	resetType: "processor" | "system" | "none";
	forceMemAccess: boolean;
	stopBeforePsInit: boolean;
	keepXsdbAlive: boolean;
	boardFamily: BoardFamily;
	xsdbAutorun: string[];
	registerPreset: RegisterPreset;
	peripheralWatch: PeripheralWatchConfig[];
	breakpointAutoReapply: boolean;
	freertosAwareness: boolean;
	mapFilePath: string;
	xsdbTraceCommands: boolean;
	crashAnalyzer: boolean;
}
export interface PeripheralWatchConfig {
	name: string;
	address: string;
	count?: number;
	refreshOnStop?: boolean;
}

export interface XSDBGDBAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	cwd: string;
	target: string;
	gdbpath: string;
	env: any;
	debugger_args: string[];
	pathSubstitutions: { [index: string]: string };
	executable: string;
	remote: boolean;
	autorun: string[];
	stopAtConnect: boolean;
	stopAtEntry: boolean | string;
	ssh: SSHArguments;
	valuesFormatting: ValuesFormattingMode;
	frameFilters: boolean;
	printCalls: boolean;
	showDevDebugOutput: boolean;
	registerLimit: string;

	// --- XSDB-specific properties ---
	xsdbPath: string;
	hwServerUrl: string;
	bitstreamPath: string;
	ltxPath: string;
	hwDesignPath: string;
	loadhwMemRanges: string[];
	psInitScript: string;
	initScript: string;
	initTargetFilter: string;
	targetFilter: string;
	jtagCableName: string;
	resetType: "processor" | "system" | "none";
	forceMemAccess: boolean;
	stopBeforePsInit: boolean;
	keepXsdbAlive: boolean;
	boardFamily: BoardFamily;
	xsdbAutorun: string[];
	registerPreset: RegisterPreset;
	peripheralWatch: PeripheralWatchConfig[];
	breakpointAutoReapply: boolean;
	freertosAwareness: boolean;
	mapFilePath: string;
	xsdbTraceCommands: boolean;
	crashAnalyzer: boolean;
}

// -----------------------------------------------------------------------
// Session class
// -----------------------------------------------------------------------

class XSDBZynqSession extends MI2DebugSession {
	protected xsdb: XSDBClient | null = null;
	private keepXsdbAlive = true;
	private boardFamily: string | undefined;
	private registerPreset: RegisterPreset = "core";
	private peripheralWatchEntries: PeripheralWatchConfig[] = [];
	private breakpointAutoReapply = false;
	private freertosAwareness = false;
	private memoryMap: MemoryMap | undefined;
	private cachedXsdbRegs: XSDBRegisterEntry[] | undefined;
	private cachedFreeRTOSTasks: FreeRTOSTask[] | undefined;
	private peripheralGroups: PeripheralGroupDef[] = [];
	private registerGroups: RegisterGroupDef[] = [];
	private registerArchitecture: RegisterArchitecture | undefined;
	private currentTargetName: string | undefined;
	private extraVariableHandles = new Handles<string>();
	private crashAnalyzerEnabled = true;

	private normalizeTargetName(name: string): string {
		return name
			.toLowerCase()
			.replace(/mpcore/g, "")
			.replace(/cortex-/g, "cortex ")
			.replace(/\s+/g, " ")
			.trim();
	}

	private pickBestTarget(allTargets: Array<{ id: number; name: string; state: string }>, filter: string) {
		const normalizedFilter = this.normalizeTargetName(filter);
		const direct = allTargets.find(t => this.normalizeTargetName(t.name) === normalizedFilter);
		if (direct) return direct;

		const contains = allTargets.find(t => this.normalizeTargetName(t.name).includes(normalizedFilter));
		if (contains) return contains;

		const strippedFilter = normalizedFilter.replace(/\s+#\d+$/, "").trim();
		if (strippedFilter !== normalizedFilter) {
			const byCoreIndex = allTargets.find(t => this.normalizeTargetName(t.name).includes(strippedFilter));
			if (byCoreIndex) return byCoreIndex;
		}

		return undefined;
	}

	private async selectXsdbTarget(filter: string, jtagCableName?: string): Promise<{ id: number; name: string; state: string } | undefined> {
		if (!this.xsdb) {
			throw new Error("XSDB is not running");
		}

		if (jtagCableName) {
			const cmd = `targets -set -nocase -filter {name =~ "${filter}" && jtag_cable_name =~ "${jtagCableName}"} -index 0`;
			await this.xsdb.sendCommand(cmd);
			this.handleMsg("stdout", `[XSDB] Selected target via filter '${filter}' on cable '${jtagCableName}'\n`);
			const allTargets = await this.xsdb.targets();
			const selected = allTargets.find(t => t.selected) || this.pickBestTarget(allTargets, filter);
			return selected ? { id: selected.id, name: selected.name, state: selected.state } : undefined;
		}

		const targets = await this.xsdb.targets(filter);
		if (targets.length > 0) {
			await this.xsdb.selectTarget(targets[0].id);
			this.handleMsg("stdout", `[XSDB] Selected target ${targets[0].id}: ${targets[0].name}\n`);
			return { id: targets[0].id, name: targets[0].name, state: targets[0].state };
		}

		const all = await this.xsdb.targets();
		const fallback = this.pickBestTarget(all, filter);
		if (fallback) {
			await this.xsdb.selectTarget(fallback.id);
			this.handleMsg("stdout", `[XSDB] Selected target (fuzzy match) ${fallback.id}: ${fallback.name}\n`);
			return { id: fallback.id, name: fallback.name, state: fallback.state };
		}

		this.handleMsg("stderr", `[XSDB] No target matching '${filter}'. Available targets:\n`);
		for (const t of all) {
			this.handleMsg("stderr", `  ${t.id}: ${t.name} (${t.state})\n`);
		}
		return undefined;
	}

	// -- DAP Initialize ------------------------------------------------

	protected override initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsGotoTargetsRequest = true;
		response.body.supportsHitConditionalBreakpoints = true;
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsFunctionBreakpoints = true;
		response.body.supportsEvaluateForHovers = true;
		response.body.supportsSetVariable = true;
		response.body.supportsStepBack = true;
		response.body.supportsLogPoints = true;
		this.sendResponse(response);
	}

	private stripOptionalQuotes(value: string | undefined): string | undefined {
		if (!value) return undefined;
		const trimmed = value.trim();
		if (trimmed.length >= 2) {
			const first = trimmed[0];
			const last = trimmed[trimmed.length - 1];
			if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
				return trimmed.substring(1, trimmed.length - 1).trim();
			}
		}
		return trimmed;
	}

	private hasUnresolvedVariable(value: string | undefined): boolean {
		if (!value) return false;
		return /\$\{[^}]+\}/.test(value);
	}

	private resolveConfiguredPath(filePath: string | undefined, cwd: string | undefined): string | undefined {
		const cleanedPath = this.stripOptionalQuotes(filePath);
		if (!cleanedPath) return undefined;

		// If VS Code variables are still present, skip host-side path checks.
		if (this.hasUnresolvedVariable(cleanedPath)) {
			return undefined;
		}

		if (path.isAbsolute(cleanedPath)) {
			return path.normalize(cleanedPath);
		}

		const cleanedCwd = this.stripOptionalQuotes(cwd);
		if (!cleanedCwd || this.hasUnresolvedVariable(cleanedCwd)) {
			return path.resolve(cleanedPath);
		}

		return path.resolve(cleanedCwd, cleanedPath);
	}

	private resolveWorkingDirectory(cwd: string | undefined): string | undefined {
		const cleanedCwd = this.stripOptionalQuotes(cwd);
		if (!cleanedCwd || this.hasUnresolvedVariable(cleanedCwd)) {
			return undefined;
		}
		return path.resolve(cleanedCwd);
	}

	private validatePaths(args: XSDBGDBLaunchRequestArguments | XSDBGDBAttachRequestArguments): string[] {
		const errors: string[] = [];
		const checkFile = (label: string, filePath: string | undefined) => {
			if (!filePath) return;

			const resolvedPath = this.resolveConfiguredPath(filePath, args.cwd);
			if (!resolvedPath) return;

			if (!fs.existsSync(resolvedPath)) {
				errors.push(`${label}: file not found: ${filePath} (resolved: ${resolvedPath})`);
			}
		};
		checkFile("bitstreamPath", args.bitstreamPath);
		checkFile("hwDesignPath", args.hwDesignPath);
		checkFile("psInitScript", args.psInitScript);
		checkFile("initScript", args.initScript);
		checkFile("ltxPath", args.ltxPath);
		return errors;
	}

	// -- XSDB init sequence --------------------------------------------

	/**
	 * Run the XSDB initialization sequence: connect, select target,
	 * program FPGA, load hardware design, run PS init, reset, and
	 * run any extra autorun commands.
	 */
	private async runXsdbInit(args: XSDBGDBLaunchRequestArguments | XSDBGDBAttachRequestArguments): Promise<void> {
		const pathErrors = this.validatePaths(args);
		if (pathErrors.length > 0) {
			for (const err of pathErrors) {
				this.handleMsg("stderr", `[XSDB] ${err}\n`);
			}
			throw new Error(`XSDB init aborted: ${pathErrors.length} file(s) not found. Check debug console for details.`);
		}

		this.registerPreset = args.registerPreset || "core";
		this.peripheralWatchEntries = args.peripheralWatch || [];
		this.breakpointAutoReapply = args.breakpointAutoReapply !== false;
		this.freertosAwareness = !!args.freertosAwareness;
		this.crashAnalyzerEnabled = args.crashAnalyzer !== false; // default true
		this.currentTargetName = undefined;

		if (args.mapFilePath) {
			try {
				const resolvedMapFilePath = this.resolveConfiguredPath(args.mapFilePath, args.cwd);
				if (!resolvedMapFilePath) {
					throw new Error(`unable to resolve path: ${args.mapFilePath}`);
				}
				const content = fs.readFileSync(resolvedMapFilePath, "utf-8");
				this.memoryMap = new MemoryMap(parseLinkerMap(content));
				this.handleMsg("stdout", `[XSDB] Loaded linker map: ${resolvedMapFilePath} (${this.memoryMap.allSymbols.length} symbols, ${this.memoryMap.allSections.length} sections)\n`);
			} catch (e) {
				this.handleMsg("stderr", `[XSDB] Warning: could not load map file: ${args.mapFilePath}: ${e}\n`);
			}
		}

		const xsdbPath = args.xsdbPath || "xsdb";
		this.xsdb = new XSDBClient(xsdbPath, this.resolveWorkingDirectory(args.cwd));
		this.xsdb.debugOutput = !!(args as any).showDevDebugOutput;

		if (args.xsdbTraceCommands) {
			this.xsdb.traceCommands = true;
			this.handleMsg("stdout", "[XSDB] Command tracing enabled.\n");
		}

		this.handleMsg("stdout", `[XSDB] Starting ${xsdbPath}...\n`);
		await this.xsdb.start();
		this.handleMsg("stdout", "[XSDB] Ready.\n");

		// 1. Connect to hw_server
		const connectOutput = await this.xsdb.connect(args.hwServerUrl || undefined);
		this.handleMsg("stdout", `[XSDB] connect: ${connectOutput}\n`);

		// 2. If user supplied a custom initScript, just source it and skip
		//    the preset-based sequence.
		if (args.initScript) {
			this.handleMsg("stdout", `[XSDB] Running custom init script: ${args.initScript}\n`);
			const out = await this.xsdb.runTclScript(args.initScript);
			if (out) this.handleMsg("stdout", `[XSDB] ${out}\n`);
			if (args.targetFilter) {
				this.currentTargetName = args.targetFilter;
			}
		} else {
			// 3. Determine board family
			let family: Exclude<BoardFamily, "auto"> | undefined;
			const boardArg = args.boardFamily || "auto";
			if (boardArg === "auto") {
				this.handleMsg("stdout", "[XSDB] Board type: auto. Detecting platform...\n");
				family = detectBoardFamily({
					hwDesignPath: args.hwDesignPath,
					bitstreamPath: args.bitstreamPath,
					psInitScript: args.psInitScript,
					initScript: args.initScript,
					targetFilter: args.targetFilter,
					initTargetFilter: args.initTargetFilter,
				});
			} else {
				family = boardArg;
			}
			this.handleMsg("stdout", `[XSDB] Detected platform: ${family}\n`);

			// 4. Select init target (APU first, if configured)
			const targetFilter = args.targetFilter ||
				(family && BOARD_PRESETS[family] ? BOARD_PRESETS[family].defaultTargetFilter : undefined);
			const initTargetFilter = args.initTargetFilter ||
				(family === "zynq7000" || family === "zynqmp" ? "APU*" : undefined);

			if (initTargetFilter) {
				await this.selectXsdbTarget(initTargetFilter, args.jtagCableName || undefined);
			}

			// 5. Run board-preset init sequence
			if (family && BOARD_PRESETS[family]) {
				const preset = BOARD_PRESETS[family];
				const cmds = preset.initSequence({
					bitstreamPath: args.bitstreamPath,
					hwDesignPath: args.hwDesignPath,
					psInitScript: args.psInitScript,
				});

				if (args.forceMemAccess) {
					const out = await this.xsdb.sendCommand("configparams force-mem-access 1");
					if (out) this.handleMsg("stdout", `[XSDB] ${out}\n`);
				}
				if (args.stopBeforePsInit) {
					const out = await this.xsdb.sendCommand("stop");
					if (out) this.handleMsg("stdout", `[XSDB] ${out}\n`);
				}

				for (const cmd of cmds) {
					let out: string;
					if (cmd.startsWith("fpga ") && args.bitstreamPath) {
						this.handleMsg("stdout", `[XSDB] fpga -file ${args.bitstreamPath}\n`);
						if (args.ltxPath) {
							this.handleMsg("stdout", `[XSDB] Note: ltxPath is currently not passed to 'fpga' (tool/version dependent).\n`);
						}
						out = await this.xsdb.fpga(args.bitstreamPath, args.ltxPath || undefined);
					} else if (cmd.startsWith("loadhw ") && args.hwDesignPath) {
						const logMemRanges = args.loadhwMemRanges && args.loadhwMemRanges.length > 0
							? ` -mem-ranges [list ${args.loadhwMemRanges.map(r => `{${r}}`).join(" ")}]`
							: "";
						this.handleMsg("stdout", `[XSDB] loadhw -hw ${args.hwDesignPath}${logMemRanges}\n`);
						out = await this.xsdb.loadhw(args.hwDesignPath, args.loadhwMemRanges || undefined);
					} else {
						this.handleMsg("stdout", `[XSDB] ${cmd}\n`);
						out = await this.xsdb.sendCommand(cmd);
					}
					if (out) this.handleMsg("stdout", `[XSDB] ${out}\n`);
				}
			} else {
				// No preset — run individual steps if paths are provided
				if (args.forceMemAccess) {
					await this.xsdb.sendCommand("configparams force-mem-access 1");
				}
				if (args.stopBeforePsInit) {
					await this.xsdb.sendCommand("stop");
				}
				if (args.bitstreamPath) {
					this.handleMsg("stdout", `[XSDB] Programming FPGA: ${args.bitstreamPath}\n`);
					if (args.ltxPath) {
						this.handleMsg("stdout", `[XSDB] Note: ltxPath is currently not passed to 'fpga' (tool/version dependent).\n`);
					}
					await this.xsdb.fpga(args.bitstreamPath, args.ltxPath || undefined);
				}
				if (args.hwDesignPath) {
					this.handleMsg("stdout", `[XSDB] Loading hardware design: ${args.hwDesignPath}\n`);
					await this.xsdb.loadhw(args.hwDesignPath, args.loadhwMemRanges || undefined);
				}
				if (args.psInitScript) {
					this.handleMsg("stdout", `[XSDB] Sourcing PS init script: ${args.psInitScript}\n`);
					await this.xsdb.runTclScript(args.psInitScript);
				}
			}

			// 6. Select final CPU target (e.g. ARM #0) before reset/GDB attach
			if (targetFilter) {
				const selectedTarget = await this.selectXsdbTarget(targetFilter, args.jtagCableName || undefined);
				this.currentTargetName = selectedTarget?.name || targetFilter;
			}

			// 7. Reset target
			const resetType = args.resetType || "processor";
			if (resetType !== "none") {
				this.handleMsg("stdout", `[XSDB] Resetting (${resetType})...\n`);
				await this.xsdb.rst(resetType);
			}

			if (args.forceMemAccess) {
				await this.xsdb.sendCommand("configparams force-mem-access 0");
			}
		}

		// 7. User-specified additional XSDB commands
		if (args.xsdbAutorun && args.xsdbAutorun.length > 0) {
			for (const cmd of args.xsdbAutorun) {
				this.handleMsg("stdout", `[XSDB] autorun: ${cmd}\n`);
				const out = await this.xsdb.sendCommand(cmd);
				if (out) this.handleMsg("stdout", `[XSDB] ${out}\n`);
			}
		}

		this.keepXsdbAlive = args.keepXsdbAlive !== false; // default true
		if (!this.keepXsdbAlive) {
			await this.xsdb.quit();
			this.xsdb = null;
			this.handleMsg("stdout", "[XSDB] Closed (keepXsdbAlive=false).\n");
		} else {
			this.handleMsg("stdout", "[XSDB] Staying alive for runtime commands.\n");
		}

		this.boardFamily = args.boardFamily || "auto";
		if (this.boardFamily === "auto") {
			this.boardFamily = detectBoardFamily({
				hwDesignPath: args.hwDesignPath,
				bitstreamPath: args.bitstreamPath,
				psInitScript: args.psInitScript,
				initScript: args.initScript,
				targetFilter: args.targetFilter,
				initTargetFilter: args.initTargetFilter,
			}) || "zynq7000";
		}
		this.registerArchitecture = inferRegisterArchitecture(this.boardFamily, this.currentTargetName || args.targetFilter);
		this.registerGroups = getRegisterGroups(this.boardFamily, this.registerPreset, this.registerArchitecture);
		this.peripheralGroups = getPeripheralGroups(this.boardFamily);
	}

	// -- DAP Launch Request --------------------------------------------

	protected override launchRequest(response: DebugProtocol.LaunchResponse, args: XSDBGDBLaunchRequestArguments): void {
		// Run XSDB init, then hand off to GDB launch.
		this.runXsdbInit(args).then(
			() => this.gdbLaunch(response, args),
			(err) => {
				this.handleMsg("stderr", `[XSDB] Init failed: ${err}\n`);
				this.sendErrorResponse(response, 110, `XSDB init failed: ${err}`);
			},
		);
	}

	private gdbLaunch(response: DebugProtocol.LaunchResponse, args: XSDBGDBLaunchRequestArguments): void {
		const dbgCommand = args.gdbpath || "gdb";
		if (!this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}
		this.miDebugger = new MI2(dbgCommand, ["-q", "--interpreter=mi2"], args.debugger_args, args.env);
		this.setPathSubstitutions(args.pathSubstitutions);
		this.initDebugger();
		this.quit = false;
		this.attached = false;
		this.initialRunCommand = RunCommand.RUN;
		this.isSSH = false;
		this.started = false;
		this.crashed = false;
		this.setValuesFormattingMode(args.valuesFormatting);
		this.miDebugger.frameFilters = !!args.frameFilters;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.stopAtEntry = args.stopAtEntry;
		this.miDebugger.registerLimit = args.registerLimit ?? "";

		if (args.ssh !== undefined) {
			if (args.ssh.forwardX11 === undefined) args.ssh.forwardX11 = true;
			if (args.ssh.port === undefined) args.ssh.port = 22;
			if (args.ssh.x11port === undefined) args.ssh.x11port = 6000;
			if (args.ssh.x11host === undefined) args.ssh.x11host = "localhost";
			if (args.ssh.remotex11screen === undefined) args.ssh.remotex11screen = 0;
			this.isSSH = true;
			this.setSourceFileMap(args.ssh.sourceFileMap, args.ssh.cwd, args.cwd);
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, args.arguments, args.terminal, false, args.autorun || []).then(() => {
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 105, `Failed to SSH: ${err.toString()}`);
			});
		} else {
			this.miDebugger.load(args.cwd, args.target, args.arguments, args.terminal, args.autorun || []).then(() => {
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 103, `Failed to load MI Debugger: ${err.toString()}`);
			});
		}
	}

	// -- DAP Attach Request --------------------------------------------

	protected override attachRequest(response: DebugProtocol.AttachResponse, args: XSDBGDBAttachRequestArguments): void {
		this.runXsdbInit(args).then(
			() => this.gdbAttach(response, args),
			(err) => {
				this.handleMsg("stderr", `[XSDB] Init failed: ${err}\n`);
				this.sendErrorResponse(response, 110, `XSDB init failed: ${err}`);
			},
		);
	}

	private gdbAttach(response: DebugProtocol.AttachResponse, args: XSDBGDBAttachRequestArguments): void {
		const dbgCommand = args.gdbpath || "gdb";
		if (!this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}
		this.miDebugger = new MI2(dbgCommand, ["-q", "--interpreter=mi2"], args.debugger_args, args.env);
		this.setPathSubstitutions(args.pathSubstitutions);
		this.initDebugger();
		this.quit = false;
		this.attached = !args.remote;
		this.initialRunCommand = args.stopAtConnect ? RunCommand.NONE : RunCommand.CONTINUE;
		this.isSSH = false;
		this.setValuesFormattingMode(args.valuesFormatting);
		this.miDebugger.frameFilters = !!args.frameFilters;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.stopAtEntry = args.stopAtEntry;
		this.miDebugger.registerLimit = args.registerLimit ?? "";

		if (args.ssh !== undefined) {
			if (args.ssh.forwardX11 === undefined) args.ssh.forwardX11 = true;
			if (args.ssh.port === undefined) args.ssh.port = 22;
			if (args.ssh.x11port === undefined) args.ssh.x11port = 6000;
			if (args.ssh.x11host === undefined) args.ssh.x11host = "localhost";
			if (args.ssh.remotex11screen === undefined) args.ssh.remotex11screen = 0;
			this.isSSH = true;
			this.setSourceFileMap(args.ssh.sourceFileMap, args.ssh.cwd, args.cwd);
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, "", undefined, true, args.autorun || []).then(() => {
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 104, `Failed to SSH: ${err.toString()}`);
			});
		} else {
			if (args.remote) {
				this.miDebugger.connect(args.cwd, args.executable, args.target, args.autorun || []).then(() => {
					this.sendResponse(response);
				}, err => {
					this.sendErrorResponse(response, 102, `Failed to attach: ${err.toString()}`);
				});
			} else {
				this.miDebugger.attach(args.cwd, args.executable, args.target, args.autorun || []).then(() => {
					this.sendResponse(response);
				}, err => {
					this.sendErrorResponse(response, 101, `Failed to attach: ${err.toString()}`);
				});
			}
		}
	}

	protected override scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		// First, let the base class build its scopes (Locals, Registers)
		// Then append XSDB-specific scopes.

		// We need to intercept the response. Call super and augment.
		const origSend = this.sendResponse.bind(this);
		this.sendResponse = (resp: any) => {
			if (resp === response) {
				const scopes: DebugProtocol.Scope[] = resp.body?.scopes || [];

				// XSDB Registers scope (grouped)
				if (this.xsdb && this.registerGroups.length > 0) {
					const handle = this.extraVariableHandles.create("xsdb-registers");
					scopes.push(new Scope("XSDB Registers", handle, true));
				}

				// Peripherals scope
				if (this.xsdb && (this.peripheralGroups.length > 0 || this.peripheralWatchEntries.length > 0)) {
					const handle = this.extraVariableHandles.create("xsdb-peripherals");
					scopes.push(new Scope("Peripherals", handle, true));
				}

				// Peripheral Watch (user-configured addresses)
				if (this.xsdb && this.peripheralWatchEntries.length > 0) {
					const handle = this.extraVariableHandles.create("xsdb-peripheral-watch");
					scopes.push(new Scope("Peripheral Watch", handle, true));
				}

				// FreeRTOS Tasks scope
				if (this.freertosAwareness) {
					const handle = this.extraVariableHandles.create("xsdb-freertos");
					scopes.push(new Scope("FreeRTOS Tasks", handle, true));
				}

				resp.body = { scopes };
				origSend(resp);
				this.sendResponse = origSend;
			} else {
				origSend(resp);
			}
		};
		super.scopesRequest(response, args);
	}

	protected override async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		const id = this.extraVariableHandles.get(args.variablesReference);
		if (typeof id !== "string") {
			// Not one of our scopes — delegate to base
			return super.variablesRequest(response, args);
		}

		const variables: DebugProtocol.Variable[] = [];

		try {
			if (id === "xsdb-registers") {
				await this.populateXsdbRegisters(variables);
			} else if (id === "xsdb-peripherals") {
				await this.populatePeripherals(variables);
			} else if (id === "xsdb-peripheral-watch") {
				await this.populatePeripheralWatch(variables);
			} else if (id === "xsdb-freertos") {
				await this.populateFreeRTOSTasks(variables);
			} else if (id.startsWith("xsdb-reg-group:")) {
				const groupLabel = id.substring("xsdb-reg-group:".length);
				await this.populateXsdbRegisterGroup(variables, groupLabel);
			} else if (id.startsWith("xsdb-periph-group:")) {
				const groupLabel = id.substring("xsdb-periph-group:".length);
				await this.populatePeripheralGroup(variables, groupLabel);
			} else {
				// Unknown scope id — delegate
				return super.variablesRequest(response, args);
			}
		} catch (e) {
			variables.push({
				name: "<error>",
				value: `${e}`,
				variablesReference: 0,
			});
		}

		response.body = { variables };
		this.sendResponse(response);
	}

	private async populateXsdbRegisters(variables: DebugProtocol.Variable[]): Promise<void> {
		// Refresh register cache from XSDB
		if (this.xsdb) {
			try {
				this.cachedXsdbRegs = await this.xsdb.readRegs();
				const flatRegNames = this.flattenRegisters(this.cachedXsdbRegs).keys();
				const inferredArchitecture = inferRegisterArchitecture(this.boardFamily, this.currentTargetName, flatRegNames);
				if (this.registerArchitecture !== inferredArchitecture) {
					this.registerArchitecture = inferredArchitecture;
					this.registerGroups = getRegisterGroups(this.boardFamily, this.registerPreset, inferredArchitecture);
					this.handleMsg("stdout", `[XSDB] Register architecture detected: ${inferredArchitecture}\n`);
				}
			} catch (e) {
				variables.push({ name: "<error>", value: `Could not read registers: ${e}`, variablesReference: 0 });
				return;
			}
		}

		for (const group of this.registerGroups) {
			const handle = this.extraVariableHandles.create(`xsdb-reg-group:${group.label}`);
			variables.push({
				name: group.label,
				value: `(${group.names.length} registers)`,
				variablesReference: handle,
			});
		}
	}

	private async populateXsdbRegisterGroup(variables: DebugProtocol.Variable[], groupLabel: string): Promise<void> {
		const group = this.registerGroups.find(g => g.label === groupLabel);
		if (!group || !this.cachedXsdbRegs) return;

		const flatRegs = this.flattenRegisters(this.cachedXsdbRegs);
		for (const regName of group.names) {
			const found = this.resolveRegisterValue(flatRegs, regName);
			const normalizedHex = this.normalizeRegisterHex(found);
			const annotated = normalizedHex
				? (this.memoryMap
					? `0x${normalizedHex}  ${this.memoryMap.annotateAddress(parseInt(normalizedHex, 16))}`
					: `0x${normalizedHex}`)
				: "N/A";
			variables.push({
				name: regName,
				value: annotated,
				variablesReference: 0,
			});
		}
	}

	/** Flatten XSDB's hierarchical register tree into name→value map. */
	private flattenRegisters(entries: XSDBRegisterEntry[], map?: Map<string, string>): Map<string, string> {
		if (!map) map = new Map();
		for (const e of entries) {
			if (e.value) {
				map.set(e.name.toLowerCase(), e.value.trim());
			}
			if (e.children) {
				this.flattenRegisters(e.children, map);
			}
		}
		return map;
	}

	private resolveRegisterValue(flatRegs: Map<string, string>, regName: string): string | undefined {
		const lower = regName.toLowerCase();
		const direct = flatRegs.get(lower);
		if (direct) return direct;

		const aliases: Record<string, string[]> = {
			sp: ["r13", "x31", "w31"],
			lr: ["r14", "x30", "w30"],
			pc: ["r15"],
			cpsr: ["xpsr", "apsr", "pstate", "nzcv"],
		};

		for (const alias of aliases[lower] || []) {
			const value = flatRegs.get(alias);
			if (value) return value;
		}

		return undefined;
	}

	private normalizeRegisterHex(value: string | undefined): string | undefined {
		if (!value) return undefined;
		const trimmed = value.trim();
		const match = /^(?:0x)?([0-9A-Fa-f]+)$/.exec(trimmed);
		if (!match) return undefined;
		return match[1].toUpperCase();
	}

	private async populatePeripherals(variables: DebugProtocol.Variable[]): Promise<void> {
		for (const group of this.peripheralGroups) {
			const handle = this.extraVariableHandles.create(`xsdb-periph-group:${group.label}`);
			variables.push({
				name: group.label,
				value: group.description,
				variablesReference: handle,
			});
		}
	}

	private async populatePeripheralGroup(variables: DebugProtocol.Variable[], groupLabel: string): Promise<void> {
		const group = this.peripheralGroups.find(g => g.label === groupLabel);
		if (!group || !this.xsdb) return;

		for (const reg of group.registers) {
			try {
				const entries = await this.xsdb.readMem(reg.address, 1);
				const val = entries.length > 0 ? `0x${entries[0].value.toString(16).toUpperCase().padStart(8, "0")}` : "read error";
				variables.push({
					name: `${reg.name} [0x${reg.address.toString(16).toUpperCase()}]`,
					value: val,
					variablesReference: 0,
				});
			} catch (e) {
				variables.push({
					name: `${reg.name} [0x${reg.address.toString(16).toUpperCase()}]`,
					value: `<error: ${e}>`,
					variablesReference: 0,
				});
			}
		}
	}

	private async populatePeripheralWatch(variables: DebugProtocol.Variable[]): Promise<void> {
		if (!this.xsdb) return;
		for (const entry of this.peripheralWatchEntries) {
			const addr = parseInt(entry.address, entry.address.startsWith("0x") ? 16 : 10);
			const count = entry.count || 1;
			if (isNaN(addr)) {
				variables.push({ name: entry.name, value: `<invalid address: ${entry.address}>`, variablesReference: 0 });
				continue;
			}
			try {
				const entries = await this.xsdb.readMem(addr, count);
				if (count === 1 && entries.length > 0) {
					const annotation = this.memoryMap ? `  ${this.memoryMap.annotateAddress(addr)}` : "";
					variables.push({
						name: entry.name,
						value: `0x${entries[0].value.toString(16).toUpperCase().padStart(8, "0")}${annotation}`,
						variablesReference: 0,
					});
				} else {
					for (const e of entries) {
						const annotation = this.memoryMap ? `  ${this.memoryMap.annotateAddress(e.address)}` : "";
						variables.push({
							name: `${entry.name}+0x${(e.address - addr).toString(16)}`,
							value: `0x${e.value.toString(16).toUpperCase().padStart(8, "0")}${annotation}`,
							variablesReference: 0,
						});
					}
				}
			} catch (e) {
				variables.push({ name: entry.name, value: `<error: ${e}>`, variablesReference: 0 });
			}
		}
	}

	private async populateFreeRTOSTasks(variables: DebugProtocol.Variable[]): Promise<void> {
		if (!this.miDebugger) {
			variables.push({ name: "<info>", value: "GDB not connected", variablesReference: 0 });
			return;
		}

		try {
			const hasFreeRTOS = await detectFreeRTOS(this.miDebugger);
			if (!hasFreeRTOS) {
				variables.push({ name: "<info>", value: "FreeRTOS symbols not detected", variablesReference: 0 });
				return;
			}

			const is64bit = (this.registerArchitecture || inferRegisterArchitecture(this.boardFamily, this.currentTargetName)) === "cortex-a53-64";
			this.cachedFreeRTOSTasks = await getFreeRTOSTasks(this.miDebugger, is64bit);

			for (const task of this.cachedFreeRTOSTasks) {
				const marker = task.isCurrent ? " *" : "";
				const hwm = task.stackHighWaterMark >= 0 ? `, stack free: ${task.stackHighWaterMark} words` : "";
				variables.push({
					name: `${task.name}${marker}`,
					value: `[${task.state}] prio=${task.priority}${hwm}  TCB=0x${task.tcbAddress.toString(16)}`,
					variablesReference: 0,
				});
			}

			if (this.cachedFreeRTOSTasks.length === 0) {
				variables.push({ name: "<info>", value: "No tasks found (scheduler not started?)", variablesReference: 0 });
			}
		} catch (e) {
			variables.push({ name: "<error>", value: `FreeRTOS query failed: ${e}`, variablesReference: 0 });
		}
	}

	// -- Evaluate: XSDB pass-through via `xsdb:` prefix ----------------

	protected override evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		if (this.xsdb && args.expression.startsWith("xsdb:")) {
			const xsdbCmd = args.expression.substring(5).trim();

			if (xsdbCmd === "trace" && this.xsdb.traceCommands) {
				const log = this.xsdb.getTraceLog();
				this.handleMsg("stdout", `[XSDB] Command Trace Log:\n${log || "(empty)"}\n`);
				response.body = { result: log || "(empty)", variablesReference: 0 };
				this.sendResponse(response);
				return;
			}

			this.handleMsg("stdout", `[XSDB] > ${xsdbCmd}\n`);
			this.xsdb.sendCommand(xsdbCmd).then(
				(output) => {
					this.handleMsg("stdout", `[XSDB] ${output}\n`);
					response.body = {
						result: output,
						variablesReference: 0,
					};
					this.sendResponse(response);
				},
				(err) => {
					this.handleMsg("stderr", `[XSDB] Error: ${err.message}\n`);
					response.body = {
						result: `Error: ${err.message}`,
						variablesReference: 0,
					};
					this.sendResponse(response);
				},
			);
			return;
		}

		// Delegate to the standard MI2DebugSession evaluate.
		super.evaluateRequest(response, args);
	}

	// -- Disconnect: clean up both GDB and XSDB -------------------------

	protected override disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if (this.xsdb) {
			this.xsdb.quit().catch(() => {
				// best-effort
			}).then(() => {
				this.xsdb = null;
			});
		}
		super.disconnectRequest(response, args);
	}

	// -- Custom DAP request handlers for runtime XSDB commands ----------

	protected override customRequest(command: string, response: DebugProtocol.Response, args: any): void {
		switch (command) {
			case "xsdb-programFPGA":
				this.handleXsdbProgramFPGA(response, args);
				return;
			case "xsdb-resetBoard":
				this.handleXsdbResetBoard(response, args);
				return;
			case "xsdb-readMemory":
				this.handleXsdbReadMemory(response, args);
				return;
			case "xsdb-writeMemory":
				this.handleXsdbWriteMemory(response, args);
				return;
			case "xsdb-sendCommand":
				this.handleXsdbSendCommand(response, args);
				return;
			case "xsdb-getTraceLog":
				this.handleXsdbGetTraceLog(response);
				return;
			case "xsdb-getMemoryMapInfo":
				this.handleGetMemoryMapInfo(response, args);
				return;
			case "xsdb-dumpMemory":
				this.handleXsdbDumpMemory(response, args);
				return;
			case "xsdb-loadMemory":
				this.handleXsdbLoadMemory(response, args);
				return;
			case "xsdb-readClockPower":
				this.handleXsdbReadClockPower(response);
				return;
			case "xsdb-runCrashAnalyzer":
				this.handleXsdbRunCrashAnalyzer(response);
				return;
			default:
				super.customRequest(command, response, args);
		}
	}

	private handleXsdbProgramFPGA(response: DebugProtocol.Response, args: { bitstreamPath: string }): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}
		this.xsdb.fpga(args.bitstreamPath).then(
			(out) => {
				this.handleMsg("stdout", `[XSDB] FPGA programmed: ${out}\n`);
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 121, `FPGA programming failed: ${err}`),
		);
	}

	private handleXsdbResetBoard(response: DebugProtocol.Response, args: { resetType?: "processor" | "system" }): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}
		this.xsdb.rst(args.resetType || "processor").then(
			(out) => {
				this.handleMsg("stdout", `[XSDB] Reset complete: ${out}\n`);
				if (this.breakpointAutoReapply && this.miDebugger) {
					this.handleMsg("stdout", "[XSDB] Re-applying breakpoints after reset...\n");
					this.miDebugger.sendCommand("break-list").then(
						(bpList) => {
							this.handleMsg("stdout", "[XSDB] Breakpoints revalidated after reset.\n");
							this.sendResponse(response);
						},
						() => {
							this.handleMsg("stderr", "[XSDB] Warning: breakpoint re-validation failed after reset.\n");
							this.sendResponse(response);
						},
					);
				} else {
					this.sendResponse(response);
				}
			},
			(err) => this.sendErrorResponse(response, 122, `Reset failed: ${err}`),
		);
	}

	private handleXsdbReadMemory(response: DebugProtocol.Response, args: { address: number; count: number }): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}
		this.xsdb.readMem(args.address, args.count).then(
			(entries) => {
				let output = "";
				for (const e of entries) {
					output += `0x${e.address.toString(16).toUpperCase()}: 0x${e.value.toString(16).toUpperCase()}\n`;
				}
				this.handleMsg("stdout", `[XSDB] Memory:\n${output}`);
				(response as any).body = { entries };
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 123, `Memory read failed: ${err}`),
		);
	}

	private handleXsdbWriteMemory(response: DebugProtocol.Response, args: { address: number; value: number }): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}
		this.xsdb.writeMem(args.address, args.value).then(
			() => {
				this.handleMsg("stdout", `[XSDB] Written 0x${args.value.toString(16)} to 0x${args.address.toString(16)}\n`);
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 124, `Memory write failed: ${err}`),
		);
	}

	private handleXsdbSendCommand(response: DebugProtocol.Response, args: { command: string }): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}
		this.xsdb.sendCommand(args.command).then(
			(output) => {
				this.handleMsg("stdout", `[XSDB] ${output}\n`);
				(response as any).body = { output };
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 125, `XSDB command failed: ${err}`),
		);
	}

	private handleXsdbGetTraceLog(response: DebugProtocol.Response): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}
		const log = this.xsdb.getTraceLog();
		(response as any).body = { traceLog: log, entries: this.xsdb.commandTrace };
		this.sendResponse(response);
	}

	private handleGetMemoryMapInfo(response: DebugProtocol.Response, args: { address?: number }): void {
		if (!this.memoryMap) {
			(response as any).body = { available: false };
			this.sendResponse(response);
			return;
		}
		if (args.address !== undefined) {
			const sym = this.memoryMap.findSymbol(args.address);
			const sec = this.memoryMap.findSection(args.address);
			const annotation = this.memoryMap.annotateAddress(args.address);
			(response as any).body = { available: true, symbol: sym, section: sec, annotation };
		} else {
			(response as any).body = {
				available: true,
				symbolCount: this.memoryMap.allSymbols.length,
				sectionCount: this.memoryMap.allSections.length,
			};
		}
		this.sendResponse(response);
	}

	// -- Memory Dump/Load handlers ----------------------------------------

	private handleXsdbDumpMemory(response: DebugProtocol.Response, args: { address: number; byteCount: number }): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}

		const wordCount = Math.ceil(args.byteCount / 4);
		const chunkSize = 1024; // words per read
		const allData: number[] = [];

		const readChunks = async (): Promise<void> => {
			for (let offset = 0; offset < wordCount; offset += chunkSize) {
				const count = Math.min(chunkSize, wordCount - offset);
				const addr = args.address + offset * 4;
				const entries = await this.xsdb!.readMem(addr, count);
				for (const entry of entries) {
					// Convert 32-bit word to 4 bytes (little-endian)
					allData.push(entry.value & 0xFF);
					allData.push((entry.value >> 8) & 0xFF);
					allData.push((entry.value >> 16) & 0xFF);
					allData.push((entry.value >> 24) & 0xFF);
				}
			}
		};

		readChunks().then(
			() => {
				// Trim to exact byte count
				const trimmed = allData.slice(0, args.byteCount);
				this.handleMsg("stdout", `[XSDB] Memory dump: ${trimmed.length} bytes from 0x${args.address.toString(16)}\n`);
				(response as any).body = { data: trimmed };
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 126, `Memory dump failed: ${err}`),
		);
	}

	private handleXsdbLoadMemory(response: DebugProtocol.Response, args: { address: number; data: number[] }): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}

		// Convert byte array to 32-bit words (little-endian)
		const words: number[] = [];
		for (let i = 0; i < args.data.length; i += 4) {
			const b0 = args.data[i] ?? 0;
			const b1 = args.data[i + 1] ?? 0;
			const b2 = args.data[i + 2] ?? 0;
			const b3 = args.data[i + 3] ?? 0;
			words.push((b3 << 24) | (b2 << 16) | (b1 << 8) | b0);
		}

		const writeChunks = async (): Promise<void> => {
			for (let i = 0; i < words.length; i++) {
				const addr = args.address + i * 4;
				await this.xsdb!.writeMem(addr, words[i]);
			}
		};

		writeChunks().then(
			() => {
				this.handleMsg("stdout", `[XSDB] Memory load: ${args.data.length} bytes written to 0x${args.address.toString(16)}\n`);
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 127, `Memory load failed: ${err}`),
		);
	}

	// -- Clock & Power handler --------------------------------------------

	private handleXsdbReadClockPower(response: DebugProtocol.Response): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}

		const platform = typeof this.boardFamily === "string" ? this.boardFamily : "zynq7000";
		const clockRegDefs = getClockRegistersForPlatform(platform);
		const powerRegDefs = getPowerRegistersForPlatform(platform);
		const allDefs = [...clockRegDefs, ...powerRegDefs];

		if (allDefs.length === 0) {
			(response as any).body = { clocks: [], power: [], platform };
			this.sendResponse(response);
			return;
		}

		const readAllRegs = async (): Promise<Map<number, number>> => {
			const regs = new Map<number, number>();
			for (const def of allDefs) {
				try {
					const entries = await this.xsdb!.readMem(def.address, 1);
					if (entries.length > 0) {
						regs.set(def.address, entries[0].value);
					}
				} catch {
					// Skip registers that fail to read
				}
			}
			return regs;
		};

		readAllRegs().then(
			(regs) => {
				let clocks: ClockInfo[] = [];
				let power: PowerDomainInfo[] = [];

				switch (platform) {
					case "zynq7000":
						clocks = decodeZynq7000Clocks(regs);
						break;
					case "zynqmp":
						clocks = decodeZynqMPClocks(regs);
						power = decodeZynqMPPowerStatus(regs);
						break;
					case "versal":
						clocks = decodeVersalClocks(regs);
						break;
				}

				(response as any).body = { clocks, power, platform };
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 128, `Clock/Power read failed: ${err}`),
		);
	}

	private handleXsdbRunCrashAnalyzer(response: DebugProtocol.Response): void {
		if (!this.xsdb) {
			this.sendErrorResponse(response, 120, "XSDB is not running");
			return;
		}

		this.runCrashAnalysis().then(
			(report) => {
				(response as any).body = {
					analyzed: true,
					report: report || null,
					note: report ? undefined : "No fault registers were set (or they were zero).",
				};
				this.sendResponse(response);
			},
			(err) => this.sendErrorResponse(response, 129, `Crash analyzer failed: ${err}`),
		);
	}

	// -- Crash Analyzer hooks ---------------------------------------------

	protected override stopEvent(info: MINode): void {
		if (!this.started)
			this.crashed = true;
		if (!this.quit) {
			const event = new StoppedEvent("exception", parseInt(info.record("thread-id")));
			(event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info.record("stopped-threads") === "all";
			this.sendEvent(event);

			// Trigger crash analysis asynchronously
			if (this.crashAnalyzerEnabled) {
				this.runCrashAnalysis().catch(() => {
					// Best-effort: don't fail the stop event
				});
			}
		}
	}

	protected override handlePause(info: MINode): void {
		super.handlePause(info);

		// Check for signal-based stops that indicate faults
		if (this.crashAnalyzerEnabled && info) {
			const signalName = info.record("signal-name");
			const faultSignals = ["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGABRT"];
			if (signalName && faultSignals.includes(signalName)) {
				this.runCrashAnalysis().catch(() => {
					// Best-effort
				});
			}
		}
	}

	private async runCrashAnalysis(): Promise<string | undefined> {
		if (!this.xsdb) return;

		const arch = this.registerArchitecture || inferRegisterArchitecture(this.boardFamily, this.currentTargetName);
		const platform = this.boardFamily || "unknown";

		try {
			// ── Strategy 0: FreeRTOS-aware crash detection ───────────────
			// Inspect the call stack for known FreeRTOS/BSP fatal handlers
			// and extract handler-specific data via GDB expressions.
			const freertosReport = await analyzeFreeRTOSCrash(this.miDebugger, platform);
			if (freertosReport) {
				const formatted = formatFreeRTOSCrashReport(freertosReport);
				this.handleMsg("stdout", "\n" + formatted + "\n");
				return formatted;
			}

			// ── Strategy 1: bulk rrd (core regs only) ────────────────────
			const regsOutput = await this.xsdb.readRegs();
			const coreFlat = this.flattenRegisters(regsOutput);

			// ── Strategy 2: rrd cp / rrd cp15 (coprocessor regs) ─────────
			const cp15Flat = await this.readCp15Registers();

			// Merge: cp15 values override core when present
			const flat = new Map<string, string>([...coreFlat, ...cp15Flat]);

			// ── Strategy 3: detect abort mode from CPSR ──────────────────
			const cpsrVal = this.parseRegHex(flat.get("cpsr") ?? "0");
			const cpuMode = cpsrVal & 0x1F;
			const inAbortMode = cpuMode === 0x17; // Data Abort mode
			const inPrefetchAbortMode = cpuMode === 0x16; // N/A on most, but check
			const inUndefinedMode = cpuMode === 0x1B;

			// LR in abort mode = faulting instruction + 8 (data) or +4 (prefetch)
			const lr = this.parseRegHex(flat.get("lr") ?? flat.get("r14") ?? "0");
			const abortPC = inAbortMode ? (lr - 8) : (inPrefetchAbortMode ? (lr - 4) : 0);

			if (arch === "cortex-a53-64") {
				return await this.runAArch64CrashAnalysis(flat, arch);
			} else {
				return await this.runAArch32CrashAnalysis(flat, cpsrVal, cpuMode, inAbortMode, abortPC, arch);
			}
		} catch {
			// Crash analysis is best-effort; don't interrupt debugging
			return undefined;
		}
	}

	private async runAArch64CrashAnalysis(flat: Map<string, string>, arch: string): Promise<string | undefined> {
		const esr = this.findRegValue(flat, ["esr_el1", "esr_el3"]);
		const far = this.findRegValue(flat, ["far_el1", "far_el3"]);
		const elr = this.findRegValue(flat, ["elr_el1", "elr_el3"]);

		if (esr === 0 && far === 0 && elr === 0) return undefined;

		const report = decodeAArch64Fault(esr, far, elr);
		const formatted = formatCrashReport(report, `AArch64 (${arch})`);
		this.handleMsg("stdout", "\n" + formatted + "\n");
		return formatted;
	}

	private async runAArch32CrashAnalysis(
		flat: Map<string, string>,
		cpsrVal: number,
		cpuMode: number,
		inAbortMode: boolean,
		abortPC: number,
		arch: string,
	): Promise<string | undefined> {
		// Try CP15 fault registers first
		let dfsr = this.findRegValue(flat, ["dfsr", "data_fault_status"]);
		let dfar = this.findRegValue(flat, ["dfar", "data_fault_address"]);
		let ifsr = this.findRegValue(flat, ["ifsr", "inst_fault_status"]);
		let ifar = this.findRegValue(flat, ["ifar", "inst_fault_address"]);

		// ── Strategy 4: GDB expression for BSP global variables ──────
		if (dfsr === 0 && ifsr === 0) {
			const bspVars = await this.readBspAbortVariables();
			if (bspVars.faultStatus !== undefined) dfsr = bspVars.faultStatus;
			if (bspVars.dataAbortAddr !== undefined) dfar = bspVars.dataAbortAddr;
			if (bspVars.prefetchAbortAddr !== undefined) ifar = bspVars.prefetchAbortAddr;
		}

		// ── Strategy 5: return mode + LR analysis even if no fault regs
		const hasFaultRegs = dfsr !== 0 || ifsr !== 0;
		const hasAbortContext = inAbortMode || abortPC !== 0;

		if (!hasFaultRegs && !hasAbortContext) return undefined;

		const lines: string[] = [];
		lines.push("═══════════════════════════════════════════════");
		lines.push("[Crash Analyzer] Exception Detected");
		lines.push("═══════════════════════════════════════════════");

		// CPSR mode analysis
		const modeNames: Record<number, string> = {
			0x10: "User", 0x11: "FIQ", 0x12: "IRQ", 0x13: "Supervisor",
			0x16: "Monitor", 0x17: "Abort", 0x1B: "Undefined", 0x1F: "System",
		};
		const modeName = modeNames[cpuMode] ?? `Unknown (0x${cpuMode.toString(16)})`;
		lines.push(`CPU Mode:  ${modeName} (CPSR=0x${cpsrVal.toString(16).toUpperCase().padStart(8, "0")})`);

		if (inAbortMode && abortPC !== 0) {
			lines.push(`Fault PC:  0x${(abortPC >>> 0).toString(16).toUpperCase().padStart(8, "0")}  (LR_abt - 8)`);
			// Try to resolve symbol
			if (this.memoryMap) {
				const annotation = this.memoryMap.annotateAddress(abortPC);
				if (annotation) lines.push(`           ${annotation}`);
			}
		}

		if (hasFaultRegs) {
			const report = decodeAArch32Fault(dfsr, dfar, ifsr, ifar);
			lines.push(`Type:      ${report.exceptionType}`);
			lines.push(`Fault:     ${report.faultType}`);
			if (report.faultAddress !== undefined) {
				lines.push(`Address:   0x${report.faultAddress.toString(16).toUpperCase().padStart(8, "0")}`);
			}
			lines.push(`Description: ${report.description}`);
			lines.push("");
			lines.push("Fault registers:");
			lines.push(`  DFSR = 0x${dfsr.toString(16).toUpperCase().padStart(8, "0")}`);
			lines.push(`  DFAR = 0x${dfar.toString(16).toUpperCase().padStart(8, "0")}`);
			lines.push(`  IFSR = 0x${ifsr.toString(16).toUpperCase().padStart(8, "0")}`);
			lines.push(`  IFAR = 0x${ifar.toString(16).toUpperCase().padStart(8, "0")}`);
		} else if (hasAbortContext) {
			lines.push(`Type:      Data Abort (detected from CPU mode)`);
			lines.push(`Note:      CP15 fault registers could not be read.`);
			lines.push(`           BSP handler may have consumed fault state.`);
			if (dfar !== 0) {
				lines.push(`Address:   0x${dfar.toString(16).toUpperCase().padStart(8, "0")} (from BSP DataAbortAddr)`);
			}
		}

		lines.push(`Architecture: AArch32 (${arch})`);
		lines.push("═══════════════════════════════════════════════");

		const formatted = lines.join("\n");
		this.handleMsg("stdout", "\n" + formatted + "\n");
		return formatted;
	}

	/**
	 * Try reading CP15 register groups from XSDB.
	 * XSDB exposes CP15 registers under group names like "cp", "cp15",
	 * "sys", or architecture-specific sub-trees.
	 */
	private async readCp15Registers(): Promise<Map<string, string>> {
		const result = new Map<string, string>();
		if (!this.xsdb) return result;

		// Try several known XSDB register group names for CP15
		const groupNames = ["cp15", "cp", "sys", "system"];
		for (const group of groupNames) {
			try {
				const output = await this.xsdb.sendCommand(`rrd ${group}`);
				if (output && !output.includes("error") && !output.includes("no such")) {
					const { parseRegisters } = await import('./backend/xsdb/xsdb_parse');
					const entries = parseRegisters(output);
					this.flattenRegisters(entries, result);
					if (result.size > 0) break;
				}
			} catch {
				// Group name not available on this target, try next
			}
		}

		// Also try reading individual fault registers by name
		const faultRegNames = [
			"dfsr", "dfar", "ifsr", "ifar",
			"DFSR", "DFAR", "IFSR", "IFAR",
			"data_fault_status", "data_fault_address",
			"inst_fault_status", "inst_fault_address",
			"esr_el1", "far_el1", "elr_el1",
			"esr_el3", "far_el3", "elr_el3",
		];
		for (const regName of faultRegNames) {
			const lower = regName.toLowerCase();
			if (result.has(lower)) continue; // Already found
			try {
				const output = await this.xsdb.sendCommand(`rrd ${regName}`);
				const parsed = this.parseRrdOutputHex(output);
				if (parsed !== undefined) {
					result.set(lower, `0x${parsed.toString(16)}`);
				}
			} catch {
				// Register not available
			}
		}

		return result;
	}

	/**
	 * Read BSP abort handler variables via GDB expression evaluation.
	 * The Xilinx BSP asm_vectors.S stores the faulting address in
	 * global variables before calling the C handler.
	 */
	private async readBspAbortVariables(): Promise<{
		faultStatus?: number;
		dataAbortAddr?: number;
		prefetchAbortAddr?: number;
	}> {
		const result: {
			faultStatus?: number;
			dataAbortAddr?: number;
			prefetchAbortAddr?: number;
		} = {};

		// Try reading BSP global variables via GDB
		const varNames = [
			{ expr: "(unsigned int)DataAbortAddr", key: "dataAbortAddr" as const },
			{ expr: "(unsigned int)PrefetchAbortAddr", key: "prefetchAbortAddr" as const },
		];

		for (const { expr, key } of varNames) {
			try {
				const res = await this.miDebugger.evalExpression(JSON.stringify(expr), 0, 0);
				const val = res.result("value");
				if (val) {
					result[key] = this.parseRegHex(val);
				}
			} catch {
				// Variable might not exist
			}
		}

		// Try reading FaultStatus local variable (only if DEBUG is defined in BSP)
		try {
			const res = await this.miDebugger.evalExpression(JSON.stringify("(unsigned int)FaultStatus"), 0, 0);
			const val = res.result("value");
			if (val) {
				result.faultStatus = this.parseRegHex(val);
			}
		} catch {
			// Variable might not be in scope
		}

		return result;
	}

	private findRegValue(flat: Map<string, string>, names: string[]): number {
		for (const name of names) {
			const val = flat.get(name.toLowerCase());
			if (val !== undefined) {
				const parsed = this.parseRegHex(val);
				if (parsed !== 0) return parsed;
			}
		}
		// Return zero-valued hit if present (as opposed to not-found)
		for (const name of names) {
			const val = flat.get(name.toLowerCase());
			if (val !== undefined) return this.parseRegHex(val);
		}
		return 0;
	}

	private parseRrdOutputHex(output: string): number | undefined {
		const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			const colonMatch = /:\s*(0x[0-9A-Fa-f]+|[0-9A-Fa-f]+)\b/.exec(line);
			if (colonMatch) {
				return this.parseRegHex(colonMatch[1]);
			}
			const directMatch = /^(0x[0-9A-Fa-f]+|[0-9A-Fa-f]+)$/.exec(line);
			if (directMatch) {
				return this.parseRegHex(directMatch[1]);
			}
		}

		return undefined;
	}

	private parseRegHex(value: string): number {
		const trimmed = value.trim();
		const match = /^(?:0x)?([0-9A-Fa-f]+)$/.exec(trimmed);
		if (!match) return 0;
		return parseInt(match[1], 16);
	}

	// -- Path substitutions (GDB-specific) ------------------------------

	protected setPathSubstitutions(substitutions: { [index: string]: string }): void {
		if (substitutions) {
			Object.keys(substitutions).forEach(source => {
				this.miDebugger.extraCommands.push("gdb-set substitute-path \"" + escape(source) + "\" \"" + escape(substitutions[source]) + "\"");
			});
		}
	}
}

DebugSession.run(XSDBZynqSession);
