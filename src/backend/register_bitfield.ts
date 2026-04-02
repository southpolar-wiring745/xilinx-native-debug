/**
 * Register bitfield model for Zynq platforms.
 *
 * Provides SVD-style register and bitfield definitions for common
 * Zynq-7000 and ZynqMP peripherals, enabling the deep-dive register
 * viewer to display named bitfields with descriptions.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type BitAccess = 'rw' | 'ro' | 'wo' | 'w1c' | 'rc';

export interface BitField {
	name: string;
	bitHigh: number;
	bitLow: number;
	access: BitAccess;
	description: string;
	enumValues?: { value: number; name: string; description?: string }[];
}

export interface RegisterDef {
	name: string;
	offset: number;
	width: 32 | 64;
	description: string;
	fields: BitField[];
}

export interface PeripheralRegisterMap {
	name: string;
	baseAddress: number;
	description: string;
	registers: RegisterDef[];
}

// ─── Zynq-7000 UART (UG585 Ch.19) ──────────────────────────────────────────

const ZYNQ_UART_REGS: RegisterDef[] = [
	{
		name: 'CR', offset: 0x00, width: 32, description: 'UART Control',
		fields: [
			{ name: 'STPBRK', bitHigh: 8, bitLow: 8, access: 'rw', description: 'Stop transmitter break' },
			{ name: 'STTBRK', bitHigh: 7, bitLow: 7, access: 'rw', description: 'Start transmitter break' },
			{ name: 'RSTTO', bitHigh: 6, bitLow: 6, access: 'rw', description: 'Restart receiver timeout counter' },
			{ name: 'TXDIS', bitHigh: 5, bitLow: 5, access: 'rw', description: 'TX disable' },
			{ name: 'TXEN', bitHigh: 4, bitLow: 4, access: 'rw', description: 'TX enable' },
			{ name: 'RXDIS', bitHigh: 3, bitLow: 3, access: 'rw', description: 'RX disable' },
			{ name: 'RXEN', bitHigh: 2, bitLow: 2, access: 'rw', description: 'RX enable' },
			{ name: 'TXRES', bitHigh: 1, bitLow: 1, access: 'rw', description: 'TX SW reset' },
			{ name: 'RXRES', bitHigh: 0, bitLow: 0, access: 'rw', description: 'RX SW reset' },
		],
	},
	{
		name: 'MR', offset: 0x04, width: 32, description: 'UART Mode',
		fields: [
			{ name: 'CHMODE', bitHigh: 9, bitLow: 8, access: 'rw', description: 'Channel mode', enumValues: [
				{ value: 0, name: 'NORMAL' }, { value: 1, name: 'AUTO_ECHO' },
				{ value: 2, name: 'LOCAL_LOOPBACK' }, { value: 3, name: 'REMOTE_LOOPBACK' },
			]},
			{ name: 'NBSTOP', bitHigh: 7, bitLow: 6, access: 'rw', description: 'Number of stop bits' },
			{ name: 'PAR', bitHigh: 5, bitLow: 3, access: 'rw', description: 'Parity type' },
			{ name: 'CHRL', bitHigh: 2, bitLow: 1, access: 'rw', description: 'Character length' },
			{ name: 'CLKS', bitHigh: 0, bitLow: 0, access: 'rw', description: 'Clock source select' },
		],
	},
	{
		name: 'SR', offset: 0x2C, width: 32, description: 'Channel Status',
		fields: [
			{ name: 'TNFUL', bitHigh: 14, bitLow: 14, access: 'ro', description: 'TX FIFO nearly full' },
			{ name: 'TTRIG', bitHigh: 13, bitLow: 13, access: 'ro', description: 'TX FIFO trigger' },
			{ name: 'FLOWDEL', bitHigh: 12, bitLow: 12, access: 'ro', description: 'RX flow delay trigger' },
			{ name: 'TACTIVE', bitHigh: 11, bitLow: 11, access: 'ro', description: 'TX active' },
			{ name: 'RACTIVE', bitHigh: 10, bitLow: 10, access: 'ro', description: 'RX active' },
			{ name: 'TXFULL', bitHigh: 4, bitLow: 4, access: 'ro', description: 'TX FIFO full' },
			{ name: 'TXEMPTY', bitHigh: 3, bitLow: 3, access: 'ro', description: 'TX FIFO empty' },
			{ name: 'RXFULL', bitHigh: 1, bitLow: 1, access: 'ro', description: 'RX FIFO full' },
			{ name: 'RXEMPTY', bitHigh: 0, bitLow: 0, access: 'ro', description: 'RX FIFO empty' },
		],
	},
	{
		name: 'FIFO', offset: 0x30, width: 32, description: 'TX/RX FIFO',
		fields: [
			{ name: 'DATA', bitHigh: 7, bitLow: 0, access: 'rw', description: 'TX/RX data byte' },
		],
	},
	{
		name: 'BDIV', offset: 0x34, width: 32, description: 'Baud Rate Divider',
		fields: [
			{ name: 'BDIV', bitHigh: 7, bitLow: 0, access: 'rw', description: 'Baud rate divider value' },
		],
	},
];

// ─── Zynq-7000 GPIO (UG585 Ch.14) ──────────────────────────────────────────

const ZYNQ_GPIO_REGS: RegisterDef[] = [
	{
		name: 'MASK_DATA_0_LSW', offset: 0x000, width: 32, description: 'Maskable Output Data (GPIO Bank0, MIO, Lower 16bits)',
		fields: [
			{ name: 'MASK', bitHigh: 31, bitLow: 16, access: 'wo', description: 'Output mask' },
			{ name: 'DATA', bitHigh: 15, bitLow: 0, access: 'wo', description: 'Output data' },
		],
	},
	{
		name: 'MASK_DATA_0_MSW', offset: 0x004, width: 32, description: 'Maskable Output Data (GPIO Bank0, MIO, Upper 16bits)',
		fields: [
			{ name: 'MASK', bitHigh: 31, bitLow: 16, access: 'wo', description: 'Output mask' },
			{ name: 'DATA', bitHigh: 15, bitLow: 0, access: 'wo', description: 'Output data' },
		],
	},
	{
		name: 'DIRM_0', offset: 0x204, width: 32, description: 'Direction Mode (Bank 0)',
		fields: [
			{ name: 'DIRECTION', bitHigh: 31, bitLow: 0, access: 'rw', description: '0=input, 1=output per bit' },
		],
	},
	{
		name: 'OEN_0', offset: 0x208, width: 32, description: 'Output Enable (Bank 0)',
		fields: [
			{ name: 'OP_ENABLE', bitHigh: 31, bitLow: 0, access: 'rw', description: 'Output enable per bit' },
		],
	},
	{
		name: 'DATA_0', offset: 0x040, width: 32, description: 'Output Data (Bank 0)',
		fields: [
			{ name: 'DATA', bitHigh: 31, bitLow: 0, access: 'rw', description: 'Output data pins' },
		],
	},
	{
		name: 'DATA_0_RO', offset: 0x060, width: 32, description: 'Input Data (Bank 0)',
		fields: [
			{ name: 'DATA', bitHigh: 31, bitLow: 0, access: 'ro', description: 'Input data pins' },
		],
	},
];

// ─── Zynq-7000 SPI (UG585 Ch.17) ───────────────────────────────────────────

const ZYNQ_SPI_REGS: RegisterDef[] = [
	{
		name: 'CR', offset: 0x00, width: 32, description: 'SPI Configuration',
		fields: [
			{ name: 'MODF_GEN_EN', bitHigh: 17, bitLow: 17, access: 'rw', description: 'ModeFail generation enable' },
			{ name: 'MANSTRT', bitHigh: 16, bitLow: 16, access: 'rw', description: 'Manual start command' },
			{ name: 'MANSTRTEN', bitHigh: 15, bitLow: 15, access: 'rw', description: 'Manual start enable' },
			{ name: 'SSFORCE', bitHigh: 14, bitLow: 14, access: 'rw', description: 'Manual SS assertion' },
			{ name: 'SSLINES', bitHigh: 13, bitLow: 10, access: 'rw', description: 'Peripheral chip select lines' },
			{ name: 'BAUD_DIV', bitHigh: 5, bitLow: 3, access: 'rw', description: 'Master baud rate divider' },
			{ name: 'CLK_PH', bitHigh: 2, bitLow: 2, access: 'rw', description: 'Clock phase' },
			{ name: 'CLK_POL', bitHigh: 1, bitLow: 1, access: 'rw', description: 'Clock polarity' },
			{ name: 'MSTREN', bitHigh: 0, bitLow: 0, access: 'rw', description: 'SPI master mode enable' },
		],
	},
	{
		name: 'SR', offset: 0x04, width: 32, description: 'SPI Interrupt Status',
		fields: [
			{ name: 'TX_FIFO_UNDERFLOW', bitHigh: 6, bitLow: 6, access: 'w1c', description: 'TX FIFO underflow' },
			{ name: 'RX_FIFO_FULL', bitHigh: 5, bitLow: 5, access: 'ro', description: 'RX FIFO full' },
			{ name: 'RX_FIFO_NOT_EMPTY', bitHigh: 4, bitLow: 4, access: 'ro', description: 'RX FIFO not empty' },
			{ name: 'TX_FIFO_FULL', bitHigh: 3, bitLow: 3, access: 'ro', description: 'TX FIFO full' },
			{ name: 'TX_FIFO_NOT_FULL', bitHigh: 2, bitLow: 2, access: 'ro', description: 'TX FIFO not full' },
			{ name: 'MODE_FAIL', bitHigh: 1, bitLow: 1, access: 'w1c', description: 'Multi-master mode fail' },
			{ name: 'RX_OVERFLOW', bitHigh: 0, bitLow: 0, access: 'w1c', description: 'RX FIFO overflow' },
		],
	},
	{
		name: 'EN', offset: 0x14, width: 32, description: 'SPI Enable',
		fields: [
			{ name: 'SPI_EN', bitHigh: 0, bitLow: 0, access: 'rw', description: 'SPI system enable' },
		],
	},
];

// ─── Zynq-7000 SLCR selected registers (UG585 Ch.25) ───────────────────────

const ZYNQ_SLCR_REGS: RegisterDef[] = [
	{
		name: 'ARM_PLL_CTRL', offset: 0x100, width: 32, description: 'ARM PLL Control',
		fields: [
			{ name: 'PLL_FDIV', bitHigh: 18, bitLow: 12, access: 'rw', description: 'PLL feedback divisor' },
			{ name: 'PLL_BYPASS_FORCE', bitHigh: 4, bitLow: 4, access: 'rw', description: 'PLL bypass force' },
			{ name: 'PLL_BYPASS_QUAL', bitHigh: 3, bitLow: 3, access: 'rw', description: 'PLL bypass qualify' },
			{ name: 'PLL_PWRDWN', bitHigh: 1, bitLow: 1, access: 'rw', description: 'PLL power down' },
			{ name: 'PLL_RESET', bitHigh: 0, bitLow: 0, access: 'rw', description: 'PLL reset' },
		],
	},
	{
		name: 'PLL_STATUS', offset: 0x10C, width: 32, description: 'PLL Lock Status',
		fields: [
			{ name: 'IO_PLL_LOCK', bitHigh: 2, bitLow: 2, access: 'ro', description: 'IO PLL lock' },
			{ name: 'DDR_PLL_LOCK', bitHigh: 1, bitLow: 1, access: 'ro', description: 'DDR PLL lock' },
			{ name: 'ARM_PLL_LOCK', bitHigh: 0, bitLow: 0, access: 'ro', description: 'ARM PLL lock' },
		],
	},
	{
		name: 'ARM_CLK_CTRL', offset: 0x120, width: 32, description: 'ARM Clock Control',
		fields: [
			{ name: 'CPU_PERI_CLKACT', bitHigh: 28, bitLow: 28, access: 'rw', description: 'CPU peripheral clock active' },
			{ name: 'CPU_1XCLKACT', bitHigh: 27, bitLow: 27, access: 'rw', description: 'CPU 1x clock active' },
			{ name: 'CPU_2XCLKACT', bitHigh: 26, bitLow: 26, access: 'rw', description: 'CPU 2x clock active' },
			{ name: 'CPU_3OR2XCLKACT', bitHigh: 25, bitLow: 25, access: 'rw', description: 'CPU 3x/2x clock active' },
			{ name: 'CPU_6OR4XCLKACT', bitHigh: 24, bitLow: 24, access: 'rw', description: 'CPU 6x/4x clock active' },
			{ name: 'DIVISOR', bitHigh: 13, bitLow: 8, access: 'rw', description: 'Frequency divisor' },
			{ name: 'SRCSEL', bitHigh: 5, bitLow: 4, access: 'rw', description: 'Clock source select', enumValues: [
				{ value: 0, name: 'ARM_PLL' }, { value: 2, name: 'DDR_PLL' }, { value: 3, name: 'IO_PLL' },
			]},
		],
	},
	{
		name: 'APER_CLK_CTRL', offset: 0x12C, width: 32, description: 'AMBA Peripheral Clock Control',
		fields: [
			{ name: 'SDI1_CPU_1XCLKACT', bitHigh: 26, bitLow: 26, access: 'rw', description: 'SDIO1 AMBA clock' },
			{ name: 'SDI0_CPU_1XCLKACT', bitHigh: 25, bitLow: 25, access: 'rw', description: 'SDIO0 AMBA clock' },
			{ name: 'SPI1_CPU_1XCLKACT', bitHigh: 15, bitLow: 15, access: 'rw', description: 'SPI1 AMBA clock' },
			{ name: 'SPI0_CPU_1XCLKACT', bitHigh: 14, bitLow: 14, access: 'rw', description: 'SPI0 AMBA clock' },
			{ name: 'UART1_CPU_1XCLKACT', bitHigh: 21, bitLow: 21, access: 'rw', description: 'UART1 AMBA clock' },
			{ name: 'UART0_CPU_1XCLKACT', bitHigh: 20, bitLow: 20, access: 'rw', description: 'UART0 AMBA clock' },
			{ name: 'GPIO_CPU_1XCLKACT', bitHigh: 22, bitLow: 22, access: 'rw', description: 'GPIO AMBA clock' },
			{ name: 'GEM0_CPU_1XCLKACT', bitHigh: 6, bitLow: 6, access: 'rw', description: 'GEM0 AMBA clock' },
			{ name: 'GEM1_CPU_1XCLKACT', bitHigh: 7, bitLow: 7, access: 'rw', description: 'GEM1 AMBA clock' },
			{ name: 'DMA_CPU_2XCLKACT', bitHigh: 0, bitLow: 0, access: 'rw', description: 'DMA controller clock' },
		],
	},
];

// ─── Built-in peripheral maps ───────────────────────────────────────────────

const ZYNQ7000_PERIPHERAL_MAPS: PeripheralRegisterMap[] = [
	{ name: 'UART0', baseAddress: 0xE0000000, description: 'PS UART Controller 0', registers: ZYNQ_UART_REGS },
	{ name: 'UART1', baseAddress: 0xE0001000, description: 'PS UART Controller 1', registers: ZYNQ_UART_REGS },
	{ name: 'SPI0', baseAddress: 0xE0006000, description: 'PS SPI Controller 0', registers: ZYNQ_SPI_REGS },
	{ name: 'SPI1', baseAddress: 0xE0007000, description: 'PS SPI Controller 1', registers: ZYNQ_SPI_REGS },
	{ name: 'GPIO', baseAddress: 0xE000A000, description: 'PS GPIO Controller', registers: ZYNQ_GPIO_REGS },
	{ name: 'SLCR', baseAddress: 0xF8000000, description: 'System Level Control Registers', registers: ZYNQ_SLCR_REGS },
];

const ZYNQMP_PERIPHERAL_MAPS: PeripheralRegisterMap[] = [
	{ name: 'UART0', baseAddress: 0xFF000000, description: 'PS UART Controller 0', registers: ZYNQ_UART_REGS },
	{ name: 'UART1', baseAddress: 0xFF010000, description: 'PS UART Controller 1', registers: ZYNQ_UART_REGS },
	{ name: 'SPI0', baseAddress: 0xFF040000, description: 'PS SPI Controller 0', registers: ZYNQ_SPI_REGS },
	{ name: 'SPI1', baseAddress: 0xFF050000, description: 'PS SPI Controller 1', registers: ZYNQ_SPI_REGS },
	{ name: 'GPIO', baseAddress: 0xFF0A0000, description: 'PS GPIO Controller', registers: ZYNQ_GPIO_REGS },
];

// ─── Lookup API ─────────────────────────────────────────────────────────────

/**
 * Find a register map by its base address across both Zynq-7000 and ZynqMP.
 */
