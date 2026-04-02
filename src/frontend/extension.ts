import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";
import { SerialTerminalProvider, SerialConfig, detectSerialPorts } from "./serial_terminal";
import { TelnetTerminalProvider, TelnetConfig } from "./telnet_terminal";
import { RawTcpTerminalProvider, RawTcpConfig } from "./raw_tcp_terminal";
import { HexEditorPanel } from "./hex_editor";
import { ProjectWizardPanel } from "./project_wizard";
import { ClockPowerPanel } from "./clock_power_panel";
import { HwMinimapPanel } from "./hw_minimap_panel";

// Active terminal references for disconnect commands
let activeSerialTerminal: vscode.Terminal | undefined;
let activeSerialPty: SerialTerminalProvider | undefined;
let activeTelnetTerminal: vscode.Terminal | undefined;
let activeTelnetPty: TelnetTerminalProvider | undefined;
let activeRawTcpTerminal: vscode.Terminal | undefined;
let activeRawTcpPty: RawTcpTerminalProvider | undefined;
let resetStatusBarItem: vscode.StatusBarItem | undefined;
let serialStatusBarItem: vscode.StatusBarItem | undefined;
let telnetStatusBarItem: vscode.StatusBarItem | undefined;
let tcpStatusBarItem: vscode.StatusBarItem | undefined;

class XilinxToolsItem extends vscode.TreeItem {
	constructor(
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly children: XilinxToolsItem[] = [],
		commandId?: string,
		description?: string,
	) {
		super(label, collapsibleState);
		this.description = description;
		if (commandId) {
			this.command = { command: commandId, title: label };
		}
	}
}

class XilinxToolsProvider implements vscode.TreeDataProvider<XilinxToolsItem> {
	private readonly roots: XilinxToolsItem[];

