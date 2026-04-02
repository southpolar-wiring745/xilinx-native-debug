import * as vscode from "vscode";
import * as crypto from "crypto";
import * as fs from "fs";
import { getXdcConstraintsHtml } from "./xdc_constraints_html";
import { parseXdc, XdcParseResult } from "../backend/xdc_parser";

/**
 * Manages the XDC Constraints Viewer webview panel.
 */
export class XdcConstraintsPanel {
	public static readonly viewType = "xilinxXdcConstraints";

	private static currentPanel: XdcConstraintsPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private disposables: vscode.Disposable[] = [];
	private xdcData: XdcParseResult | undefined;

	public static createOrShow(extensionUri: vscode.Uri): XdcConstraintsPanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (XdcConstraintsPanel.currentPanel) {
			XdcConstraintsPanel.currentPanel.panel.reveal(column);
			return XdcConstraintsPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			XdcConstraintsPanel.viewType,
			"XDC Constraints",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		XdcConstraintsPanel.currentPanel = new XdcConstraintsPanel(panel, extensionUri);
		return XdcConstraintsPanel.currentPanel;
	}

	/**
	 * Load an XDC file directly (called from Mini-Map or command).
	 */
	public static loadFile(extensionUri: vscode.Uri, filePath: string): void {
		const p = XdcConstraintsPanel.createOrShow(extensionUri);
		p.loadXdcFile(filePath);
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
		this.panel.webview.html = getXdcConstraintsHtml(nonce, cspSource);
	}

	private setupMessageHandler(): void {
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				switch (msg.type) {
					case "loadXdc":
						await this.handleLoadXdc();
						break;
				}
			},
			null,
			this.disposables,
		);
	}

	private async handleLoadXdc(): Promise<void> {
		const files = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: {
				"Xilinx Design Constraints": ["xdc"],
				"All Files": ["*"],
			},
			openLabel: "Load XDC Constraints",
		});
		if (!files || files.length === 0) return;

		this.loadXdcFile(files[0].fsPath);
	}

	private loadXdcFile(filePath: string): void {
		try {
			const text = fs.readFileSync(filePath, "utf-8");
			this.xdcData = parseXdc(text);

			// Convert portMap to serializable arrays for the webview
			const data = {
				pins: this.xdcData.pins,
				clocks: this.xdcData.clocks,
				debugCores: this.xdcData.debugCores,
			};

			this.panel.webview.postMessage({
				type: "xdcData",
				data,
			});
		} catch (e: any) {
			this.panel.webview.postMessage({
				type: "error",
				message: `Failed to parse XDC file: ${e.message || e}`,
			});
		}
	}

	/**
	 * Get the current parsed XDC data (for mini-map overlay integration).
	 */
	public getXdcData(): XdcParseResult | undefined {
		return this.xdcData;
	}

	private dispose(): void {
		XdcConstraintsPanel.currentPanel = undefined;
		this.panel.dispose();
		for (const d of this.disposables) d.dispose();
		this.disposables = [];
	}
}
