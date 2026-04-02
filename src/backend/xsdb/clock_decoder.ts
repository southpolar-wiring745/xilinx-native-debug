/**
 * Clock frequency decoder for Zynq-7000 and ZynqMP platforms.
 * Decodes PLL control registers into human-readable frequency values.
 *
 * Based on:
 * - Zynq-7000 TRM (UG585): Chapter 25 — System-Level Control Registers
 * - ZynqMP TRM (UG1087): Chapter 37 — Clock and Reset
 */

export interface ClockInfo {
	name: string;
	frequencyMHz: number;
	source: string;
	enabled: boolean;
}

// ─── Zynq-7000 ─────────────────────────────────────────────────────────────

const ZYNQ7000_DEFAULT_PS_CLK_MHZ = 33.333;

export function decodeZynq7000Clocks(regs: Map<number, number>, psClkMHz: number = ZYNQ7000_DEFAULT_PS_CLK_MHZ): ClockInfo[] {
	const clocks: ClockInfo[] = [];

	// ARM PLL: Fout = PS_CLK * FBDIV
	const armPllCtrl = regs.get(0xF8000100) ?? 0;
	const armFbdiv = (armPllCtrl >> 12) & 0x7F;
	const armPllFreq = psClkMHz * (armFbdiv || 1);

	// DDR PLL
	const ddrPllCtrl = regs.get(0xF8000104) ?? 0;
	const ddrFbdiv = (ddrPllCtrl >> 12) & 0x7F;
	const ddrPllFreq = psClkMHz * (ddrFbdiv || 1);

	// IO PLL
	const ioPllCtrl = regs.get(0xF8000108) ?? 0;
	const ioFbdiv = (ioPllCtrl >> 12) & 0x7F;
	const ioPllFreq = psClkMHz * (ioFbdiv || 1);

	clocks.push({ name: "ARM PLL", frequencyMHz: round(armPllFreq), source: "PS_CLK", enabled: true });
	clocks.push({ name: "DDR PLL", frequencyMHz: round(ddrPllFreq), source: "PS_CLK", enabled: true });
	clocks.push({ name: "IO PLL", frequencyMHz: round(ioPllFreq), source: "PS_CLK", enabled: true });

	// ARM Clock = ARM PLL / divisor
	const armClkCtrl = regs.get(0xF8000120) ?? 0;
	const armClkSrc = (armClkCtrl >> 4) & 0x3;
	const armClkDiv = (armClkCtrl >> 8) & 0x3f;
	const armSrcFreq = armClkSrc === 0 || armClkSrc === 1 ? armPllFreq : (armClkSrc === 2 ? ddrPllFreq : ioPllFreq);
	const armClkFreq = armSrcFreq / Math.max(armClkDiv, 1);
	const pllSrcName = armClkSrc <= 1 ? "ARM PLL" : (armClkSrc === 2 ? "DDR PLL" : "IO PLL");
	clocks.push({ name: "CPU (6x4x)", frequencyMHz: round(armClkFreq), source: pllSrcName, enabled: true });

	// CPU 6:2:1 mode
	const clk621 = regs.get(0xF80001C4) ?? 0;
	const is621 = (clk621 & 1) !== 0;
	const cpu1xFreq = is621 ? armClkFreq / 6 : armClkFreq / 4;
	clocks.push({ name: "CPU_1x", frequencyMHz: round(cpu1xFreq), source: is621 ? "6:2:1" : "4:2:1", enabled: true });

	// DDR Clock
	const ddrClkCtrl = regs.get(0xF8000124) ?? 0;
	const ddrClkDiv2 = (ddrClkCtrl >> 20) & 0x3f;
	const ddrClkDiv3 = (ddrClkCtrl >> 26) & 0x3f;
	void ddrClkDiv3;
	const ddrClkFreq = ddrPllFreq / Math.max(ddrClkDiv2, 1);
	clocks.push({ name: "DDR", frequencyMHz: round(ddrClkFreq), source: "DDR PLL", enabled: true });

	// FPGA PL Clocks
	for (let i = 0; i < 4; i++) {
		const addr = 0xF8000170 + (i * 0x10);
		const ctrl = regs.get(addr) ?? 0;
		const srcsel = (ctrl >> 4) & 0x3;
		const div0 = (ctrl >> 8) & 0x3f;
		const div1 = (ctrl >> 20) & 0x3f;
		const srcFreq = srcsel <= 1 ? ioPllFreq : (srcsel === 2 ? armPllFreq : ddrPllFreq);
		const srcName = srcsel <= 1 ? "IO PLL" : (srcsel === 2 ? "ARM PLL" : "DDR PLL");
		const freq = srcFreq / Math.max(div0, 1) / Math.max(div1, 1);
		clocks.push({ name: `FCLK${i}`, frequencyMHz: round(freq), source: srcName, enabled: true });
	}

	return clocks;
}

