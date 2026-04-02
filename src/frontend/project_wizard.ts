import * as vscode from "vscode";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";
import { getProjectWizardHtml } from "./project_wizard_html";
import {
	parseXilinxContainer,
	XilinxContainer,
	generateLaunchSuggestion,
	generatePeripheralWatch,
	HardwarePlatform,
} from "../hdf-xsa-parser";

/**
 * Manages the Project Setup Wizard webview panel.
 */
export class ProjectWizardPanel {
	public static readonly viewType = "xilinxProjectWizard";

	private static currentPanel: ProjectWizardPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private disposables: vscode.Disposable[] = [];
	private browseDialogOpen = false;
	private importedArchiveBuffer: Buffer | undefined;
	private importedArchiveName: string | undefined;

	public static createOrShow(extensionUri: vscode.Uri): ProjectWizardPanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (ProjectWizardPanel.currentPanel) {
			ProjectWizardPanel.currentPanel.panel.reveal(column);
			return ProjectWizardPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			ProjectWizardPanel.viewType,
			"Xilinx Project Setup Wizard",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		ProjectWizardPanel.currentPanel = new ProjectWizardPanel(panel, extensionUri);
		return ProjectWizardPanel.currentPanel;
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
		this.panel.webview.html = getProjectWizardHtml(nonce, cspSource);
	}

