/**
 * XSDB backend client — spawns an `xsdb` (or `xsdb.bat`) interactive
 * process and provides an async API to send Tcl commands and receive
 * their text output.
 *
 */

import * as ChildProcess from "child_process";
import { EventEmitter } from "events";
import {
	isPromptReady,
	parseError,
	parseTargets,
	parseMemoryDump,
	parseRegisters,
	XSDBTarget,
	XSDBMemoryEntry,
	XSDBRegisterEntry,
} from "./xsdb_parse";

export interface XSDBEvents {
	ready: [];
	output: [text: string];
	error: [message: string];
	quit: [code: number | null];
}

/**
 * Manages a single XSDB child-process, providing a promise-based API
 * for sending commands and waiting for their output.
 */
export interface XSDBCommandTrace {
	command: string;
	timestamp: number;
	durationMs: number;
	success: boolean;
	error?: string;
}

export class XSDBClient extends EventEmitter {
	private process: ChildProcess.ChildProcess | null = null;
	private buffer = "";
	private resolveReady: (() => void) | null = null;
	private pendingCommand: {
		resolve: (output: string) => void;
		reject: (err: Error) => void;
		commandText: string;
		startTime: number;
	} | null = null;
	private _isReady = false;
	public debugOutput = false;

	/** Enable command tracing with timestamps and latency. */
	public traceCommands = false;

	/** Recorded command trace entries (when traceCommands is enabled). */
	public readonly commandTrace: XSDBCommandTrace[] = [];

	/** Maximum number of trace entries to keep (ring buffer). */
	public maxTraceEntries = 500;

	constructor(
		private readonly xsdbPath: string = "xsdb",
		private readonly workingDirectory?: string,
	) {
		super();
	}

	// ------------------------------------------------------------------
	// Lifecycle
	// ------------------------------------------------------------------

