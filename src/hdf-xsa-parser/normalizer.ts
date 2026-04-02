import {
	HardwarePlatform,
	Peripheral,
	MemoryRegion,
	ProcessorInfo,
	MemRangeInfo,
	IpModule,
	SystemInfo,
	ContainerType,
} from './types';
import { HwhParseResult } from './parsers/hwh-parser';

// ─── Processor detection ────────────────────────────────────────────────────

const PROCESSOR_MOD_TYPES: Record<string, ProcessorInfo['type']> = {
	processing_system7: 'zynq7000',
	zynq_ultra_ps_e: 'zynqmp',
	versal_cips: 'versal',
	microblaze: 'microblaze',
	psu_cortexa53: 'zynqmp',
	psv_cortexa72: 'versal',
};

export function detectProcessor(modules: IpModule[], arch: string): ProcessorInfo {
	for (const mod of modules) {
		const ptype = PROCESSOR_MOD_TYPES[mod.modType];
		if (ptype) {
			return { name: mod.instance, type: ptype, arch };
		}
	}

	const archLower = arch.toLowerCase();
	if (archLower === 'zynq') return { name: 'unknown', type: 'zynq7000', arch };
	if (archLower === 'zynquplus' || archLower === 'zynqmp') return { name: 'unknown', type: 'zynqmp', arch };
	if (archLower === 'versal') return { name: 'unknown', type: 'versal', arch };
	if (archLower === 'microblaze') return { name: 'unknown', type: 'microblaze', arch };

	return { name: 'unknown', type: 'unknown', arch };
}

// ─── Memory region classification ───────────────────────────────────────────

function classifyMemoryType(name: string, instance: string): MemoryRegion['type'] {
	const lower = (name + ' ' + instance).toLowerCase();
	if (lower.includes('ddr')) return 'ddr';
	if (lower.includes('ocm')) return 'ocm';
	if (lower.includes('bram')) return 'bram';
	return 'other';
}

// ─── Normalizer ─────────────────────────────────────────────────────────────

export interface NormalizerInput {
	containerType: ContainerType;
	systemInfo: SystemInfo;
	hwh: HwhParseResult;
	bitstreamFile?: string;
	pdiFile?: string;
}

export function normalize(input: NormalizerInput): HardwarePlatform {
	const { containerType, systemInfo, hwh, bitstreamFile, pdiFile } = input;

	const processor = detectProcessor(hwh.modules, hwh.arch || systemInfo.arch);
	const peripherals = buildPeripherals(hwh.memRanges, hwh.modules);
	const memoryRegions = buildMemoryRegions(hwh.memRanges);

	return {
		containerType: containerType === 'unknown' ? 'hdf' : containerType,
		systemInfo,
		processor,
		peripherals,
		memoryRegions,
		modules: hwh.modules,
		memRanges: hwh.memRanges,
		bitstreamFile,
		pdiFile,
	};
}

function buildPeripherals(memRanges: MemRangeInfo[], modules: IpModule[]): Peripheral[] {
	const moduleMap = new Map<string, IpModule>();
	for (const m of modules) {
		moduleMap.set(m.instance, m);
	}

	const registerRanges = memRanges.filter(mr => mr.memoryType === 'REGISTER');
	return registerRanges.map(mr => {
		const mod = moduleMap.get(mr.instance);
		return {
			name: mr.instance,
			baseAddress: mr.baseAddress,
			highAddress: mr.highAddress,
			range: mr.highAddress - mr.baseAddress + 1,
			ipType: mod?.modType ?? '',
			ipVersion: mod?.hwVersion,
			vlnv: mod?.vlnv,
			memoryType: 'register' as const,
			busInterface: mr.slaveBusInterface,
		};
	});
}

function buildMemoryRegions(memRanges: MemRangeInfo[]): MemoryRegion[] {
	const memoryRanges = memRanges.filter(mr => mr.memoryType === 'MEMORY');

	const seen = new Set<string>();
	const results: MemoryRegion[] = [];

	for (const mr of memoryRanges) {
		const key = `${mr.addressBlock}:${mr.baseAddress}`;
		if (seen.has(key)) continue;
		seen.add(key);

		results.push({
			name: mr.addressBlock,
			baseAddress: mr.baseAddress,
			highAddress: mr.highAddress,
			size: mr.highAddress - mr.baseAddress + 1,
			type: classifyMemoryType(mr.addressBlock, mr.instance),
			instance: mr.instance,
		});
	}

	return results;
}
