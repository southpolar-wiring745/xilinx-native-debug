/**
 * Returns the full HTML/CSS/JS content for the Project Setup Wizard webview.
 */
export function getProjectWizardHtml(nonce: string, cspSource: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Xilinx Project Setup Wizard</title>
<style nonce="${nonce}">
:root {
	--bg: var(--vscode-editor-background);
	--fg: var(--vscode-editor-foreground);
	--border: var(--vscode-widget-border, #444);
	--input-bg: var(--vscode-input-background);
	--input-fg: var(--vscode-input-foreground);
	--btn-bg: var(--vscode-button-background);
	--btn-fg: var(--vscode-button-foreground);
	--btn-hover: var(--vscode-button-hoverBackground);
	--section-bg: var(--vscode-sideBar-background, #1e1e1e);
	--accent: var(--vscode-focusBorder, #007acc);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; color: var(--fg); background: var(--bg); padding: 16px; max-width: 800px; margin: 0 auto; }
h1 { font-size: 18px; margin-bottom: 4px; }
.subtitle { opacity: 0.7; margin-bottom: 16px; font-size: 12px; }
.section { background: var(--section-bg); border: 1px solid var(--border); border-radius: 4px; margin-bottom: 12px; }
.section-header { padding: 10px 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; user-select: none; }
.section-header .chevron { transition: transform 0.2s; }
.section-header.collapsed .chevron { transform: rotate(-90deg); }
.section-body { padding: 0 14px 14px 14px; }
.section-body.hidden { display: none; }
.form-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.form-row label { min-width: 140px; font-size: 12px; }
.form-row input, .form-row select { flex: 1; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 4px 8px; font-size: 12px; font-family: inherit; }
.form-row select { appearance: auto; }
.form-row button { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 4px 12px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.form-row button:hover { background: var(--btn-hover); }
.form-row .hint { font-size: 11px; opacity: 0.6; margin-left: 148px; margin-bottom: 4px; }
.btn-primary { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 8px 24px; cursor: pointer; font-size: 13px; font-weight: 600; margin-top: 8px; }
.btn-primary:hover { background: var(--btn-hover); }
.btn-secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); padding: 8px 24px; cursor: pointer; font-size: 13px; margin-top: 8px; margin-right: 8px; }
.btn-secondary:hover { background: var(--input-bg); }
.actions { display: flex; gap: 8px; margin-top: 16px; }
.summary { background: var(--input-bg); border: 1px solid var(--border); padding: 10px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; max-height: 300px; overflow-y: auto; margin-bottom: 12px; border-radius: 2px; }
.import-zone { border: 2px dashed var(--border); border-radius: 4px; padding: 20px; text-align: center; margin-bottom: 12px; cursor: pointer; }
.import-zone:hover { border-color: var(--accent); }
.import-zone.active { border-color: var(--accent); background: var(--input-bg); }
.info-msg { padding: 8px; background: var(--input-bg); border-left: 3px solid var(--accent); margin-bottom: 8px; font-size: 12px; }
.checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.checkbox-row input[type="checkbox"] { width: auto; flex: none; }
</style>
</head>
<body>
<h1>Xilinx Project Setup Wizard</h1>
<p class="subtitle">Import an HDF/XSA hardware design or manually configure a debug project.</p>

<!-- Import Zone -->
<div class="import-zone" id="importZone">
	<p>Drop an <strong>.hdf</strong> or <strong>.xsa</strong> file here, or click to browse</p>
	<input type="file" id="fileInput" accept=".hdf,.xsa" style="display:none" />
</div>
<div id="importInfo" class="info-msg" style="display:none"></div>

<!-- Section 1: Hardware Platform -->
<div class="section">
	<div class="section-header" data-section="hw">
		<span class="chevron">▼</span> Section 1 — Hardware Platform
	</div>
	<div class="section-body" id="section-hw">
		<div class="form-row">
			<label>Board Family:</label>
			<select id="boardFamily">
				<option value="auto">Auto-detect</option>
				<option value="zynq7000">Zynq-7000</option>
				<option value="zynqmp">Zynq UltraScale+ (ZynqMP)</option>
				<option value="versal">Versal</option>
				<option value="fpga">FPGA Only</option>
			</select>
		</div>
		<div class="form-row">
			<label>Device Name:</label>
			<input type="text" id="deviceName" placeholder="e.g. xc7z020clg484-1" />
		</div>
	</div>
</div>

<!-- Section 2: FPGA & Init -->
<div class="section">
	<div class="section-header" data-section="fpga">
		<span class="chevron">▼</span> Section 2 — FPGA & Init
	</div>
	<div class="section-body" id="section-fpga">
		<div class="form-row">
			<label>Bitstream Path:</label>
			<input type="text" id="bitstreamPath" placeholder="./hw_platform/design.bit" />
			<button id="btnBrowseBit">Browse</button>
		</div>
		<div class="form-row">
			<label>LTX Path:</label>
			<input type="text" id="ltxPath" placeholder="./hw_platform/design.ltx (optional)" />
		</div>
		<div class="form-row">
			<label>PS Init Script:</label>
			<input type="text" id="psInitScript" placeholder="./hw_platform/ps7_init.tcl" />
			<button id="btnBrowsePsInit">Browse</button>
		</div>
		<div class="form-row">
			<label>Custom Init Script:</label>
			<input type="text" id="initScript" placeholder="(optional) overrides preset init" />
		</div>
		<div class="form-row">
			<label>HW Design Path:</label>
			<input type="text" id="hwDesignPath" placeholder="./hw_platform/design.hdf" />
			<button id="btnBrowseHw">Browse</button>
		</div>
		<div class="form-row">
			<label>Memory Ranges:</label>
			<input type="text" id="memRanges" placeholder="0x40000000 0xbfffffff (space-separated pairs)" />
		</div>
	</div>
</div>

<!-- Section 3: Debug Target -->
<div class="section">
	<div class="section-header" data-section="debug">
		<span class="chevron">▼</span> Section 3 — Debug Target
	</div>
	<div class="section-body" id="section-debug">
		<div class="form-row">
			<label>XSDB Path:</label>
			<input type="text" id="xsdbPath" value="xsdb" />
		</div>
		<div class="form-row">
			<label>HW Server URL:</label>
			<input type="text" id="hwServerUrl" placeholder="TCP:localhost:3121 (leave empty for local)" />
		</div>
		<div class="form-row">
			<label>JTAG Cable Name:</label>
			<input type="text" id="jtagCableName" placeholder="(optional)" />
		</div>
		<div class="form-row">
			<label>Init Target Filter:</label>
			<input type="text" id="initTargetFilter" placeholder="e.g. APU*" />
		</div>
		<div class="form-row">
			<label>Target Filter:</label>
			<input type="text" id="targetFilter" placeholder="e.g. ARM Cortex-A9 #0" />
		</div>
		<div class="form-row">
			<label>Reset Type:</label>
			<select id="resetType">
				<option value="processor">Processor</option>
				<option value="system">System</option>
				<option value="none">None</option>
			</select>
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="forceMemAccess" checked />
			<label for="forceMemAccess">Force Memory Access</label>
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="stopBeforePsInit" checked />
			<label for="stopBeforePsInit">Stop Before PS Init</label>
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="keepXsdbAlive" checked />
			<label for="keepXsdbAlive">Keep XSDB Alive During Debug</label>
		</div>
		<div class="form-row">
			<label>GDB Path:</label>
			<input type="text" id="gdbPath" value="arm-none-eabi-gdb" />
		</div>
		<div class="form-row">
			<label>GDB Target:</label>
			<input type="text" id="gdbTarget" value="extended-remote localhost:3000" />
		</div>
		<div class="form-row">
			<label>ELF Executable:</label>
			<input type="text" id="elfPath" placeholder="./build/app.elf" />
			<button id="btnBrowseElf">Browse</button>
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="remote" checked />
			<label for="remote">Remote GDB Session</label>
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="stopAtConnect" checked />
			<label for="stopAtConnect">Stop At Connect</label>
		</div>
	</div>
</div>

<!-- Section 4: Advanced Options -->
<div class="section">
	<div class="section-header collapsed" data-section="advanced">
		<span class="chevron">▼</span> Section 4 — Advanced Options
	</div>
	<div class="section-body hidden" id="section-advanced">
		<div class="form-row">
			<label>Register Preset:</label>
			<select id="registerPreset">
				<option value="core">Core</option>
				<option value="minimal">Minimal</option>
				<option value="all">All</option>
			</select>
		</div>
		<div class="form-row">
			<label>Peripheral Watch:</label>
			<input type="text" id="peripheralWatch" placeholder='JSON array (auto-filled from import)' />
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="freertosAwareness" />
			<label for="freertosAwareness">FreeRTOS Awareness</label>
		</div>
		<div class="form-row">
			<label>Map File Path:</label>
			<input type="text" id="mapFilePath" placeholder="./build/app.map (optional)" />
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="xsdbTrace" />
			<label for="xsdbTrace">XSDB Command Tracing</label>
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="crashAnalyzer" checked />
			<label for="crashAnalyzer">Crash Analyzer</label>
		</div>
		<div class="form-row">
			<label>XSDB Autorun:</label>
			<input type="text" id="xsdbAutorun" placeholder='XSDB commands, comma-separated' />
		</div>
		<div class="form-row">
			<label>Custom GDB Commands:</label>
			<input type="text" id="autorun" placeholder='Custom commands (prepended), comma-separated' />
		</div>
		<div class="form-row">
			<label>Required GDB Tail:</label>
			<input type="text" value='set print pretty on, set confirm off, file <elf>, load' disabled />
		</div>
	</div>
</div>

<!-- Section 5: Review & Generate -->
<div class="section">
	<div class="section-header" data-section="review">
		<span class="chevron">▼</span> Section 5 — Review & Generate
	</div>
	<div class="section-body" id="section-review">
		<button class="btn-secondary" id="btnPreview">Preview launch.json</button>
		<div class="summary" id="preview" style="display:none"></div>
		<div class="checkbox-row">
			<input type="checkbox" id="createProject" checked />
			<label for="createProject">Create project workspace (hw_platform/, src/, CMakeLists.txt)</label>
		</div>
		<div class="actions">
			<button class="btn-primary" id="btnGenerate">Generate launch.json</button>
		</div>
	</div>
</div>

<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();

	// Collapsible sections
	document.querySelectorAll('.section-header').forEach(header => {
		header.addEventListener('click', () => {
			const section = header.dataset.section;
			const body = document.getElementById('section-' + section);
			header.classList.toggle('collapsed');
			body.classList.toggle('hidden');
		});
	});

	// File import
	const importZone = document.getElementById('importZone');
	const fileInput = document.getElementById('fileInput');
	const importInfo = document.getElementById('importInfo');

	importZone.addEventListener('click', () => fileInput.click());
	importZone.addEventListener('dragover', e => { e.preventDefault(); importZone.classList.add('active'); });
	importZone.addEventListener('dragleave', () => importZone.classList.remove('active'));
	importZone.addEventListener('drop', e => {
		e.preventDefault();
		importZone.classList.remove('active');
		if (e.dataTransfer.files.length > 0) {
			handleFile(e.dataTransfer.files[0]);
		}
	});
	fileInput.addEventListener('change', () => {
		if (fileInput.files.length > 0) {
			handleFile(fileInput.files[0]);
		}
	});

	function handleFile(file) {
		const reader = new FileReader();
		reader.onload = () => {
			const data = new Uint8Array(reader.result);
			vscode.postMessage({ type: 'importFile', fileName: file.name, data: Array.from(data) });
		};
		reader.readAsArrayBuffer(file);
	}

	// Browse buttons
	document.getElementById('btnBrowseBit').addEventListener('click', (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		vscode.postMessage({ type: 'browse', field: 'bitstreamPath', filters: { 'Bitstream': ['bit', 'pdi'] } });
	});
	document.getElementById('btnBrowsePsInit').addEventListener('click', (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		vscode.postMessage({ type: 'browse', field: 'psInitScript', filters: { 'Tcl Scripts': ['tcl'] } });
	});
	document.getElementById('btnBrowseHw').addEventListener('click', (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		vscode.postMessage({ type: 'browse', field: 'hwDesignPath', filters: { 'HW Design': ['hdf', 'xsa'] } });
	});
	document.getElementById('btnBrowseElf').addEventListener('click', (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		vscode.postMessage({ type: 'browse', field: 'elfPath', filters: { 'ELF': ['elf'] } });
	});

	// Preview
	document.getElementById('btnPreview').addEventListener('click', () => {
		const config = gatherConfig();
		const preview = document.getElementById('preview');
		preview.style.display = 'block';
		preview.textContent = JSON.stringify(buildLaunchJson(config), null, '\\t');
	});

	// Generate
	document.getElementById('btnGenerate').addEventListener('click', () => {
		const config = gatherConfig();
		const launchJson = buildLaunchJson(config);
		const createProject = document.getElementById('createProject').checked;
		vscode.postMessage({ type: 'generate', config, launchJson, createProject });
	});

	function gatherConfig() {
		return {
			boardFamily: document.getElementById('boardFamily').value,
			deviceName: document.getElementById('deviceName').value,
			bitstreamPath: document.getElementById('bitstreamPath').value,
			ltxPath: document.getElementById('ltxPath').value,
			psInitScript: document.getElementById('psInitScript').value,
			initScript: document.getElementById('initScript').value,
			hwDesignPath: document.getElementById('hwDesignPath').value,
			memRanges: document.getElementById('memRanges').value,
			xsdbPath: document.getElementById('xsdbPath').value,
			hwServerUrl: document.getElementById('hwServerUrl').value,
			jtagCableName: document.getElementById('jtagCableName').value,
			initTargetFilter: document.getElementById('initTargetFilter').value,
			targetFilter: document.getElementById('targetFilter').value,
			resetType: document.getElementById('resetType').value,
			forceMemAccess: document.getElementById('forceMemAccess').checked,
			stopBeforePsInit: document.getElementById('stopBeforePsInit').checked,
			keepXsdbAlive: document.getElementById('keepXsdbAlive').checked,
			gdbPath: document.getElementById('gdbPath').value,
			gdbTarget: document.getElementById('gdbTarget').value,
			elfPath: document.getElementById('elfPath').value,
			remote: document.getElementById('remote').checked,
			stopAtConnect: document.getElementById('stopAtConnect').checked,
			registerPreset: document.getElementById('registerPreset').value,
			peripheralWatch: document.getElementById('peripheralWatch').value,
			freertosAwareness: document.getElementById('freertosAwareness').checked,
			mapFilePath: document.getElementById('mapFilePath').value,
			xsdbTrace: document.getElementById('xsdbTrace').checked,
			crashAnalyzer: document.getElementById('crashAnalyzer').checked,
			xsdbAutorun: document.getElementById('xsdbAutorun').value,
			autorun: document.getElementById('autorun').value,
		};
	}

	function buildLaunchJson(c) {
		const config = {
			type: 'xsdb-gdb',
			request: 'attach',
			name: 'Debug ' + (c.boardFamily === 'auto' ? 'Xilinx' : c.boardFamily),
			xsdbPath: c.xsdbPath || 'xsdb',
			gdbpath: c.gdbPath,
			target: c.gdbTarget,
			executable: c.elfPath,
			remote: !!c.remote,
			cwd: '\${workspaceRoot}',
			boardFamily: c.boardFamily,
			resetType: c.resetType,
			forceMemAccess: !!c.forceMemAccess,
			stopBeforePsInit: !!c.stopBeforePsInit,
			keepXsdbAlive: !!c.keepXsdbAlive,
			stopAtConnect: !!c.stopAtConnect,
			crashAnalyzer: c.crashAnalyzer !== false,
			valuesFormatting: 'parseText',
		};
		if (c.bitstreamPath) config.bitstreamPath = c.bitstreamPath;
		if (c.ltxPath) config.ltxPath = c.ltxPath;
		if (c.hwDesignPath) config.hwDesignPath = c.hwDesignPath;
		if (c.psInitScript) config.psInitScript = c.psInitScript;
		if (c.initScript) config.initScript = c.initScript;
		if (c.hwServerUrl) config.hwServerUrl = c.hwServerUrl;
		if (c.jtagCableName) config.jtagCableName = c.jtagCableName;
		if (c.initTargetFilter) config.initTargetFilter = c.initTargetFilter;
		if (c.targetFilter) config.targetFilter = c.targetFilter;
		if (c.memRanges) {
			config.loadhwMemRanges = c.memRanges.trim().split(/\\s*,\\s*|\\n/).filter(Boolean);
		}
		if (c.registerPreset && c.registerPreset !== 'core') config.registerPreset = c.registerPreset;
		if (c.freertosAwareness) config.freertosAwareness = true;
		if (c.mapFilePath) config.mapFilePath = c.mapFilePath;
		if (c.xsdbTrace) config.xsdbTraceCommands = true;
		if (c.xsdbAutorun) {
			const xsdbCmds = c.xsdbAutorun.split(',').map(s => s.trim()).filter(Boolean);
			if (xsdbCmds.length > 0) config.xsdbAutorun = xsdbCmds;
		}

		const customAutorun = c.autorun
			? c.autorun.split(',').map(s => s.trim()).filter(Boolean)
			: [];
		const elfPath = (c.elfPath && c.elfPath.trim()) ? c.elfPath.trim() : './build/app.elf';
		const requiredAutorun = [
			'set print pretty on',
			'set confirm off',
			'file ' + elfPath,
			'load',
		];
		const mergedAutorun = [];
		for (const cmd of customAutorun.concat(requiredAutorun)) {
			if (!mergedAutorun.includes(cmd)) mergedAutorun.push(cmd);
		}
		config.autorun = mergedAutorun;
		try {
			if (c.peripheralWatch) {
				const pw = JSON.parse(c.peripheralWatch);
				if (Array.isArray(pw) && pw.length > 0) config.peripheralWatch = pw;
			}
		} catch {}
		return config;
	}

	// Handle messages from extension
	window.addEventListener('message', event => {
		const msg = event.data;
		switch (msg.type) {
			case 'importResult':
				applyImportResult(msg);
				break;
			case 'browseResult':
				if (msg.field && msg.path) {
					const el = document.getElementById(msg.field);
					if (el) el.value = msg.path;
				}
				break;
		}
	});

	function applyImportResult(msg) {
		if (msg.error) {
			importInfo.style.display = 'block';
			importInfo.textContent = 'Import error: ' + msg.error;
			return;
		}
		importInfo.style.display = 'block';
		importInfo.textContent = 'Imported: ' + msg.fileName + ' — ' + msg.processor.type + ' (' + msg.processor.arch + ')';

		// Auto-fill fields
		if (msg.processor.type === 'zynq7000') {
			document.getElementById('boardFamily').value = 'zynq7000';
			document.getElementById('gdbPath').value = 'arm-none-eabi-gdb';
			document.getElementById('initTargetFilter').value = 'APU*';
			document.getElementById('targetFilter').value = 'ARM Cortex-A9 #0';
		} else if (msg.processor.type === 'zynqmp') {
			document.getElementById('boardFamily').value = 'zynqmp';
			document.getElementById('gdbPath').value = 'aarch64-none-elf-gdb';
			document.getElementById('initTargetFilter').value = 'APU*';
			document.getElementById('targetFilter').value = 'Cortex-A53 #0';
		} else if (msg.processor.type === 'versal') {
			document.getElementById('boardFamily').value = 'versal';
			document.getElementById('gdbPath').value = 'aarch64-none-elf-gdb';
			document.getElementById('targetFilter').value = 'Cortex-A72 #0';
		} else if (msg.processor.type === 'microblaze') {
			document.getElementById('boardFamily').value = 'fpga';
			document.getElementById('gdbPath').value = 'mb-gdb';
		}

		if (msg.deviceName) document.getElementById('deviceName').value = msg.deviceName;
		if (msg.bitstreamPath) document.getElementById('bitstreamPath').value = msg.bitstreamPath;
		if (msg.hwDesignPath) document.getElementById('hwDesignPath').value = msg.hwDesignPath;
		if (msg.psInitScript) document.getElementById('psInitScript').value = msg.psInitScript;
		document.getElementById('forceMemAccess').checked = true;
		document.getElementById('stopBeforePsInit').checked = true;
		document.getElementById('keepXsdbAlive').checked = true;
		document.getElementById('remote').checked = true;
		document.getElementById('stopAtConnect').checked = true;
		document.getElementById('crashAnalyzer').checked = true;
		if (msg.peripheralWatch) {
			document.getElementById('peripheralWatch').value = JSON.stringify(msg.peripheralWatch);
		}
		if (msg.memoryRanges) {
			document.getElementById('memRanges').value = msg.memoryRanges.map(
				r => r.start + ' ' + (parseInt(r.start, 16) + parseInt(r.size, 16) - 1).toString(16)
			).join(', ');
		}
	}
})();
</script>
</body>
</html>`;
}
