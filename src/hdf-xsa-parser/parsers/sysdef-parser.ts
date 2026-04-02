import { XMLParser } from 'fast-xml-parser';
import { SystemInfo } from '../types';

interface SysdefXml {
	Project: {
		TOOL_VERSION: { '@_Version': string };
		SYSTEMINFO: {
			'@_BOARD': string;
			'@_PART': string;
			'@_ARCH': string;
			'@_DEVICE': string;
			'@_PACKAGE': string;
			'@_SPEED': string;
		};
		HIERARCHY: { '@_Name': string };
		File: Array<{
			'@_Type': string;
			'@_Name': string;
			'@_DESIGN_HIERARCHY'?: string;
			'@_BD_TYPE'?: string;
		}> | {
			'@_Type': string;
			'@_Name': string;
			'@_DESIGN_HIERARCHY'?: string;
			'@_BD_TYPE'?: string;
		};
	};
}

/** Parse sysdef.xml content into SystemInfo */
export function parseSysdef(xml: string): SystemInfo {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
	});

	const doc: SysdefXml = parser.parse(xml);
	const info = doc.Project.SYSTEMINFO;

	return {
		board: info['@_BOARD'] ?? '',
		part: info['@_PART'] ?? '',
		arch: info['@_ARCH'] ?? '',
		device: info['@_DEVICE'] ?? '',
		package: info['@_PACKAGE'] ?? '',
		speed: info['@_SPEED'] ?? '',
		toolVersion: doc.Project.TOOL_VERSION['@_Version'] ?? '',
	};
}

/** Find the HWH file name reference from sysdef.xml */
export function getHwhFileName(xml: string): string | null {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		isArray: (name) => name === 'File',
	});

	const doc: SysdefXml = parser.parse(xml);
	const files = Array.isArray(doc.Project.File) ? doc.Project.File : [doc.Project.File];
	const hwh = files.find(f => f['@_Type'] === 'HW_HANDOFF');
	return hwh?.['@_Name'] ?? null;
}

/** Find the bitstream file name from sysdef.xml */
export function getBitstreamFileName(xml: string): string | null {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		isArray: (name) => name === 'File',
	});

	const doc: SysdefXml = parser.parse(xml);
	const files = Array.isArray(doc.Project.File) ? doc.Project.File : [doc.Project.File];
	const bit = files.find(f => f['@_Type'] === 'BIT');
	return bit?.['@_Name'] ?? null;
}