	constructor() {
		this.roots = [
			new XilinxToolsItem("Project & Panels", vscode.TreeItemCollapsibleState.Expanded, [
				new XilinxToolsItem("Project Wizard", vscode.TreeItemCollapsibleState.None, [], "code-debug.projectWizard.open"),
				new XilinxToolsItem("Hex Memory Editor", vscode.TreeItemCollapsibleState.None, [], "code-debug.hexEditor.open"),
				new XilinxToolsItem("Clock & Power Monitor", vscode.TreeItemCollapsibleState.None, [], "code-debug.clockPower.open"),
				new XilinxToolsItem("Hardware Mini-Map", vscode.TreeItemCollapsibleState.None, [], "code-debug.hwMinimap.open"),
			]),
			new XilinxToolsItem("XSDB", vscode.TreeItemCollapsibleState.Expanded, [
				new XilinxToolsItem("Program FPGA", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.programFPGA"),
				new XilinxToolsItem("Reset Board", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.resetBoard"),
				new XilinxToolsItem("Quick Reset", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.quickReset"),
				new XilinxToolsItem("Reset Processor", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.resetProcessor"),
				new XilinxToolsItem("Reset System", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.resetSystem"),
				new XilinxToolsItem("Read Memory", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.readMemory"),
				new XilinxToolsItem("Write Memory", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.writeMemory"),
				new XilinxToolsItem("Dump Memory to File", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.dumpMemory"),
				new XilinxToolsItem("Load Memory from File", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.loadMemory"),
				new XilinxToolsItem("Run Crash Analyzer", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.runCrashAnalyzer"),
				new XilinxToolsItem("Send XSDB Command", vscode.TreeItemCollapsibleState.None, [], "code-debug.xsdb.sendCommand"),
			]),
			new XilinxToolsItem("Terminals", vscode.TreeItemCollapsibleState.Expanded, [
				new XilinxToolsItem("UART Connect", vscode.TreeItemCollapsibleState.None, [], "code-debug.serial.connect"),
				new XilinxToolsItem("UART Disconnect", vscode.TreeItemCollapsibleState.None, [], "code-debug.serial.disconnect"),
				new XilinxToolsItem("UART Toggle", vscode.TreeItemCollapsibleState.None, [], "code-debug.serial.toggle"),
				new XilinxToolsItem("Telnet Connect", vscode.TreeItemCollapsibleState.None, [], "code-debug.telnet.connect"),
				new XilinxToolsItem("Telnet Disconnect", vscode.TreeItemCollapsibleState.None, [], "code-debug.telnet.disconnect"),
				new XilinxToolsItem("Telnet Toggle", vscode.TreeItemCollapsibleState.None, [], "code-debug.telnet.toggle"),
				new XilinxToolsItem("TCP Connect", vscode.TreeItemCollapsibleState.None, [], "code-debug.tcp.connect"),
				new XilinxToolsItem("TCP Disconnect", vscode.TreeItemCollapsibleState.None, [], "code-debug.tcp.disconnect"),
				new XilinxToolsItem("TCP Toggle", vscode.TreeItemCollapsibleState.None, [], "code-debug.tcp.toggle"),
			]),
		];
	}

	getTreeItem(element: XilinxToolsItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: XilinxToolsItem): Thenable<XilinxToolsItem[]> {
		if (!element) {
			return Promise.resolve(this.roots);
		}
		return Promise.resolve(element.children);
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("debugmemory", new MemoryContentProvider()));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.examineMemoryLocation", examineMemory));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.getFileNameNoExt", () => {
		if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
			vscode.window.showErrorMessage("No editor with valid file name active");
			return;
		}
		const fileName = vscode.window.activeTextEditor.document.fileName;
		const ext = path.extname(fileName);
		return fileName.substring(0, fileName.length - ext.length);
	}));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.getFileBasenameNoExt", () => {
		if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
			vscode.window.showErrorMessage("No editor with valid file name active");
			return;
		}
		const fileName = path.basename(vscode.window.activeTextEditor.document.fileName);
		const ext = path.extname(fileName);
		return fileName.substring(0, fileName.length - ext.length);
	}));

	// -- XSDB commands --------------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.programFPGA", xsdbProgramFPGA));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.resetBoard", xsdbResetBoard));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.readMemory", xsdbReadMemory));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.writeMemory", xsdbWriteMemory));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.sendCommand", xsdbSendCommand));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.runCrashAnalyzer", xsdbRunCrashAnalyzer));

	// -- Serial Terminal ------------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.serial.connect", serialConnect));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.serial.disconnect", serialDisconnect));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.serial.toggle", serialToggle));

	// -- Telnet Terminal ------------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.telnet.connect", telnetConnect));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.telnet.disconnect", telnetDisconnect));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.telnet.toggle", telnetToggle));

	// -- Raw TCP Terminal -----------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.tcp.connect", rawTcpConnect));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.tcp.disconnect", rawTcpDisconnect));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.tcp.toggle", rawTcpToggle));

	// -- Hex Memory Editor ----------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.hexEditor.open", () => hexEditorOpen(context)));

	// -- Project Setup Wizard -------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.projectWizard.open", () => ProjectWizardPanel.createOrShow(context.extensionUri)));

	// -- Memory Dump/Load -----------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.dumpMemory", xsdbDumpMemory));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.loadMemory", xsdbLoadMemory));

	// -- Clock & Power Panel --------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.clockPower.open", () => ClockPowerPanel.createOrShow(context.extensionUri)));

	// -- Hardware Mini-Map Panel -----------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.hwMinimap.open", () => HwMinimapPanel.createOrShow(context.extensionUri)));

	// -- Quick Reset Buttons --------------------------------------------
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.quickReset", xsdbQuickReset));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.resetProcessor", () => xsdbQuickResetTyped("processor")));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.xsdb.resetSystem", () => xsdbQuickResetTyped("system")));

	// -- Activity Bar Tools View ----------------------------------------
	const toolsProvider = new XilinxToolsProvider();
	context.subscriptions.push(vscode.window.createTreeView("xilinxDebugView", { treeDataProvider: toolsProvider }));

	// -- Reset Status Bar Item ------------------------------------------
	resetStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	resetStatusBarItem.text = "$(debug-restart) Reset Board";
	resetStatusBarItem.tooltip = "Quick reset the board via XSDB";
	resetStatusBarItem.command = "code-debug.xsdb.quickReset";
	context.subscriptions.push(resetStatusBarItem);

	// -- Connection Status Bar Items ------------------------------------
	serialStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
	serialStatusBarItem.command = "code-debug.serial.toggle";
	context.subscriptions.push(serialStatusBarItem);

	telnetStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48);
	telnetStatusBarItem.command = "code-debug.telnet.toggle";
	context.subscriptions.push(telnetStatusBarItem);

	tcpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 47);
	tcpStatusBarItem.command = "code-debug.tcp.toggle";
	context.subscriptions.push(tcpStatusBarItem);

	// Show/hide status bar item based on active debug session
	context.subscriptions.push(vscode.debug.onDidStartDebugSession(updateResetButtonVisibility));
	context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(updateResetButtonVisibility));
	context.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession(updateResetButtonVisibility));
	updateResetButtonVisibility();
	updateConnectionButtons();

	// Clean up terminal references when terminals are closed
	context.subscriptions.push(vscode.window.onDidCloseTerminal((t) => {
		if (t === activeSerialTerminal) {
			activeSerialTerminal = undefined;
			activeSerialPty = undefined;
			updateConnectionButtons();
		}
		if (t === activeTelnetTerminal) {
			activeTelnetTerminal = undefined;
			activeTelnetPty = undefined;
			updateConnectionButtons();
		}
		if (t === activeRawTcpTerminal) {
			activeRawTcpTerminal = undefined;
			activeRawTcpPty = undefined;
			updateConnectionButtons();
		}
	}));
}

const memoryLocationRegex = /^0x[0-9a-f]+$/;

function getMemoryRange(range: string) {
	if (!range)
		return undefined;
	range = range.replace(/\s+/g, "").toLowerCase();
	let index;
	if ((index = range.indexOf("+")) !== -1) {
		const from = range.substring(0, index);
		let length = range.substring(index + 1);
		if (!memoryLocationRegex.exec(from))
			return undefined;
		if (memoryLocationRegex.exec(length))
			length = parseInt(length.substring(2), 16).toString();
		return "from=" + encodeURIComponent(from) + "&length=" + encodeURIComponent(length);
	} else if ((index = range.indexOf("-")) !== -1) {
		const from = range.substring(0, index);
		const to = range.substring(index + 1);
		if (!memoryLocationRegex.exec(from))
			return undefined;
		if (!memoryLocationRegex.exec(to))
			return undefined;
		return "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
	} else if (memoryLocationRegex.exec(range))
		return "at=" + encodeURIComponent(range);
	else return undefined;
}

function examineMemory() {
	const socketlists = path.join(os.tmpdir(), "code-debug-sockets");
	if (!fs.existsSync(socketlists)) {
		if (process.platform === "win32")
			return vscode.window.showErrorMessage("This command is not available on windows");
		else
			return vscode.window.showErrorMessage("No debugging sessions available");
	}
	fs.readdir(socketlists, (err, files) => {
		if (err) {
			if (process.platform === "win32")
				return vscode.window.showErrorMessage("This command is not available on windows");
			else
				return vscode.window.showErrorMessage("No debugging sessions available");
		}
		const pickedFile = (file: string) => {
			vscode.window.showInputBox({ placeHolder: "Memory Location or Range", validateInput: range => getMemoryRange(range) === undefined ? "Range must either be in format 0xF00-0xF01, 0xF100+32 or 0xABC154" : "" }).then(range => {
				vscode.window.showTextDocument(vscode.Uri.parse("debugmemory://" + file + "?" + getMemoryRange(range)));
			});
		};
		if (files.length === 1)
			pickedFile(files[0]);
		else if (files.length > 0)
			vscode.window.showQuickPick(files, { placeHolder: "Running debugging instance" }).then(file => pickedFile(file));
		else if (process.platform === "win32")
			return vscode.window.showErrorMessage("This command is not available on windows");
		else
			vscode.window.showErrorMessage("No debugging sessions available");
	});
}

class MemoryContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
		return new Promise((resolve, reject) => {
			const conn = net.connect(path.join(os.tmpdir(), "code-debug-sockets", uri.authority.toLowerCase()));
			let from: number, to: number;
			let highlightAt = -1;
			const splits = uri.query.split("&");
			if (splits[0].split("=")[0] === "at") {
				const loc = parseInt(splits[0].split("=")[1].substring(2), 16);
				highlightAt = 64;
				from = Math.max(loc - 64, 0);
				to = Math.max(loc + 768, 0);
			} else if (splits[0].split("=")[0] === "from") {
				from = parseInt(splits[0].split("=")[1].substring(2), 16);
				if (splits[1].split("=")[0] === "to") {
					to = parseInt(splits[1].split("=")[1].substring(2), 16);
				} else if (splits[1].split("=")[0] === "length") {
					to = from + parseInt(splits[1].split("=")[1]);
				} else return reject("Invalid Range");
			} else return reject("Invalid Range");
			if (to < from)
				return reject("Negative Range");
			conn.write("examineMemory " + JSON.stringify([from, to - from + 1]));
			conn.once("data", data => {
				let formattedCode = "                  00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F\n";
				let index: number = from;
				const hexString = data.toString();
				let x = 0;
				let asciiLine = "";
				let byteNo = 0;
				for (let i = 0; i < hexString.length; i += 2) {
					if (x === 0) {
						let addr = index.toString(16);
						while (addr.length < 16) addr = '0' + addr;
						formattedCode += addr + "  ";
					}
					index++;

					const digit = hexString.substring(i, i + 2);
					const digitNum = parseInt(digit, 16);
					if (digitNum >= 32 && digitNum <= 126)
						asciiLine += String.fromCharCode(digitNum);
					else
						asciiLine += ".";

					if (highlightAt === byteNo) {
						formattedCode = formattedCode.slice(0, -1) + "[" + digit + "]";
					} else {
						formattedCode += digit + " ";
					}

					if (x === 7)
						formattedCode += " ";

					if (++x >= 16) {
						formattedCode += " " + asciiLine + "\n";
						x = 0;
						asciiLine = "";
					}
					byteNo++;
				}
				if (x > 0) {
					for (let i = 0; i <= 16 - x; i++) {
						formattedCode += "   ";
					}
					if (x >= 8)
						formattedCode = formattedCode.slice(0, -2);
					else
						formattedCode = formattedCode.slice(0, -1);
					formattedCode += asciiLine;
				}
				resolve(center("Memory Range from 0x" + from.toString(16) + " to 0x" + to.toString(16), 84) + "\n\n" + formattedCode);
				conn.destroy();
			});
		});
	}
}

function center(str: string, width: number): string {
	let left = true;
	while (str.length < width) {
		if (left) str = ' ' + str;
		else str = str + ' ';
		left = !left;
	}
	return str;
}

// ---------------------------------------------------------------------------
// XSDB runtime commands — communicate with the active debug session via
// custom DAP requests handled by XSDBZynqSession.
// ---------------------------------------------------------------------------

function getActiveXsdbSession(): vscode.DebugSession | undefined {
	const session = vscode.debug.activeDebugSession;
	if (!session || session.type !== "xsdb-gdb") {
		vscode.window.showErrorMessage("No active XSDB+GDB debug session");
		return undefined;
	}
	return session;
}

async function xsdbProgramFPGA() {
	const session = getActiveXsdbSession();
	if (!session) return;
	const files = await vscode.window.showOpenDialog({
		canSelectMany: false,
		filters: { "Bitstream": ["bit", "pdi"] },
		openLabel: "Select Bitstream",
	});
	if (!files || files.length === 0) return;
	try {
		await session.customRequest("xsdb-programFPGA", { bitstreamPath: files[0].fsPath });
		vscode.window.showInformationMessage("FPGA programmed successfully.");
	} catch (err) {
		vscode.window.showErrorMessage(`FPGA programming failed: ${err}`);
	}
}

async function xsdbResetBoard() {
	const pick = await vscode.window.showQuickPick(
		[
			{ label: "processor", description: "Reset processor only" },
			{ label: "system", description: "Full system reset" },
		],
		{ placeHolder: "Select reset type" },
	);
	if (!pick) return;
	try {
		await performBoardReset(pick.label as "processor" | "system");
		vscode.window.showInformationMessage(`Board reset (${pick.label}) complete.`);
	} catch (err) {
		vscode.window.showErrorMessage(`Board reset failed: ${err}`);
	}
}

async function xsdbReadMemory() {
	const session = getActiveXsdbSession();
	if (!session) return;
	const input = await vscode.window.showInputBox({
		placeHolder: "0xF8000000 10",
		prompt: "Enter address and word count (e.g. 0xF8000000 10)",
	});
	if (!input) return;
	const parts = input.trim().split(/\s+/);
	const address = parseInt(parts[0], parts[0].startsWith("0x") ? 16 : 10);
	const count = parseInt(parts[1] || "1", 10);
	if (isNaN(address) || isNaN(count)) {
		vscode.window.showErrorMessage("Invalid address or count");
		return;
	}
	try {
		const result = await session.customRequest("xsdb-readMemory", { address, count });
		// result.entries is an array of { address, value }
		const channel = vscode.window.createOutputChannel("XSDB Memory");
		channel.clear();
		if (result && result.entries) {
			for (const e of result.entries) {
				channel.appendLine(`0x${e.address.toString(16).toUpperCase().padStart(8, '0')}: 0x${e.value.toString(16).toUpperCase().padStart(8, '0')}`);
			}
		}
		channel.show();
	} catch (err) {
		vscode.window.showErrorMessage(`Memory read failed: ${err}`);
	}
}

