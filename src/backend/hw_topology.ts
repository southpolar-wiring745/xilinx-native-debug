import { HardwarePlatform, IpModule, MemRangeInfo } from '../hdf-xsa-parser/types';

// ─── Topology graph types ───────────────────────────────────────────────────

export type HwNodeKind = 'cpu' | 'memory' | 'interconnect' | 'peripheral' | 'pl_ip';

export type HwNodeState = 'active' | 'inactive' | 'fault' | 'unknown';

export interface HwNode {
	id: string;
	label: string;
	kind: HwNodeKind;
	state: HwNodeState;
	isPl: boolean;
	baseAddress?: number;
	highAddress?: number;
	ipType: string;
	vlnv?: string;
	hwVersion?: string;
	clockFreqMhz?: number;
	irqNumber?: number;
	parameters: Record<string, string>;
}

export type HwEdgeKind = 'axi' | 'irq' | 'clock' | 'reset';

export interface HwEdge {
	id: string;
	source: string;
	target: string;
	kind: HwEdgeKind;
	label?: string;
	busName?: string;
	dataWidth?: number;
}

export interface HwTopology {
	platform: string;
	arch: string;
	device: string;
	board: string;
	nodes: HwNode[];
	edges: HwEdge[];
}

// ─── Known CPU module types ─────────────────────────────────────────────────

const CPU_MOD_TYPES = new Set([
	'processing_system7',
	'zynq_ultra_ps_e',
	'versal_cips',
	'microblaze',
	'psu_cortexa53',
	'psv_cortexa72',
]);

const INTERCONNECT_MOD_TYPES = new Set([
	'axi_interconnect',
	'axi_crossbar',
	'smartconnect',
]);

const MEMORY_MOD_TYPES = new Set([
	'axi_bram_ctrl',
	'mig_7series',
	'ddr4',
	'axi_emc',
	'ddr3',
]);

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildTopology(hw: HardwarePlatform): HwTopology {
	const nodes: HwNode[] = [];
	const edges: HwEdge[] = [];
	const nodeIds = new Set<string>();

	// Build a module map for quick lookups
	const moduleMap = new Map<string, IpModule>();
	for (const mod of hw.modules) {
		moduleMap.set(mod.instance, mod);
	}

	// Create nodes for every module
	for (const mod of hw.modules) {
		const kind = classifyModule(mod);
		const freqParam = findClockFreqParam(mod);

		// Find address from memRanges
		const addrInfo = findAddressInfo(mod.instance, hw.memRanges);

		const node: HwNode = {
			id: mod.instance,
			label: mod.instance,
			kind,
			state: 'unknown',
			isPl: mod.isPl,
			ipType: mod.modType,
			vlnv: mod.vlnv,
			hwVersion: mod.hwVersion,
			clockFreqMhz: freqParam,
			parameters: mod.parameters,
			...(addrInfo && { baseAddress: addrInfo.baseAddress, highAddress: addrInfo.highAddress }),
		};

		// Try to find IRQ number
		const irq = findIrqNumber(mod);
		if (irq !== undefined) {
			node.irqNumber = irq;
		}

		nodes.push(node);
		nodeIds.add(mod.instance);
	}

	// Create AXI edges from memRanges (master -> slave)
	const edgeSet = new Set<string>();
	for (const mr of hw.memRanges) {
		// Find the master module by checking which module owns the master bus interface
		const masterModule = findMasterForBusInterface(mr.masterBusInterface, hw.modules);
		const slaveInstance = mr.instance;

		if (masterModule && nodeIds.has(slaveInstance) && masterModule !== slaveInstance) {
			const edgeKey = `${masterModule}->${slaveInstance}:${mr.masterBusInterface}`;
			if (!edgeSet.has(edgeKey)) {
				edgeSet.add(edgeKey);
				edges.push({
					id: `axi_${masterModule}_${slaveInstance}_${mr.slaveBusInterface}`,
					source: masterModule,
					target: slaveInstance,
					kind: 'axi',
					label: mr.slaveBusInterface || mr.masterBusInterface,
					busName: mr.masterBusInterface,
				});
			}
		}
	}

	// Create AXI edges from bus interfaces (for interconnects without memRanges)
	for (const mod of hw.modules) {
		for (const bi of mod.busInterfaces) {
			if (bi.type === 'MASTER' || bi.type === 'INITIATOR') {
				// Find a slave module connected to this bus
				const busName = bi.busName;
				if (busName && busName !== '__NOC__') {
					for (const otherMod of hw.modules) {
						if (otherMod.instance === mod.instance) continue;
						for (const otherBi of otherMod.busInterfaces) {
							if ((otherBi.type === 'SLAVE' || otherBi.type === 'TARGET') && otherBi.busName === busName) {
								const edgeKey = `${mod.instance}->${otherMod.instance}:${busName}`;
								if (!edgeSet.has(edgeKey)) {
									edgeSet.add(edgeKey);
									edges.push({
										id: `axi_bi_${mod.instance}_${otherMod.instance}_${busName}`,
										source: mod.instance,
										target: otherMod.instance,
										kind: 'axi',
										label: bi.name,
										busName,
										dataWidth: bi.dataWidth,
									});
								}
							}
						}
					}
				}
			}
		}
	}

	return {
		platform: hw.processor.type,
		arch: hw.systemInfo.arch,
		device: hw.systemInfo.device,
		board: hw.systemInfo.board || '',
		nodes,
		edges,
	};
}

