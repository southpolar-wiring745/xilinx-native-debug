/**
 * ARM Fault Register Decoder — Crash Analyzer
 *
 * Decodes ARM fault status registers into human-readable crash reports.
 * Supports both AArch32 (Cortex-A9, Cortex-R5) and AArch64 (Cortex-A53).
 *
 * Based on:
 * - ARM Architecture Reference Manual (ARMv7-A/R): DFSR/IFSR/DFAR/IFAR
 * - ARM Architecture Reference Manual (ARMv8-A): ESR_ELx/FAR_ELx/ELR_ELx
 */

export interface CrashReport {
	exceptionType: string;
	faultType: string;
	faultAddress?: number;
	returnAddress?: number;
	description: string;
	rawRegisters: Record<string, number>;
}

// ─── AArch32 Fault Decoding ─────────────────────────────────────────────────

/** DFSR/IFSR fault status field encoding (ARMv7-A/R, short descriptor) */
const AARCH32_FAULT_STATUS: Record<number, string> = {
	0b00001: "Alignment fault",
	0b00100: "Instruction cache maintenance fault",
	0b01100: "Translation fault (L1)",
	0b01110: "Translation fault (L2)",
	0b00101: "Translation fault (Section)",
	0b00111: "Translation fault (Page)",
	0b01001: "Domain fault (Section)",
	0b01011: "Domain fault (Page)",
	0b01101: "Permission fault (Section)",
	0b01111: "Permission fault (Page)",
	0b00010: "Debug event",
	0b01000: "Synchronous external abort",
	0b10000: "TLB conflict abort",
	0b10100: "Implementation defined (Lockdown)",
	0b11010: "Implementation defined (Coprocessor abort)",
	0b11001: "Synchronous parity/ECC error on memory access",
	0b00110: "Asynchronous external abort",
	0b11000: "Asynchronous parity/ECC error",
};

/**
 * Decode an AArch32 fault from DFSR/DFAR/IFSR/IFAR registers.
 */
export function decodeAArch32Fault(
	dfsr: number,
	dfar: number,
	ifsr: number,
	ifar: number,
): CrashReport {
	const rawRegisters: Record<string, number> = { DFSR: dfsr, DFAR: dfar, IFSR: ifsr, IFAR: ifar };

	// Extract fault status from DFSR: bits [12,10,3:0]
	const dfsrStatus = ((dfsr >> 6) & 0x10) | (dfsr & 0xF);
	const ifsrStatus = ((ifsr >> 6) & 0x10) | (ifsr & 0xF);

	// Check if we have a data fault
	const dfsrFault = AARCH32_FAULT_STATUS[dfsrStatus];
	const ifsrFault = AARCH32_FAULT_STATUS[ifsrStatus];

	let exceptionType: string;
	let faultType: string;
	let faultAddress: number | undefined;
	let description: string;

	if (dfsrFault && dfsrStatus !== 0) {
		exceptionType = "Data Abort";
		faultType = dfsrFault;
		faultAddress = dfar;
		const wnr = (dfsr >> 11) & 1;
		const accessType = wnr ? "write" : "read";
		description = `Data abort during ${accessType} access: ${faultType} at address 0x${dfar.toString(16).padStart(8, "0")}`;
	} else if (ifsrFault && ifsrStatus !== 0) {
		exceptionType = "Prefetch Abort";
		faultType = ifsrFault;
		faultAddress = ifar;
		description = `Instruction abort: ${faultType} at address 0x${ifar.toString(16).padStart(8, "0")}`;
	} else {
		exceptionType = "Unknown Exception";
		faultType = `DFSR status=0x${dfsrStatus.toString(16)}, IFSR status=0x${ifsrStatus.toString(16)}`;
		description = "Unable to classify fault. DFSR and IFSR may not contain valid fault status.";
	}

	return {
		exceptionType,
		faultType,
		faultAddress,
		description,
		rawRegisters,
	};
}