async function xsdbWriteMemory() {
	const session = getActiveXsdbSession();
	if (!session) return;
	const input = await vscode.window.showInputBox({
		placeHolder: "0xF8000000 0xDEADBEEF",
		prompt: "Enter address and value (e.g. 0xF8000000 0xDEADBEEF)",
	});
	if (!input) return;
	const parts = input.trim().split(/\s+/);
	const address = parseInt(parts[0], parts[0].startsWith("0x") ? 16 : 10);
	const value = parseInt(parts[1] || "0", parts[1]?.startsWith("0x") ? 16 : 10);
	if (isNaN(address) || isNaN(value)) {
		vscode.window.showErrorMessage("Invalid address or value");
		return;
	}
	try {
		await session.customRequest("xsdb-writeMemory", { address, value });
		vscode.window.showInformationMessage(`Written 0x${value.toString(16)} to 0x${address.toString(16)}`);
	} catch (err) {
		vscode.window.showErrorMessage(`Memory write failed: ${err}`);
	}
}

async function xsdbSendCommand() {
	const session = getActiveXsdbSession();
	if (!session) return;
	const command = await vscode.window.showInputBox({
		placeHolder: "targets",
		prompt: "Enter XSDB command to execute",
	});
	if (!command) return;
	try {
		const result = await session.customRequest("xsdb-sendCommand", { command });
		const channel = vscode.window.createOutputChannel("XSDB Output");
		channel.clear();
		channel.appendLine(`xsdb% ${command}`);
		channel.appendLine(result?.output || "(no output)");
		channel.show();
	} catch (err) {
		vscode.window.showErrorMessage(`XSDB command failed: ${err}`);
	}
}

async function xsdbRunCrashAnalyzer() {
	const session = getActiveXsdbSession();
	if (!session) return;
	try {
		const result = await session.customRequest("xsdb-runCrashAnalyzer");
		if (result?.report) {
			const channel = vscode.window.createOutputChannel("XSDB Crash Analyzer");
			channel.clear();
			channel.appendLine(result.report);
			channel.show();
		} else {
			vscode.window.showWarningMessage(result?.note || "Crash analyzer did not find fault register data.");
		}
	} catch (err) {
		vscode.window.showErrorMessage(`Crash analyzer failed: ${err}`);
	}
}

// ---------------------------------------------------------------------------
// Memory Dump / Load commands
// ---------------------------------------------------------------------------

async function xsdbDumpMemory() {
	const session = getActiveXsdbSession();
	if (!session) return;

	const addrStr = await vscode.window.showInputBox({ prompt: "Start address (hex, e.g. 0x00100000)" });
	if (!addrStr) return;
	const address = parseInt(addrStr, 16);
	if (isNaN(address)) { vscode.window.showErrorMessage("Invalid address"); return; }

	const sizeStr = await vscode.window.showInputBox({ prompt: "Number of bytes to dump", value: "4096" });
	if (!sizeStr) return;
	const byteCount = parseInt(sizeStr, 10);
	if (isNaN(byteCount) || byteCount <= 0) { vscode.window.showErrorMessage("Invalid byte count"); return; }

	const uri = await vscode.window.showSaveDialog({
		filters: { "Binary files": ["bin"], "All files": ["*"] },
		defaultUri: vscode.Uri.file(`memory_dump_${addrStr}.bin`),
	});
	if (!uri) return;

	try {
		const result = await session.customRequest("xsdb-dumpMemory", { address, byteCount });
		const buffer = Buffer.from(result.data);
		await vscode.workspace.fs.writeFile(uri, buffer);
		vscode.window.showInformationMessage(`Dumped ${buffer.length} bytes to ${uri.fsPath}`);
	} catch (err) {
		vscode.window.showErrorMessage(`Memory dump failed: ${err}`);
	}
}

