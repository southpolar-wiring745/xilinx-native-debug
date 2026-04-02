import * as vscode from "vscode";
import * as crypto from "crypto";
import * as fs from "fs";
import { getRegisterDeepDiveHtml } from "./register_deepdive_html";
import { getPeripheralMaps, matchNodeToPeripheral, PeripheralRegisterMap } from "../backend/register_bitfield";
import { buildTopology, HwTopology } from "../backend/hw_topology";
import { parseXilinxContainer } from "../hdf-xsa-parser";

/**
 * Manages the Register Deep-Dive webview panel.
 */
export class RegisterDeepDivePanel {
	public static readonly viewType = "xilinxRegisterDeepDive";

	private static currentPanel: RegisterDeepDivePanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private disposables: vscode.Disposable[] = [];
	private topology: HwTopology | undefined;

	public static createOrShow(extensionUri: vscode.Uri, topology?: HwTopology): RegisterDeepDivePanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (RegisterDeepDivePanel.currentPanel) {
			RegisterDeepDivePanel.currentPanel.panel.reveal(column);
			if (topology) {
				RegisterDeepDivePanel.currentPanel.setTopology(topology);
			}
			return RegisterDeepDivePanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			RegisterDeepDivePanel.viewType,
			"Register Deep Dive",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		RegisterDeepDivePanel.currentPanel = new RegisterDeepDivePanel(panel, extensionUri);
		if (topology) {
			RegisterDeepDivePanel.currentPanel.setTopology(topology);
		}
		return RegisterDeepDivePanel.currentPanel;
	}

	/**
	 * Open directly to a specific node from the Mini-Map.
	 */
	public static openForNode(extensionUri: vscode.Uri, topology: HwTopology, nodeId: string): void {
		const p = RegisterDeepDivePanel.createOrShow(extensionUri, topology);
		p.focusNode(nodeId);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel;
		this.extensionUri = extensionUri;

		this.updateWebview();
		this.setupMessageHandler();

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private updateWebview(): void {
		const nonce = crypto.randomBytes(16).toString("hex");
		const cspSource = this.panel.webview.cspSource;
		this.panel.webview.html = getRegisterDeepDiveHtml(nonce, cspSource);
	}

	public setTopology(topology: HwTopology): void {
		this.topology = topology;
		this.sendPeripherals();
	}

	private sendPeripherals(): void {
		if (!this.topology) return;

		const maps = getPeripheralMaps(this.topology.platform);

		// Also try to match topology nodes to known peripherals
		const matched: PeripheralRegisterMap[] = [...maps];
		for (const node of this.topology.nodes) {
			const m = matchNodeToPeripheral(node.id, node.ipType, node.baseAddress, this.topology.platform);
			if (m && !matched.find(x => x.name === m.name && x.baseAddress === m.baseAddress)) {
				matched.push(m);
			}
		}

		this.panel.webview.postMessage({
			type: "peripherals",
			peripherals: matched,
			platform: this.topology.platform,
		});
	}

	private focusNode(nodeId: string): void {
		if (!this.topology) return;
		const node = this.topology.nodes.find(n => n.id === nodeId);
		if (!node) return;

		const peri = matchNodeToPeripheral(node.id, node.ipType, node.baseAddress, this.topology.platform);
		if (peri) {
			// Send peripherals and indicate which to select
			this.sendPeripherals();
		}
	}

	private setupMessageHandler(): void {
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				switch (msg.type) {
					case "readRegister":
						await this.handleReadRegister(msg.address, msg.name);
						break;
					case "readRegisters":
						await this.handleReadRegisters(msg.addresses);
						break;
					case "writeRegister":
						await this.handleWriteRegister(msg.address, msg.value);
						break;
				}
			},
			null,
			this.disposables,
		);
	}

	private async handleReadRegister(address: number, name: string): Promise<void> {
		const session = vscode.debug.activeDebugSession;
		if (!session || session.type !== "xsdb-gdb") {
			this.panel.webview.postMessage({
				type: "error",
				message: "No active xsdb-gdb debug session.",
			});
			return;
		}

		try {
			const resp = await session.customRequest("xsdb-readMemory", {
				address,
				length: 4,
			});
			const value = resp?.value ?? resp?.data?.[0] ?? 0;
			this.panel.webview.postMessage({
				type: "registerValue",
				address,
				value,
				name,
			});
		} catch (e: any) {
			this.panel.webview.postMessage({
				type: "error",
				message: `Failed to read ${name} at 0x${address.toString(16)}: ${e.message || e}`,
			});
		}
	}

	private async handleReadRegisters(addresses: { address: number; name: string }[]): Promise<void> {
		const session = vscode.debug.activeDebugSession;
		if (!session || session.type !== "xsdb-gdb") {
			this.panel.webview.postMessage({
				type: "error",
				message: "No active xsdb-gdb debug session.",
			});
			return;
		}

		const values: { address: number; value: number; name: string }[] = [];
		for (const a of addresses) {
			try {
				const resp = await session.customRequest("xsdb-readMemory", {
					address: a.address,
					length: 4,
				});
				const value = resp?.value ?? resp?.data?.[0] ?? 0;
				values.push({ address: a.address, value, name: a.name });
			} catch {
				// Skip failed reads
			}
		}

		this.panel.webview.postMessage({
			type: "registerValues",
			values,
		});
	}

	private async handleWriteRegister(address: number, value: number): Promise<void> {
		const session = vscode.debug.activeDebugSession;
		if (!session || session.type !== "xsdb-gdb") {
			this.panel.webview.postMessage({
				type: "error",
				message: "No active xsdb-gdb debug session.",
			});
			return;
		}

		try {
			await session.customRequest("xsdb-writeMemory", {
				address,
				data: [value],
			});
			// Re-read the value after write
			await this.handleReadRegister(address, "");
		} catch (e: any) {
			this.panel.webview.postMessage({
				type: "error",
				message: `Failed to write 0x${value.toString(16)} to 0x${address.toString(16)}: ${e.message || e}`,
			});
		}
	}

	private dispose(): void {
		RegisterDeepDivePanel.currentPanel = undefined;
		this.panel.dispose();
		for (const d of this.disposables) d.dispose();
		this.disposables = [];
	}
}
