/**
 * Returns the full HTML/CSS/JS for the Register Deep-Dive webview panel.
 * Tree-based register and bitfield inspector with live read/write via DAP.
 */
export function getRegisterDeepDiveHtml(nonce: string, cspSource: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Register Deep Dive</title>
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
.toolbar select {
	background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border);
	padding: 2px 6px; font-size: 11px;
}

/* Main split */
.main { flex: 1; display: flex; overflow: hidden; }

/* Peripheral tree (left pane) */
.peri-tree {
	width: 260px; border-right: 1px solid var(--border); overflow-y: auto;
	flex-shrink: 0; padding: 8px;
}
.peri-item { cursor: pointer; padding: 4px 8px; border-radius: 3px; font-size: 12px; margin: 1px 0; }
.peri-item:hover { background: var(--input-bg); }
.peri-item.selected { background: var(--highlight); color: var(--btn-fg); }
.peri-item .peri-name { font-weight: 600; }
.peri-item .peri-addr { font-family: var(--mono); font-size: 10px; opacity: 0.6; margin-left: 6px; }

/* Register list (center) */
.reg-list {
	flex: 1; overflow-y: auto; padding: 0;
}
.reg-card {
	border-bottom: 1px solid var(--border); padding: 10px 14px;
}
.reg-header {
	display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none;
}
.reg-header .arrow { font-size: 10px; width: 14px; text-align: center; transition: transform 0.15s; }
.reg-header .arrow.open { transform: rotate(90deg); }
.reg-header .reg-name { font-weight: 700; font-size: 12px; }
.reg-header .reg-offset { font-family: var(--mono); font-size: 10px; opacity: 0.6; }
.reg-header .reg-val {
	font-family: var(--mono); font-size: 12px; margin-left: auto;
	background: var(--input-bg); border: 1px solid var(--border); padding: 1px 6px;
	border-radius: 2px; min-width: 90px; text-align: right;
}
.reg-header .reg-val.stale { opacity: 0.4; }
.reg-desc { font-size: 11px; opacity: 0.6; margin: 2px 0 0 24px; }

/* Bitfield grid */
.bitfield-grid { margin: 6px 0 0 24px; display: none; }
.bitfield-grid.open { display: block; }

.bf-visual {
	display: flex; flex-direction: row-reverse; height: 28px; border: 1px solid var(--border);
	border-radius: 3px; overflow: hidden; margin-bottom: 6px; font-size: 9px;
}
.bf-bit {
	flex: 1; display: flex; align-items: center; justify-content: center;
	border-left: 1px solid var(--border); font-family: var(--mono);
	cursor: default; position: relative; min-width: 0;
}
.bf-bit:last-child { border-left: none; }
.bf-bit.bit-1 { background: var(--highlight); opacity: 0.8; color: #fff; }
.bf-bit.bit-0 { background: var(--panel-bg); }
.bf-bit .bf-bitnum { position: absolute; top: -12px; font-size: 8px; opacity: 0.4; }

.bf-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.bf-table th { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--border); opacity: 0.6; font-weight: 400; font-size: 10px; }
.bf-table td { padding: 3px 6px; border-bottom: 1px solid var(--border); }
.bf-table td.bf-name { font-weight: 600; }
.bf-table td.bf-bits { font-family: var(--mono); font-size: 10px; opacity: 0.7; }
.bf-table td.bf-val { font-family: var(--mono); }
.bf-table td.bf-access { font-size: 10px; opacity: 0.6; }
.bf-table td.bf-desc { opacity: 0.7; max-width: 200px; }

/* Write controls */
.write-row { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.write-row input {
	background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border);
	padding: 2px 6px; font-family: var(--mono); font-size: 11px; width: 100px; border-radius: 2px;
}
.write-row button {
	background: var(--btn-bg); color: var(--btn-fg); border: none;
	padding: 2px 8px; cursor: pointer; font-size: 10px; border-radius: 2px;
}
.write-row button:hover { background: var(--btn-hover); }

/* No data */
.no-data { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.5; font-size: 14px; }