async function xsdbLoadMemory() {
	const session = getActiveXsdbSession();
	if (!session) return;

	const files = await vscode.window.showOpenDialog({
		canSelectMany: false,
		filters: { "Binary files": ["bin"], "All files": ["*"] },
	});
	if (!files || files.length === 0) return;

	const addrStr = await vscode.window.showInputBox({ prompt: "Target address (hex, e.g. 0x00100000)" });
	if (!addrStr) return;
	const address = parseInt(addrStr, 16);
	if (isNaN(address)) { vscode.window.showErrorMessage("Invalid address"); return; }

	try {
		const fileData = await vscode.workspace.fs.readFile(files[0]);
		const data = Array.from(fileData);
		await session.customRequest("xsdb-loadMemory", { address, data });
		vscode.window.showInformationMessage(`Loaded ${data.length} bytes to 0x${address.toString(16)}`);
	} catch (err) {
		vscode.window.showErrorMessage(`Memory load failed: ${err}`);
	}
}

// ---------------------------------------------------------------------------
// Serial Terminal commands
// ---------------------------------------------------------------------------

async function serialConnect() {
	const config = vscode.workspace.getConfiguration("xilinx-debug");

	// Detect available ports
	const ports = await detectSerialPorts();
	let selectedPort: string | undefined;
	if (ports.length > 0) {
		const defaultPort = config.get<string>("serial.defaultPort");
		const items = ports.map(p => ({ label: p, description: p === defaultPort ? "(default)" : "" }));
		const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select serial port" });
		if (!pick) return;
		selectedPort = pick.label;
	} else {
		selectedPort = await vscode.window.showInputBox({
			placeHolder: process.platform === "win32" ? "COM3" : "/dev/ttyUSB0",
			prompt: "No ports auto-detected. Enter serial port manually:",
			value: config.get<string>("serial.defaultPort") || "",
		});
		if (!selectedPort) return;
	}

	const defaultBaud = config.get<number>("serial.defaultBaudRate") || 115200;
	const baudStr = await vscode.window.showInputBox({
		placeHolder: String(defaultBaud),
		prompt: "Baud rate",
		value: String(defaultBaud),
	});
	if (!baudStr) return;
	const baudRate = parseInt(baudStr, 10);
	if (isNaN(baudRate)) {
		vscode.window.showErrorMessage("Invalid baud rate");
		return;
	}

	const serialConfig: SerialConfig = {
		port: selectedPort,
		baudRate,
		dataBits: 8,
		parity: "none",
		stopBits: 1,
		flowControl: "none",
	};

	// Disconnect existing serial terminal if any
	if (activeSerialPty) {
		activeSerialPty.dispose();
	}
	if (activeSerialTerminal) {
		activeSerialTerminal.dispose();
	}

	const pty = new SerialTerminalProvider(serialConfig);
	activeSerialPty = pty;
	const terminal = vscode.window.createTerminal({
		name: `UART: ${selectedPort}`,
		pty,
	});
	activeSerialTerminal = terminal;
	terminal.show();
	updateConnectionButtons();
}

function serialDisconnect() {
	if (activeSerialPty) {
		activeSerialPty.dispose();
		activeSerialPty = undefined;
	}
	if (activeSerialTerminal) {
		activeSerialTerminal.dispose();
		activeSerialTerminal = undefined;
	}
	updateConnectionButtons();
	vscode.window.showInformationMessage("Serial terminal disconnected.");
}

async function serialToggle() {
	if (activeSerialPty && activeSerialTerminal) {
		serialDisconnect();
		return;
	}
	await serialConnect();
}

// ---------------------------------------------------------------------------
// Telnet Terminal commands
// ---------------------------------------------------------------------------

async function telnetConnect() {
	const config = vscode.workspace.getConfiguration("xilinx-debug");

	const defaultHost = config.get<string>("telnet.defaultHost") || "127.0.0.1";
	const host = await vscode.window.showInputBox({
		placeHolder: defaultHost,
		prompt: "Telnet host",
		value: defaultHost,
	});
	if (!host) return;

	const defaultPort = config.get<number>("telnet.defaultPort") || 23;
	const portStr = await vscode.window.showInputBox({
		placeHolder: String(defaultPort),
		prompt: "Telnet port",
		value: String(defaultPort),
	});
	if (!portStr) return;
	const port = parseInt(portStr, 10);
	if (isNaN(port)) {
		vscode.window.showErrorMessage("Invalid port number");
		return;
	}

	const telnetConfig: TelnetConfig = { host, port };

	// Disconnect existing telnet terminal if any
	if (activeTelnetPty) {
		activeTelnetPty.dispose();
	}
	if (activeTelnetTerminal) {
		activeTelnetTerminal.dispose();
	}

	const pty = new TelnetTerminalProvider(telnetConfig);
	activeTelnetPty = pty;
	const terminal = vscode.window.createTerminal({
		name: `Telnet: ${host}:${port}`,
		pty,
	});
	activeTelnetTerminal = terminal;
	terminal.show();
	updateConnectionButtons();
}