// ─── ZynqMP ─────────────────────────────────────────────────────────────────

const ZYNQMP_DEFAULT_PS_CLK_MHZ = 33.333;

export function decodeZynqMPClocks(regs: Map<number, number>, psClkMHz: number = ZYNQMP_DEFAULT_PS_CLK_MHZ): ClockInfo[] {
	const clocks: ClockInfo[] = [];

	// APU PLL (APLL)
	const apllCtrl = regs.get(0xFD1A0020) ?? 0;
	const apllFbdiv = (apllCtrl >> 8) & 0x7F;
	const apllBypassed = ((apllCtrl >> 3) & 1) !== 0;
	const apllFreq = apllBypassed ? psClkMHz : psClkMHz * (apllFbdiv || 1);

	// DDR PLL (DPLL)
	const dpllCtrl = regs.get(0xFD1A002C) ?? 0;
	const dpllFbdiv = (dpllCtrl >> 8) & 0x7F;
	const dpllBypassed = ((dpllCtrl >> 3) & 1) !== 0;
	const dpllFreq = dpllBypassed ? psClkMHz : psClkMHz * (dpllFbdiv || 1);

	// Video PLL (VPLL)
	const vpllCtrl = regs.get(0xFD1A0038) ?? 0;
	const vpllFbdiv = (vpllCtrl >> 8) & 0x7F;
	const vpllBypassed = ((vpllCtrl >> 3) & 1) !== 0;
	const vpllFreq = vpllBypassed ? psClkMHz : psClkMHz * (vpllFbdiv || 1);

	// IO PLL
	const ioPllCtrl = regs.get(0xFF5E0020) ?? 0;
	const ioPllFbdiv = (ioPllCtrl >> 8) & 0x7F;
	const ioPllBypassed = ((ioPllCtrl >> 3) & 1) !== 0;
	const ioPllFreq = ioPllBypassed ? psClkMHz : psClkMHz * (ioPllFbdiv || 1);

	// RPU PLL
	const rpllCtrl = regs.get(0xFF5E0030) ?? 0;
	const rpllFbdiv = (rpllCtrl >> 8) & 0x7F;
	const rpllBypassed = ((rpllCtrl >> 3) & 1) !== 0;
	const rpllFreq = rpllBypassed ? psClkMHz : psClkMHz * (rpllFbdiv || 1);

	clocks.push({ name: "APLL", frequencyMHz: round(apllFreq), source: "PS_CLK", enabled: !apllBypassed });
	clocks.push({ name: "DPLL", frequencyMHz: round(dpllFreq), source: "PS_CLK", enabled: !dpllBypassed });
	clocks.push({ name: "VPLL", frequencyMHz: round(vpllFreq), source: "PS_CLK", enabled: !vpllBypassed });
	clocks.push({ name: "IOPLL", frequencyMHz: round(ioPllFreq), source: "PS_CLK", enabled: !ioPllBypassed });
	clocks.push({ name: "RPLL", frequencyMHz: round(rpllFreq), source: "PS_CLK", enabled: !rpllBypassed });

	// APU Clock
	const acpuCtrl = regs.get(0xFD1A0060) ?? 0;
	const acpuSrcsel = (acpuCtrl >> 0) & 0x7;
	const acpuDiv0 = (acpuCtrl >> 8) & 0x3f;
	const acpuEnabled = ((acpuCtrl >> 24) & 1) !== 0;
	const acpuSrcFreq = (acpuSrcsel === 0 || acpuSrcsel === 1) ? apllFreq :
		(acpuSrcsel === 2 || acpuSrcsel === 3) ? dpllFreq : vpllFreq;
	const acpuSrcName = (acpuSrcsel <= 1) ? "APLL" : (acpuSrcsel <= 3) ? "DPLL" : "VPLL";
	const acpuFreq = acpuSrcFreq / Math.max(acpuDiv0, 1);
	clocks.push({ name: "APU", frequencyMHz: round(acpuFreq), source: acpuSrcName, enabled: acpuEnabled });

	// RPU Clock
	const rpuCtrl = regs.get(0xFF5E0090) ?? 0;
	const rpuSrcsel = (rpuCtrl >> 0) & 0x7;
	const rpuDiv0 = (rpuCtrl >> 8) & 0x3f;
	const rpuEnabled = ((rpuCtrl >> 24) & 1) !== 0;
	const rpuSrcFreq = (rpuSrcsel === 0 || rpuSrcsel === 1) ? rpllFreq : ioPllFreq;
	const rpuSrcName = (rpuSrcsel <= 1) ? "RPLL" : "IOPLL";
	const rpuFreq = rpuSrcFreq / Math.max(rpuDiv0, 1);
	clocks.push({ name: "RPU", frequencyMHz: round(rpuFreq), source: rpuSrcName, enabled: rpuEnabled });

	// DDR Clock
	const ddrCtrl = regs.get(0xFD1A0080) ?? 0;
	const ddrSrcsel = (ddrCtrl >> 0) & 0x7;
	const ddrDiv0 = (ddrCtrl >> 8) & 0x3f;
	const ddrSrcFreq = (ddrSrcsel === 0 || ddrSrcsel === 1) ? dpllFreq : vpllFreq;
	const ddrSrcName = (ddrSrcsel <= 1) ? "DPLL" : "VPLL";
	const ddrFreq = ddrSrcFreq / Math.max(ddrDiv0, 1);
	clocks.push({ name: "DDR", frequencyMHz: round(ddrFreq), source: ddrSrcName, enabled: true });

	// PL Clocks 0-3
	for (let i = 0; i < 4; i++) {
		const addr = 0xFF5E00C0 + (i * 4);
		const ctrl = regs.get(addr) ?? 0;
		const srcsel = ctrl & 0x7;
		const div0 = (ctrl >> 8) & 0x3f;
		const div1 = (ctrl >> 16) & 0x3f;
		const enabled = ((ctrl >> 24) & 1) !== 0;
		const srcFreq = (srcsel <= 1) ? ioPllFreq : (srcsel <= 3) ? rpllFreq : dpllFreq;
		const srcName = (srcsel <= 1) ? "IOPLL" : (srcsel <= 3) ? "RPLL" : "DPLL";
		const freq = srcFreq / Math.max(div0, 1) / Math.max(div1, 1);
		clocks.push({ name: `PL${i}`, frequencyMHz: round(freq), source: srcName, enabled });
	}

	return clocks;
}

// ─── Versal (stub) ──────────────────────────────────────────────────────────

export function decodeVersalClocks(_regs: Map<number, number>, _refClkMHz?: number): ClockInfo[] {
	return [
		{ name: "Versal", frequencyMHz: 0, source: "not yet supported", enabled: false },
	];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
