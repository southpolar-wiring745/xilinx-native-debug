import * as vscode from "vscode";
import * as net from "net";

/**
 * Configuration for a raw TCP connection.
 */
export interface RawTcpConfig {
	host: string;
	port: number;
}

/**
 * VS Code pseudoterminal for plain raw TCP sockets (no telnet negotiation).
 * Useful for lwIP TCP console servers on embedded targets.
 */
export class RawTcpTerminalProvider implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

	public onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	public onDidClose: vscode.Event<number> = this.closeEmitter.event;

	private socket: net.Socket | undefined;

	constructor(private readonly config: RawTcpConfig) {
	}

	open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
		this.writeEmitter.fire(`\r\nConnecting (raw TCP) to ${this.config.host}:${this.config.port}...\r\n`);

		this.socket = new net.Socket();
		this.socket.setNoDelay(true);
		this.socket.setKeepAlive(true, 5000);
		this.socket.setTimeout(30000);

		this.socket.on("connect", () => {
			this.writeEmitter.fire(`Connected (raw TCP) to ${this.config.host}:${this.config.port}\r\n\r\n`);
		});

		this.socket.on("data", (data: Buffer) => {
			const text = data.toString("utf8").replace(/\r?\n/g, "\r\n");
			this.writeEmitter.fire(text);
		});

		this.socket.on("close", () => {
			this.writeEmitter.fire("\r\nRaw TCP connection closed.\r\n");
			this.closeEmitter.fire(0);
		});

		this.socket.on("error", (err: Error) => {
			this.writeEmitter.fire(`\r\nRaw TCP error: ${err.message}\r\n`);
			this.closeEmitter.fire(1);
		});

		this.socket.on("timeout", () => {
			this.writeEmitter.fire("\r\nRaw TCP connection timed out.\r\n");
			this.socket?.destroy();
			this.closeEmitter.fire(1);
		});

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
