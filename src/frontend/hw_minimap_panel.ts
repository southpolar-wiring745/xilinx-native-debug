import * as vscode from "vscode";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getHwMinimapHtml } from "./hw_minimap_html";
import { parseXilinxContainer } from "../hdf-xsa-parser";
import { buildTopology, HwTopology, RuntimeNodeState } from "../backend/hw_topology";

/**
 * Manages the Hardware Mini-Map webview panel.
 */
export class HwMinimapPanel {
	public static readonly viewType = "xilinxHwMinimap";

	private static currentPanel: HwMinimapPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private disposables: vscode.Disposable[] = [];
	private topology: HwTopology | undefined;
	private autoRefreshEnabled = false;
	private debugListener: vscode.Disposable | undefined;

	public static createOrShow(extensionUri: vscode.Uri): HwMinimapPanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (HwMinimapPanel.currentPanel) {
			HwMinimapPanel.currentPanel.panel.reveal(column);
			return HwMinimapPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			HwMinimapPanel.viewType,
			"Hardware Mini-Map",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		HwMinimapPanel.currentPanel = new HwMinimapPanel(panel, extensionUri);
		return HwMinimapPanel.currentPanel;
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
		this.panel.webview.html = getHwMinimapHtml(nonce, cspSource);
	}

	private setupMessageHandler(): void {
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				switch (msg.type) {
					case "loadDesign":
						await this.handleLoadDesign();
						break;
					case "refreshState":
						await this.handleRefreshState();
						break;
					case "setAutoRefresh":
						this.setAutoRefresh(msg.enabled);
						break;
					case "viewRegisters":
						await this.handleViewRegisters(msg.nodeId);
						break;
					case "jumpToSource":
						await this.handleJumpToSource(msg.nodeId);
						break;
				}
			},
			null,
			this.disposables,
		);
	}

	private async handleLoadDesign(): Promise<void> {
		const files = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: {
				"Hardware Design": ["xsa", "hdf"],
				"Hardware Handoff": ["hwh"],
			},
			openLabel: "Load Hardware Design",
		});
		if (!files || files.length === 0) return;

		const filePath = files[0].fsPath;
		try {
			let hwPlatform;

			if (filePath.endsWith(".hwh")) {
				// Parse standalone HWH file
				const { parseHwh } = await import("../hdf-xsa-parser/parsers");
				const { normalize, detectProcessor } = await import("../hdf-xsa-parser/normalizer");
				const xml = fs.readFileSync(filePath, "utf-8");
				const hwh = parseHwh(xml);
				const processor = detectProcessor(hwh.modules, hwh.arch);
				hwPlatform = normalize({
					containerType: "hdf",
					systemInfo: {
						board: hwh.board,
						part: "",
						arch: hwh.arch,
						device: hwh.device,
						package: "",
						speed: "",
						toolVersion: "",
					},
					hwh,
				});
			} else {
				// Parse XSA/HDF container
				const buf = fs.readFileSync(filePath);
				hwPlatform = parseXilinxContainer(buf);
			}

			this.topology = buildTopology(hwPlatform);

			this.panel.webview.postMessage({
				type: "topology",
				topology: this.topology,
			});
		} catch (e: any) {
			this.panel.webview.postMessage({
				type: "error",
				message: `Failed to parse hardware design: ${e.message || e}`,
			});
		}
	}

	private async handleRefreshState(): Promise<void> {
		const session = vscode.debug.activeDebugSession;
		if (!session || session.type !== "xsdb-gdb") {
			this.panel.webview.postMessage({
				type: "error",
				message: "No active xsdb-gdb debug session. Start a debug session to poll runtime state.",
			});
			return;
		}

		if (!this.topology) {
			this.panel.webview.postMessage({
				type: "error",
				message: "No hardware design loaded. Load an .xsa or .hdf file first.",
			});
			return;
		}

		try {
			const response = await session.customRequest("xsdb-readClockPower");
			const states = this.deriveRuntimeStates(response);

			this.panel.webview.postMessage({
				type: "runtimeState",
				states,
			});
		} catch (e: any) {
			this.panel.webview.postMessage({
				type: "error",
				message: `Failed to read runtime state: ${e.message || e}`,
			});
		}
	}

	private deriveRuntimeStates(clockPowerResponse: any): RuntimeNodeState[] {
		const states: RuntimeNodeState[] = [];

		if (!this.topology) return states;

		// Try to derive state from clock/power data
		const clocks: any[] = clockPowerResponse?.clocks || [];
		const power: any[] = clockPowerResponse?.power || [];

		// Build a map of clock frequencies by name
		const clockMap = new Map<string, number>();
		for (const c of clocks) {
			if (c.name && c.freqMhz !== undefined) {
				clockMap.set(c.name.toLowerCase(), c.freqMhz);
			}
		}

		// Build a set of active power domains
		const activeDomains = new Set<string>();
		for (const p of power) {
			if (p.state === "on" || p.state === "active") {
				activeDomains.add((p.name || "").toLowerCase());
			}
		}

		for (const node of this.topology.nodes) {
			let state: RuntimeNodeState["state"] = "unknown";
			let clockFreqMhz: number | undefined;

			// Check if any clock matches this node
			const nodeLower = node.id.toLowerCase();
			for (const [clockName, freq] of clockMap) {
				if (clockName.includes(nodeLower) || nodeLower.includes(clockName)) {
					clockFreqMhz = freq;
					state = freq > 0 ? "active" : "inactive";
					break;
				}
			}

			// If CPU node and we have power data, check power domain
			if (node.kind === "cpu") {
				const hasActivePower = activeDomains.size === 0 || activeDomains.has("apu") || activeDomains.has("rpu") || activeDomains.has("fpd") || activeDomains.has("lpd");
				if (hasActivePower && state === "unknown") {
					state = "active";
				}
			}

			states.push({
				id: node.id,
				state,
				clockFreqMhz,
			});
		}

		return states;
	}

	private setAutoRefresh(enabled: boolean): void {
		this.autoRefreshEnabled = enabled;

		if (this.debugListener) {
			this.debugListener.dispose();
			this.debugListener = undefined;
		}

		if (enabled) {
			// Listen for debug session stopped events (breakpoints hit)
			this.debugListener = vscode.debug.onDidChangeActiveDebugSession(() => {
				if (this.autoRefreshEnabled && this.topology) {
					this.handleRefreshState();
				}
			});
			this.disposables.push(this.debugListener);
		}
	}

	private async handleViewRegisters(nodeId: string): Promise<void> {
		if (!this.topology) return;

		const node = this.topology.nodes.find(n => n.id === nodeId);
		if (!node || node.baseAddress === undefined) {
			vscode.window.showWarningMessage(`No register address available for ${nodeId}`);
			return;
		}

		// Open the hex editor at this node's base address
		vscode.commands.executeCommand("code-debug.hexEditor.open");
	}

	private async handleJumpToSource(nodeId: string): Promise<void> {
		if (!this.topology) return;

		const node = this.topology.nodes.find(n => n.id === nodeId);
		if (!node) return;

		// Search for xparameters.h or driver init in workspace
		const searchPattern = node.id.toUpperCase();
		const files = await vscode.workspace.findFiles("**/{xparameters,xparameters_ps}.h", "**/node_modules/**", 5);

		if (files.length > 0) {
			for (const f of files) {
				const doc = await vscode.workspace.openTextDocument(f);
				const text = doc.getText();
				const idx = text.indexOf(searchPattern);
				if (idx >= 0) {
					const pos = doc.positionAt(idx);
					await vscode.window.showTextDocument(doc, {
						selection: new vscode.Range(pos, pos),
						preview: true,
					});
					return;
				}
			}
			// If no match in content, just open the first xparameters.h
			await vscode.window.showTextDocument(files[0]);
		} else {
			// Try to find any .h or .c file referencing this IP
			const srcFiles = await vscode.workspace.findFiles("**/*.{c,h}", "**/node_modules/**", 20);
			for (const f of srcFiles) {
				const doc = await vscode.workspace.openTextDocument(f);
				const text = doc.getText();
				if (text.includes(node.id) || text.includes(searchPattern)) {
					const idx = text.indexOf(node.id);
					const pos = doc.positionAt(idx >= 0 ? idx : 0);
					await vscode.window.showTextDocument(doc, {
						selection: new vscode.Range(pos, pos),
						preview: true,
					});
					return;
				}
			}
			vscode.window.showInformationMessage(`No source reference found for ${nodeId}`);
		}
	}

	private dispose(): void {
		HwMinimapPanel.currentPanel = undefined;
		if (this.debugListener) {
			this.debugListener.dispose();
		}
		this.panel.dispose();
		while (this.disposables.length) {
			const d = this.disposables.pop();
			if (d) d.dispose();
		}
	}
}
