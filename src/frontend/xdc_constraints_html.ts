/**
 * Returns the full HTML/CSS/JS for the XDC Constraints Viewer webview panel.
 * Visualizes FPGA pin assignments, I/O standards, clock constraints, and
 * provides an interactive package-pin table with search/filter.
 */
export function getXdcConstraintsHtml(nonce: string, cspSource: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XDC Constraints Viewer</title>
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
	--success: var(--vscode-testing-iconPassed, #89d185);
	--error: var(--vscode-testing-iconFailed, #f48771);
	--warn: var(--vscode-editorWarning-foreground, #cca700);
	--panel-bg: var(--vscode-sideBar-background, #252526);
	--highlight: var(--vscode-focusBorder, #007fd4);
	--mono: var(--vscode-editor-font-family, monospace);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; color: var(--fg); background: var(--bg); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }

/* Toolbar */
.toolbar {
	display: flex; gap: 8px; padding: 8px 12px; align-items: center;
	border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap;
}
.toolbar h1 { font-size: 14px; margin-right: 8px; white-space: nowrap; }
.toolbar button {
	background: var(--btn-bg); color: var(--btn-fg); border: none;
	padding: 3px 10px; cursor: pointer; font-size: 11px; border-radius: 2px;
}
.toolbar button:hover { background: var(--btn-hover); }
.toolbar .sep { width: 1px; height: 20px; background: var(--border); }
.toolbar .status { font-size: 11px; opacity: 0.7; margin-left: auto; }
.toolbar input[type="text"] {
	background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border);
	padding: 2px 8px; font-size: 11px; border-radius: 2px; width: 200px;
}

/* Tabs */
.tabs {
	display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.tab {
	padding: 6px 16px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent;
	opacity: 0.7;
}
.tab:hover { opacity: 1; }
.tab.active { opacity: 1; border-bottom-color: var(--highlight); font-weight: 600; }

/* Main area */
.main { flex: 1; overflow: hidden; position: relative; }

/* Tab content */
.tab-content { display: none; height: 100%; overflow: auto; }
.tab-content.active { display: block; }

/* ──── Pin Table ──── */
.pin-table-wrap { padding: 8px; }
table.pin-table { width: 100%; border-collapse: collapse; font-size: 12px; }
table.pin-table th {
	position: sticky; top: 0; background: var(--panel-bg); text-align: left;
	padding: 6px 10px; border-bottom: 2px solid var(--border); font-size: 11px;
	cursor: pointer; user-select: none;
}
table.pin-table th:hover { text-decoration: underline; }
table.pin-table td { padding: 4px 10px; border-bottom: 1px solid var(--border); }
table.pin-table tr:hover td { background: rgba(255,255,255,0.03); }
table.pin-table td.mono { font-family: var(--mono); font-size: 11px; }
table.pin-table .io-badge {
	display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
	font-weight: 600;
}
table.pin-table .io-badge.lvcmos33 { background: #2d5a27; color: #89d185; }
table.pin-table .io-badge.lvcmos25 { background: #27455a; color: #85b5d1; }
table.pin-table .io-badge.lvcmos18 { background: #5a4b27; color: #d1c385; }
table.pin-table .io-badge.lvds { background: #5a2727; color: #d18585; }
table.pin-table .io-badge.default { background: var(--panel-bg); color: var(--fg); }
table.pin-table .slew-badge {
	display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
	background: var(--panel-bg); border: 1px solid var(--border);
}
table.pin-table .slew-badge.fast { border-color: var(--warn); color: var(--warn); }

/* ──── Clock Summary ──── */
.clock-cards { padding: 12px; display: flex; flex-wrap: wrap; gap: 12px; }
.clock-card {
	background: var(--panel-bg); border: 1px solid var(--border); border-radius: 6px;
	padding: 14px 18px; min-width: 240px; flex: 1; max-width: 400px;
}
.clock-card .cc-name { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
.clock-card .cc-port { font-family: var(--mono); font-size: 11px; opacity: 0.7; }
.clock-card .cc-row { display: flex; gap: 8px; margin-top: 6px; font-size: 12px; }
.clock-card .cc-label { opacity: 0.6; min-width: 70px; }
.clock-card .cc-val { font-family: var(--mono); font-weight: 600; }
.clock-card .cc-freq { color: var(--success); font-size: 18px; font-weight: 700; margin-top: 6px; }

/* ──── Pin Map (visual grid) ──── */
.pinmap-wrap { padding: 12px; }
.pinmap-legend { margin-bottom: 12px; font-size: 11px; display: flex; gap: 16px; flex-wrap: wrap; }
.pinmap-legend-item { display: flex; align-items: center; gap: 4px; }
.pinmap-legend-dot { width: 12px; height: 12px; border-radius: 2px; border: 1px solid var(--border); }

.pinmap-grid {
	display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
	gap: 3px; max-width: 1200px;
}
.pinmap-cell {
	background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px;
	padding: 4px; text-align: center; font-size: 9px; font-family: var(--mono);
	cursor: default; min-height: 36px; display: flex; flex-direction: column;
	align-items: center; justify-content: center; transition: transform 0.1s;
}
.pinmap-cell:hover { transform: scale(1.1); z-index: 10; border-color: var(--highlight); }
.pinmap-cell.assigned { border-color: var(--success); }
.pinmap-cell .pm-pin { font-weight: 700; font-size: 10px; }
.pinmap-cell .pm-port { font-size: 8px; opacity: 0.7; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ──── Debug Cores ──── */
.debug-list { padding: 12px; }
.debug-item { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px 12px; margin-bottom: 6px; }
.debug-item .di-prop { font-weight: 600; }
.debug-item .di-val { font-family: var(--mono); opacity: 0.8; }
.debug-item .di-target { font-size: 11px; opacity: 0.6; }

/* No data */
.no-data { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.5; font-size: 14px; flex-direction: column; gap: 12px; }
.no-data button { font-size: 13px; padding: 6px 16px; }
.error-bar { background: var(--error); color: #fff; padding: 6px 12px; font-size: 12px; display: none; flex-shrink: 0; }
</style>
</head>
<body>

<div class="toolbar">
	<h1>XDC Constraints Viewer</h1>
	<div class="sep"></div>
	<button id="btnLoadXdc">Load .xdc File</button>
	<div class="sep"></div>
	<input type="text" id="searchInput" placeholder="Filter ports or pins...">
	<div class="sep"></div>
	<span class="status" id="statusLabel">No constraints loaded</span>
</div>

<div class="error-bar" id="errorBar"></div>

<div class="tabs">
	<div class="tab active" data-tab="pins">Pin Assignments</div>
	<div class="tab" data-tab="clocks">Clock Constraints</div>
	<div class="tab" data-tab="pinmap">Pin Map</div>
	<div class="tab" data-tab="debug">Debug Cores</div>
</div>

<div class="main">
	<div class="tab-content active" id="tab-pins">
		<div class="no-data" id="pinNoData">
			<span>No XDC file loaded</span>
			<button id="btnLoadXdcAlt">Load .xdc File</button>
		</div>
		<div class="pin-table-wrap" id="pinTableWrap" style="display:none">
			<table class="pin-table" id="pinTable">
				<thead>
					<tr>
						<th data-sort="port">Port</th>
						<th data-sort="pin">Package Pin</th>
						<th data-sort="io">I/O Standard</th>
						<th data-sort="slew">Slew</th>
						<th data-sort="drive">Drive</th>
						<th data-sort="pull">Pull</th>
					</tr>
				</thead>
				<tbody id="pinTableBody"></tbody>
			</table>
		</div>
	</div>

	<div class="tab-content" id="tab-clocks">
		<div class="clock-cards" id="clockCards">
			<div class="no-data">No clock constraints</div>
		</div>
	</div>

	<div class="tab-content" id="tab-pinmap">
		<div class="pinmap-wrap" id="pinmapWrap">
			<div class="pinmap-legend" id="pinmapLegend"></div>
			<div class="pinmap-grid" id="pinmapGrid"></div>
		</div>
	</div>

	<div class="tab-content" id="tab-debug">
		<div class="debug-list" id="debugList">
			<div class="no-data">No debug core constraints</div>
		</div>
	</div>
</div>

<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();

	let xdcData = null; // {pins:[], clocks:[], debugCores:[]}
	let sortCol = 'port';
	let sortAsc = true;
	let filterText = '';

	// ─── Toolbar ──────────────────────────────────────────────────────

	document.getElementById('btnLoadXdc').addEventListener('click', () => {
		vscode.postMessage({ type: 'loadXdc' });
	});
	document.getElementById('btnLoadXdcAlt').addEventListener('click', () => {
		vscode.postMessage({ type: 'loadXdc' });
	});
	document.getElementById('searchInput').addEventListener('input', (e) => {
		filterText = e.target.value.toLowerCase();
		if (xdcData) renderPinTable();
	});

	// ─── Tab switching ────────────────────────────────────────────────

	document.querySelectorAll('.tab').forEach(tab => {
		tab.addEventListener('click', () => {
			document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
			document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
			tab.classList.add('active');
			document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
		});
	});

	// ─── Pin table sorting ────────────────────────────────────────────

	document.querySelectorAll('#pinTable th[data-sort]').forEach(th => {
		th.addEventListener('click', () => {
			const col = th.dataset.sort;
			if (sortCol === col) sortAsc = !sortAsc;
			else { sortCol = col; sortAsc = true; }
			renderPinTable();
		});
	});

	// ─── Render functions ─────────────────────────────────────────────

	function renderPinTable() {
		const tbody = document.getElementById('pinTableBody');
		tbody.innerHTML = '';

		let filtered = xdcData.pins;
		if (filterText) {
			filtered = filtered.filter(p =>
				(p.port || '').toLowerCase().includes(filterText) ||
				(p.packagePin || '').toLowerCase().includes(filterText) ||
				(p.ioStandard || '').toLowerCase().includes(filterText)
			);
		}

		const getter = {
			port: p => p.port || '',
			pin: p => p.packagePin || '',
			io: p => p.ioStandard || '',
			slew: p => p.slew || '',
			drive: p => p.drive || 0,
			pull: p => p.pullType || '',
		};
		const fn = getter[sortCol] || getter.port;
		filtered.sort((a, b) => {
			const va = fn(a), vb = fn(b);
			const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
			return sortAsc ? cmp : -cmp;
		});

		for (const p of filtered) {
			const tr = document.createElement('tr');

			const tdPort = document.createElement('td');
			tdPort.className = 'mono';
			tdPort.textContent = p.port;
			tr.appendChild(tdPort);

			const tdPin = document.createElement('td');
			tdPin.className = 'mono';
			tdPin.textContent = p.packagePin || '—';
			tr.appendChild(tdPin);

			const tdIo = document.createElement('td');
			if (p.ioStandard) {
				const badge = document.createElement('span');
				badge.className = 'io-badge ' + ioClass(p.ioStandard);
				badge.textContent = p.ioStandard;
				tdIo.appendChild(badge);
			} else {
				tdIo.textContent = '—';
			}
			tr.appendChild(tdIo);

			const tdSlew = document.createElement('td');
			if (p.slew) {
				const badge = document.createElement('span');
				badge.className = 'slew-badge' + (p.slew.toUpperCase() === 'FAST' ? ' fast' : '');
				badge.textContent = p.slew;
				tdSlew.appendChild(badge);
			} else {
				tdSlew.textContent = '—';
			}
			tr.appendChild(tdSlew);

			const tdDrive = document.createElement('td');
			tdDrive.textContent = p.drive ? p.drive + ' mA' : '—';
			tr.appendChild(tdDrive);

			const tdPull = document.createElement('td');
			tdPull.textContent = p.pullType || '—';
			tr.appendChild(tdPull);

			tbody.appendChild(tr);
		}

		document.getElementById('pinNoData').style.display = 'none';
		document.getElementById('pinTableWrap').style.display = '';
	}

	function renderClocks() {
		const container = document.getElementById('clockCards');
		container.innerHTML = '';

		if (!xdcData.clocks || xdcData.clocks.length === 0) {
			container.innerHTML = '<div class="no-data">No clock constraints found</div>';
			return;
		}

		for (const c of xdcData.clocks) {
			const card = document.createElement('div');
			card.className = 'clock-card';
			card.innerHTML =
				'<div class="cc-name">' + esc(c.name) + '</div>' +
				'<div class="cc-port">' + esc(c.port) + '</div>' +
				'<div class="cc-freq">' + c.frequencyMhz.toFixed(2) + ' MHz</div>' +
				'<div class="cc-row"><span class="cc-label">Period</span><span class="cc-val">' + c.period.toFixed(3) + ' ns</span></div>' +
				(c.waveform ? '<div class="cc-row"><span class="cc-label">Waveform</span><span class="cc-val">{' + c.waveform[0] + ', ' + c.waveform[1] + '}</span></div>' : '');
			container.appendChild(card);
		}
	}

	function renderPinMap() {
		const grid = document.getElementById('pinmapGrid');
		const legend = document.getElementById('pinmapLegend');
		grid.innerHTML = '';
		legend.innerHTML = '';

		if (!xdcData.pins || xdcData.pins.length === 0) return;

		// Collect unique I/O standards for legend
		const ioSet = new Set();
		for (const p of xdcData.pins) {
			if (p.ioStandard) ioSet.add(p.ioStandard);
		}

		const IO_COLORS = {
			'LVCMOS33': '#2d5a27',
			'LVCMOS25': '#27455a',
			'LVCMOS18': '#5a4b27',
			'LVDS': '#5a2727',
			'LVDS_25': '#5a2747',
			'SSTL15': '#27475a',
		};

		for (const io of ioSet) {
			const item = document.createElement('div');
			item.className = 'pinmap-legend-item';
			const dot = document.createElement('div');
			dot.className = 'pinmap-legend-dot';
			dot.style.background = IO_COLORS[io] || '#444';
			item.appendChild(dot);
			const label = document.createElement('span');
			label.textContent = io;
			item.appendChild(label);
			legend.appendChild(item);
		}

		// Render pin cells
		for (const p of xdcData.pins) {
			if (!p.packagePin) continue;
			const cell = document.createElement('div');
			cell.className = 'pinmap-cell assigned';
			cell.style.borderColor = IO_COLORS[p.ioStandard] || 'var(--success)';
			cell.style.background = (IO_COLORS[p.ioStandard] || '#333') + '40';
			cell.title = p.port + ' → ' + p.packagePin + (p.ioStandard ? ' [' + p.ioStandard + ']' : '') + (p.slew ? ' SLEW=' + p.slew : '');

			const pinSpan = document.createElement('div');
			pinSpan.className = 'pm-pin';
			pinSpan.textContent = p.packagePin;
			cell.appendChild(pinSpan);

			const portSpan = document.createElement('div');
			portSpan.className = 'pm-port';
			portSpan.textContent = p.port;
			cell.appendChild(portSpan);

			grid.appendChild(cell);
		}
	}

	function renderDebugCores() {
		const container = document.getElementById('debugList');
		container.innerHTML = '';

		if (!xdcData.debugCores || xdcData.debugCores.length === 0) {
			container.innerHTML = '<div class="no-data">No debug core constraints found</div>';
			return;
		}

		for (const d of xdcData.debugCores) {
			const div = document.createElement('div');
			div.className = 'debug-item';
			div.innerHTML =
				'<span class="di-prop">' + esc(d.property) + '</span> = <span class="di-val">' + esc(d.value) + '</span>' +
				'<div class="di-target">Target: ' + esc(d.target) + '</div>';
			container.appendChild(div);
		}
	}

	// ─── Helpers ──────────────────────────────────────────────────────

	function ioClass(std) {
		const s = (std || '').toLowerCase();
		if (s.includes('lvcmos33')) return 'lvcmos33';
		if (s.includes('lvcmos25')) return 'lvcmos25';
		if (s.includes('lvcmos18')) return 'lvcmos18';
		if (s.includes('lvds')) return 'lvds';
		return 'default';
	}

	function esc(s) {
		const d = document.createElement('div');
		d.textContent = s;
		return d.innerHTML;
	}

	// ─── Messages from extension ──────────────────────────────────────

	window.addEventListener('message', event => {
		const msg = event.data;
		switch (msg.type) {
			case 'xdcData':
				xdcData = msg.data;
				document.getElementById('statusLabel').textContent =
					(xdcData.pins.length) + ' pins, ' + (xdcData.clocks.length) + ' clocks, ' + (xdcData.debugCores.length) + ' debug cores';
				renderPinTable();
				renderClocks();
				renderPinMap();
				renderDebugCores();
				break;

			case 'error':
				errorBar.textContent = msg.message;
				errorBar.style.display = 'block';
				setTimeout(() => { errorBar.style.display = 'none'; }, 8000);
				break;
		}
	});
})();
</script>
</body>
</html>`;
}
