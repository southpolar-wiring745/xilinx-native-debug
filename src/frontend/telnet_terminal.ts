import * as vscode from "vscode";
import * as net from "net";

/**
 * Configuration for a Telnet connection.
 */
export interface TelnetConfig {
	host: string;
	port: number;
}

// ---- Telnet IAC constants ----
const IAC = 0xFF;
const WILL = 0xFB;
const WONT = 0xFC;
const DO = 0xFD;
const DONT = 0xFE;
const SB = 0xFA;
const SE = 0xF0;

/**
 * Strips Telnet IAC negotiation sequences from raw data and responds
 * with WONT/DONT for all options (refuse negotiation).
 * Returns the cleaned data buffer.
 */
function processTelnetData(data: Buffer, socket: net.Socket): Buffer {
	const cleaned: number[] = [];
	let i = 0;
	while (i < data.length) {
		if (data[i] === IAC && i + 1 < data.length) {
			const cmd = data[i + 1];
			if (cmd === IAC) {
				// Escaped 0xFF → literal 0xFF
				cleaned.push(0xFF);
				i += 2;
			} else if ((cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) && i + 2 < data.length) {
				const option = data[i + 2];
				if (cmd === WILL || cmd === DO) {
					// Refuse everything
					const response = cmd === WILL ? DONT : WONT;
					socket.write(Buffer.from([IAC, response, option]));
				}
				i += 3;
			} else if (cmd === SB) {
				// Skip subnegotiation: find IAC SE
				let j = i + 2;
				while (j < data.length - 1) {
					if (data[j] === IAC && data[j + 1] === SE) {
						break;
					}
					j++;
				}
				i = j + 2;
			} else {
				// Other two-byte IAC command, skip
				i += 2;
			}
		} else {
			cleaned.push(data[i]);
			i++;
		}
	}
	return Buffer.from(cleaned);
}

/**
 * A VS Code Pseudoterminal that provides a Telnet connection
 * using Node.js built-in net.Socket with inline IAC handling.
 */
export class TelnetTerminalProvider implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	onDidClose: vscode.Event<number> = this.closeEmitter.event;

	private socket: net.Socket | undefined;
	private config: TelnetConfig;

	constructor(config: TelnetConfig) {
		this.config = config;
	}

	open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
		this.writeEmitter.fire(`\r\nConnecting to ${this.config.host}:${this.config.port}...\r\n`);

		this.socket = new net.Socket();

		this.socket.on("connect", () => {
			this.writeEmitter.fire(`Connected to ${this.config.host}:${this.config.port}\r\n\r\n`);
		});

		this.socket.on("data", (data: Buffer) => {
			const cleaned = processTelnetData(data, this.socket!);
			if (cleaned.length > 0) {
				// Normalize line endings for the VS Code terminal
				const text = cleaned.toString("utf8").replace(/\r?\n/g, "\r\n");
				this.writeEmitter.fire(text);
			}
		});

		this.socket.on("close", () => {
			this.writeEmitter.fire("\r\nConnection closed.\r\n");
			this.closeEmitter.fire(0);
		});

		this.socket.on("error", (err: Error) => {
			this.writeEmitter.fire(`\r\nConnection error: ${err.message}\r\n`);
			this.closeEmitter.fire(1);
		});

		this.socket.on("timeout", () => {
			this.writeEmitter.fire("\r\nConnection timed out.\r\n");
			this.socket?.destroy();
			this.closeEmitter.fire(1);
		});

		this.socket.setTimeout(30000);
		this.socket.connect(this.config.port, this.config.host);
	}

	handleInput(data: string): void {
		if (this.socket && !this.socket.destroyed) {
			this.socket.write(data);
		}
	}

	close(): void {
		this.dispose();
	}

	dispose(): void {
		if (this.socket) {
			this.socket.destroy();
			this.socket = undefined;
		}
	}
}
