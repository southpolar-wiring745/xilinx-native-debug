import { XMLParser } from 'fast-xml-parser';
import {
	IpModule,
	AddressBlockInfo,
	BusInterfaceInfo,
	MemRangeInfo,
} from '../types';

// ─── Raw XML shape helpers ──────────────────────────────────────────────────

function ensureArray<T>(val: T | T[] | undefined): T[] {
	if (val === undefined || val === null) return [];
	return Array.isArray(val) ? val : [val];
}

function parseHexOrDec(val: string | number | undefined): number {
	if (val === undefined || val === null) return 0;
	const s = String(val).trim();
	if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16);
	return parseInt(s, 10);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface HwhParseResult {
	systemName: string;
	arch: string;
	board: string;
	device: string;
	modules: IpModule[];
	memRanges: MemRangeInfo[];
}

/** Parse a Xilinx .hwh XML file */
export function parseHwh(xml: string): HwhParseResult {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		isArray: (name) => {
			return [
				'MODULE', 'PARAMETER', 'PORT', 'BUSINTERFACE',
				'ADDRESSBLOCK', 'MEMRANGE', 'PORTMAP', 'CONNECTION',
			].includes(name);
		},
	});

	const doc = parser.parse(xml);
	const root = doc.EDKSYSTEM;

	const systemInfo = root.SYSTEMINFO ?? {};
	const systemName: string = systemInfo['@_NAME'] ?? '';
	const arch: string = systemInfo['@_ARCH'] ?? '';
	const board: string = systemInfo['@_BOARD'] ?? '';
	const device: string = systemInfo['@_DEVICE'] ?? '';

	const rawModules = ensureArray(root.MODULES?.MODULE);
	const modules: IpModule[] = rawModules.map(parseModule);

	const memRanges = extractMemRanges(root);

	return { systemName, arch, board, device, modules, memRanges };
}

function parseModule(raw: any): IpModule {
	const instance: string = raw['@_INSTANCE'] ?? '';
	const fullName: string = raw['@_FULLNAME'] ?? '';
	const modType: string = raw['@_MODTYPE'] ?? '';
	const ipType: string = raw['@_IPTYPE'] ?? '';
	const hwVersion: string = raw['@_HWVERSION'] ?? '';
	const vlnv: string = raw['@_VLNV'] ?? '';
	const isPl: boolean = raw['@_IS_PL'] !== 'FALSE';

	const params = ensureArray(raw.PARAMETERS?.PARAMETER);
	const parameters: Record<string, string> = {};
	for (const p of params) {
		const name = p['@_NAME'];
		const value = p['@_VALUE'];
		if (name !== undefined) {
			parameters[name] = String(value ?? '');
		}
	}

	const rawAbs = ensureArray(raw.ADDRESSBLOCKS?.ADDRESSBLOCK);
	const addressBlocks: AddressBlockInfo[] = rawAbs.map((ab: any) => ({
		name: ab['@_NAME'] ?? '',
		range: parseHexOrDec(ab['@_RANGE']),
		usage: ab['@_USAGE'] ?? '',
		access: ab['@_ACCESS'] ?? '',
		interface: ab['@_INTERFACE'] ?? '',
	}));

	const rawBis = ensureArray(raw.BUSINTERFACES?.BUSINTERFACE);
	const busInterfaces: BusInterfaceInfo[] = rawBis.map((bi: any) => ({
		name: bi['@_NAME'] ?? '',
		busName: bi['@_BUSNAME'] ?? '',
		type: bi['@_TYPE'] ?? '',
		vlnv: bi['@_VLNV'] ?? '',
		dataWidth: bi['@_DATAWIDTH'] ? parseHexOrDec(bi['@_DATAWIDTH']) : undefined,
	}));

	return {
		instance,
		fullName,
		modType,
		ipType,
		hwVersion,
		vlnv,
		isPl,
		parameters,
		addressBlocks,
		busInterfaces,
	};
}

function extractMemRanges(root: any): MemRangeInfo[] {
	const results: MemRangeInfo[] = [];
	const rawModules = ensureArray(root.MODULES?.MODULE);

	for (const mod of rawModules) {
		const rawMemMap = mod.MEMORYMAP;
		if (!rawMemMap) continue;

		const rawRanges = ensureArray(rawMemMap.MEMRANGE);
		for (const mr of rawRanges) {
			results.push({
				instance: mr['@_INSTANCE'] ?? '',
				addressBlock: mr['@_ADDRESSBLOCK'] ?? '',
				baseAddress: parseHexOrDec(mr['@_BASEVALUE']),
				highAddress: parseHexOrDec(mr['@_HIGHVALUE']),
				memoryType: mr['@_MEMTYPE'] ?? '',
				masterBusInterface: mr['@_MASTERBUSINTERFACE'] ?? '',
				slaveBusInterface: mr['@_SLAVEBUSINTERFACE'] ?? '',
				isData: mr['@_IS_DATA'] === 'TRUE',
				isInstruction: mr['@_IS_INSTRUCTION'] === 'TRUE',
			});
		}
	}

	return results;
}
