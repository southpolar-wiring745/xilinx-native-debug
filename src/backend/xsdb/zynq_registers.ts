/**
 * Zynq / ARM register group definitions and peripheral address maps.
 *
 * Provides structured register presets for the Variables panel so that
 * XSDB `rrd` output is presented in meaningful groups instead of a flat
 * list.  Also defines common Zynq-7000 / ZynqMP peripheral base addresses
 * for the peripheral watch feature.
 */

// ---------------------------------------------------------------------------
// Register group definitions (ARM Cortex-A9 / A53 / R5)
// ---------------------------------------------------------------------------

export type RegisterPreset = "minimal" | "core" | "all";
export type RegisterArchitecture = "cortex-a9" | "cortex-a53-32" | "cortex-a53-64" | "cortex-r5";

export interface RegisterGroupDef {
	/** Display name shown in the Variables panel. */
	label: string;
	/** Register names (from XSDB `rrd`) that belong to this group. */
	names: string[];
	/** If true, this group is shown only when preset is "all". */
	allOnly?: boolean;
}

/** Core registers visible in the "minimal" preset. */
const MINIMAL_REGS_BY_ARCH: Record<RegisterArchitecture, string[]> = {
	"cortex-a9": [
		"r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7",
		"r8", "r9", "r10", "r11", "r12", "sp", "lr", "pc", "cpsr",
	],
	"cortex-a53-32": [
		"r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7",
		"r8", "r9", "r10", "r11", "r12", "sp", "lr", "pc", "cpsr",
	],
	"cortex-a53-64": [
		"x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7",
		"x8", "x9", "x10", "x11", "x12", "x13", "x14", "x15",
		"x16", "x17", "x18", "x19", "x20", "x21", "x22", "x23",
		"x24", "x25", "x26", "x27", "x28", "x29", "x30", "sp", "pc", "cpsr",
	],
	"cortex-r5": [
		"r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7",
		"r8", "r9", "r10", "r11", "r12", "sp", "lr", "pc", "cpsr",
	],
};

export const ARM_CORTEX_A9_GROUPS: RegisterGroupDef[] = [
	{
		label: "General Purpose",
		names: [
			"r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7",
			"r8", "r9", "r10", "r11", "r12",
		],
	},
	{
		label: "Stack / Link / PC",
		names: ["sp", "lr", "pc"],
	},
	{
		label: "Status Registers",
		names: ["cpsr", "spsr", "spsr_abt", "spsr_fiq", "spsr_irq", "spsr_svc", "spsr_und"],
	},
	{
		label: "Banked (USR/SYS)",
		names: ["r8_usr", "r9_usr", "r10_usr", "r11_usr", "r12_usr", "sp_usr", "lr_usr"],
		allOnly: true,
	},
	{
		label: "Banked (FIQ)",
		names: ["r8_fiq", "r9_fiq", "r10_fiq", "r11_fiq", "r12_fiq", "sp_fiq", "lr_fiq"],
		allOnly: true,
	},
	{
		label: "Banked (IRQ)",
		names: ["sp_irq", "lr_irq"],
		allOnly: true,
	},
	{
		label: "Banked (SVC)",
		names: ["sp_svc", "lr_svc"],
		allOnly: true,
	},
	{
		label: "Banked (ABT)",
		names: ["sp_abt", "lr_abt"],
		allOnly: true,
	},
	{
		label: "Banked (UND)",
		names: ["sp_und", "lr_und"],
		allOnly: true,
	},
	{
		label: "VFP / NEON",
		names: [
			"fpscr", "fpexc",
			"d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7",
			"d8", "d9", "d10", "d11", "d12", "d13", "d14", "d15",
			"d16", "d17", "d18", "d19", "d20", "d21", "d22", "d23",
			"d24", "d25", "d26", "d27", "d28", "d29", "d30", "d31",
		],
		allOnly: true,
	},
	{
		label: "CP15 / System Control",
		names: [
			"sctlr", "actlr", "ttbr0", "ttbr1", "ttbcr", "dacr",
			"dfsr", "ifsr", "dfar", "ifar", "contextidr", "tpidrurw",
			"tpidruro", "tpidrprw",
		],
		allOnly: true,
	},
];