/* Error bar */
.error-bar { background: var(--error); color: #fff; padding: 6px 12px; font-size: 12px; display: none; flex-shrink: 0; }
</style>
</head>
<body>

<div class="toolbar">
	<h1>Register Deep Dive</h1>
	<div class="sep"></div>
	<button id="btnReadAll" title="Read all registers for selected peripheral">Read All</button>
	<button id="btnRefresh" title="Re-read last peripheral">Refresh</button>
	<div class="sep"></div>
	<label style="font-size:11px">Platform:</label>
	<span class="status" id="platformLabel">—</span>
	<div class="sep"></div>
	<span class="status" id="statusLabel">No peripheral selected</span>
</div>

<div class="error-bar" id="errorBar"></div>

<div class="main">
	<div class="peri-tree" id="periTree">
		<div class="no-data" id="periNoData">No design loaded</div>
	</div>

	<div class="reg-list" id="regList">
		<div class="no-data" id="regNoData">Select a peripheral</div>
	</div>
</div>

<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();

	let peripherals = []; // {name, baseAddress, description, registers:[{name,offset,width,description,fields:[]}]}
	let selectedPeri = null;
	let registerValues = {}; // "baseAddress+offset" -> value

	const periTree = document.getElementById('periTree');
	const periNoData = document.getElementById('periNoData');
	const regList = document.getElementById('regList');
	const regNoData = document.getElementById('regNoData');
	const errorBar = document.getElementById('errorBar');
	const statusLabel = document.getElementById('statusLabel');
	const platformLabel = document.getElementById('platformLabel');

	document.getElementById('btnReadAll').addEventListener('click', () => {
		if (selectedPeri) readAllRegisters(selectedPeri);
	});
	document.getElementById('btnRefresh').addEventListener('click', () => {
		if (selectedPeri) readAllRegisters(selectedPeri);
	});

	// ─── Render peripherals tree ──────────────────────────────────────

	function renderTree() {
		periTree.innerHTML = '';
		if (peripherals.length === 0) {
			periTree.appendChild(periNoData);
			return;
		}
		for (const p of peripherals) {
			const div = document.createElement('div');
			div.className = 'peri-item' + (selectedPeri && selectedPeri.name === p.name ? ' selected' : '');
			div.innerHTML = '<span class="peri-name">' + esc(p.name) + '</span>'
				+ '<span class="peri-addr">0x' + p.baseAddress.toString(16).toUpperCase() + '</span>'
				+ '<br><span style="font-size:10px;opacity:0.6">' + esc(p.description) + '</span>';
			div.addEventListener('click', () => {
				selectedPeri = p;
				renderTree();
				renderRegisters(p);
			});
			periTree.appendChild(div);
		}
	}

	// ─── Render registers ─────────────────────────────────────────────

	function renderRegisters(peri) {
		regList.innerHTML = '';
		statusLabel.textContent = peri.name + ' — ' + peri.registers.length + ' registers';

		for (const reg of peri.registers) {
			const addr = peri.baseAddress + reg.offset;
			const valKey = addr.toString();
			const hasVal = valKey in registerValues;
			const val = hasVal ? registerValues[valKey] : null;

			const card = document.createElement('div');
			card.className = 'reg-card';

			// Header
			const header = document.createElement('div');
			header.className = 'reg-header';
			const arrow = document.createElement('span');
			arrow.className = 'arrow';
			arrow.textContent = '▶';
			header.appendChild(arrow);

			const nameSpan = document.createElement('span');
			nameSpan.className = 'reg-name';
			nameSpan.textContent = reg.name;
			header.appendChild(nameSpan);

			const offSpan = document.createElement('span');
			offSpan.className = 'reg-offset';
			offSpan.textContent = '+0x' + reg.offset.toString(16).toUpperCase() + '  [0x' + addr.toString(16).toUpperCase() + ']';
			header.appendChild(offSpan);

			const valSpan = document.createElement('span');
			valSpan.className = 'reg-val' + (hasVal ? '' : ' stale');
			valSpan.textContent = hasVal ? '0x' + (val >>> 0).toString(16).toUpperCase().padStart(8, '0') : '--------';
			header.appendChild(valSpan);

			card.appendChild(header);

			// Description
			const desc = document.createElement('div');
			desc.className = 'reg-desc';
			desc.textContent = reg.description;
			card.appendChild(desc);

			// Bitfield grid
			const bfDiv = document.createElement('div');
			bfDiv.className = 'bitfield-grid';

			if (reg.fields && reg.fields.length) {
				// Visual bit bar (show 32 bits)
				const visual = document.createElement('div');
				visual.className = 'bf-visual';
				for (let b = 0; b < 32; b++) {
					const bitDiv = document.createElement('div');
					const bitVal = hasVal ? ((val >>> b) & 1) : 0;
					bitDiv.className = 'bf-bit' + (hasVal && bitVal ? ' bit-1' : ' bit-0');
					bitDiv.textContent = hasVal ? String(bitVal) : '·';
					// Find which field this bit belongs to
					const field = reg.fields.find(f => b >= f.bitLow && b <= f.bitHigh);
					if (field) bitDiv.title = field.name + '[' + b + ']';
					if (b % 4 === 0) {
						const numSpan = document.createElement('span');
						numSpan.className = 'bf-bitnum';
						numSpan.textContent = String(b);
						bitDiv.appendChild(numSpan);
					}
					visual.appendChild(bitDiv);
				}
				bfDiv.appendChild(visual);

				// Field table
				const table = document.createElement('table');
				table.className = 'bf-table';
				const thead = document.createElement('tr');
				['Field', 'Bits', 'Value', 'Access', 'Description'].forEach(h => {
					const th = document.createElement('th');
					th.textContent = h;
					thead.appendChild(th);
				});
				table.appendChild(thead);

				for (const f of reg.fields) {
					const tr = document.createElement('tr');
					const tdName = document.createElement('td');
					tdName.className = 'bf-name';
					tdName.textContent = f.name;
					tr.appendChild(tdName);

					const tdBits = document.createElement('td');
					tdBits.className = 'bf-bits';
					tdBits.textContent = f.bitHigh === f.bitLow ? '[' + f.bitLow + ']' : '[' + f.bitHigh + ':' + f.bitLow + ']';
					tr.appendChild(tdBits);

					const tdVal = document.createElement('td');
					tdVal.className = 'bf-val';
					if (hasVal) {
						const mask = ((1 << (f.bitHigh - f.bitLow + 1)) - 1) << f.bitLow;
						const raw = (val & mask) >>> f.bitLow;
						let display = '0x' + raw.toString(16);
						if (f.enumValues) {
							const ev = f.enumValues.find(e => e.value === raw);
							if (ev) display = ev.name + ' (' + raw + ')';
						} else if (f.bitHigh === f.bitLow) {
							display = raw ? '1' : '0';
						}
						tdVal.textContent = display;
					} else {
						tdVal.textContent = '—';
						tdVal.style.opacity = '0.4';
					}
					tr.appendChild(tdVal);

					const tdAccess = document.createElement('td');
					tdAccess.className = 'bf-access';
					tdAccess.textContent = f.access.toUpperCase();
					tr.appendChild(tdAccess);

					const tdDesc = document.createElement('td');
					tdDesc.className = 'bf-desc';
					tdDesc.textContent = f.description;
					tr.appendChild(tdDesc);

					table.appendChild(tr);
				}
				bfDiv.appendChild(table);

				// Write row (only if any field is writable)
				if (reg.fields.some(f => f.access === 'rw' || f.access === 'wo' || f.access === 'w1c')) {
					const wr = document.createElement('div');
					wr.className = 'write-row';
					const inp = document.createElement('input');
					inp.type = 'text';
					inp.placeholder = '0x00000000';
					inp.value = hasVal ? '0x' + (val >>> 0).toString(16).toUpperCase().padStart(8, '0') : '';
					wr.appendChild(inp);
					const btn = document.createElement('button');
					btn.textContent = 'Write';
					btn.addEventListener('click', () => {
						const wv = parseInt(inp.value, 16);
						if (!isNaN(wv)) {
							vscode.postMessage({ type: 'writeRegister', address: addr, value: wv });
						}
					});
					wr.appendChild(btn);
					const readBtn = document.createElement('button');
					readBtn.textContent = 'Read';
					readBtn.addEventListener('click', () => {
						vscode.postMessage({ type: 'readRegister', address: addr, name: reg.name });
					});
					wr.appendChild(readBtn);
					bfDiv.appendChild(wr);
				}
			}

			card.appendChild(bfDiv);

			// Toggle expand
			header.addEventListener('click', () => {
				const isOpen = bfDiv.classList.contains('open');
				bfDiv.classList.toggle('open');
				arrow.classList.toggle('open');
				if (!isOpen && !hasVal) {
					// Auto-read when expanding
					vscode.postMessage({ type: 'readRegister', address: addr, name: reg.name });
				}
			});

			regList.appendChild(card);
		}
	}

	// ─── Request helpers ──────────────────────────────────────────────

	function readAllRegisters(peri) {
		const addrs = peri.registers.map(r => ({
			address: peri.baseAddress + r.offset,
			name: r.name,
		}));
		vscode.postMessage({ type: 'readRegisters', addresses: addrs, peripheral: peri.name });
		statusLabel.textContent = 'Reading ' + addrs.length + ' registers...';
	}

	// ─── Messages from extension ──────────────────────────────────────

	window.addEventListener('message', event => {
		const msg = event.data;
		switch (msg.type) {
			case 'peripherals':
				peripherals = msg.peripherals || [];
				platformLabel.textContent = msg.platform || '—';
				renderTree();
				if (peripherals.length > 0 && !selectedPeri) {
					selectedPeri = peripherals[0];
					renderTree();
					renderRegisters(selectedPeri);
				}
				break;

			case 'registerValue':
				registerValues[msg.address.toString()] = msg.value;
				if (selectedPeri) renderRegisters(selectedPeri);
				break;

			case 'registerValues':
				for (const rv of (msg.values || [])) {
					registerValues[rv.address.toString()] = rv.value;
				}
				if (selectedPeri) renderRegisters(selectedPeri);
				statusLabel.textContent = selectedPeri ? selectedPeri.name + ' — updated' : 'Updated';
				break;

			case 'error':
				showError(msg.message);
				break;
		}
	});

	function showError(msg) {
		errorBar.textContent = msg;
		errorBar.style.display = 'block';
		setTimeout(() => { errorBar.style.display = 'none'; }, 8000);
	}

	function esc(s) {
		const d = document.createElement('div');
		d.textContent = s;
		return d.innerHTML;
	}
})();
</script>
</body>
</html>`;
}
