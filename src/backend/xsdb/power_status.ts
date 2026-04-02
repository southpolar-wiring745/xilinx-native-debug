/**
 * Power domain status decoder for ZynqMP (Zynq UltraScale+).
 * Reads PMU power state registers to determine APU/RPU core power status.
 *
 * Based on ZynqMP TRM (UG1087): Chapter 38 — Platform Management Unit.
 */

export interface CorePowerInfo {
	name: string;
	powered: boolean;
}

export interface PowerDomainInfo {
	name: string;
	state: "on" | "off" | "sleep";
	cores: CorePowerInfo[];
}

export interface PowerRegisterDef {
	name: string;
	address: number;
	description: string;
}

// ─── ZynqMP PMU Registers ───────────────────────────────────────────────────

export const ZYNQMP_PMU_BASE = 0xFFD80000;

export const ZYNQMP_POWER_REGISTERS: PowerRegisterDef[] = [
	{ name: "PWR_STATE", address: 0xFFD80100, description: "Current Power State" },
	{ name: "REQ_PWRUP_INT_EN", address: 0xFFD80118, description: "Power Up Interrupt Enable" },
	{ name: "REQ_PWRUP_TRIG", address: 0xFFD80120, description: "Power Up Trigger" },
	{ name: "REQ_PWRDN_INT_EN", address: 0xFFD80218, description: "Power Down Interrupt Enable" },
	{ name: "REQ_PWRDN_TRIG", address: 0xFFD80220, description: "Power Down Trigger" },
];

// Zynq-7000 does not have PMU power gating in the same way, so we only
// support ZynqMP power status.

// ─── ZynqMP Power State Decoding ────────────────────────────────────────────

// PWR_STATE register bit mapping (0xFFD80100):
//   Bit 0: FPD (Full Power Domain — APU, GPU, SATA, etc.)
//   Bit 1: unused
//   Bit 2: unused
//   Bit 3: unused
//   Bit 4: RPU island / Cortex-R5
//   Bit 5: unused
//   Bit 6: PL (Programmable Logic)
//   Bit 7-15: various
//
// Individual APU core status is in APU registers, not PMU.

export function decodeZynqMPPowerStatus(regs: Map<number, number>): PowerDomainInfo[] {
	const domains: PowerDomainInfo[] = [];

	const pwrState = regs.get(0xFFD80100) ?? 0;

	// Full Power Domain (FPD) — includes APU
	const fpdOn = (pwrState & (1 << 0)) !== 0;
	domains.push({
		name: "FPD (APU)",
		state: fpdOn ? "on" : "off",
		cores: [
			{ name: "Cortex-A53 #0", powered: fpdOn },
			{ name: "Cortex-A53 #1", powered: fpdOn },
			{ name: "Cortex-A53 #2", powered: fpdOn },
			{ name: "Cortex-A53 #3", powered: fpdOn },
		],
	});

	// RPU island
	const rpuOn = (pwrState & (1 << 4)) !== 0;
	domains.push({
		name: "RPU",
		state: rpuOn ? "on" : "off",
		cores: [
			{ name: "Cortex-R5 #0", powered: rpuOn },
			{ name: "Cortex-R5 #1", powered: rpuOn },
		],
	});

	// PL power domain
	const plOn = (pwrState & (1 << 6)) !== 0;
	domains.push({
		name: "PL",
		state: plOn ? "on" : "off",
		cores: [],
	});

	return domains;
}

export function getPowerRegistersForPlatform(platform: string): PowerRegisterDef[] {
	switch (platform) {
		case "zynqmp":
			return ZYNQMP_POWER_REGISTERS;
		default:
			return [];
	}
}