export const ARM_CORTEX_A53_GROUPS: RegisterGroupDef[] = [
	{
		label: "General Purpose",
		names: [
			"x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7",
			"x8", "x9", "x10", "x11", "x12", "x13", "x14", "x15",
			"x16", "x17", "x18", "x19", "x20", "x21", "x22", "x23",
			"x24", "x25", "x26", "x27", "x28", "x29", "x30",
		],
	},
	{
		label: "Stack / Link / PC",
		names: ["sp", "pc"],
	},
	{
		label: "Status / EL",
		names: ["cpsr", "spsr_el1", "spsr_el2", "spsr_el3", "elr_el1", "elr_el2", "elr_el3"],
	},
	{
		label: "System Control",
		names: [
			"sctlr_el1", "sctlr_el2", "sctlr_el3",
			"tcr_el1", "tcr_el2", "tcr_el3",
			"ttbr0_el1", "ttbr1_el1",
			"mair_el1", "contextidr_el1", "vbar_el1", "vbar_el2", "vbar_el3",
		],
		allOnly: true,
	},
	{
		label: "FP / SIMD",
		names: [
			"fpcr", "fpsr",
			"v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7",
			"v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15",
			"v16", "v17", "v18", "v19", "v20", "v21", "v22", "v23",
			"v24", "v25", "v26", "v27", "v28", "v29", "v30", "v31",
		],
		allOnly: true,
	},
];

export const ARM_CORTEX_A53_32_GROUPS: RegisterGroupDef[] = [
	{
		label: "General Purpose",
		names: [
			"r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7",
			"r8", "r9", "r10", "r11", "r12",
		],
	},
	{
		label: "Stack / Link / PC",
		names: ["sp", "lr", "pc"],
	},
	{
		label: "Status Registers",
		names: ["cpsr", "spsr"],
	},
	{
		label: "VFP / NEON",
		names: [
			"fpscr", "fpexc",
			"d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7",
			"d8", "d9", "d10", "d11", "d12", "d13", "d14", "d15",
			"d16", "d17", "d18", "d19", "d20", "d21", "d22", "d23",
			"d24", "d25", "d26", "d27", "d28", "d29", "d30", "d31",
		],
		allOnly: true,
	},
	{
		label: "CP15 / System Control",
		names: [
			"sctlr", "actlr", "ttbr0", "ttbr1", "ttbcr", "dacr",
			"dfsr", "ifsr", "dfar", "ifar", "contextidr", "mpidr",
			"tpidrurw", "tpidruro", "tpidrprw",
		],
		allOnly: true,
	},
];

export const ARM_CORTEX_R5_GROUPS: RegisterGroupDef[] = [
	{
		label: "General Purpose",
		names: [
			"r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7",
			"r8", "r9", "r10", "r11", "r12",
		],
	},
	{
		label: "Stack / Link / PC",
		names: ["sp", "lr", "pc"],
	},
	{
		label: "Status Registers",
		names: ["cpsr", "spsr", "spsr_abt", "spsr_fiq", "spsr_irq", "spsr_svc", "spsr_und"],
	},
	{
		label: "Banked (FIQ)",
		names: ["r8_fiq", "r9_fiq", "r10_fiq", "r11_fiq", "r12_fiq", "sp_fiq", "lr_fiq"],
		allOnly: true,
	},
	{
		label: "Banked (IRQ/SVC/ABT/UND)",
		names: ["sp_irq", "lr_irq", "sp_svc", "lr_svc", "sp_abt", "lr_abt", "sp_und", "lr_und"],
		allOnly: true,
	},
	{
		label: "VFP",
		names: [
			"fpscr", "fpexc",
			"d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7",
			"d8", "d9", "d10", "d11", "d12", "d13", "d14", "d15",
		],
		allOnly: true,
	},
	{
		label: "CP15 / MPU",
		names: [
			"sctlr", "actlr", "ttbr0", "ttbr1", "ttbcr", "dacr",
			"dfsr", "ifsr", "dfar", "ifar", "mpidr",
		],
		allOnly: true,
	},
];

