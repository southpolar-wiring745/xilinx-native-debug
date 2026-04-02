/**
 * Returns the full HTML/CSS/JS for the Hardware Mini-Map webview.
 * Self-contained SVG-based interactive graph with hierarchical layout.
 */
export function getHwMinimapHtml(nonce: string, cspSource: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hardware Mini-Map</title>
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
.toolbar button.active { outline: 1px solid var(--highlight); }
.toolbar .sep { width: 1px; height: 20px; background: var(--border); }
.toolbar .status { font-size: 11px; opacity: 0.7; margin-left: auto; }
.toolbar select, .toolbar input[type="file"] {
	background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border);
	padding: 2px 6px; font-size: 11px;
}
.toolbar label { font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 3px; }

/* Main area */
.main { flex: 1; display: flex; overflow: hidden; position: relative; }

/* SVG canvas */
#canvas-container {
	flex: 1; overflow: hidden; position: relative; cursor: grab;
}
#canvas-container.grabbing { cursor: grabbing; }
#graphSvg { width: 100%; height: 100%; }

/* Legend */
.legend {
	position: absolute; bottom: 12px; left: 12px; background: var(--panel-bg);
	border: 1px solid var(--border); border-radius: 4px; padding: 8px 12px;
	font-size: 11px; z-index: 10; opacity: 0.92;
}
.legend-row { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.legend-dot.active { background: var(--success); }
.legend-dot.inactive { background: #888; }
.legend-dot.fault { background: var(--error); }
.legend-dot.unknown { background: #555; border: 1px dashed #888; }
.legend-line { width: 20px; height: 2px; display: inline-block; }
.legend-line.axi { background: var(--highlight); }
.legend-line.irq { background: var(--warn); border-top: 1px dashed var(--warn); height: 0; }

/* Tooltip */
#tooltip {
	display: none; position: absolute; background: var(--panel-bg);
	border: 1px solid var(--border); border-radius: 4px; padding: 10px 14px;
	font-size: 12px; z-index: 100; max-width: 360px; pointer-events: none;
	box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
#tooltip .tt-title { font-weight: 700; margin-bottom: 4px; font-size: 13px; }
#tooltip .tt-row { display: flex; gap: 8px; margin: 2px 0; }
#tooltip .tt-key { opacity: 0.7; min-width: 100px; }
#tooltip .tt-val { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; }

/* Detail Panel (right sidebar) */
.detail-panel {
	width: 320px; border-left: 1px solid var(--border); overflow-y: auto;
	padding: 12px; flex-shrink: 0; display: none; font-size: 12px;
}
.detail-panel.visible { display: block; }
.detail-panel h2 { font-size: 14px; margin-bottom: 8px; }
.detail-panel .dp-section { margin-bottom: 12px; }
.detail-panel .dp-section h3 { font-size: 12px; opacity: 0.7; margin-bottom: 4px; border-bottom: 1px solid var(--border); padding-bottom: 2px; }
.detail-panel table { width: 100%; border-collapse: collapse; }
.detail-panel td { padding: 2px 4px; border-bottom: 1px solid var(--border); font-size: 11px; }
.detail-panel td:first-child { opacity: 0.7; width: 120px; }
.detail-panel td:last-child { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; }
.detail-panel .dp-actions { display: flex; gap: 6px; margin-top: 8px; }
.detail-panel .dp-actions button {
	background: var(--btn-bg); color: var(--btn-fg); border: none;
	padding: 3px 10px; cursor: pointer; font-size: 11px; border-radius: 2px;
}
.detail-panel .dp-actions button:hover { background: var(--btn-hover); }
.detail-panel .close-btn {
	position: absolute; top: 4px; right: 4px; background: none;
	color: var(--fg); border: none; cursor: pointer; font-size: 16px; opacity: 0.6;
}
.detail-panel .close-btn:hover { opacity: 1; }

/* No data */
.no-data { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.5; font-size: 14px; flex-direction: column; gap: 12px; }
.no-data button { font-size: 13px; padding: 6px 16px; }

/* Error */
.error-bar { background: var(--error); color: #fff; padding: 6px 12px; font-size: 12px; display: none; flex-shrink: 0; }

/* Zoom controls */
.zoom-controls {
	position: absolute; bottom: 12px; right: 12px; display: flex; flex-direction: column;
	gap: 4px; z-index: 10;
}
.zoom-controls button {
	background: var(--panel-bg); color: var(--fg); border: 1px solid var(--border);
	width: 28px; height: 28px; cursor: pointer; font-size: 16px; border-radius: 3px;
	display: flex; align-items: center; justify-content: center;
}
.zoom-controls button:hover { background: var(--btn-hover); color: var(--btn-fg); }
</style>
</head>
<body>

<div class="toolbar">
	<h1>Hardware Mini-Map</h1>
	<div class="sep"></div>
	<button id="btnLoadFile" title="Load .xsa or .hdf file">Load HW Design</button>
	<button id="btnRefreshState" title="Poll runtime state via XSDB">Refresh State</button>
	<label><input type="checkbox" id="chkAutoRefresh"> Auto-refresh on break</label>
	<div class="sep"></div>
	<button id="btnFitView" title="Fit graph to view">Fit</button>
	<button id="btnResetLayout" title="Re-layout the graph">Re-layout</button>
	<div class="sep"></div>
	<button id="btnLoadXdc" title="Load .xdc constraints for pin overlay">Load XDC</button>
	<button id="btnCheckAxi" title="Read AXI interconnect error registers">AXI Health</button>
	<div class="sep"></div>
	<span class="status" id="statusLabel">No design loaded</span>
</div>

<div class="error-bar" id="errorBar"></div>

<div class="main">
	<div id="canvas-container">
		<div class="no-data" id="noDataView">
			<span>No hardware design loaded</span>
			<button id="btnLoadFileAlt">Load .xsa / .hdf File</button>
		</div>
		<svg id="graphSvg" style="display:none">
			<defs>
				<marker id="arrowAxi" viewBox="0 0 10 6" refX="10" refY="3"
					markerWidth="8" markerHeight="6" orient="auto-start-reverse">
					<path d="M0,0 L10,3 L0,6 z" fill="var(--highlight)"/>
				</marker>
				<marker id="arrowIrq" viewBox="0 0 10 6" refX="10" refY="3"
					markerWidth="8" markerHeight="6" orient="auto-start-reverse">
					<path d="M0,0 L10,3 L0,6 z" fill="var(--warn)"/>
				</marker>
			</defs>
			<g id="graphRoot"></g>
		</svg>
	</div>

	<div class="legend" id="legend" style="display:none">
		<div class="legend-row"><span class="legend-dot active"></span> Active</div>
		<div class="legend-row"><span class="legend-dot inactive"></span> Inactive</div>
		<div class="legend-row"><span class="legend-dot fault"></span> Fault</div>
		<div class="legend-row"><span class="legend-dot unknown"></span> Unknown</div>
		<div class="legend-row"><span class="legend-line axi"></span> AXI Bus</div>
		<div class="legend-row"><span class="legend-line irq"></span> IRQ</div>
	</div>

	<div class="zoom-controls" id="zoomControls" style="display:none">
		<button id="btnZoomIn" title="Zoom in">+</button>
		<button id="btnZoomOut" title="Zoom out">−</button>
	</div>

	<div id="tooltip"></div>

	<div class="detail-panel" id="detailPanel">
		<div style="position:relative">
			<button class="close-btn" id="btnCloseDetail">×</button>
			<h2 id="dpTitle">—</h2>
		</div>
		<div class="dp-section" id="dpGeneral">
			<h3>General</h3>
			<table id="dpGeneralTable"></table>
		</div>
		<div class="dp-section" id="dpAddress">
			<h3>Address Map</h3>
			<table id="dpAddressTable"></table>
		</div>
		<div class="dp-section" id="dpBus">
			<h3>Bus Connections</h3>
			<table id="dpBusTable"></table>
		</div>
		<div class="dp-actions">
			<button id="btnViewRegisters">View Registers</button>
			<button id="btnDeepDiveRegs">Deep Dive Registers</button>
			<button id="btnJumpToSource">Jump to xparameters.h</button>
		</div>
	</div>
</div>

<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();
	let topology = null;
	let layoutNodes = [];
	let layoutEdges = [];
	let selectedNodeId = null;

	// ─── SVG Pan & Zoom state ─────────────────────────────────────────
	let viewBox = { x: 0, y: 0, w: 1200, h: 800 };
	let isPanning = false;
	let panStart = { x: 0, y: 0 };

	const svg = document.getElementById('graphSvg');
	const graphRoot = document.getElementById('graphRoot');
	const container = document.getElementById('canvas-container');
	const tooltip = document.getElementById('tooltip');
	const detailPanel = document.getElementById('detailPanel');
	const noDataView = document.getElementById('noDataView');
	const legend = document.getElementById('legend');
	const zoomControls = document.getElementById('zoomControls');
	const errorBar = document.getElementById('errorBar');
	const statusLabel = document.getElementById('statusLabel');

	// ─── Toolbar handlers ─────────────────────────────────────────────

	document.getElementById('btnLoadFile').addEventListener('click', () => {
		vscode.postMessage({ type: 'loadDesign' });
	});
	document.getElementById('btnLoadFileAlt').addEventListener('click', () => {
		vscode.postMessage({ type: 'loadDesign' });
	});
	document.getElementById('btnRefreshState').addEventListener('click', () => {
		vscode.postMessage({ type: 'refreshState' });
	});
	document.getElementById('btnFitView').addEventListener('click', fitView);
	document.getElementById('btnResetLayout').addEventListener('click', () => {
		if (topology) doLayout(topology);
	});
	document.getElementById('btnZoomIn').addEventListener('click', () => zoom(0.8));
	document.getElementById('btnZoomOut').addEventListener('click', () => zoom(1.25));
	document.getElementById('btnCloseDetail').addEventListener('click', () => {
		detailPanel.classList.remove('visible');
		selectedNodeId = null;
		highlightNode(null);
	});
	document.getElementById('btnViewRegisters').addEventListener('click', () => {
		if (selectedNodeId) {
			vscode.postMessage({ type: 'viewRegisters', nodeId: selectedNodeId });
		}
	});
	document.getElementById('btnDeepDiveRegs').addEventListener('click', () => {
		if (selectedNodeId) {
			vscode.postMessage({ type: 'deepDiveRegisters', nodeId: selectedNodeId });
		}
	});
	document.getElementById('btnJumpToSource').addEventListener('click', () => {
		if (selectedNodeId) {
			vscode.postMessage({ type: 'jumpToSource', nodeId: selectedNodeId });
		}
	});
	document.getElementById('btnLoadXdc').addEventListener('click', () => {
		vscode.postMessage({ type: 'loadXdc' });
	});
	document.getElementById('btnCheckAxi').addEventListener('click', () => {
		vscode.postMessage({ type: 'checkAxiHealth' });
	});

	document.getElementById('chkAutoRefresh').addEventListener('change', (e) => {
		vscode.postMessage({ type: 'setAutoRefresh', enabled: e.target.checked });
	});

	// ─── SVG pan & zoom ───────────────────────────────────────────────

	container.addEventListener('mousedown', (e) => {
		if (e.target.closest('.hw-node')) return;
		isPanning = true;
		panStart = { x: e.clientX, y: e.clientY };
		container.classList.add('grabbing');
	});
	window.addEventListener('mousemove', (e) => {
		if (!isPanning) return;
		const dx = (e.clientX - panStart.x) * (viewBox.w / container.clientWidth);
		const dy = (e.clientY - panStart.y) * (viewBox.h / container.clientHeight);
		viewBox.x -= dx;
		viewBox.y -= dy;
		panStart = { x: e.clientX, y: e.clientY };
		applyViewBox();
	});
	window.addEventListener('mouseup', () => {
		isPanning = false;
		container.classList.remove('grabbing');
	});
	container.addEventListener('wheel', (e) => {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 1.1 : 0.9;
		const rect = container.getBoundingClientRect();
		const mx = (e.clientX - rect.left) / rect.width;
		const my = (e.clientY - rect.top) / rect.height;
		const nw = viewBox.w * factor;
		const nh = viewBox.h * factor;
		viewBox.x += (viewBox.w - nw) * mx;
		viewBox.y += (viewBox.h - nh) * my;
		viewBox.w = nw;
		viewBox.h = nh;
		applyViewBox();
	}, { passive: false });

	function zoom(factor) {
		const nw = viewBox.w * factor;
		const nh = viewBox.h * factor;
		viewBox.x += (viewBox.w - nw) * 0.5;
		viewBox.y += (viewBox.h - nh) * 0.5;
		viewBox.w = nw;
		viewBox.h = nh;
		applyViewBox();
	}
	function applyViewBox() {
		svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
	}

	function fitView() {
		if (layoutNodes.length === 0) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const n of layoutNodes) {
			if (n.x < minX) minX = n.x;
			if (n.y < minY) minY = n.y;
			if (n.x + n.w > maxX) maxX = n.x + n.w;
			if (n.y + n.h > maxY) maxY = n.y + n.h;
		}
		const pad = 60;
		viewBox = { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
		applyViewBox();
	}

	// ─── Layout engine (hierarchical / layered) ───────────────────────

	const NODE_W = 180;
	const NODE_H = 56;
	const H_GAP = 60;
	const V_GAP = 40;

	function doLayout(topo) {
		topology = topo;
		const nodes = topo.nodes;
		const edges = topo.edges;

		// Separate into layers: CPU -> Interconnect -> Memory/Peripherals/PL
		const cpuNodes = nodes.filter(n => n.kind === 'cpu');
		const icNodes = nodes.filter(n => n.kind === 'interconnect');
		const memNodes = nodes.filter(n => n.kind === 'memory');
		const periphNodes = nodes.filter(n => n.kind === 'peripheral' && !n.isPl);
		const plNodes = nodes.filter(n => n.kind === 'pl_ip' || (n.kind === 'peripheral' && n.isPl));

		// Assign layers (columns)
		const layers = [];
		if (cpuNodes.length) layers.push({ label: 'PS Core', nodes: cpuNodes });
		if (icNodes.length) layers.push({ label: 'Interconnect', nodes: icNodes });

		// Group PS peripherals and PL IP
		const psPeriphs = [...memNodes, ...periphNodes];
		if (psPeriphs.length) layers.push({ label: 'PS Peripherals', nodes: psPeriphs });
		if (plNodes.length) layers.push({ label: 'PL IP Blocks', nodes: plNodes });

		// If only one layer, put everything there
		if (layers.length === 0) {
			layers.push({ label: 'Modules', nodes: nodes.slice() });
		}

		layoutNodes = [];
		let xOffset = 40;

		for (const layer of layers) {
			let yOffset = 60;
			// Add layer header
			const headerNode = {
				id: '__layer_' + layer.label,
				x: xOffset - 4,
				y: yOffset - 28,
				w: NODE_W + 8,
				h: 22,
				isHeader: true,
				label: layer.label,
			};
			layoutNodes.push(headerNode);
			yOffset += 4;

			for (const n of layer.nodes) {
				layoutNodes.push({
					id: n.id,
					x: xOffset,
					y: yOffset,
					w: NODE_W,
					h: NODE_H,
					data: n,
				});
				yOffset += NODE_H + V_GAP;
			}
			xOffset += NODE_W + H_GAP;
		}

		// Build layout edges
		const nodePositions = new Map();
		for (const ln of layoutNodes) {
			if (!ln.isHeader) nodePositions.set(ln.id, ln);
		}

		layoutEdges = [];
		for (const e of edges) {
			const src = nodePositions.get(e.source);
			const tgt = nodePositions.get(e.target);
			if (src && tgt) {
				layoutEdges.push({
					id: e.id,
					kind: e.kind,
					label: e.label || '',
					x1: src.x + src.w,
					y1: src.y + src.h / 2,
					x2: tgt.x,
					y2: tgt.y + tgt.h / 2,
				});
			}
		}

		render();
		fitView();
		updateStatus();
	}

	// ─── SVG Render ───────────────────────────────────────────────────

	const STATE_COLORS = {
		active: 'var(--success)',
		inactive: '#888',
		fault: 'var(--error)',
		unknown: '#555',
	};
	const STATE_BORDER = {
		active: 'var(--success)',
		inactive: '#666',
		fault: 'var(--error)',
		unknown: '#666',
	};
	const KIND_ICONS = {
		cpu: '⚙',
		memory: '▦',
		interconnect: '⇄',
		peripheral: '◈',
		pl_ip: '◆',
	};

	function render() {
		graphRoot.innerHTML = '';
		svg.style.display = '';
		noDataView.style.display = 'none';
		legend.style.display = '';
		zoomControls.style.display = '';

		// Draw edges first (behind nodes)
		for (const e of layoutEdges) {
			const isAxi = e.kind === 'axi';
			const color = isAxi ? 'var(--highlight)' : 'var(--warn)';
			const marker = isAxi ? 'url(#arrowAxi)' : 'url(#arrowIrq)';

			// Bezier curve
			const mx = (e.x1 + e.x2) / 2;
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', 'M' + e.x1 + ',' + e.y1 + ' C' + mx + ',' + e.y1 + ' ' + mx + ',' + e.y2 + ' ' + e.x2 + ',' + e.y2);
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', color);
			path.setAttribute('stroke-width', isAxi ? '2' : '1.5');
			path.setAttribute('marker-end', marker);
			if (!isAxi) path.setAttribute('stroke-dasharray', '6,3');
			path.setAttribute('opacity', '0.7');
			graphRoot.appendChild(path);

			// Edge label
			if (e.label) {
				const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
				txt.setAttribute('x', mx);
				txt.setAttribute('y', ((e.y1 + e.y2) / 2) - 6);
				txt.setAttribute('text-anchor', 'middle');
				txt.setAttribute('font-size', '9');
				txt.setAttribute('fill', color);
				txt.setAttribute('opacity', '0.8');
				txt.textContent = e.label;
				graphRoot.appendChild(txt);
			}
		}

		// Draw nodes
		for (const ln of layoutNodes) {
			if (ln.isHeader) {
				// Layer header
				const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
				txt.setAttribute('x', ln.x + 4);
				txt.setAttribute('y', ln.y + 15);
				txt.setAttribute('font-size', '12');
				txt.setAttribute('font-weight', '700');
				txt.setAttribute('fill', 'var(--fg)');
				txt.setAttribute('opacity', '0.5');
				txt.textContent = ln.label;
				graphRoot.appendChild(txt);
				continue;
			}

			const n = ln.data;
			const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
			g.setAttribute('class', 'hw-node');
			g.setAttribute('data-id', n.id);
			g.style.cursor = 'pointer';

			// Background rect
			const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			rect.setAttribute('x', ln.x);
			rect.setAttribute('y', ln.y);
			rect.setAttribute('width', ln.w);
			rect.setAttribute('height', ln.h);
			rect.setAttribute('rx', '6');
			rect.setAttribute('fill', 'var(--panel-bg)');
			rect.setAttribute('stroke', STATE_BORDER[n.state] || '#666');
			rect.setAttribute('stroke-width', selectedNodeId === n.id ? '2.5' : '1.5');
			if (n.state === 'unknown') rect.setAttribute('stroke-dasharray', '4,2');
			g.appendChild(rect);

			// State indicator dot
			const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			dot.setAttribute('cx', ln.x + 14);
			dot.setAttribute('cy', ln.y + 18);
			dot.setAttribute('r', '5');
			dot.setAttribute('fill', STATE_COLORS[n.state] || '#555');
			g.appendChild(dot);

			// Kind icon
			const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			icon.setAttribute('x', ln.x + 28);
			icon.setAttribute('y', ln.y + 22);
			icon.setAttribute('font-size', '13');
			icon.setAttribute('fill', 'var(--fg)');
			icon.textContent = KIND_ICONS[n.kind] || '•';
			g.appendChild(icon);

			// Instance name
			const nameTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			nameTxt.setAttribute('x', ln.x + 42);
			nameTxt.setAttribute('y', ln.y + 22);
			nameTxt.setAttribute('font-size', '11');
			nameTxt.setAttribute('font-weight', '600');
			nameTxt.setAttribute('fill', 'var(--fg)');
			nameTxt.textContent = truncate(n.label, 18);
			g.appendChild(nameTxt);

			// IP type subtitle
			const subTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			subTxt.setAttribute('x', ln.x + 14);
			subTxt.setAttribute('y', ln.y + 40);
			subTxt.setAttribute('font-size', '10');
			subTxt.setAttribute('fill', 'var(--fg)');
			subTxt.setAttribute('opacity', '0.6');
			subTxt.textContent = truncate(n.ipType, 24);
			g.appendChild(subTxt);

			// Address badge
			if (n.baseAddress !== undefined) {
				const addrTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
				addrTxt.setAttribute('x', ln.x + ln.w - 8);
				addrTxt.setAttribute('y', ln.y + 50);
				addrTxt.setAttribute('text-anchor', 'end');
				addrTxt.setAttribute('font-size', '8');
				addrTxt.setAttribute('fill', 'var(--fg)');
				addrTxt.setAttribute('opacity', '0.5');
				addrTxt.setAttribute('font-family', 'var(--vscode-editor-font-family, monospace)');
				addrTxt.textContent = '0x' + n.baseAddress.toString(16).toUpperCase();
				g.appendChild(addrTxt);
			}

			// PL badge
			if (n.isPl) {
				const plRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				plRect.setAttribute('x', ln.x + ln.w - 26);
				plRect.setAttribute('y', ln.y + 4);
				plRect.setAttribute('width', '20');
				plRect.setAttribute('height', '14');
				plRect.setAttribute('rx', '3');
				plRect.setAttribute('fill', 'var(--highlight)');
				plRect.setAttribute('opacity', '0.3');
				g.appendChild(plRect);
				const plTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
				plTxt.setAttribute('x', ln.x + ln.w - 16);
				plTxt.setAttribute('y', ln.y + 14);
				plTxt.setAttribute('text-anchor', 'middle');
				plTxt.setAttribute('font-size', '8');
				plTxt.setAttribute('font-weight', '700');
				plTxt.setAttribute('fill', 'var(--highlight)');
				plTxt.textContent = 'PL';
				g.appendChild(plTxt);
			}

			// Interaction
			g.addEventListener('mouseenter', (ev) => showTooltip(ev, n));
			g.addEventListener('mouseleave', hideTooltip);
			g.addEventListener('click', () => selectNode(n));
			g.addEventListener('dblclick', () => {
				vscode.postMessage({ type: 'jumpToSource', nodeId: n.id });
			});

			graphRoot.appendChild(g);
		}
	}

	function truncate(s, max) {
		return s.length > max ? s.slice(0, max - 1) + '…' : s;
	}

	function highlightNode(nodeId) {
		const allNodes = graphRoot.querySelectorAll('.hw-node');
		for (const g of allNodes) {
			const rect = g.querySelector('rect');
			if (!rect) continue;
			const id = g.getAttribute('data-id');
			if (id === nodeId) {
				rect.setAttribute('stroke-width', '2.5');
				rect.setAttribute('stroke', 'var(--highlight)');
			} else {
				const node = topology?.nodes.find(n => n.id === id);
				if (node) {
					rect.setAttribute('stroke-width', '1.5');
					rect.setAttribute('stroke', STATE_BORDER[node.state] || '#666');
				}
			}
		}
	}

	// ─── Tooltip ──────────────────────────────────────────────────────

	function showTooltip(ev, n) {
		let html = '<div class="tt-title">' + esc(n.label) + '</div>';
		html += ttRow('IP Type', n.ipType);
		html += ttRow('Kind', n.kind + (n.isPl ? ' (PL)' : ' (PS)'));
		html += ttRow('State', n.state);
		if (n.baseAddress !== undefined) {
			html += ttRow('Base Address', '0x' + n.baseAddress.toString(16).toUpperCase());
		}
		if (n.highAddress !== undefined) {
			const range = n.highAddress - n.baseAddress + 1;
			html += ttRow('Range', formatBytes(range));
		}
		if (n.clockFreqMhz !== undefined) {
			html += ttRow('Clock', n.clockFreqMhz.toFixed(2) + ' MHz');
		}
		if (n.irqNumber !== undefined) {
			html += ttRow('IRQ', '#' + n.irqNumber);
		}
		if (n.vlnv) {
			html += ttRow('VLNV', n.vlnv);
		}
		if (n.hwVersion) {
			html += ttRow('Version', n.hwVersion);
		}
		// XDC pin overlay data
		if (xdcPinData) {
			const nodePins = xdcPinData.filter(p => {
				const portBase = (p.port || '').replace(/\\[\\d+\\]$/, '').toLowerCase();
				return n.id.toLowerCase().includes(portBase) || portBase.includes(n.id.toLowerCase());
			});
			if (nodePins.length > 0) {
				html += '<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">';
				html += '<div style="font-weight:600;font-size:11px;opacity:0.8">Pin Constraints</div>';
				for (const p of nodePins.slice(0, 5)) {
					html += ttRow(p.port, (p.packagePin || '?') + (p.ioStandard ? ' [' + p.ioStandard + ']' : ''));
				}
				if (nodePins.length > 5) html += '<div style="opacity:0.5;font-size:10px">+' + (nodePins.length - 5) + ' more...</div>';
				html += '</div>';
			}
		}
		tooltip.innerHTML = html;
		tooltip.style.display = 'block';

		const rect = container.getBoundingClientRect();
		let tx = ev.clientX - rect.left + 16;
		let ty = ev.clientY - rect.top + 16;
		if (tx + 360 > rect.width) tx = ev.clientX - rect.left - 370;
		if (ty + 200 > rect.height) ty = ev.clientY - rect.top - 210;
		tooltip.style.left = Math.max(0, tx) + 'px';
		tooltip.style.top = Math.max(0, ty) + 'px';
	}

	function hideTooltip() {
		tooltip.style.display = 'none';
	}

	function ttRow(key, val) {
		return '<div class="tt-row"><span class="tt-key">' + esc(key) + '</span><span class="tt-val">' + esc(String(val)) + '</span></div>';
	}

	// ─── Detail Panel ─────────────────────────────────────────────────

	function selectNode(n) {
		selectedNodeId = n.id;
		highlightNode(n.id);

		document.getElementById('dpTitle').textContent = n.label;

		// General table
		const genTable = document.getElementById('dpGeneralTable');
		genTable.innerHTML = '';
		addRow(genTable, 'IP Type', n.ipType);
		addRow(genTable, 'Kind', n.kind);
		addRow(genTable, 'Domain', n.isPl ? 'PL (Programmable Logic)' : 'PS (Processing System)');
		addRow(genTable, 'State', n.state);
		if (n.vlnv) addRow(genTable, 'VLNV', n.vlnv);
		if (n.hwVersion) addRow(genTable, 'HW Version', n.hwVersion);
		if (n.clockFreqMhz !== undefined) addRow(genTable, 'Clock Freq', n.clockFreqMhz.toFixed(2) + ' MHz');
		if (n.irqNumber !== undefined) addRow(genTable, 'IRQ', '#' + n.irqNumber);

		// Address table
		const addrTable = document.getElementById('dpAddressTable');
		addrTable.innerHTML = '';
		if (n.baseAddress !== undefined) {
			addRow(addrTable, 'Base Address', '0x' + n.baseAddress.toString(16).toUpperCase());
			if (n.highAddress !== undefined) {
				addRow(addrTable, 'High Address', '0x' + n.highAddress.toString(16).toUpperCase());
				addRow(addrTable, 'Range', formatBytes(n.highAddress - n.baseAddress + 1));
			}
		} else {
			addRow(addrTable, '', 'No address map');
		}

		// Bus connections
		const busTable = document.getElementById('dpBusTable');
		busTable.innerHTML = '';
		if (topology) {
			const connected = topology.edges.filter(e => e.source === n.id || e.target === n.id);
			if (connected.length === 0) {
				addRow(busTable, '', 'No bus connections');
			} else {
				for (const e of connected) {
					const dir = e.source === n.id ? '→' : '←';
					const other = e.source === n.id ? e.target : e.source;
					addRow(busTable, dir + ' ' + other, (e.label || e.kind) + (e.dataWidth ? ' (' + e.dataWidth + 'b)' : ''));
				}
			}
		}

		detailPanel.classList.add('visible');
	}

	function addRow(table, key, val) {
		const tr = document.createElement('tr');
		const td1 = document.createElement('td');
		td1.textContent = key;
		const td2 = document.createElement('td');
		td2.textContent = val;
		tr.appendChild(td1);
		tr.appendChild(td2);
		table.appendChild(tr);
	}

	// ─── Helpers ──────────────────────────────────────────────────────

	function formatBytes(bytes) {
		if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
		if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
		if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return bytes + ' B';
	}

	function esc(s) {
		const d = document.createElement('div');
		d.textContent = s;
		return d.innerHTML;
	}

	function updateStatus() {
		if (!topology) {
			statusLabel.textContent = 'No design loaded';
			return;
		}
		const nc = topology.nodes.length;
		const ec = topology.edges.length;
		statusLabel.textContent = topology.platform + ' | ' + topology.device + ' | ' + nc + ' nodes, ' + ec + ' connections';
	}

	function showError(msg) {
		errorBar.textContent = msg;
		errorBar.style.display = 'block';
		setTimeout(() => { errorBar.style.display = 'none'; }, 8000);
	}

	// ─── AXI Health overlay ───────────────────────────────────────────

	function applyAxiHealth(edgeHealth) {
		if (!edgeHealth || !Array.isArray(edgeHealth)) return;
		const faultEdges = new Set();
		for (const eh of edgeHealth) {
			if (eh.hasError) faultEdges.add(eh.edgeId);
		}
		// Re-color edges in SVG
		const paths = graphRoot.querySelectorAll('path');
		for (let i = 0; i < layoutEdges.length && i < paths.length; i++) {
			const le = layoutEdges[i];
			const path = paths[i];
			if (faultEdges.has(le.id)) {
				path.setAttribute('stroke', 'var(--error)');
				path.setAttribute('stroke-width', '3');
				path.setAttribute('opacity', '1');
				// Pulse animation
				path.style.animation = 'none';
				path.offsetHeight; // reflow
				path.style.animation = '';
			}
		}
		if (faultEdges.size > 0) {
			showError('AXI fault detected on ' + faultEdges.size + ' edge(s)!');
		} else {
			statusLabel.textContent = statusLabel.textContent.replace(/ \\| AXI:.*/, '') + ' | AXI: OK';
		}
	}

	// ─── XDC pin data overlay ─────────────────────────────────────────

	let xdcPinData = null;

	function applyXdcOverlay(pins) {
		if (!pins || !Array.isArray(pins)) return;
		xdcPinData = pins;
		// Re-render to update tooltips
		if (topology) render();
		statusLabel.textContent = statusLabel.textContent.replace(/ \\| XDC:.*/, '') + ' | XDC: ' + pins.length + ' pins';
	}

	// ─── Messages from extension ──────────────────────────────────────

	window.addEventListener('message', event => {
		const msg = event.data;
		switch (msg.type) {
			case 'topology':
				doLayout(msg.topology);
				break;
			case 'runtimeState':
				if (topology && msg.states) {
					for (const st of msg.states) {
						const node = topology.nodes.find(n => n.id === st.id);
						if (node) {
							node.state = st.state;
							if (st.clockFreqMhz !== undefined) node.clockFreqMhz = st.clockFreqMhz;
						}
					}
					render();
					statusLabel.textContent = statusLabel.textContent.replace(/ \\| Updated:.*/, '') + ' | Updated: ' + new Date().toLocaleTimeString();
				}
				break;
			case 'error':
				showError(msg.message);
				break;
			case 'axiHealth':
				applyAxiHealth(msg.edgeHealth);
				break;
			case 'xdcPinOverlay':
				applyXdcOverlay(msg.pins);
				break;
		}
	});
})();
</script>
</body>
</html>`;
}
