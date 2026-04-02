/**
 * Xilinx Design Constraints (.xdc) parser.
 *
 * Parses set_property and create_clock commands from XDC files
 * into structured constraint objects for use in the HW mini-map
 * pin overlay and constraints viewer.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PinConstraint {
	port: string;
	packagePin?: string;
	ioStandard?: string;
	slew?: string;
	drive?: number;
	pullType?: string;
}

export interface ClockConstraint {
	name: string;
	period: number;
	frequencyMhz: number;
	port: string;
	waveform?: [number, number];
}

export interface DebugConstraint {
	property: string;
	value: string;
	target: string;
}

export interface XdcParseResult {
	pins: PinConstraint[];
	clocks: ClockConstraint[];
	debugCores: DebugConstraint[];
	/** Raw port→property map for quick lookups */
	portMap: Map<string, PinConstraint>;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse XDC file content.
 * Handles `set_property`, `create_clock`, and `connect_debug_port`.
 */
export function parseXdc(text: string): XdcParseResult {
	const pins: PinConstraint[] = [];
	const clocks: ClockConstraint[] = [];
	const debugCores: DebugConstraint[] = [];
	const portMap = new Map<string, PinConstraint>();

	const lines = text.split(/\r?\n/);

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		if (line.startsWith('set_property')) {
			parseSetProperty(line, portMap);
		} else if (line.startsWith('create_clock')) {
			const clock = parseCreateClock(line);
			if (clock) clocks.push(clock);
		} else if (line.startsWith('set_property') || line.startsWith('connect_debug_port')) {
			const dbg = parseDebugConstraint(line);
			if (dbg) debugCores.push(dbg);
		}
	}

	// Flatten portMap into pins
	for (const pin of portMap.values()) {
		pins.push(pin);
	}

	return { pins, clocks, debugCores, portMap };
}

// ─── set_property parsing ───────────────────────────────────────────────────

const SET_PROPERTY_RE = /^set_property\s+(\S+)\s+(.*?)\s+\[get_ports\s+\{?([^}\]]+)\}?\]/i;
const SET_PROPERTY_DEBUG_RE = /^set_property\s+(\S+)\s+(.*?)\s+\[get_debug_cores\s+(\S+)\]/i;

function parseSetProperty(line: string, portMap: Map<string, PinConstraint>): void {
	const m = SET_PROPERTY_RE.exec(line);
	if (!m) {
		// Try debug core variant
		const dm = SET_PROPERTY_DEBUG_RE.exec(line);
		if (dm) {
			// Handled as debug constraint if needed
		}
		return;
	}

	const propName = m[1].toUpperCase();
	const propValue = m[2].trim();
	const portName = m[3].trim();

	let pin = portMap.get(portName);
	if (!pin) {
		pin = { port: portName };
		portMap.set(portName, pin);
	}

	switch (propName) {
		case 'PACKAGE_PIN':
			pin.packagePin = propValue;
			break;
		case 'IOSTANDARD':
			pin.ioStandard = propValue;
			break;
		case 'SLEW':
			pin.slew = propValue;
			break;
		case 'DRIVE':
			pin.drive = parseInt(propValue, 10);
			break;
		case 'PULLTYPE':
		case 'PULLUP':
		case 'PULLDOWN':
			pin.pullType = propName === 'PULLUP' ? 'PULLUP' : propName === 'PULLDOWN' ? 'PULLDOWN' : propValue;
			break;
	}
}

// ─── create_clock parsing ───────────────────────────────────────────────────

const CREATE_CLOCK_RE = /create_clock\s+-period\s+([\d.]+)(?:\s+-name\s+(\S+))?(?:\s+-waveform\s+\{([\d.\s]+)\})?\s+\[get_ports\s+\{?([^}\]]+)\}?\]/i;

function parseCreateClock(line: string): ClockConstraint | null {
	const m = CREATE_CLOCK_RE.exec(line);
	if (!m) return null;

	const period = parseFloat(m[1]);
	const name = m[2] || m[4]?.trim() || 'unknown';
	const port = m[4]?.trim() || '';
	let waveform: [number, number] | undefined;

	if (m[3]) {
		const parts = m[3].trim().split(/\s+/).map(Number);
		if (parts.length >= 2) {
			waveform = [parts[0], parts[1]];
		}
	}

	return {
		name,
		period,
		frequencyMhz: 1000 / period,
		port,
		waveform,
	};
}

// ─── Debug constraint parsing ───────────────────────────────────────────────

function parseDebugConstraint(line: string): DebugConstraint | null {
	const m = SET_PROPERTY_DEBUG_RE.exec(line);
	if (m) {
		return { property: m[1], value: m[2].trim(), target: m[3] };
	}
	return null;
}

// ─── Utility: match ports to HW topology nodes ─────────────────────────────

/**
 * Attempt to associate XDC port names with HW topology node IDs.
 * Returns a map: nodeId -> PinConstraint[]
 */
export function mapPortsToNodes(
	xdc: XdcParseResult,
	externalPorts: Map<string, string>, // portName -> instanceName, from HWH EXTERNALPORTS
): Map<string, PinConstraint[]> {
	const result = new Map<string, PinConstraint[]>();

	for (const pin of xdc.pins) {
		const portBase = pin.port.replace(/\[\d+\]$/, '');
		const instance = externalPorts.get(pin.port) || externalPorts.get(portBase);
		if (instance) {
			let arr = result.get(instance);
			if (!arr) {
				arr = [];
				result.set(instance, arr);
			}
			arr.push(pin);
		}
	}

	return result;
}
