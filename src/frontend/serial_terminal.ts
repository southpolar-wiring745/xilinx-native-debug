import * as vscode from "vscode";
import * as cp from "child_process";
import * as os from "os";
import * as fs from "fs";

/**
 * Configuration for a serial port connection.
 */
export interface SerialConfig {
	port: string;
	baudRate: number;
	dataBits: 5 | 6 | 7 | 8;
	parity: "none" | "odd" | "even";
	stopBits: 1 | 2;
	flowControl: "none" | "rtscts" | "xonxoff";
}

/**
 * Detects available serial ports on the current platform.
 */
export async function detectSerialPorts(): Promise<string[]> {
	if (process.platform === "win32") {
		return detectSerialPortsWindows();
	} else {
		return detectSerialPortsUnix();
	}
}

async function detectSerialPortsWindows(): Promise<string[]> {
	return new Promise<string[]>((resolve) => {
		cp.exec("reg query HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM", (err, stdout) => {
			if (err || !stdout) {
				// Fallback: try mode command
				cp.exec("mode", (err2, stdout2) => {
					if (err2 || !stdout2) {
						resolve([]);
						return;
					}
					const ports: string[] = [];
					const regex = /Status for device (COM\d+):/gi;
					let match;
					while ((match = regex.exec(stdout2)) !== null) {
						ports.push(match[1]);
					}
					resolve(ports);
				});
				return;
			}
			const ports: string[] = [];
			const lines = stdout.split("\n");
			for (const line of lines) {
				const match = line.match(/(COM\d+)\s*$/);
				if (match) {
					ports.push(match[1]);
				}
			}
			resolve(ports);
		});
	});
}

async function detectSerialPortsUnix(): Promise<string[]> {
	const patterns = ["/dev/ttyUSB*", "/dev/ttyACM*", "/dev/ttyS*"];
	const ports: string[] = [];
	for (const pattern of patterns) {
		const dir = pattern.replace(/\*$/, "");
		const prefix = dir;
		try {
			const base = dir.substring(0, dir.lastIndexOf("/"));
			const filePrefix = dir.substring(dir.lastIndexOf("/") + 1);
			const entries = fs.readdirSync(base);
			for (const entry of entries) {
				if (entry.startsWith(filePrefix)) {
					const fullPath = base + "/" + entry;
					ports.push(fullPath);
				}
			}
		} catch {
			// Directory doesn't exist or not readable
		}
	}
	return ports;
}

type ExternalTool = "auto" | "plink" | "picocom" | "screen" | "minicom" | "powershell";

/**
 * Detects the best serial tool available on the system.
 */
function detectSerialTool(preferred: ExternalTool): { tool: string; args: (config: SerialConfig) => string[] } | undefined {
	if (process.platform === "win32") {
		return detectSerialToolWindows(preferred);
	} else {
		return detectSerialToolUnix(preferred);
	}
}

function detectSerialToolWindows(preferred: ExternalTool): { tool: string; args: (config: SerialConfig) => string[] } | undefined {
	if (preferred === "plink" || preferred === "auto") {
		// Try plink.exe (PuTTY CLI companion)
		try {
			cp.execSync("where plink.exe", { stdio: "pipe" });
			return {
				tool: "plink.exe",
				args: (config: SerialConfig) => {
					const sercfg = `${config.baudRate},${config.dataBits},${parityChar(config.parity)},${config.stopBits},${flowChar(config.flowControl)}`;
					return ["-serial", config.port, "-sercfg", sercfg];
				}
			};
		} catch {
			if (preferred === "plink") return undefined;
		}
	}

	if (preferred === "powershell" || preferred === "auto") {
		// Use PowerShell System.IO.Ports.SerialPort
		return {
			tool: "powershell.exe",
			args: (config: SerialConfig) => {
				const script = `
$port = New-Object System.IO.Ports.SerialPort '${config.port}',${config.baudRate},([System.IO.Ports.Parity]::${capitalize(config.parity)}),${config.dataBits},([System.IO.Ports.StopBits]::${config.stopBits === 1 ? "One" : "Two"})
$port.Handshake = [System.IO.Ports.Handshake]::${flowHandshake(config.flowControl)}
$port.Open()
Write-Host "Connected to ${config.port} at ${config.baudRate} baud"
try {
  while ($true) {
    if ($port.BytesToRead -gt 0) {
      $data = $port.ReadExisting()
      Write-Host -NoNewline $data
    }
    if ([Console]::KeyAvailable) {
      $key = [Console]::ReadKey($true)
      $port.Write($key.KeyChar.ToString())
    }
    Start-Sleep -Milliseconds 10
  }
} finally {
  $port.Close()
}`;
				return ["-NoProfile", "-Command", script];
			}
		};
	}

	return undefined;
}