export function findPeripheralByAddress(baseAddress: number): PeripheralRegisterMap | undefined {
	return [...ZYNQ7000_PERIPHERAL_MAPS, ...ZYNQMP_PERIPHERAL_MAPS].find(m => m.baseAddress === baseAddress);
}

/**
 * Find a register map by peripheral name pattern (case-insensitive).
 */
export function findPeripheralByName(name: string, platform: string): PeripheralRegisterMap | undefined {
	const maps = platform.includes('zynq_ultra') || platform.includes('zynqmp')
		? ZYNQMP_PERIPHERAL_MAPS
		: ZYNQ7000_PERIPHERAL_MAPS;
	const lower = name.toLowerCase();
	return maps.find(m => m.name.toLowerCase() === lower || lower.includes(m.name.toLowerCase()));
}

/**
 * Get all peripheral maps for a platform.
 */
export function getPeripheralMaps(platform: string): PeripheralRegisterMap[] {
	if (platform.includes('zynq_ultra') || platform.includes('zynqmp') || platform.includes('psu_cortexa53')) {
		return ZYNQMP_PERIPHERAL_MAPS;
	}
	return ZYNQ7000_PERIPHERAL_MAPS;
}

/**
 * Attempt to match a HW topology node to a known peripheral register map.
 * Matches on base address first, then on IP type name heuristics.
 */