// ─── AArch64 Fault Decoding ─────────────────────────────────────────────────

/** Exception Class (EC) field encoding [31:26] of ESR_ELx */
const AARCH64_EXCEPTION_CLASS: Record<number, string> = {
	0b000000: "Unknown reason",
	0b000001: "Trapped WFI/WFE",
	0b000011: "Trapped MCR/MRC (CP15)",
	0b000100: "Trapped MCRR/MRRC (CP15)",
	0b000101: "Trapped MCR/MRC (CP14)",
	0b000110: "Trapped LDC/STC",
	0b000111: "Trapped SIMD/FP",
	0b001000: "Trapped VMRS (PSTATE.{IT,GE})",
	0b001100: "Trapped MRRC (CP14)",
	0b001110: "Illegal execution state",
	0b010001: "SVC instruction (AArch32)",
	0b010010: "HVC instruction (AArch32)",
	0b010011: "SMC instruction (AArch32)",
	0b010101: "SVC instruction (AArch64)",
	0b010110: "HVC instruction (AArch64)",
	0b010111: "SMC instruction (AArch64)",
	0b011000: "Trapped MSR/MRS/System instruction",
	0b011001: "Trapped SVE",
	0b100000: "Instruction Abort (lower EL)",
	0b100001: "Instruction Abort (same EL)",
	0b100010: "PC alignment fault",
	0b100100: "Data Abort (lower EL)",
	0b100101: "Data Abort (same EL)",
	0b100110: "SP alignment fault",
	0b101000: "Trapped FP (AArch32)",
	0b101100: "Trapped FP (AArch64)",
	0b101111: "SError",
	0b110000: "Breakpoint (lower EL)",
	0b110001: "Breakpoint (same EL)",
	0b110010: "Software step (lower EL)",
	0b110011: "Software step (same EL)",
	0b110100: "Watchpoint (lower EL)",
	0b110101: "Watchpoint (same EL)",
	0b111000: "BKPT instruction (AArch32)",
	0b111100: "BRK instruction (AArch64)",
};

/** Data/Instruction Fault Status Code (DFSC/IFSC) encoding [5:0] of ISS */
const AARCH64_FAULT_STATUS_CODE: Record<number, string> = {
	0b000000: "Address size fault (L0)",
	0b000001: "Address size fault (L1)",
	0b000010: "Address size fault (L2)",
	0b000011: "Address size fault (L3)",
	0b000100: "Translation fault (L0)",
	0b000101: "Translation fault (L1)",
	0b000110: "Translation fault (L2)",
	0b000111: "Translation fault (L3)",
	0b001001: "Access flag fault (L1)",
	0b001010: "Access flag fault (L2)",
	0b001011: "Access flag fault (L3)",
	0b001101: "Permission fault (L1)",
	0b001110: "Permission fault (L2)",
	0b001111: "Permission fault (L3)",
	0b010000: "Synchronous external abort (not on translation table walk)",
	0b010100: "Synchronous external abort (L0)",
	0b010101: "Synchronous external abort (L1)",
	0b010110: "Synchronous external abort (L2)",
	0b010111: "Synchronous external abort (L3)",
	0b011000: "Synchronous parity/ECC error (not on translation table walk)",
	0b011100: "Synchronous parity/ECC error (L0)",
	0b011101: "Synchronous parity/ECC error (L1)",
	0b011110: "Synchronous parity/ECC error (L2)",
	0b011111: "Synchronous parity/ECC error (L3)",
	0b100001: "Alignment fault",
	0b110000: "TLB conflict abort",
	0b110001: "Unsupported atomic hardware update fault",
	0b110100: "Implementation defined (Lockdown)",
	0b110101: "Implementation defined (Unsupported exclusive/atomic)",
};

/**
 * Decode an AArch64 fault from ESR_ELx/FAR_ELx/ELR_ELx registers.
 */