function detectSerialToolUnix(preferred: ExternalTool): { tool: string; args: (config: SerialConfig) => string[] } | undefined {
	const tools: Array<{ name: string; check: string; builder: (config: SerialConfig) => string[] }> = [
		{
			name: "picocom",
			check: "which picocom",
			builder: (config) => {
				const args = ["-b", String(config.baudRate), "-d", String(config.dataBits)];
				if (config.parity !== "none") args.push("-p", config.parity.charAt(0));
				else args.push("-p", "n");
				args.push("-y", config.stopBits === 1 ? "1" : "2");
				if (config.flowControl === "rtscts") args.push("-f", "h");
				else if (config.flowControl === "xonxoff") args.push("-f", "s");
				else args.push("-f", "n");
				args.push(config.port);
				return args;
			}
		},
		{
			name: "minicom",
			check: "which minicom",
			builder: (config) => ["-D", config.port, "-b", String(config.baudRate)]
		},
		{
			name: "screen",
			check: "which screen",
			builder: (config) => [config.port, String(config.baudRate)]
		}
	];

	if (preferred !== "auto") {
		const tool = tools.find(t => t.name === preferred);
		if (tool) {
			try {
				cp.execSync(tool.check, { stdio: "pipe" });
				return { tool: tool.name, args: tool.builder };
			} catch {
				return undefined;
			}
		}
		return undefined;
	}

	for (const tool of tools) {
		try {
			cp.execSync(tool.check, { stdio: "pipe" });
			return { tool: tool.name, args: tool.builder };
		} catch {
			continue;
		}
	}
	return undefined;
}

function parityChar(parity: string): string {
	switch (parity) {
		case "none": return "n";
		case "odd": return "o";
		case "even": return "e";
		default: return "n";
	}
}

function flowChar(flow: string): string {
	switch (flow) {
		case "none": return "N";
		case "rtscts": return "H";
		case "xonxoff": return "S";
		default: return "N";
	}
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function flowHandshake(flow: string): string {
	switch (flow) {
		case "rtscts": return "RequestToSend";
		case "xonxoff": return "XOnXOff";
		default: return "None";
	}
}

/**
 * A VS Code Pseudoterminal that provides serial port communication
 * by spawning an external tool (plink, picocom, minicom, screen, or PowerShell).
 */
export class SerialTerminalProvider implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	onDidClose: vscode.Event<number> = this.closeEmitter.event;

	private process: cp.ChildProcess | undefined;
	private config: SerialConfig;

	constructor(config: SerialConfig) {
		this.config = config;
	}

	open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
		const extConfig = vscode.workspace.getConfiguration("xilinx-debug");
		const preferredTool = (extConfig.get<string>("serial.externalTool") || "auto") as ExternalTool;

		const detected = detectSerialTool(preferredTool);
		if (!detected) {
			this.writeEmitter.fire(
				`\r\nError: No serial terminal tool found.\r\n` +
				`On Windows: install PuTTY (plink.exe) or use PowerShell.\r\n` +
				`On Linux/macOS: install picocom, minicom, or screen.\r\n`
			);
			this.closeEmitter.fire(1);
			return;
		}

		const args = detected.args(this.config);
		this.writeEmitter.fire(`\r\nConnecting to ${this.config.port} at ${this.config.baudRate} baud using ${detected.tool}...\r\n`);

		try {
			this.process = cp.spawn(detected.tool, args, {
				stdio: ["pipe", "pipe", "pipe"],
				shell: process.platform === "win32" && detected.tool === "powershell.exe",
			});
		} catch (err) {
			this.writeEmitter.fire(`\r\nFailed to spawn ${detected.tool}: ${err}\r\n`);
			this.closeEmitter.fire(1);
			return;
		}

		this.process.stdout?.on("data", (data: Buffer) => {
			// Normalize line endings for the VS Code terminal
			const text = data.toString().replace(/\r?\n/g, "\r\n");
			this.writeEmitter.fire(text);
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			const text = data.toString().replace(/\r?\n/g, "\r\n");
			this.writeEmitter.fire(text);
		});

		this.process.on("close", (code) => {
			this.writeEmitter.fire(`\r\nSerial connection closed (exit code: ${code ?? "unknown"}).\r\n`);
			this.closeEmitter.fire(code ?? 0);
		});

		this.process.on("error", (err) => {
			this.writeEmitter.fire(`\r\nSerial process error: ${err.message}\r\n`);
			this.closeEmitter.fire(1);
		});
	}

	handleInput(data: string): void {
		if (this.process?.stdin?.writable) {
			this.process.stdin.write(data);
		}
	}

	close(): void {
		this.dispose();
	}

	dispose(): void {
		if (this.process) {
			this.process.kill();
			this.process = undefined;
		}
	}
}
