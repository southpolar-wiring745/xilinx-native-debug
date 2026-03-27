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
import { SSHArguments, ValuesFormattingMode } from './backend/backend';
import { XSDBClient } from './backend/xsdb/xsdb';
import { BoardFamily, BOARD_PRESETS, detectBoardFamily } from './backend/xsdb/board_presets';
import { RegisterPreset, RegisterArchitecture, inferRegisterArchitecture, getRegisterGroups, getPeripheralGroups, RegisterGroupDef, PeripheralGroupDef } from './backend/xsdb/zynq_registers';
import { XSDBRegisterEntry } from './backend/xsdb/xsdb_parse';
import { detectFreeRTOS, getFreeRTOSTasks, FreeRTOSTask } from './backend/xsdb/freertos';
import { parseLinkerMap, MemoryMap } from './backend/xsdb/memory_map';
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
}

/** User-configurable peripheral watch entry. */
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