function detectArchFromTargetName(targetName: string | undefined): RegisterArchitecture | undefined {
	if (!targetName) return undefined;
	const lower = targetName.toLowerCase();
	if (/(cortex[-\s]*r5|\br5\b|\brpu\b)/i.test(lower)) return "cortex-r5";
	if (/(cortex[-\s]*a9|\ba9\b)/i.test(lower)) return "cortex-a9";
	if (/(cortex[-\s]*a53|\ba53\b)/i.test(lower)) return "cortex-a53-64";
	return undefined;
}

function detectArchFromRegisterNames(registerNames: Iterable<string> | undefined): RegisterArchitecture | undefined {
	if (!registerNames) return undefined;
	const lower = new Set<string>();
	for (const name of registerNames) {
		lower.add(name.toLowerCase());
	}
	if (lower.has("x0") || lower.has("x30") || lower.has("sp_el0") || lower.has("elr_el1")) {
		return "cortex-a53-64";
	}
	if (lower.has("r0") || lower.has("r15")) {
		return "cortex-a53-32";
	}
	return undefined;
}

export function inferRegisterArchitecture(
	boardFamily: string | undefined,
	targetName?: string,
	registerNames?: Iterable<string>,
): RegisterArchitecture {
	const fromTarget = detectArchFromTargetName(targetName);
	if (fromTarget) return fromTarget;

	const fromRegs = detectArchFromRegisterNames(registerNames);
	if (fromRegs) {
		if (fromRegs === "cortex-a53-32" && boardFamily === "zynq7000") {
			return "cortex-a9";
		}
		return fromRegs;
	}

	if (boardFamily === "zynqmp" || boardFamily === "versal") {
		return "cortex-a53-64";
	}
	return "cortex-a9";
}

/**
 * Return the register groups applicable for a given board family/preset/architecture.
 */
export function getRegisterGroups(
	boardFamily: string | undefined,
	preset: RegisterPreset,
	architecture?: RegisterArchitecture,
): RegisterGroupDef[] {
	const arch = architecture || inferRegisterArchitecture(boardFamily);
	const groups = arch === "cortex-a53-64"
		? ARM_CORTEX_A53_GROUPS
		: arch === "cortex-a53-32"
			? ARM_CORTEX_A53_32_GROUPS
			: arch === "cortex-r5"
				? ARM_CORTEX_R5_GROUPS
				: ARM_CORTEX_A9_GROUPS;

	if (preset === "all") return groups;
	if (preset === "minimal") {
		// Return only the first three groups (GP, SP/LR/PC, Status)
		return groups.filter(g => !g.allOnly).slice(0, 3);
	}
	// "core" — everything except allOnly
	return groups.filter(g => !g.allOnly);
}

/**
 * Check if a register name belongs to the minimal set.
 */