export function matchNodeToPeripheral(
	nodeId: string,
	ipType: string,
	baseAddress: number | undefined,
	platform: string,
): PeripheralRegisterMap | undefined {
	if (baseAddress !== undefined) {
		const byAddr = findPeripheralByAddress(baseAddress);
		if (byAddr) return byAddr;
	}

	// Heuristic: match ipType to peripheral name
	const lowerIp = ipType.toLowerCase();
	const maps = getPeripheralMaps(platform);

	if (lowerIp.includes('uart') || lowerIp.includes('ps7_uart') || lowerIp.includes('psu_uart')) {
		// Try to figure out which UART from the node id
		const idx = nodeId.match(/[_]?(\d)$/)?.[1];
		const name = 'UART' + (idx || '0');
		return maps.find(m => m.name === name) || maps.find(m => m.name.startsWith('UART'));
	}
	if (lowerIp.includes('spi') || lowerIp.includes('ps7_spi') || lowerIp.includes('psu_spi')) {
		const idx = nodeId.match(/[_]?(\d)$/)?.[1];
		const name = 'SPI' + (idx || '0');
		return maps.find(m => m.name === name) || maps.find(m => m.name.startsWith('SPI'));
	}
	if (lowerIp.includes('gpio')) {
		return maps.find(m => m.name === 'GPIO');
	}
	if (lowerIp.includes('processing_system7') || lowerIp.includes('slcr')) {
		return maps.find(m => m.name === 'SLCR');
	}

	return undefined;
}

/**
 * Decode a 32-bit register value into its named bitfields.
 */
export function decodeRegister(reg: RegisterDef, value: number): { field: BitField; rawValue: number; display: string }[] {
	const result: { field: BitField; rawValue: number; display: string }[] = [];
	for (const f of reg.fields) {
		const mask = ((1 << (f.bitHigh - f.bitLow + 1)) - 1) << f.bitLow;
		const raw = (value & mask) >>> f.bitLow;

		let display = '0x' + raw.toString(16);
		if (f.enumValues) {
			const ev = f.enumValues.find(e => e.value === raw);
			if (ev) display = ev.name + ' (' + raw + ')';
		} else if (f.bitHigh === f.bitLow) {
			display = raw ? '1' : '0';
		}

		result.push({ field: f, rawValue: raw, display });
	}
	return result;
}
