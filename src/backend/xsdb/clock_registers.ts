/**
 * Clock register address maps per Xilinx platform.
 * Values sourced from Xilinx TRMs (UG585 for Zynq-7000, UG1087 for ZynqMP).
 */

export interface ClockRegisterDef {
	name: string;
	address: number;
	description: string;
}

// ─── Zynq-7000 SLCR (0xF8000000) ───────────────────────────────────────────

export const ZYNQ7000_SLCR_BASE = 0xF8000000;

export const ZYNQ7000_CLOCK_REGISTERS: ClockRegisterDef[] = [
	{ name: "ARM_PLL_CTRL", address: 0xF8000100, description: "ARM PLL Control" },
	{ name: "DDR_PLL_CTRL", address: 0xF8000104, description: "DDR PLL Control" },
	{ name: "IO_PLL_CTRL", address: 0xF8000108, description: "IO PLL Control" },
	{ name: "PLL_STATUS", address: 0xF800010C, description: "PLL Lock Status" },
	{ name: "ARM_PLL_CFG", address: 0xF8000110, description: "ARM PLL Configuration" },
	{ name: "DDR_PLL_CFG", address: 0xF8000114, description: "DDR PLL Configuration" },
	{ name: "IO_PLL_CFG", address: 0xF8000118, description: "IO PLL Configuration" },
	{ name: "ARM_CLK_CTRL", address: 0xF8000120, description: "ARM Clock Control" },
	{ name: "DDR_CLK_CTRL", address: 0xF8000124, description: "DDR Clock Control" },
	{ name: "DCI_CLK_CTRL", address: 0xF8000128, description: "DCI Clock Control" },
	{ name: "APER_CLK_CTRL", address: 0xF800012C, description: "AMBA Peripheral Clock Control" },
	{ name: "USB0_CLK_CTRL", address: 0xF8000130, description: "USB0 Clock Control" },
	{ name: "USB1_CLK_CTRL", address: 0xF8000134, description: "USB1 Clock Control" },
	{ name: "GEM0_RCLK_CTRL", address: 0xF8000138, description: "GEM0 Rx Clock Control" },
	{ name: "GEM1_RCLK_CTRL", address: 0xF800013C, description: "GEM1 Rx Clock Control" },
	{ name: "GEM0_CLK_CTRL", address: 0xF8000140, description: "GEM0 Ref Clock Control" },
	{ name: "GEM1_CLK_CTRL", address: 0xF8000144, description: "GEM1 Ref Clock Control" },
	{ name: "SMC_CLK_CTRL", address: 0xF8000148, description: "SMC Clock Control" },
	{ name: "LQSPI_CLK_CTRL", address: 0xF800014C, description: "Quad SPI Clock Control" },
	{ name: "SDIO_CLK_CTRL", address: 0xF8000150, description: "SDIO Clock Control" },
	{ name: "UART_CLK_CTRL", address: 0xF8000154, description: "UART Clock Control" },
	{ name: "SPI_CLK_CTRL", address: 0xF8000158, description: "SPI Clock Control" },
	{ name: "CAN_CLK_CTRL", address: 0xF800015C, description: "CAN Clock Control" },
	{ name: "PCAP_CLK_CTRL", address: 0xF8000168, description: "PCAP Clock Control" },
	{ name: "FPGA0_CLK_CTRL", address: 0xF8000170, description: "PL Clock 0 Control" },
	{ name: "FPGA1_CLK_CTRL", address: 0xF8000180, description: "PL Clock 1 Control" },
	{ name: "FPGA2_CLK_CTRL", address: 0xF8000190, description: "PL Clock 2 Control" },
	{ name: "FPGA3_CLK_CTRL", address: 0xF80001A0, description: "PL Clock 3 Control" },
	{ name: "CLK_621_TRUE", address: 0xF80001C4, description: "CPU 6:2:1 Clock Ratio" },
];

// ─── ZynqMP CRL_APB (0xFF5E0000) ───────────────────────────────────────────

export const ZYNQMP_CRL_APB_BASE = 0xFF5E0000;

