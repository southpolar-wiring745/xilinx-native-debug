import { XilinxContainer } from './container';
import { parseSysdef, parseHwh } from './parsers';
import { normalize } from './normalizer';
import { HardwarePlatform } from './types';

/**
 * High-level API: parse an XSA or HDF file buffer into a HardwarePlatform model.
 */
export function parseXilinxContainer(input: Buffer | string): HardwarePlatform {
	const container = new XilinxContainer(input);

	const sysdefXml = container.readTextFile('sysdef.xml');
	if (!sysdefXml) {
		throw new Error('Container does not contain sysdef.xml');
	}
	const systemInfo = parseSysdef(sysdefXml);

	const hwhName = container.findHwhFile();
	if (!hwhName) {
		throw new Error('Container does not contain a .hwh hardware handoff file');
	}
	const hwhXml = container.readTextFile(hwhName);
	if (!hwhXml) {
		throw new Error(`Failed to read ${hwhName} from container`);
	}
	const hwh = parseHwh(hwhXml);

	const bitstreamFile = container.findBitstreamFile() ?? undefined;
	const pdiFile = container.findPdiFile() ?? undefined;

	return normalize({
		containerType: container.type,
		systemInfo,
		hwh,
		bitstreamFile,
		pdiFile,
	});
}

export { XilinxContainer } from './container';
export { parseSysdef, getHwhFileName, getBitstreamFileName, parseHwh } from './parsers';
export { normalize, detectProcessor } from './normalizer';
export {
	generatePeripheralWatch,
	generateLaunchSuggestion,
	validateMemoryRanges,
} from './vscode-integration';
export * from './types';