// ─── Runtime state update ───────────────────────────────────────────────────

export interface RuntimeNodeState {
	id: string;
	state: HwNodeState;
	clockFreqMhz?: number;
}

export function applyRuntimeState(topology: HwTopology, states: RuntimeNodeState[]): HwTopology {
	const stateMap = new Map<string, RuntimeNodeState>();
	for (const s of states) {
		stateMap.set(s.id, s);
	}

	const updatedNodes = topology.nodes.map(n => {
		const rs = stateMap.get(n.id);
		if (rs) {
			return {
				...n,
				state: rs.state,
				clockFreqMhz: rs.clockFreqMhz ?? n.clockFreqMhz,
			};
		}
		return n;
	});

	return { ...topology, nodes: updatedNodes };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function classifyModule(mod: IpModule): HwNodeKind {
	if (CPU_MOD_TYPES.has(mod.modType)) return 'cpu';
	if (INTERCONNECT_MOD_TYPES.has(mod.modType)) return 'interconnect';
	if (MEMORY_MOD_TYPES.has(mod.modType)) return 'memory';

	// Memory types based on name patterns
	const lowerType = mod.modType.toLowerCase();
	if (lowerType.includes('bram') || lowerType.includes('ddr') || lowerType.includes('mig')) return 'memory';
	if (lowerType.includes('interconnect') || lowerType.includes('crossbar')) return 'interconnect';

	// PL IP blocks
	if (mod.isPl) return 'pl_ip';

	return 'peripheral';
}

function findClockFreqParam(mod: IpModule): number | undefined {
	// Try common clock frequency parameter names
	const freqKeys = [
		'PCW_ACT_FPGA0_PERIPHERAL_FREQMHZ',
		'PCW_ACT_APU_PERIPHERAL_FREQMHZ',
		'C_FREQ_HZ',
		'C_S_AXI_ACLK_FREQ_HZ',
		'FREQ_HZ',
	];

	for (const key of freqKeys) {
		const val = mod.parameters[key];
		if (val) {
			const num = parseFloat(val);
			if (!isNaN(num)) {
				// Convert from Hz if > 1000000
				return num > 1_000_000 ? num / 1_000_000 : num;
			}
		}
	}

	return undefined;
}

function findAddressInfo(instance: string, memRanges: MemRangeInfo[]): { baseAddress: number; highAddress: number } | undefined {
	for (const mr of memRanges) {
		if (mr.instance === instance) {
			return { baseAddress: mr.baseAddress, highAddress: mr.highAddress };
		}
	}
	return undefined;
}

function findIrqNumber(mod: IpModule): number | undefined {
	const irqParam = mod.parameters['C_IRQ_F2P_MODE'] || mod.parameters['C_NUM_INTR_INPUTS'];
	if (irqParam) {
		const num = parseInt(irqParam, 10);
		if (!isNaN(num)) return num;
	}
	return undefined;
}

function findMasterForBusInterface(masterBusInterface: string, modules: IpModule[]): string | undefined {
	// The master bus interface name is typically on the PS or an interconnect
	for (const mod of modules) {
		for (const bi of mod.busInterfaces) {
			if (bi.name === masterBusInterface && (bi.type === 'MASTER' || bi.type === 'INITIATOR')) {
				return mod.instance;
			}
		}
	}

	// Fallback: match by partial name on PS modules
	for (const mod of modules) {
		if (CPU_MOD_TYPES.has(mod.modType) || INTERCONNECT_MOD_TYPES.has(mod.modType)) {
			for (const bi of mod.busInterfaces) {
				if (bi.name === masterBusInterface) {
					return mod.instance;
				}
			}
		}
	}

	return undefined;
}
