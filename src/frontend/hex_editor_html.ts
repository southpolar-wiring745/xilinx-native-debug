import * as vscode from "vscode";

/**
 * Returns the full HTML/CSS/JS content for the hex editor webview.
 * @param nonce A nonce for inline script CSP.
 * @param cspSource The webview CSP source string.
 */
export function getHexEditorHtml(nonce: string, cspSource: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hex Memory Editor</title>
<style nonce="${nonce}">
:root {
	--bg: var(--vscode-editor-background);
	--fg: var(--vscode-editor-foreground);
	--border: var(--vscode-widget-border, #444);
	--highlight: var(--vscode-editor-findMatchHighlightBackground, #ff8c0050);
	--modified: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
	--input-bg: var(--vscode-input-background);
	--input-fg: var(--vscode-input-foreground);
	--btn-bg: var(--vscode-button-background);
	--btn-fg: var(--vscode-button-foreground);
	--btn-hover: var(--vscode-button-hoverBackground);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-editor-font-family, 'Consolas', monospace); font-size: 13px; color: var(--fg); background-color: var(--bg); padding: 10px; }
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.toolbar label { font-weight: 600; }
.toolbar input { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 3px 6px; font-family: inherit; font-size: 12px; }
.toolbar input[type="text"] { width: 130px; }
.toolbar input[type="number"] { width: 80px; }
.toolbar button { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.toolbar button:hover { background: var(--btn-hover); }
.hex-container { width: 100%; overflow-x: auto; }
table { border-collapse: collapse; font-family: var(--vscode-editor-font-family, 'Consolas', monospace); font-size: 13px; }
th { text-align: left; padding: 2px 6px; border-bottom: 1px solid var(--border); color: var(--fg); opacity: 0.7; position: sticky; top: 0; background: var(--bg); }
td { padding: 1px 4px; cursor: default; white-space: pre; }
td.offset { color: var(--fg); opacity: 0.5; padding-right: 12px; user-select: none; }
td.hex-byte { text-align: center; min-width: 24px; cursor: pointer; border-radius: 2px; }
td.hex-byte:hover { background: var(--highlight); }
td.hex-byte.modified { color: var(--modified); font-weight: bold; }
td.hex-byte.editing { }
td.hex-byte input { width: 24px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); font-family: inherit; font-size: 13px; text-align: center; padding: 0; }
td.spacer { width: 8px; }
td.ascii { letter-spacing: 1px; user-select: none; }
.status { margin-top: 8px; font-size: 11px; opacity: 0.7; }
.error { color: var(--vscode-errorForeground, #f44); }
</style>
</head>
<body>
<div class="toolbar">
	<label>Address:</label>
	<input type="text" id="inputAddress" placeholder="0xF8000000" />
	<label>Bytes:</label>
	<input type="number" id="inputByteCount" value="256" min="1" max="65536" />
	<button id="btnRead">Read</button>
	<button id="btnRefresh">Refresh</button>
	<button id="btnWrite">Write Changes</button>
	<button id="btnExport">Export .bin</button>
	<button id="btnImport">Import .bin</button>
</div>
<div class="hex-container">
	<table id="hexTable"><tbody></tbody></table>
</div>
<div class="status" id="status"></div>

<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();
	const hexTable = document.getElementById('hexTable').getElementsByTagName('tbody')[0];
	const inputAddress = document.getElementById('inputAddress');
	const inputByteCount = document.getElementById('inputByteCount');
	const btnRead = document.getElementById('btnRead');
	const btnRefresh = document.getElementById('btnRefresh');
	const btnWrite = document.getElementById('btnWrite');
	const btnExport = document.getElementById('btnExport');
	const btnImport = document.getElementById('btnImport');
	const statusEl = document.getElementById('status');

	let currentAddress = 0;
	let currentByteCount = 256;
	let originalData = [];  // original byte values
	let modifiedData = {};  // index -> new value

	function setStatus(msg, isError) {
		statusEl.textContent = msg;
		statusEl.className = isError ? 'status error' : 'status';
	}

	function toHex(n, digits) {
		return n.toString(16).toUpperCase().padStart(digits, '0');
	}

	function renderTable(data) {
		hexTable.innerHTML = '';
		originalData = data.slice();
		modifiedData = {};

		// Header
		const headerRow = document.createElement('tr');
		const thOffset = document.createElement('th');
		thOffset.textContent = 'Offset';
		headerRow.appendChild(thOffset);
		for (let i = 0; i < 16; i++) {
			const th = document.createElement('th');
			th.textContent = toHex(i, 2);
			headerRow.appendChild(th);
			if (i === 7) {
				const sp = document.createElement('th');
				sp.textContent = '';
				headerRow.appendChild(sp);
			}
		}
		const thAscii = document.createElement('th');
		thAscii.textContent = 'ASCII';
		headerRow.appendChild(thAscii);
		hexTable.appendChild(headerRow);

		// Data rows
		const rows = Math.ceil(data.length / 16);
		for (let r = 0; r < rows; r++) {
			const tr = document.createElement('tr');
			const tdOff = document.createElement('td');
			tdOff.className = 'offset';
			tdOff.textContent = '0x' + toHex(currentAddress + r * 16, 8);
			tr.appendChild(tdOff);

			let asciiStr = '';
			for (let c = 0; c < 16; c++) {
				const idx = r * 16 + c;
				const td = document.createElement('td');
				td.className = 'hex-byte';
				if (idx < data.length) {
					td.textContent = toHex(data[idx], 2);
					td.dataset.index = idx;
					td.addEventListener('click', onByteClick);
					const byte = data[idx];
					asciiStr += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
				} else {
					td.textContent = '  ';
				}
				tr.appendChild(td);
				if (c === 7) {
					const sp = document.createElement('td');
					sp.className = 'spacer';
					tr.appendChild(sp);
				}
			}

			const tdAscii = document.createElement('td');
			tdAscii.className = 'ascii';
			tdAscii.textContent = asciiStr;
			tr.appendChild(tdAscii);
			hexTable.appendChild(tr);
		}
	}

	function onByteClick(e) {
		const td = e.currentTarget;
		if (td.querySelector('input')) return;
		const idx = parseInt(td.dataset.index);
		const currentVal = (idx in modifiedData) ? modifiedData[idx] : originalData[idx];
		const input = document.createElement('input');
		input.type = 'text';
		input.maxLength = 2;
		input.value = toHex(currentVal, 2);
		td.textContent = '';
		td.classList.add('editing');
		td.appendChild(input);
		input.focus();
		input.select();

		function commit() {
			td.classList.remove('editing');
			const val = parseInt(input.value, 16);
			if (!isNaN(val) && val >= 0 && val <= 255) {
				if (val !== originalData[idx]) {
					modifiedData[idx] = val;
					td.classList.add('modified');
				} else {
					delete modifiedData[idx];
					td.classList.remove('modified');
				}
				td.textContent = toHex(val, 2);
			} else {
				const restore = (idx in modifiedData) ? modifiedData[idx] : originalData[idx];
				td.textContent = toHex(restore, 2);
			}
		}

		input.addEventListener('blur', commit);
		input.addEventListener('keydown', function(ev) {
			if (ev.key === 'Enter') { input.blur(); }
			if (ev.key === 'Escape') { input.value = toHex(currentVal, 2); input.blur(); }
		});
	}

	function doRead() {
		const addrStr = inputAddress.value.trim();
		const addr = parseInt(addrStr, addrStr.startsWith('0x') ? 16 : 10);
		const count = parseInt(inputByteCount.value) || 256;
		if (isNaN(addr)) {
			setStatus('Invalid address', true);
			return;
		}
		currentAddress = addr;
		currentByteCount = count;
		setStatus('Reading...');
		vscode.postMessage({ type: 'read', address: addr, byteCount: count });
	}

	btnRead.addEventListener('click', doRead);
	btnRefresh.addEventListener('click', function() {
		if (currentAddress > 0 || currentByteCount > 0) {
			setStatus('Refreshing...');
			vscode.postMessage({ type: 'read', address: currentAddress, byteCount: currentByteCount });
		}
	});

	btnWrite.addEventListener('click', function() {
		const changes = Object.keys(modifiedData).map(function(idx) {
			return { offset: parseInt(idx), value: modifiedData[idx] };
		});
		if (changes.length === 0) {
			setStatus('No changes to write.');
			return;
		}
		setStatus('Writing ' + changes.length + ' byte(s)...');
		vscode.postMessage({ type: 'write', address: currentAddress, changes: changes });
	});

	btnExport.addEventListener('click', function() {
		if (originalData.length === 0) {
			setStatus('No data to export. Read memory first.', true);
			return;
		}
		// Merge modifications into data
		const data = originalData.slice();
		for (const idx in modifiedData) {
			data[parseInt(idx)] = modifiedData[idx];
		}
		vscode.postMessage({ type: 'export', address: currentAddress, data: data });
	});

	btnImport.addEventListener('click', function() {
		vscode.postMessage({ type: 'import', address: currentAddress });
	});

	// Handle messages from the extension
	window.addEventListener('message', function(event) {
		const msg = event.data;
		switch (msg.type) {
			case 'data':
				renderTable(msg.bytes);
				inputAddress.value = '0x' + toHex(msg.address, 8);
				inputByteCount.value = msg.bytes.length;
				setStatus('Read ' + msg.bytes.length + ' bytes from 0x' + toHex(msg.address, 8));
				break;
			case 'writeResult':
				if (msg.success) {
					setStatus('Write successful. Refreshing...');
					vscode.postMessage({ type: 'read', address: currentAddress, byteCount: currentByteCount });
				} else {
					setStatus('Write failed: ' + (msg.error || 'unknown error'), true);
				}
				break;
			case 'error':
				setStatus(msg.message, true);
				break;
			case 'importData':
				if (msg.bytes && msg.bytes.length > 0) {
					renderTable(msg.bytes);
					inputByteCount.value = msg.bytes.length;
					setStatus('Imported ' + msg.bytes.length + ' bytes from file');
				}
				break;
			case 'init':
				if (msg.address !== undefined) {
					inputAddress.value = '0x' + toHex(msg.address, 8);
				}
				if (msg.byteCount !== undefined) {
					inputByteCount.value = msg.byteCount;
				}
				doRead();
				break;
		}
	});
})();
</script>
</body>
</html>`;
}