	/** Spawn the XSDB interactive process and wait for the first prompt. */
	public start(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const cmd = this.xsdbPath;
			// "-interactive" keeps the prompt coming even when spawned from a pipe.
			this.process = ChildProcess.spawn(cmd, ["-interactive"], {
				stdio: ["pipe", "pipe", "pipe"],
				shell: true,
				cwd: this.workingDirectory,
			});

			this.process.on("error", (err) => {
				this.emit("error", err.message);
				reject(err);
			});

			this.process.on("exit", (code) => {
				this._isReady = false;
				this.emit("quit", code);
			});

			this.process.stdout?.on("data", (data: Buffer) => {
				this.onStdout(data.toString());
			});

			this.process.stderr?.on("data", (data: Buffer) => {
				const text = data.toString();
				if (this.debugOutput) {
					// eslint-disable-next-line no-console
					console.error("[xsdb stderr]", text);
				}
				this.emit("output", text);
			});

			// Wait for the first prompt to know XSDB is alive.
			this.resolveReady = () => {
				this._isReady = true;
				this.emit("ready");
				resolve();
			};
		});
	}

	/** Gracefully quit XSDB.  Sends `exit` and waits for the process to close. */
	public async quit(timeoutMs = 5000): Promise<void> {
		if (!this.process) return;
		try {
			await this.sendCommand("exit");
		} catch {
			// best-effort
		}
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.process?.kill("SIGKILL");
				resolve();
			}, timeoutMs);
			this.process?.on("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	/** Force-kill the child process immediately. */
	public kill(): void {
		this.process?.kill("SIGKILL");
		this.process = null;
	}

	public get isReady(): boolean {
		return this._isReady;
	}

	// ------------------------------------------------------------------
	// Command execution
	// ------------------------------------------------------------------

	/**
	 * Send a raw Tcl command to XSDB and return the text output after
	 * the next prompt is received.  Only one command can be in-flight at
	 * a time (XSDB is sequential).
	 */
	public sendCommand(command: string): Promise<string> {
		if (!this.process || !this.process.stdin) {
			return Promise.reject(new Error("XSDB process is not running"));
		}

		if (this.pendingCommand) {
			return Promise.reject(new Error("A command is already pending"));
		}

		return new Promise<string>((resolve, reject) => {
			const startTime = Date.now();
			this.pendingCommand = {
				resolve: (output: string) => {
					if (this.traceCommands) {
						this.recordTrace(command, startTime, true);
					}
					resolve(output);
				},
				reject: (err: Error) => {
					if (this.traceCommands) {
						this.recordTrace(command, startTime, false, err.message);
					}
					reject(err);
				},
				commandText: command,
				startTime,
			};
			this.buffer = "";
			if (this.debugOutput) {
				// eslint-disable-next-line no-console
				console.log("[xsdb cmd]", command);
			}
			this.process!.stdin!.write(command + "\n");
		});
	}

	// ------------------------------------------------------------------
	// High-level convenience methods
	// ------------------------------------------------------------------

	/** Connect to hw_server.  If url is omitted, uses the local default. */
	public async connect(url?: string): Promise<string> {
		const cmd = url ? `connect -url ${url}` : "connect";
		return this.sendCommand(cmd);
	}

	/** List targets.  Optionally filter by name pattern. */
	public async targets(filter?: string): Promise<XSDBTarget[]> {
		let cmd = "targets";
		if (filter) {
			const wildcardFilter = /[*?]/.test(filter) ? filter : `*${filter}*`;
			cmd = `targets -nocase -filter {name =~ "${wildcardFilter}"}`;
		}
		const output = await this.sendCommand(cmd);
		return parseTargets(output);
	}

	/** Select a target by its numeric ID. */
	public async selectTarget(id: number): Promise<void> {
		await this.sendCommand(`targets ${id}`);
	}

	/** Program the FPGA with a bitstream file.
	 *
	 * Note: `ltxFile` is currently ignored because XSDB `fpga` options for
	 * probe association are tool-version specific and passing an unsupported
	 * flag can make programming fail silently.
	 */
	public async fpga(bitFile: string, ltxFile?: string): Promise<string> {
		void ltxFile;
		return this.sendCommand(`fpga -file ${bitFile}`);
	}

	/** Load a hardware design (`.hdf` / `.xsa`) with optional memory ranges. */
	public async loadhw(hwFile: string, memRanges?: string[]): Promise<string> {
		let cmd = `loadhw -hw ${hwFile}`;
		if (memRanges && memRanges.length > 0) {
			const rangeParts = memRanges.map(r => `{${r}}`).join(" ");
			cmd += ` -mem-ranges [list ${rangeParts}]`;
		}
		return this.sendCommand(cmd);
	}

	/** Reset: `rst -processor`, `rst -system`, or `rst`. */
	public async rst(type?: "processor" | "system"): Promise<string> {
		const flag = type ? ` -${type}` : "";
		return this.sendCommand(`rst${flag}`);
	}

	/** Source (execute) a Tcl script. */
	public async runTclScript(path: string): Promise<string> {
		return this.sendCommand(`source ${path}`);
	}

	/** Read `count` words starting at `addr` (hex). */
	public async readMem(addr: number, count: number): Promise<XSDBMemoryEntry[]> {
		const output = await this.sendCommand(
			`mrd 0x${addr.toString(16)} ${count}`,
		);
		return parseMemoryDump(output);
	}

	/** Write a single word to memory. */
	public async writeMem(addr: number, value: number): Promise<string> {
		return this.sendCommand(
			`mwr 0x${addr.toString(16)} 0x${value.toString(16)}`,
		);
	}

	/** Read the register tree. */
	public async readRegs(): Promise<XSDBRegisterEntry[]> {
		const output = await this.sendCommand("rrd");
		return parseRegisters(output);
	}

	/** Disconnect from hw_server. */
	public async disconnect(): Promise<string> {
		return this.sendCommand("disconnect");
	}

	/** Download an ELF file to the target. */
	public async dow(elfFile: string): Promise<string> {
		return this.sendCommand(`dow ${elfFile}`);
	}

	/** Resume execution. */
	public async con(): Promise<string> {
		return this.sendCommand("con");
	}

	/** Stop execution. */
	public async stop(): Promise<string> {
		return this.sendCommand("stop");
	}

	// ------------------------------------------------------------------
	// Internal stdout handling
	// ------------------------------------------------------------------

	private recordTrace(command: string, startTime: number, success: boolean, error?: string): void {
		const entry: XSDBCommandTrace = {
			command,
			timestamp: startTime,
			durationMs: Date.now() - startTime,
			success,
			error,
		};
		this.commandTrace.push(entry);
		if (this.commandTrace.length > this.maxTraceEntries) {
			this.commandTrace.shift();
		}
		this.emit("trace", entry);
	}

	/** Get a formatted trace log string for diagnostics. */
	public getTraceLog(): string {
		return this.commandTrace.map(e => {
			const ts = new Date(e.timestamp).toISOString();
			const status = e.success ? "OK" : `ERR: ${e.error}`;
			return `[${ts}] ${e.durationMs}ms ${status} | ${e.command}`;
		}).join("\n");
	}

	private onStdout(data: string): void {
		this.buffer += data;

		if (this.debugOutput) {
			// eslint-disable-next-line no-console
			console.log("[xsdb raw]", JSON.stringify(data));
		}

		if (isPromptReady(this.buffer)) {
			// Strip trailing prompt from the output.
			const output = this.buffer.replace(/xsdb% $/, "").trim();

			// If we are still waiting for the very first prompt (startup):
			if (this.resolveReady) {
				const cb = this.resolveReady;
				this.resolveReady = null;
				cb();
				return;
			}

			// Otherwise resolve the pending command.
			if (this.pendingCommand) {
				const { resolve, reject } = this.pendingCommand;
				this.pendingCommand = null;
				this.buffer = "";

				const err = parseError(output);
				if (err) {
					reject(new Error(err));
				} else {
					resolve(output);
				}
			}
		}
	}
}
