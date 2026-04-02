import {
	HardwarePlatform,
	LaunchJsonSuggestion,
	PeripheralWatchEntry,
} from './types';

/**
 * Generate peripheral watch entries for a VS Code debug view.
 */
export function generatePeripheralWatch(platform: HardwarePlatform): PeripheralWatchEntry[] {
	return platform.peripherals.map(p => ({
		name: p.name,
		baseAddress: `0x${p.baseAddress.toString(16).toUpperCase().padStart(8, '0')}`,
		size: `0x${p.range.toString(16).toUpperCase()}`,
		ipType: p.ipType,
	}));
}

/**
 * Generate a full launch.json suggestion set from a parsed hardware platform.
 */
export function generateLaunchSuggestion(platform: HardwarePlatform): LaunchJsonSuggestion {
	return {
		bitstreamPath: platform.bitstreamFile,
		pdiPath: platform.pdiFile,
		peripherals: generatePeripheralWatch(platform),
		memoryRanges: platform.memoryRegions.map(r => ({
			name: r.name,
			start: `0x${r.baseAddress.toString(16).toUpperCase().padStart(8, '0')}`,
			size: `0x${r.size.toString(16).toUpperCase()}`,
		})),
	};
}

/**
 * Validate address ranges from a launch.json against the hardware platform.
 */
export function validateMemoryRanges(
	platform: HardwarePlatform,
	userRanges: { name: string; start: number; end: number }[],
): string[] {
	const warnings: string[] = [];

	const allRegions = [
		...platform.peripherals.map(p => ({
			name: p.name,
			base: p.baseAddress,
			high: p.highAddress,
		})),
		...platform.memoryRegions.map(m => ({
			name: m.name,
			base: m.baseAddress,
			high: m.highAddress,
		})),
	];

	for (const range of userRanges) {
		const covered = allRegions.some(
			r => range.start >= r.base && range.end <= r.high
		);
		if (!covered) {
			warnings.push(
				`Address range "${range.name}" (0x${range.start.toString(16)}-0x${range.end.toString(16)}) ` +
				`does not fall within any known peripheral or memory region in the hardware platform.`
			);
		}
	}

	return warnings;
}