export function isMinimalRegister(name: string, architecture: RegisterArchitecture = "cortex-a9"): boolean {
	return (MINIMAL_REGS_BY_ARCH[architecture] || MINIMAL_REGS_BY_ARCH["cortex-a9"]).includes(name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Peripheral address maps
// ---------------------------------------------------------------------------

export interface PeripheralRegisterDef {
	/** Display name */
	name: string;
	/** Base address */
	address: number;
	/** Description */
	description: string;
}

export interface PeripheralGroupDef {
	/** Peripheral block name */
	label: string;
	/** Description */
	description: string;
	/** Individual registers in this peripheral */
	registers: PeripheralRegisterDef[];
}

// ---- Zynq-7000 Peripherals -----------------------------------------------

export const ZYNQ7000_PERIPHERALS: PeripheralGroupDef[] = [
	{
		label: "SLCR (System Level Control)",
		description: "PS system-level control registers",
		registers: [
			{ name: "SCL", address: 0xF8000000, description: "Secure config lock" },
			{ name: "SLCR_LOCK", address: 0xF8000004, description: "SLCR write protection lock" },
			{ name: "SLCR_UNLOCK", address: 0xF8000008, description: "SLCR write protection unlock" },
			{ name: "SLCR_LOCKSTA", address: 0xF800000C, description: "SLCR write protection status" },
			{ name: "ARM_PLL_CTRL", address: 0xF8000100, description: "ARM PLL control" },
			{ name: "DDR_PLL_CTRL", address: 0xF8000104, description: "DDR PLL control" },
			{ name: "IO_PLL_CTRL", address: 0xF8000108, description: "IO PLL control" },
			{ name: "ARM_CLK_CTRL", address: 0xF8000120, description: "CPU clock control" },
			{ name: "DDR_CLK_CTRL", address: 0xF8000124, description: "DDR clock control" },
			{ name: "FPGA0_CLK_CTRL", address: 0xF8000170, description: "PL clock 0 control" },
			{ name: "FPGA1_CLK_CTRL", address: 0xF8000180, description: "PL clock 1 control" },
			{ name: "PSS_RST_CTRL", address: 0xF8000200, description: "PS software reset control" },
			{ name: "FPGA_RST_CTRL", address: 0xF8000240, description: "FPGA software reset control" },
			{ name: "REBOOT_STATUS", address: 0xF8000258, description: "Reboot status" },
			{ name: "PSS_IDCODE", address: 0xF8000530, description: "PS IDCODE" },
		],
	},
	{
		label: "DDRC (DDR Controller)",
		description: "DDR memory controller registers",
		registers: [
			{ name: "DDRC_CTRL", address: 0xF8006000, description: "DDRC control" },
			{ name: "TWO_RANK_CFG", address: 0xF8006004, description: "Two rank configuration" },
			{ name: "HPR_REG", address: 0xF8006008, description: "HPR queue control" },
			{ name: "LPR_REG", address: 0xF800600C, description: "LPR queue control" },
			{ name: "WR_REG", address: 0xF8006010, description: "Write queue control" },
			{ name: "DRAM_PARAM0", address: 0xF8006014, description: "DRAM parameters 0" },
			{ name: "DRAM_PARAM1", address: 0xF8006018, description: "DRAM parameters 1" },
			{ name: "MODE_STS_REG", address: 0xF8006054, description: "Controller operation mode status" },
		],
	},
	{
		label: "TTC0 (Triple Timer Counter 0)",
		description: "Triple timer/counter unit 0",
		registers: [
			{ name: "CLK_CTRL_1", address: 0xF8001000, description: "Clock control 1" },
			{ name: "CLK_CTRL_2", address: 0xF8001004, description: "Clock control 2" },
			{ name: "CLK_CTRL_3", address: 0xF8001008, description: "Clock control 3" },
			{ name: "CNT_CTRL_1", address: 0xF800100C, description: "Counter control 1" },
			{ name: "CNT_CTRL_2", address: 0xF8001010, description: "Counter control 2" },
			{ name: "CNT_CTRL_3", address: 0xF8001014, description: "Counter control 3" },
			{ name: "CNT_VAL_1", address: 0xF8001018, description: "Counter value 1" },
			{ name: "CNT_VAL_2", address: 0xF800101C, description: "Counter value 2" },
			{ name: "CNT_VAL_3", address: 0xF8001020, description: "Counter value 3" },
		],
	},
	{
		label: "UART0",
		description: "UART controller 0",
		registers: [
			{ name: "CR", address: 0xE0000000, description: "Control register" },
			{ name: "MR", address: 0xE0000004, description: "Mode register" },
			{ name: "IER", address: 0xE0000008, description: "Interrupt enable" },
			{ name: "IDR", address: 0xE000000C, description: "Interrupt disable" },
			{ name: "IMR", address: 0xE0000010, description: "Interrupt mask" },
			{ name: "ISR", address: 0xE0000014, description: "Channel interrupt status" },
			{ name: "BAUDGEN", address: 0xE0000018, description: "Baud rate generator" },
			{ name: "RXTOUT", address: 0xE000001C, description: "Receiver timeout" },
			{ name: "SR", address: 0xE000002C, description: "Channel status" },
		],
	},
	{
		label: "UART1",
		description: "UART controller 1",
		registers: [
			{ name: "CR", address: 0xE0001000, description: "Control register" },
			{ name: "MR", address: 0xE0001004, description: "Mode register" },
			{ name: "SR", address: 0xE000102C, description: "Channel status" },
		],
	},
	{
		label: "GIC (Interrupt Controller)",
		description: "ARM Generic Interrupt Controller (GIC PL390)",
		registers: [
			{ name: "ICDDCR", address: 0xF8F01000, description: "Distributor control" },
			{ name: "ICDICTR", address: 0xF8F01004, description: "Interrupt controller type" },
			{ name: "ICDIIDR", address: 0xF8F01008, description: "Distributor implementer ID" },
			{ name: "ICCICR", address: 0xF8F00100, description: "CPU interface control" },
			{ name: "ICCPMR", address: 0xF8F00104, description: "Interrupt priority mask" },
			{ name: "ICCBPR", address: 0xF8F00108, description: "Binary point" },
			{ name: "ICCIAR", address: 0xF8F0010C, description: "Interrupt acknowledge" },
			{ name: "ICCEOIR", address: 0xF8F00110, description: "End of interrupt" },
		],
	},
	{
		label: "SCU (Snoop Control Unit)",
		description: "Cortex-A9 MPCore SCU",
		registers: [
			{ name: "SCU_CTRL", address: 0xF8F00000, description: "SCU control" },
			{ name: "SCU_CONFIG", address: 0xF8F00004, description: "SCU configuration" },
			{ name: "SCU_FILTER_START", address: 0xF8F00040, description: "Filtering start address" },
			{ name: "SCU_FILTER_END", address: 0xF8F00044, description: "Filtering end address" },
		],
	},
];

// ---- Zynq UltraScale+ Peripherals ----------------------------------------

export const ZYNQMP_PERIPHERALS: PeripheralGroupDef[] = [
	{
		label: "CRL_APB (Low-Power Domain Clock)",
		description: "Clock and reset for LPD",
		registers: [
			{ name: "IOPLL_CTRL", address: 0xFF5E0020, description: "IO PLL control" },
			{ name: "RPLL_CTRL", address: 0xFF5E0030, description: "RPU PLL control" },
			{ name: "UART0_REF_CTRL", address: 0xFF5E0074, description: "UART0 reference clock" },
			{ name: "UART1_REF_CTRL", address: 0xFF5E0078, description: "UART1 reference clock" },
			{ name: "RST_LPD_TOP", address: 0xFF5E023C, description: "LPD top-level software reset" },
		],
	},
	{
		label: "CRF_APB (Full-Power Domain Clock)",
		description: "Clock and reset for FPD",
		registers: [
			{ name: "APLL_CTRL", address: 0xFD1A0020, description: "APU PLL control" },
			{ name: "DPLL_CTRL", address: 0xFD1A002C, description: "Display PLL control" },
			{ name: "VPLL_CTRL", address: 0xFD1A0038, description: "Video PLL control" },
			{ name: "RST_FPD_TOP", address: 0xFD1A0100, description: "FPD top-level software reset" },
		],
	},
	{
		label: "UART0 (ZynqMP)",
		description: "UART controller 0",
		registers: [
			{ name: "CR", address: 0xFF000000, description: "Control register" },
			{ name: "MR", address: 0xFF000004, description: "Mode register" },
			{ name: "SR", address: 0xFF00002C, description: "Channel status" },
		],
	},
	{
		label: "GICv2 Distributor",
		description: "ARM GICv2 distributor",
		registers: [
			{ name: "GICD_CTLR", address: 0xF9010000, description: "Distributor control" },
			{ name: "GICD_TYPER", address: 0xF9010004, description: "Interrupt controller type" },
			{ name: "GICD_IIDR", address: 0xF9010008, description: "Distributor implementer ID" },
		],
	},
];

/**
 * Return the peripheral group definitions for a given board family.
 */
export function getPeripheralGroups(boardFamily: string | undefined): PeripheralGroupDef[] {
	switch (boardFamily) {
		case "zynqmp":
		case "versal":
			return ZYNQMP_PERIPHERALS;
		case "zynq7000":
		default:
			return ZYNQ7000_PERIPHERALS;
	}
}
