import AdmZip = require('adm-zip');
import { ContainerEntry, ContainerType } from './types';

/**
 * Handles extraction of XSA/HDF ZIP archives and identification of container type.
 */
export class XilinxContainer {
	private zip: AdmZip;
	private _entries: ContainerEntry[];
	private _type: ContainerType;

	constructor(input: Buffer | string) {
		this.zip = new AdmZip(input);
		this._entries = this.zip.getEntries().map((e: any) => ({
			name: e.entryName,
			size: e.header.size,
		}));
		this._type = this.detectType();
	}

	/** Detect whether this is an XSA or HDF container */
	private detectType(): ContainerType {
		const names = new Set(this._entries.map(e => e.name.toLowerCase()));
		const hasXsaMarker = names.has('xsa.json') || names.has('xsa.xml');
		const hasSysdef = names.has('sysdef.xml');

		if (hasXsaMarker) return 'xsa';
		if (hasSysdef) return 'hdf';
		return 'unknown';
	}

	get type(): ContainerType {
		return this._type;
	}

	get entries(): ContainerEntry[] {
		return this._entries;
	}

	listFiles(): string[] {
		return this._entries.map(e => e.name);
	}

	hasFile(name: string): boolean {
		return this._entries.some(
			e => e.name === name || e.name.toLowerCase() === name.toLowerCase()
		);
	}

	readFile(name: string): Buffer | null {
		const entry = this.zip.getEntry(name);
		if (!entry) return null;
		return entry.getData();
	}

	readTextFile(name: string): string | null {
		const buf = this.readFile(name);
		return buf ? buf.toString('utf-8') : null;
	}

	findHwhFile(): string | null {
		const entry = this._entries.find(e => e.name.endsWith('.hwh'));
		return entry?.name ?? null;
	}

	findSysdefFile(): string | null {
		return this.hasFile('sysdef.xml') ? 'sysdef.xml' : null;
	}

	findBitstreamFile(): string | null {
		const entry = this._entries.find(e => e.name.endsWith('.bit'));
		return entry?.name ?? null;
	}

	findPdiFile(): string | null {
		const entry = this._entries.find(e => e.name.endsWith('.pdi'));
		return entry?.name ?? null;
	}

	findTclFiles(): string[] {
		return this._entries.filter(e => e.name.endsWith('.tcl')).map(e => e.name);
	}

	findMddFiles(): string[] {
		return this._entries.filter(e => e.name.endsWith('.mdd')).map(e => e.name);
	}

	/** Extract a file to a target directory. Returns the output file path. */
	extractFile(name: string, targetDir: string): string | null {
		const entry = this.zip.getEntry(name);
		if (!entry) return null;
		this.zip.extractEntryTo(entry, targetDir, false, true);
		const path = require('path');
		return path.join(targetDir, path.basename(name));
	}

	/** Extract all files matching a pattern to a target directory. */
	extractAll(targetDir: string): string[] {
		const extracted: string[] = [];
		const path = require('path');
		for (const entry of this._entries) {
			this.zip.extractEntryTo(entry.name, targetDir, false, true);
			extracted.push(path.join(targetDir, path.basename(entry.name)));
		}
		return extracted;
	}
}