	private setupMessageHandler(): void {
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				switch (msg.type) {
					case "importFile":
						await this.handleImport(msg.fileName, msg.data);
						break;
					case "browse":
						await this.handleBrowse(msg.field, msg.filters);
						break;
					case "generate":
						await this.handleGenerate(msg.config, msg.launchJson, msg.createProject);
						break;
				}
			},
			null,
			this.disposables,
		);
	}

	private async handleImport(fileName: string, data: number[]): Promise<void> {
		try {
			const buffer = Buffer.from(data);
			this.importedArchiveBuffer = buffer;
			this.importedArchiveName = fileName;
			const platform = parseXilinxContainer(buffer);
			const suggestion = generateLaunchSuggestion(platform);
			const peripheralWatch = generatePeripheralWatch(platform).map(p => ({
				name: p.name,
				address: p.baseAddress,
				count: 1,
				refreshOnStop: true,
			}));

			// Find TCL files for PS init
			const container = new XilinxContainer(buffer);
			const tclFiles = container.findTclFiles();
			const psInitFile = tclFiles.find(f =>
				f.includes("ps7_init") || f.includes("psu_init") || f.includes("psv_init")
			);

			this.panel.webview.postMessage({
				type: "importResult",
				fileName,
				processor: platform.processor,
				deviceName: platform.systemInfo.device,
				bitstreamPath: suggestion.bitstreamPath ? `./hw_platform/${suggestion.bitstreamPath}` : undefined,
				hwDesignPath: `./hw_platform/${fileName}`,
				psInitScript: psInitFile ? `./hw_platform/${path.basename(psInitFile)}` : undefined,
				peripheralWatch,
				memoryRanges: suggestion.memoryRanges,
			});
		} catch (e: any) {
			this.panel.webview.postMessage({
				type: "importResult",
				error: e.message || String(e),
			});
		}
	}

	private async handleBrowse(field: string, filters: Record<string, string[]>): Promise<void> {
		if (this.browseDialogOpen) {
			return;
		}

		const fileFilters: Record<string, string[]> = {};
		for (const [label, exts] of Object.entries(filters)) {
			fileFilters[label] = exts;
		}
		fileFilters["All Files"] = ["*"];

		this.browseDialogOpen = true;
		try {
			const uris = await vscode.window.showOpenDialog({
				canSelectMany: false,
				canSelectFiles: true,
				canSelectFolders: false,
				filters: fileFilters,
			});

			if (uris && uris.length > 0) {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				let filePath = uris[0].fsPath;
				if (workspaceFolder) {
					const relative = path.relative(workspaceFolder.uri.fsPath, filePath);
					if (!relative.startsWith("..")) {
						filePath = "./" + relative.replace(/\\/g, "/");
					}
				}
				this.panel.webview.postMessage({
					type: "browseResult",
					field,
					path: filePath,
				});
			}
		} finally {
			this.browseDialogOpen = false;
		}
	}

	private async handleGenerate(
		config: any,
		launchJson: any,
		createProject: boolean,
	): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			const openFolder = await vscode.window.showInformationMessage(
				"No workspace folder is open. Open a folder to generate the project.",
				"Open Folder",
			);
			if (openFolder) {
				await vscode.commands.executeCommand("vscode.openFolder");
			}
			return;
		}

		const rootPath = workspaceFolder.uri.fsPath;

		try {
			// Create .vscode/launch.json
			const vscodePath = path.join(rootPath, ".vscode");
			if (!fs.existsSync(vscodePath)) {
				fs.mkdirSync(vscodePath, { recursive: true });
			}

			const launchJsonPath = path.join(vscodePath, "launch.json");
			let launchConfig: any;
			if (fs.existsSync(launchJsonPath)) {
				try {
					const content = fs.readFileSync(launchJsonPath, "utf-8");
					launchConfig = JSON.parse(content);
					if (!Array.isArray(launchConfig.configurations)) {
						launchConfig.configurations = [];
					}
					launchConfig.configurations.push(launchJson);
				} catch {
					launchConfig = { version: "0.2.0", configurations: [launchJson] };
				}
			} else {
				launchConfig = { version: "0.2.0", configurations: [launchJson] };
			}
			fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, "\t"), "utf-8");

			if (createProject) {
				await this.scaffoldProject(rootPath, config);
			}

			await this.copyImportedHardwareFiles(rootPath, config);

			vscode.window.showInformationMessage("Xilinx project generated successfully!");
		} catch (e: any) {
			vscode.window.showErrorMessage(`Project generation failed: ${e.message || e}`);
		}
	}

	private async copyImportedHardwareFiles(rootPath: string, config: any): Promise<void> {
		let archiveBuffer = this.importedArchiveBuffer;
		let archiveName = this.importedArchiveName;

		if (!archiveBuffer) {
			const hwDesignPath = typeof config?.hwDesignPath === "string" ? config.hwDesignPath.trim() : "";
			if (!hwDesignPath) {
				return;
			}

			const resolvedPath = this.resolvePathFromWorkspace(rootPath, hwDesignPath);
			if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
				return;
			}

			const ext = path.extname(resolvedPath).toLowerCase();
			if (ext !== ".hdf" && ext !== ".xsa") {
				return;
			}

			archiveBuffer = fs.readFileSync(resolvedPath);
			archiveName = path.basename(resolvedPath);
		}

		if (!archiveBuffer || !archiveName) {
			return;
		}

		const hwPlatformDir = path.join(rootPath, "hw_platform");
		if (!fs.existsSync(hwPlatformDir)) {
			fs.mkdirSync(hwPlatformDir, { recursive: true });
		}

		const archivePath = path.join(hwPlatformDir, path.basename(archiveName));
		fs.writeFileSync(archivePath, archiveBuffer);

		const container = new XilinxContainer(archiveBuffer);
		for (const entryName of container.listFiles()) {
			const fileData = container.readFile(entryName);
			if (!fileData) {
				continue;
			}

			const outPath = path.join(hwPlatformDir, path.basename(entryName));
			fs.writeFileSync(outPath, fileData);
		}
	}

	private resolvePathFromWorkspace(rootPath: string, value: string): string | undefined {
		if (!value) {
			return undefined;
		}
		if (path.isAbsolute(value)) {
			return value;
		}
		const normalized = value.startsWith("./") ? value.substring(2) : value;
		return path.join(rootPath, normalized.replace(/\//g, path.sep));
	}

	private async scaffoldProject(rootPath: string, config: any): Promise<void> {
		// Create hw_platform/
		const hwPlatformDir = path.join(rootPath, "hw_platform");
		if (!fs.existsSync(hwPlatformDir)) {
			fs.mkdirSync(hwPlatformDir, { recursive: true });
		}

		// Create src/
		const srcDir = path.join(rootPath, "src");
		if (!fs.existsSync(srcDir)) {
			fs.mkdirSync(srcDir, { recursive: true });
		}

		// Create include/
		const includeDir = path.join(rootPath, "include");
		if (!fs.existsSync(includeDir)) {
			fs.mkdirSync(includeDir, { recursive: true });
		}

		// Create starter main.c
		const mainC = path.join(srcDir, "main.c");
		if (!fs.existsSync(mainC)) {
			fs.writeFileSync(mainC, this.getMainCTemplate(config.boardFamily), "utf-8");
		}

		// Create CMakeLists.txt or Makefile
		const cmakePath = path.join(rootPath, "CMakeLists.txt");
		if (!fs.existsSync(cmakePath)) {
			fs.writeFileSync(cmakePath, this.getCMakeTemplate(config), "utf-8");
		}

		// Create .vscode/settings.json with IntelliSense hints
		const settingsPath = path.join(rootPath, ".vscode", "settings.json");
		if (!fs.existsSync(settingsPath)) {
			const settings = {
				"C_Cpp.default.compilerPath": this.getCompilerPath(config.boardFamily),
				"C_Cpp.default.intelliSenseMode": "gcc-arm",
			};
			fs.writeFileSync(settingsPath, JSON.stringify(settings, null, "\t"), "utf-8");
		}
	}

	private getMainCTemplate(boardFamily: string): string {
		switch (boardFamily) {
			case "zynq7000":
				return `#include "xparameters.h"
#include "xil_printf.h"

int main(void) {
\txil_printf("Hello from Zynq-7000\\r\\n");

\twhile (1) {
\t\t/* Main loop */
\t}
\treturn 0;
}
`;
			case "zynqmp":
				return `#include "xparameters.h"
#include "xil_printf.h"

int main(void) {
\txil_printf("Hello from Zynq UltraScale+\\r\\n");

\twhile (1) {
\t\t/* Main loop */
\t}
\treturn 0;
}
`;
			default:
				return `#include <stdio.h>

int main(void) {
\t/* Application entry point */

\twhile (1) {
\t\t/* Main loop */
\t}
\treturn 0;
}
`;
		}
	}

	private getCMakeTemplate(config: any): string {
		const toolchain = this.getToolchainPrefix(config.boardFamily);
		return `cmake_minimum_required(VERSION 3.10)
project(xilinx_app C ASM)

set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER ${toolchain}gcc)
set(CMAKE_ASM_COMPILER ${toolchain}gcc)
set(CMAKE_OBJCOPY ${toolchain}objcopy)
set(CMAKE_SIZE ${toolchain}size)

set(CMAKE_C_FLAGS "-mcpu=${this.getCpuFlag(config.boardFamily)} -g -O0 -Wall")

# Add linker script path
# set(CMAKE_EXE_LINKER_FLAGS "-T \${CMAKE_SOURCE_DIR}/lscript.ld")

add_executable(\${PROJECT_NAME}.elf
\tsrc/main.c
)

target_include_directories(\${PROJECT_NAME}.elf PRIVATE
\tinclude
)
`;
	}

	private getToolchainPrefix(boardFamily: string): string {
		switch (boardFamily) {
			case "zynqmp":
			case "versal":
				return "aarch64-none-elf-";
			default:
				return "arm-none-eabi-";
		}
	}

	private getCpuFlag(boardFamily: string): string {
		switch (boardFamily) {
			case "zynq7000":
				return "cortex-a9";
			case "zynqmp":
				return "cortex-a53";
			case "versal":
				return "cortex-a72";
			default:
				return "cortex-a9";
		}
	}

	private getCompilerPath(boardFamily: string): string {
		switch (boardFamily) {
			case "zynqmp":
			case "versal":
				return "aarch64-none-elf-gcc";
			default:
				return "arm-none-eabi-gcc";
		}
	}

	private dispose(): void {
		ProjectWizardPanel.currentPanel = undefined;
		this.panel.dispose();
		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) x.dispose();
		}
	}
}
