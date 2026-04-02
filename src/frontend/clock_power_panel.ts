import * as vscode from "vscode";
import * as crypto from "crypto";
import { getClockPowerHtml } from "./clock_power_html";

/**
 * Manages the Clock & Power Status webview panel.
 */
export class ClockPowerPanel {
	public static readonly viewType = "xilinxClockPower";

	private static currentPanel: ClockPowerPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri): ClockPowerPanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (ClockPowerPanel.currentPanel) {
			ClockPowerPanel.currentPanel.panel.reveal(column);
			return ClockPowerPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			ClockPowerPanel.viewType,
			"Clock & Power Status",
			column || vscode.ViewColumn.Two,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		ClockPowerPanel.currentPanel = new ClockPowerPanel(panel, extensionUri);
		return ClockPowerPanel.currentPanel;
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
		this.panel.webview.html = getClockPowerHtml(nonce, cspSource);
	}

	private setupMessageHandler(): void {
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				switch (msg.type) {
					case "refresh":
						await this.handleRefresh();
						break;
				}
			},
			null,
			this.disposables,
		);
	}

	private async handleRefresh(): Promise<void> {
		const session = vscode.debug.activeDebugSession;
		if (!session || session.type !== "xsdb-gdb") {
			this.panel.webview.postMessage({
				type: "error",
				message: "No active xsdb-gdb debug session. Start a debug session first.",
			});
			return;
		}

		try {
			const response = await session.customRequest("xsdb-readClockPower");
			this.panel.webview.postMessage({
				type: "clockPowerData",
				clocks: response.clocks,
				power: response.power,
				platform: response.platform,
			});
		} catch (e: any) {
			this.panel.webview.postMessage({
				type: "error",
				message: `Failed to read clock/power status: ${e.message || e}`,
			});
		}
	}

	private dispose(): void {
		ClockPowerPanel.currentPanel = undefined;
		this.panel.dispose();
		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) x.dispose();
		}
	}
}
