// ─── Hardware Abstraction Types ───────────────────────────────────────────────

/** Register within a peripheral address block */
export interface Register {
	name: string;
	offset: number;
	width: number;
	access: 'read-only' | 'read-write' | 'write-only';
	description?: string;
}

/** A single peripheral (IP block) on the SoC */
export interface Peripheral {
	name: string;
	baseAddress: number;
	highAddress: number;
	range: number;
	ipType: string;
	ipVersion?: string;
	vlnv?: string;
	memoryType: 'register' | 'memory';
	busInterface?: string;
	registers?: Register[];
}

/** Memory region (DDR, OCM, BRAM, etc.) */
export interface MemoryRegion {
	name: string;
	baseAddress: number;
	highAddress: number;
	size: number;
	type: 'ddr' | 'ocm' | 'bram' | 'other';
	instance: string;
}

/** Top-level processor information */
export interface ProcessorInfo {
	name: string;
	type: 'zynq7000' | 'zynqmp' | 'microblaze' | 'versal' | 'unknown';
	arch: string;
}

/** System information from sysdef.xml */
export interface SystemInfo {
	board: string;
	part: string;
	arch: string;
	device: string;
	package: string;
	speed: string;
	toolVersion: string;
}

/** IP Module as parsed from HWH */
export interface IpModule {
	instance: string;
	fullName: string;
	modType: string;
	ipType: string;
	hwVersion: string;
	vlnv: string;
	isPl: boolean;
	parameters: Record<string, string>;
	addressBlocks: AddressBlockInfo[];
	busInterfaces: BusInterfaceInfo[];
}

/** Address block as found inside a MODULE in HWH */
export interface AddressBlockInfo {
	name: string;
	range: number;
	usage: string;
	access: string;
	interface: string;
}

/** Bus interface info */
export interface BusInterfaceInfo {
	name: string;
	busName: string;
	type: string;
	vlnv: string;
	dataWidth?: number;
}

/** Memory range entry from MEMORYMAP */
export interface MemRangeInfo {
	instance: string;
	addressBlock: string;
	baseAddress: number;
	highAddress: number;
	memoryType: string;
	masterBusInterface: string;
	slaveBusInterface: string;
	isData: boolean;
	isInstruction: boolean;
}

/** Complete hardware platform model */
export interface HardwarePlatform {
	containerType: 'xsa' | 'hdf';
	systemInfo: SystemInfo;
	processor: ProcessorInfo;
	peripherals: Peripheral[];
	memoryRegions: MemoryRegion[];
	modules: IpModule[];
	memRanges: MemRangeInfo[];
	bitstreamFile?: string;
	pdiFile?: string;
}

// ─── Container types ─────────────────────────────────────────────────────────

export interface ContainerEntry {
	name: string;
	size: number;
}

export type ContainerType = 'xsa' | 'hdf' | 'unknown';

// ─── VS Code integration types ──────────────────────────────────────────────

export interface PeripheralWatchEntry {
	name: string;
	baseAddress: string;
	size: string;
	ipType: string;
}

export interface LaunchJsonSuggestion {
	bitstreamPath?: string;
	pdiPath?: string;
	peripherals: PeripheralWatchEntry[];
	memoryRanges: { name: string; start: string; size: string }[];
}
