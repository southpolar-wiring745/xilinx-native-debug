/**
 * Returns the full HTML/CSS/JS content for the Clock & Power Status webview.
 */
export function getClockPowerHtml(nonce: string, cspSource: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Clock & Power Status</title>
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
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; color: var(--fg); background: var(--bg); padding: 16px; }
h1 { font-size: 16px; margin-bottom: 4px; }
.subtitle { opacity: 0.7; font-size: 12px; margin-bottom: 12px; }
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.toolbar button { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.toolbar button:hover { background: var(--btn-hover); }
.toolbar .status { font-size: 11px; opacity: 0.7; margin-left: auto; }
.panel-section { margin-bottom: 16px; }
.panel-section h2 { font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); opacity: 0.7; font-weight: 600; }
td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
td.freq { font-family: var(--vscode-editor-font-family, monospace); text-align: right; font-weight: 600; }
td.source { opacity: 0.7; }
.power-cards { display: flex; gap: 12px; flex-wrap: wrap; }
.power-card { border: 1px solid var(--border); border-radius: 4px; padding: 10px; min-width: 180px; }
.power-card .title { font-weight: 600; margin-bottom: 6px; }
.power-card .state { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
.power-card .state.on { color: var(--success); }
.power-card .state.off { color: var(--error); }
.power-card .state.sleep { color: var(--warn); }
.power-card .cores { font-size: 11px; }
.power-card .core { display: flex; align-items: center; gap: 4px; margin: 2px 0; }
.power-card .core .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.power-card .core .dot.on { background: var(--success); }
.power-card .core .dot.off { background: var(--error); }
.no-data { opacity: 0.5; padding: 20px; text-align: center; }
.error-msg { color: var(--error); margin-top: 4px; }
</style>
</head>
<body>
<h1>Clock & Power Status</h1>
<p class="subtitle" id="platformLabel">Platform: detecting...</p>

<div class="toolbar">
	<button id="btnRefresh">Refresh</button>
	<span class="status" id="lastUpdate"></span>
</div>

<div class="panel-section">
	<h2>Clock Tree</h2>
	<div id="clockContent"><p class="no-data">No data — click Refresh</p></div>
</div>

<div class="panel-section">
	<h2>Power Domains</h2>
	<div id="powerContent"><p class="no-data">No data — click Refresh</p></div>
</div>

<div id="errorMsg" class="error-msg" style="display:none"></div>

<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();

	document.getElementById('btnRefresh').addEventListener('click', () => {
		vscode.postMessage({ type: 'refresh' });
	});

	window.addEventListener('message', event => {
		const msg = event.data;
		switch (msg.type) {
			case 'clockPowerData':
				renderClocks(msg.clocks || []);
				renderPower(msg.power || []);
				document.getElementById('platformLabel').textContent = 'Platform: ' + (msg.platform || 'unknown');
				document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();
				document.getElementById('errorMsg').style.display = 'none';
				break;
			case 'error':
				document.getElementById('errorMsg').textContent = msg.message;
				document.getElementById('errorMsg').style.display = 'block';
				break;
		}
	});

	function renderClocks(clocks) {
		const container = document.getElementById('clockContent');
		if (clocks.length === 0) {
			container.innerHTML = '<p class="no-data">No clock data available for this platform</p>';
			return;
		}
		let html = '<table><tr><th>Clock</th><th>Frequency</th><th>Source</th><th>Status</th></tr>';
		for (const c of clocks) {
			const freqStr = c.frequencyMHz >= 1000
				? (c.frequencyMHz / 1000).toFixed(3) + ' GHz'
				: c.frequencyMHz.toFixed(3) + ' MHz';
			const statusStr = c.enabled ? '\\u2714 Enabled' : '\\u2716 Disabled';
			html += '<tr>';
			html += '<td>' + esc(c.name) + '</td>';
			html += '<td class="freq">' + freqStr + '</td>';
			html += '<td class="source">' + esc(c.source) + '</td>';
			html += '<td>' + statusStr + '</td>';
			html += '</tr>';
		}
		html += '</table>';
		container.innerHTML = html;
	}

	function renderPower(domains) {
		const container = document.getElementById('powerContent');
		if (domains.length === 0) {
			container.innerHTML = '<p class="no-data">Power status not available for this platform</p>';
			return;
		}
		let html = '<div class="power-cards">';
		for (const d of domains) {
			html += '<div class="power-card">';
			html += '<div class="title">' + esc(d.name) + '</div>';
			html += '<div class="state ' + d.state + '">' + d.state.toUpperCase() + '</div>';
			if (d.cores && d.cores.length > 0) {
				html += '<div class="cores">';
				for (const core of d.cores) {
					const dotClass = core.powered ? 'on' : 'off';
					html += '<div class="core"><span class="dot ' + dotClass + '"></span> ' + esc(core.name) + '</div>';
				}
				html += '</div>';
			}
			html += '</div>';
		}
		html += '</div>';
		container.innerHTML = html;
	}

	function esc(s) {
		const el = document.createElement('span');
		el.textContent = s;
		return el.innerHTML;
	}

	// Auto-refresh on load
	vscode.postMessage({ type: 'refresh' });
})();
</script>
</body>
</html>`;
}