function telnetDisconnect() {
	if (activeTelnetPty) {
		activeTelnetPty.dispose();
		activeTelnetPty = undefined;
	}
	if (activeTelnetTerminal) {
		activeTelnetTerminal.dispose();
		activeTelnetTerminal = undefined;
	}
	updateConnectionButtons();
	vscode.window.showInformationMessage("Telnet terminal disconnected.");
}

async function telnetToggle() {
	if (activeTelnetPty && activeTelnetTerminal) {
		telnetDisconnect();
		return;
	}
	await telnetConnect();
}

// ---------------------------------------------------------------------------
// Raw TCP Terminal commands
// ---------------------------------------------------------------------------

async function rawTcpConnect() {
	const config = vscode.workspace.getConfiguration("xilinx-debug");

	const defaultHost = config.get<string>("tcp.defaultHost") || "127.0.0.1";
	const host = await vscode.window.showInputBox({
		placeHolder: defaultHost,
		prompt: "Raw TCP host",
		value: defaultHost,
	});
	if (!host) return;

	const defaultPort = config.get<number>("tcp.defaultPort") || 5000;
	const portStr = await vscode.window.showInputBox({
		placeHolder: String(defaultPort),
		prompt: "Raw TCP port",
		value: String(defaultPort),
	});
	if (!portStr) return;
	const port = parseInt(portStr, 10);
	if (isNaN(port)) {
		vscode.window.showErrorMessage("Invalid port number");
		return;
	}

	const tcpConfig: RawTcpConfig = { host, port };

	if (activeRawTcpPty) {
		activeRawTcpPty.dispose();
	}
	if (activeRawTcpTerminal) {
		activeRawTcpTerminal.dispose();
	}

	const pty = new RawTcpTerminalProvider(tcpConfig);
	activeRawTcpPty = pty;
	const terminal = vscode.window.createTerminal({
		name: `TCP: ${host}:${port}`,
		pty,
	});
	activeRawTcpTerminal = terminal;
	terminal.show();
	updateConnectionButtons();
}

function rawTcpDisconnect() {
	if (activeRawTcpPty) {
		activeRawTcpPty.dispose();
		activeRawTcpPty = undefined;
	}
	if (activeRawTcpTerminal) {
		activeRawTcpTerminal.dispose();
		activeRawTcpTerminal = undefined;
	}
	updateConnectionButtons();
	vscode.window.showInformationMessage("Raw TCP terminal disconnected.");
}

async function rawTcpToggle() {
	if (activeRawTcpPty && activeRawTcpTerminal) {
		rawTcpDisconnect();
		return;
	}
	await rawTcpConnect();
}

// ---------------------------------------------------------------------------
// Hex Memory Editor
// ---------------------------------------------------------------------------

async function hexEditorOpen(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("xilinx-debug");
	const defaultByteCount = config.get<number>("hexEditor.defaultByteCount") || 256;

	const addrStr = await vscode.window.showInputBox({
		placeHolder: "0xF8000000",
		prompt: "Enter start address (hex)",
	});
	if (!addrStr) return;
	const address = parseInt(addrStr, addrStr.startsWith("0x") ? 16 : 10);
	if (isNaN(address)) {
		vscode.window.showErrorMessage("Invalid address");
		return;
	}

	const countStr = await vscode.window.showInputBox({
		placeHolder: String(defaultByteCount),
		prompt: "Number of bytes to read",
		value: String(defaultByteCount),
	});
	if (!countStr) return;
	const byteCount = parseInt(countStr, 10);
	if (isNaN(byteCount) || byteCount <= 0) {
		vscode.window.showErrorMessage("Invalid byte count");
		return;
	}

	HexEditorPanel.createOrShow(context.extensionUri, address, byteCount);
}

