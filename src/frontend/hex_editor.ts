import * as vscode from "vscode";
import * as crypto from "crypto";
import { getHexEditorHtml } from "./hex_editor_html";

/**
 * Manages a webview panel that displays a read/write hex memory editor.
 * Works both with an active xsdb-gdb debug session (via custom DAP requests)
 * and in standalone mode (via an XSDBConnectionManager).
 */
export class HexEditorPanel {
	public static readonly viewType = "xilinxHexEditor";

	private static currentPanel: HexEditorPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private disposables: vscode.Disposable[] = [];
	private initialAddress: number;
	private initialByteCount: number;

	/**
	 * Show or create the hex editor panel.
	 */
	public static createOrShow(
		extensionUri: vscode.Uri,
		address: number,
		byteCount: number,
	): HexEditorPanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, reveal it
		if (HexEditorPanel.currentPanel) {
			HexEditorPanel.currentPanel.panel.reveal(column);
			HexEditorPanel.currentPanel.initialAddress = address;
			HexEditorPanel.currentPanel.initialByteCount = byteCount;
			HexEditorPanel.currentPanel.panel.webview.postMessage({
				type: "init",
				address,
				byteCount,
			});
			return HexEditorPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			HexEditorPanel.viewType,
			"Hex Memory Editor",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		HexEditorPanel.currentPanel = new HexEditorPanel(panel, extensionUri, address, byteCount);
		return HexEditorPanel.currentPanel;
	}

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		address: number,
		byteCount: number,
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.initialAddress = address;
		this.initialByteCount = byteCount;

		this.updateWebview();
		this.setupMessageHandler();

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private updateWebview(): void {
		const nonce = crypto.randomBytes(16).toString("hex");
		const cspSource = this.panel.webview.cspSource;
		this.panel.webview.html = getHexEditorHtml(nonce, cspSource);
	}

	private setupMessageHandler(): void {
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				switch (msg.type) {
					case "read":
						await this.handleRead(msg.address, msg.byteCount);
						break;
					case "write":
						await this.handleWrite(msg.address, msg.changes);
						break;
				}
			},
			null,
			this.disposables,
		);

		// Send initial parameters once the webview is ready
		// Use a short delay to ensure the webview JS has initialized
		setTimeout(() => {
			this.panel.webview.postMessage({
				type: "init",
				address: this.initialAddress,
				byteCount: this.initialByteCount,
			});
		}, 300);
	}

	private async handleRead(address: number, byteCount: number): Promise<void> {
		const session = this.getXsdbSession();
		if (!session) {
			this.panel.webview.postMessage({
				type: "error",
				message: "No active xsdb-gdb debug session. Start a debug session or use standalone XSDB connection.",
			});
			return;
		}

		try {
			// Read memory as 32-bit words, converting byte count to word count
			const wordCount = Math.ceil(byteCount / 4);
			const result = await session.customRequest("xsdb-readMemory", { address, count: wordCount });

			if (result && result.entries) {
				// Convert 32-bit word entries to byte array
				const bytes: number[] = [];
				for (const entry of result.entries) {
					const val = entry.value;
					// Little-endian: LSB first
					bytes.push(val & 0xFF);
					bytes.push((val >> 8) & 0xFF);
					bytes.push((val >> 16) & 0xFF);
					bytes.push((val >> 24) & 0xFF);
				}
				// Trim to requested byte count
				this.panel.webview.postMessage({
					type: "data",
					address,
					bytes: bytes.slice(0, byteCount),
				});
			} else {
				this.panel.webview.postMessage({
					type: "error",
					message: "No data returned from memory read.",
				});
			}
		} catch (err) {
			this.panel.webview.postMessage({
				type: "error",
				message: `Memory read failed: ${err}`,
			});
		}
	}

	private async handleWrite(address: number, changes: Array<{ offset: number; value: number }>): Promise<void> {
		const session = this.getXsdbSession();
		if (!session) {
			this.panel.webview.postMessage({
				type: "writeResult",
				success: false,
				error: "No active xsdb-gdb debug session.",
			});
			return;
		}

		try {
			// Group byte changes into 32-bit word writes
			const wordChanges: Map<number, number[]> = new Map();
			for (const change of changes) {
				const wordOffset = Math.floor(change.offset / 4) * 4;
				const wordAddr = address + wordOffset;
				if (!wordChanges.has(wordAddr)) {
					wordChanges.set(wordAddr, [0, 0, 0, 0]);
				}
				const byteIndex = change.offset % 4;
				wordChanges.get(wordAddr)![byteIndex] = change.value;
			}

			// For each modified word, read current value, apply byte changes, write back
			for (const [wordAddr, byteOverrides] of wordChanges) {
				// Read current word
				const result = await session.customRequest("xsdb-readMemory", { address: wordAddr, count: 1 });
				let currentValue = 0;
				if (result && result.entries && result.entries.length > 0) {
					currentValue = result.entries[0].value;
				}

				// Apply byte-level changes (little-endian)
				for (const change of changes) {
					const wordOffset = Math.floor(change.offset / 4) * 4;
					if (address + wordOffset === wordAddr) {
						const byteIndex = change.offset % 4;
						const mask = ~(0xFF << (byteIndex * 8));
						currentValue = (currentValue & mask) | (change.value << (byteIndex * 8));
					}
				}

				await session.customRequest("xsdb-writeMemory", { address: wordAddr, value: currentValue });
			}

			this.panel.webview.postMessage({
				type: "writeResult",
				success: true,
			});
		} catch (err) {
			this.panel.webview.postMessage({
				type: "writeResult",
				success: false,
				error: String(err),
			});
		}
	}

	private getXsdbSession(): vscode.DebugSession | undefined {
		const session = vscode.debug.activeDebugSession;
		if (session && session.type === "xsdb-gdb") {
			return session;
		}
		return undefined;
	}

	public dispose(): void {
		HexEditorPanel.currentPanel = undefined;
		this.panel.dispose();
		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}