export function decodeAArch64Fault(
	esr: number,
	far: number,
	elr: number,
): CrashReport {
	const rawRegisters: Record<string, number> = { ESR_EL1: esr, FAR_EL1: far, ELR_EL1: elr };

	const ec = (esr >>> 26) & 0x3F;
	const iss = esr & 0x1FFFFFF;
	const il = (esr >>> 25) & 1;

	const exceptionClass = AARCH64_EXCEPTION_CLASS[ec] ?? `Unknown EC (0x${ec.toString(16)})`;

	let faultType: string;
	let description: string;
	let faultAddress: number | undefined;

	// Data abort or Instruction abort — decode DFSC/IFSC
	if (ec === 0b100000 || ec === 0b100001 || ec === 0b100100 || ec === 0b100101) {
		const fsc = iss & 0x3F;
		faultType = AARCH64_FAULT_STATUS_CODE[fsc] ?? `Unknown FSC (0x${fsc.toString(16)})`;
		faultAddress = far;

		const isDataAbort = ec === 0b100100 || ec === 0b100101;
		if (isDataAbort) {
			const wnr = (iss >> 6) & 1;
			const accessType = wnr ? "write" : "read";
			description = `Data abort during ${accessType}: ${faultType} at address 0x${far.toString(16).padStart(16, "0")}`;
		} else {
			description = `Instruction abort: ${faultType} at address 0x${far.toString(16).padStart(16, "0")}`;
		}
	} else if (ec === 0b100010) {
		faultType = "PC alignment fault";
		faultAddress = far;
		description = `PC alignment fault at ELR=0x${elr.toString(16).padStart(16, "0")}`;
	} else if (ec === 0b100110) {
		faultType = "SP alignment fault";
		description = `SP alignment fault at ELR=0x${elr.toString(16).padStart(16, "0")}`;
	} else if (ec === 0b101111) {
		const dfsc = iss & 0x3F;
		faultType = AARCH64_FAULT_STATUS_CODE[dfsc] ?? `SError (ISS=0x${iss.toString(16)})`;
		description = `SError interrupt: ${faultType}`;
	} else {
		faultType = exceptionClass;
		description = `${exceptionClass}. ISS=0x${iss.toString(16)}, IL=${il}`;
	}

	return {
		exceptionType: exceptionClass,
		faultType,
		faultAddress,
		returnAddress: elr,
		description,
		rawRegisters,
	};
}

// ─── Report formatting ──────────────────────────────────────────────────────

/**
 * Format a CrashReport into a human-readable string for the Debug Console.
 */
export function formatCrashReport(report: CrashReport, architecture: string): string {
	const lines: string[] = [];
	lines.push("═══════════════════════════════════════════════");
	lines.push("[Crash Analyzer] Exception Detected");
	lines.push("═══════════════════════════════════════════════");
	lines.push(`Type:    ${report.exceptionType}`);
	lines.push(`Fault:   ${report.faultType}`);
	if (report.faultAddress !== undefined) {
		const hexWidth = architecture.includes("64") ? 16 : 8;
		lines.push(`Address: 0x${report.faultAddress.toString(16).toUpperCase().padStart(hexWidth, "0")}`);
	}
	if (report.returnAddress !== undefined) {
		const hexWidth = architecture.includes("64") ? 16 : 8;
		lines.push(`PC:      0x${report.returnAddress.toString(16).toUpperCase().padStart(hexWidth, "0")}`);
	}
	lines.push(`Architecture: ${architecture}`);
	lines.push("");
	lines.push("Raw registers:");
	for (const [name, value] of Object.entries(report.rawRegisters)) {
		const hexWidth = architecture.includes("64") ? 16 : 8;
		lines.push(`  ${name} = 0x${value.toString(16).toUpperCase().padStart(hexWidth, "0")}`);
	}
	lines.push("═══════════════════════════════════════════════");
	return lines.join("\n");
}
