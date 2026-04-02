/**
 * AXI Bus Health & Transaction Monitor.
 *
 * Defines addresses and decoders for AXI interconnect error registers
 * and Performance Monitor (APM) counters on Zynq-7000 and ZynqMP.
 * Used by the Mini-Map to flash edges red when faults are detected.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AxiErrorRegister {
	name: string;
	address: number;
	description: string;
	faultBits: { bit: number; name: string; description: string }[];
}

export interface AxiEdgeHealth {
	edgeId: string;
	hasError: boolean;
	errorType?: string;
	errorDetail?: string;
}

export interface ApmCounterSnapshot {
	timestamp: number;
	writeCount: number;
	readCount: number;
	writeBytesTotal: number;
	readBytesTotal: number;
}

export interface AxiHealthReport {
	platform: string;
	edgeHealth: AxiEdgeHealth[];
	apmSnapshot?: ApmCounterSnapshot;
	rawRegisterValues: { name: string; address: number; value: number }[];
}

// ─── Zynq-7000 AXI error registers ─────────────────────────────────────────

// AFI (AXI FIFO Interface) status registers — UG585 §4.3
const ZYNQ7000_AFI_REGS: AxiErrorRegister[] = [
	{
		name: 'AFI0_STS', address: 0xF8008000, description: 'AXI HP0 FIFO Status',
		faultBits: [
			{ bit: 0, name: 'AFIVALID', description: 'AFI valid signal asserted' },
		],
	},
	{
		name: 'AFI1_STS', address: 0xF8009000, description: 'AXI HP1 FIFO Status',
		faultBits: [
			{ bit: 0, name: 'AFIVALID', description: 'AFI valid signal asserted' },
		],
	},
	{
		name: 'AFI2_STS', address: 0xF800A000, description: 'AXI HP2 FIFO Status',
		faultBits: [
			{ bit: 0, name: 'AFIVALID', description: 'AFI valid signal asserted' },
		],
	},
	{
		name: 'AFI3_STS', address: 0xF800B000, description: 'AXI HP3 FIFO Status',
		faultBits: [
			{ bit: 0, name: 'AFIVALID', description: 'AFI valid signal asserted' },
		],
	},
];

// DEVC (Device Configuration) — captures some AXI decode errors
const ZYNQ7000_DEVC_ISR: AxiErrorRegister = {
	name: 'DEVC_ISR', address: 0xF800200C, description: 'Device Config Interrupt Status',
	faultBits: [
		{ bit: 17, name: 'AXI_WTO', description: 'AXI write timeout' },
		{ bit: 16, name: 'AXI_RTO', description: 'AXI read timeout' },
		{ bit: 11, name: 'P2D_LEN_ERR', description: 'PCAP to DMA length error' },
	],
};

// ─── ZynqMP LPD/FPD interconnect error registers ───────────────────────────

// LPD XPPU status (UG1087 §14.2)
const ZYNQMP_LPD_XPPU: AxiErrorRegister = {
	name: 'LPD_XPPU_ISR', address: 0xFF980010, description: 'LPD XPPU Interrupt Status',
	faultBits: [
		{ bit: 1, name: 'INV_APB', description: 'Invalid APB address' },
		{ bit: 0, name: 'PERM_VIO', description: 'Permission violation' },
	],
};

// FPD XMPU status registers
const ZYNQMP_FPD_XMPU: AxiErrorRegister[] = [
	{
		name: 'FPD_XMPU_ISR', address: 0xFD000010, description: 'FPD XMPU Interrupt Status',
		faultBits: [
			{ bit: 4, name: 'WRPERM', description: 'Write permission violation' },
			{ bit: 3, name: 'RDPERM', description: 'Read permission violation' },
			{ bit: 2, name: 'INV_APB', description: 'Invalid APB transaction' },
			{ bit: 1, name: 'POISONED', description: 'Poisoned transaction' },
			{ bit: 0, name: 'RDVIO', description: 'Read address violation' },
		],
	},
	{
		name: 'DDR_XMPU0_ISR', address: 0xFD000010, description: 'DDR XMPU0 Interrupt Status',
		faultBits: [
			{ bit: 1, name: 'WRPERM', description: 'Write permission violation' },
			{ bit: 0, name: 'RDPERM', description: 'Read permission violation' },
		],
	},
];

// AFI / CCI error (ZynqMP)
const ZYNQMP_AFI_REGS: AxiErrorRegister[] = [
	{
		name: 'AFIFM0_ISR', address: 0xFD360000, description: 'AFI FM0 Status (HPC0)',
		faultBits: [
			{ bit: 0, name: 'BRESP_ERR', description: 'Write response error on HP/HPC port' },
		],
	},
	{
		name: 'AFIFM1_ISR', address: 0xFD370000, description: 'AFI FM1 Status (HPC1)',
		faultBits: [
			{ bit: 0, name: 'BRESP_ERR', description: 'Write response error on HP/HPC port' },
		],
	},
];

// ─── APM (AXI Performance Monitor) addresses ───────────────────────────────

export interface ApmRegisterSet {
	base: number;
	name: string;
	/** Metric Counter 0 – typically wired to write transactions */
	mc0: number;
	/** Metric Counter 1 – typically wired to read transactions */
	mc1: number;
	/** Metric Counter 2 – write byte count */
	mc2: number;
	/** Metric Counter 3 – read byte count */
	mc3: number;
	/** Global clock counter */
	gcc: number;
	/** Control register */
	ctrl: number;
}