// ---------------------------------------------------------------------------
// Quick Reset commands
// ---------------------------------------------------------------------------

async function xsdbQuickReset() {
	// Check launch config or workspace setting for default reset type
	const config = vscode.workspace.getConfiguration("xilinx-debug");
	const resetType = (config.get<string>("xsdb.defaultResetType") || "processor") as "processor" | "system";

	try {
		await performBoardReset(resetType);
		vscode.window.showInformationMessage(`Board reset (${resetType}) complete.`);
	} catch (err) {
		vscode.window.showErrorMessage(`Board reset failed: ${err}`);
	}
}

async function xsdbQuickResetTyped(resetType: "processor" | "system") {
	try {
		await performBoardReset(resetType);
		vscode.window.showInformationMessage(`Board reset (${resetType}) complete.`);
	} catch (err) {
		vscode.window.showErrorMessage(`Board reset failed: ${err}`);
	}
}

async function performBoardReset(resetType: "processor" | "system"): Promise<void> {
	const active = vscode.debug.activeDebugSession;
	if (active && active.type === "xsdb-gdb") {
		await active.customRequest("xsdb-resetBoard", { resetType });
		return;
	}

	await runStandaloneXsdbReset(resetType);
}

async function runStandaloneXsdbReset(resetType: "processor" | "system"): Promise<void> {
	const config = vscode.workspace.getConfiguration("xilinx-debug");
	const configuredPath = (config.get<string>("xsdb.standalonePath") || "").trim();
	const xsdbPath = configuredPath || "xsdb";
	let hwServerUrl = (config.get<string>("xsdb.standaloneHwServerUrl") || "").trim();

	if (!hwServerUrl) {
		hwServerUrl = (await vscode.window.showInputBox({
			prompt: "hw_server URL for standalone reset (leave empty for local default)",
			placeHolder: "tcp:127.0.0.1:3121",
			value: "",
		}))?.trim() || "";
	}

	const commandLines = [
		hwServerUrl ? `connect -url ${hwServerUrl}` : "connect",
		`rst -${resetType}`,
		"disconnect",
		"exit",
	];

	const output = await new Promise<string>((resolve, reject) => {
		const child = cp.spawn(xsdbPath, ["-interactive"], {
			shell: true,
		});

		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("Standalone XSDB reset timed out"));
		}, 20000);

		child.stdout.on("data", d => { stdout += d.toString(); });
		child.stderr.on("data", d => { stderr += d.toString(); });
		child.on("error", err => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			const combined = `${stdout}\n${stderr}`.trim();
			if (code !== 0) {
				reject(new Error(combined || `xsdb exited with code ${code}`));
				return;
			}
			resolve(combined);
		});

		for (const line of commandLines) {
			child.stdin.write(line + "\n");
		}
		child.stdin.end();
	});

	if (/\berror:\b/i.test(output)) {
		throw new Error(output);
	}
}

function updateResetButtonVisibility(): void {
	if (!resetStatusBarItem) return;
	const session = vscode.debug.activeDebugSession;
	if (session && session.type === "xsdb-gdb") {
		resetStatusBarItem.show();
	} else {
		resetStatusBarItem.hide();
	}
}

function updateConnectionButtons(): void {
	if (serialStatusBarItem) {
		const connected = !!(activeSerialTerminal && activeSerialPty);
		serialStatusBarItem.text = connected ? "$(debug-disconnect) UART" : "$(plug) UART";
		serialStatusBarItem.tooltip = connected ? "Disconnect UART terminal" : "Connect UART terminal";
		serialStatusBarItem.show();
	}

	if (telnetStatusBarItem) {
		const connected = !!(activeTelnetTerminal && activeTelnetPty);
		telnetStatusBarItem.text = connected ? "$(debug-disconnect) Telnet" : "$(vm-connect) Telnet";
		telnetStatusBarItem.tooltip = connected ? "Disconnect Telnet terminal" : "Connect Telnet terminal";
		telnetStatusBarItem.show();
	}

	if (tcpStatusBarItem) {
		const connected = !!(activeRawTcpTerminal && activeRawTcpPty);
		tcpStatusBarItem.text = connected ? "$(debug-disconnect) TCP" : "$(radio-tower) TCP";
		tcpStatusBarItem.tooltip = connected ? "Disconnect raw TCP terminal" : "Connect raw TCP terminal";
		tcpStatusBarItem.show();
	}
}