export const ZYNQMP_CRL_REGISTERS: ClockRegisterDef[] = [
	{ name: "IOPLL_CTRL", address: 0xFF5E0020, description: "IO PLL Control" },
	{ name: "RPLL_CTRL", address: 0xFF5E0030, description: "RPU PLL Control" },
	{ name: "PLL_STATUS", address: 0xFF5E0040, description: "PLL Lock Status" },
	{ name: "IOPLL_CFG", address: 0xFF5E0024, description: "IO PLL Configuration" },
	{ name: "RPLL_CFG", address: 0xFF5E0034, description: "RPU PLL Configuration" },
	{ name: "USB0_BUS_REF_CTRL", address: 0xFF5E0060, description: "USB0 Bus Ref Clock" },
	{ name: "USB1_BUS_REF_CTRL", address: 0xFF5E0064, description: "USB1 Bus Ref Clock" },
	{ name: "GEM0_REF_CTRL", address: 0xFF5E0050, description: "GEM0 Ref Clock" },
	{ name: "GEM1_REF_CTRL", address: 0xFF5E0054, description: "GEM1 Ref Clock" },
	{ name: "GEM2_REF_CTRL", address: 0xFF5E0058, description: "GEM2 Ref Clock" },
	{ name: "GEM3_REF_CTRL", address: 0xFF5E005C, description: "GEM3 Ref Clock" },
	{ name: "QSPI_REF_CTRL", address: 0xFF5E0068, description: "QSPI Ref Clock" },
	{ name: "SDIO0_REF_CTRL", address: 0xFF5E006C, description: "SDIO0 Ref Clock" },
	{ name: "SDIO1_REF_CTRL", address: 0xFF5E0070, description: "SDIO1 Ref Clock" },
	{ name: "UART0_REF_CTRL", address: 0xFF5E0074, description: "UART0 Ref Clock" },
	{ name: "UART1_REF_CTRL", address: 0xFF5E0078, description: "UART1 Ref Clock" },
	{ name: "SPI0_REF_CTRL", address: 0xFF5E007C, description: "SPI0 Ref Clock" },
	{ name: "SPI1_REF_CTRL", address: 0xFF5E0080, description: "SPI1 Ref Clock" },
	{ name: "CAN0_REF_CTRL", address: 0xFF5E0084, description: "CAN0 Ref Clock" },
	{ name: "CAN1_REF_CTRL", address: 0xFF5E0088, description: "CAN1 Ref Clock" },
	{ name: "CPU_R5_CTRL", address: 0xFF5E0090, description: "RPU Clock Control" },
	{ name: "IOU_SWITCH_CTRL", address: 0xFF5E009C, description: "IOU Switch Clock" },
	{ name: "PCAP_CTRL", address: 0xFF5E00A4, description: "PCAP Clock" },
	{ name: "LPD_SWITCH_CTRL", address: 0xFF5E00A8, description: "LPD Switch Clock" },
	{ name: "LPD_LSBUS_CTRL", address: 0xFF5E00AC, description: "LPD LS Bus Clock" },
	{ name: "DBG_LPD_CTRL", address: 0xFF5E00B0, description: "Debug LPD Clock" },
	{ name: "NAND_REF_CTRL", address: 0xFF5E00B4, description: "NAND Ref Clock" },
	{ name: "ADMA_REF_CTRL", address: 0xFF5E00B8, description: "ADMA Ref Clock" },
	{ name: "PL0_REF_CTRL", address: 0xFF5E00C0, description: "PL Clock 0" },
	{ name: "PL1_REF_CTRL", address: 0xFF5E00C4, description: "PL Clock 1" },
	{ name: "PL2_REF_CTRL", address: 0xFF5E00C8, description: "PL Clock 2" },
	{ name: "PL3_REF_CTRL", address: 0xFF5E00CC, description: "PL Clock 3" },
	{ name: "GEM_TSU_REF_CTRL", address: 0xFF5E0100, description: "GEM TSU Ref Clock" },
	{ name: "PSSYSMON_REF_CTRL", address: 0xFF5E02E4, description: "PS SYSMON Ref Clock" },
];

// ─── ZynqMP CRF_APB (0xFD1A0000) ───────────────────────────────────────────