export const ZYNQ7000_APM: ApmRegisterSet = {
	base: 0xF8891000,
	name: 'OCM APM',
	mc0: 0xF8891010,
	mc1: 0xF8891014,
	mc2: 0xF8891018,
	mc3: 0xF889101C,
	gcc: 0xF8891004,
	ctrl: 0xF8891300,
};

// ─── Decoder ────────────────────────────────────────────────────────────────

/**
 * Get all AXI error register addresses that should be read for a given platform.
 */
export function getAxiErrorAddresses(platform: string): { name: string; address: number }[] {
	if (platform.includes('zynq_ultra') || platform.includes('zynqmp') || platform.includes('psu_cortexa53')) {
		return [
			ZYNQMP_LPD_XPPU,
			...ZYNQMP_FPD_XMPU,
			...ZYNQMP_AFI_REGS,
		].map(r => ({ name: r.name, address: r.address }));
	}

	return [
		...ZYNQ7000_AFI_REGS,
		ZYNQ7000_DEVC_ISR,
	].map(r => ({ name: r.name, address: r.address }));
}

/**
 * Decode raw register values into edge health status.
 */
export function decodeAxiHealth(
	platform: string,
	registerValues: { name: string; address: number; value: number }[],
	edgeIds: string[],
): AxiHealthReport {
	const edgeHealth: AxiEdgeHealth[] = [];
	const allRegs = getAllErrorRegisters(platform);
	let anyFault = false;
	const foundErrors: string[] = [];

	for (const rv of registerValues) {
		const regDef = allRegs.find(r => r.address === rv.address);
		if (!regDef) continue;

		for (const fb of regDef.faultBits) {
			if ((rv.value >>> fb.bit) & 1) {
				anyFault = true;
				foundErrors.push(`${regDef.name}.${fb.name}: ${fb.description}`);
			}
		}
	}

	// Map errors to edges — for now, mark all AXI edges with errors
	for (const eid of edgeIds) {
		edgeHealth.push({
			edgeId: eid,
			hasError: anyFault,
			errorType: anyFault ? 'AXI Fault' : undefined,
			errorDetail: anyFault ? foundErrors.join('; ') : undefined,
		});
	}

	return {
		platform,
		edgeHealth,
		rawRegisterValues: registerValues,
	};
}

function getAllErrorRegisters(platform: string): AxiErrorRegister[] {
	if (platform.includes('zynq_ultra') || platform.includes('zynqmp') || platform.includes('psu_cortexa53')) {
		return [ZYNQMP_LPD_XPPU, ...ZYNQMP_FPD_XMPU, ...ZYNQMP_AFI_REGS];
	}
	return [...ZYNQ7000_AFI_REGS, ZYNQ7000_DEVC_ISR];
}

/**
 * Get APM counter addresses for the platform.
 */
export function getApmAddresses(platform: string): ApmRegisterSet | undefined {
	if (platform.includes('zynq_ultra') || platform.includes('zynqmp') || platform.includes('psu_cortexa53')) {
		// ZynqMP APM is at different addresses and varies by design — caller should provide
		return undefined;
	}
	return ZYNQ7000_APM;
}

/**
 * Decode raw APM counter reads into a snapshot.
 */
export function decodeApmCounters(
	values: { mc0: number; mc1: number; mc2: number; mc3: number },
): ApmCounterSnapshot {
	return {
		timestamp: Date.now(),
		writeCount: values.mc0,
		readCount: values.mc1,
		writeBytesTotal: values.mc2,
		readBytesTotal: values.mc3,
	};
}