export const ZYNQMP_CRF_APB_BASE = 0xFD1A0000;

export const ZYNQMP_CRF_REGISTERS: ClockRegisterDef[] = [
	{ name: "APLL_CTRL", address: 0xFD1A0020, description: "APU PLL Control" },
	{ name: "DPLL_CTRL", address: 0xFD1A002C, description: "DDR PLL Control" },
	{ name: "VPLL_CTRL", address: 0xFD1A0038, description: "Video PLL Control" },
	{ name: "PLL_STATUS", address: 0xFD1A0044, description: "PLL Lock Status (FPD)" },
	{ name: "APLL_CFG", address: 0xFD1A0024, description: "APU PLL Configuration" },
	{ name: "DPLL_CFG", address: 0xFD1A0030, description: "DDR PLL Configuration" },
	{ name: "VPLL_CFG", address: 0xFD1A003C, description: "Video PLL Configuration" },
	{ name: "APLL_FRAC_CFG", address: 0xFD1A0028, description: "APU PLL Fractional Config" },
	{ name: "DPLL_FRAC_CFG", address: 0xFD1A0034, description: "DDR PLL Fractional Config" },
	{ name: "VPLL_FRAC_CFG", address: 0xFD1A0040, description: "Video PLL Fractional Config" },
	{ name: "ACPU_CTRL", address: 0xFD1A0060, description: "APU Clock Control" },
	{ name: "DBG_TRACE_CTRL", address: 0xFD1A0064, description: "Debug Trace Clock" },
	{ name: "DBG_FPD_CTRL", address: 0xFD1A0068, description: "Debug FPD Clock" },
	{ name: "DP_VIDEO_REF_CTRL", address: 0xFD1A0070, description: "DisplayPort Video Ref Clock" },
	{ name: "DP_AUDIO_REF_CTRL", address: 0xFD1A0074, description: "DisplayPort Audio Ref Clock" },
	{ name: "DP_STC_REF_CTRL", address: 0xFD1A007C, description: "DisplayPort STC Ref Clock" },
	{ name: "DDR_CTRL", address: 0xFD1A0080, description: "DDR Clock Control" },
	{ name: "GPU_REF_CTRL", address: 0xFD1A0084, description: "GPU Ref Clock" },
	{ name: "SATA_REF_CTRL", address: 0xFD1A00A0, description: "SATA Ref Clock" },
	{ name: "PCIE_REF_CTRL", address: 0xFD1A00B4, description: "PCIe Ref Clock" },
	{ name: "GDMA_REF_CTRL", address: 0xFD1A00B8, description: "GDMA Ref Clock" },
	{ name: "DPDMA_REF_CTRL", address: 0xFD1A00BC, description: "DPDMA Ref Clock" },
	{ name: "TOPSW_MAIN_CTRL", address: 0xFD1A00C0, description: "Top Switch Main Clock" },
	{ name: "TOPSW_LSBUS_CTRL", address: 0xFD1A00C4, description: "Top Switch LS Bus Clock" },
	{ name: "DBG_TSTMP_CTRL", address: 0xFD1A00F8, description: "Debug Timestamp Clock" },
];

// ─── Versal CRP (stub) ─────────────────────────────────────────────────────

export const VERSAL_CRP_BASE = 0xF1260000;

export const VERSAL_CLOCK_REGISTERS: ClockRegisterDef[] = [
	// Versal clock decoding is deferred; these are stubs.
	{ name: "PPLL_CTRL", address: 0xF1260040, description: "PMC PLL Control" },
	{ name: "NPLL_CTRL", address: 0xF1260050, description: "NOC PLL Control" },
];

// ─── Per-platform aggregate ─────────────────────────────────────────────────

export function getClockRegistersForPlatform(platform: string): ClockRegisterDef[] {
	switch (platform) {
		case "zynq7000":
			return ZYNQ7000_CLOCK_REGISTERS;
		case "zynqmp":
			return [...ZYNQMP_CRL_REGISTERS, ...ZYNQMP_CRF_REGISTERS];
		case "versal":
			return VERSAL_CLOCK_REGISTERS;
		default:
			return [];
	}
}
