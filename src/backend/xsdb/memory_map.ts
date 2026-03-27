/**
 * Linker map file parser and symbol-address lookup utilities.
 *
 * Parses GNU ld `.map` files to build a table mapping addresses to symbol
 * names and sections.  This is used to annotate peripheral watch and
 * memory read views with human-readable labels.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapSymbol {
	/** Symbol name */
	name: string;
	/** Absolute address */
	address: number;
	/** Size in bytes (0 if unknown) */
	size: number;
	/** Section name (e.g. ".text", ".bss", ".data") */
	section: string;
	/** Source file if available */
	sourceFile?: string;
}

export interface MapSection {
	/** Section name (e.g. ".text", ".bss") */
	name: string;
	/** Start address */
	address: number;
	/** Size in bytes */
	size: number;
}

export interface MemoryMapInfo {
	sections: MapSection[];
	symbols: MapSymbol[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Line patterns found in GNU ld map files.
 *
 * Section headers look like:
 *   `.text           0x00100000    0x1a34`
 *
 * Symbol entries look like:
 *   `                0x00100000                _start`
 *   ` .text.main     0x001000a0       0x1c ./build/main.o`
 */
const SECTION_REGEX = /^(\.[a-zA-Z_]\S*)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)/;
const SYMBOL_REGEX = /^\s+(0x[0-9a-fA-F]+)\s+(\S+)\s*$/;
const SUBSECTION_REGEX = /^\s+(\.[a-zA-Z_]\S*)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(\S+)/;

/**
 * Parse a GNU ld linker map file content and extract sections and symbols.
 */
export function parseLinkerMap(content: string): MemoryMapInfo {
	const sections: MapSection[] = [];
	const symbols: MapSymbol[] = [];
	let currentSection = "";

	const lines = content.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Match top-level section headers
		const secMatch = SECTION_REGEX.exec(line);
		if (secMatch) {
			currentSection = secMatch[1];
			const address = parseInt(secMatch[2], 16);
			const size = parseInt(secMatch[3], 16);
			if (size > 0) {
				sections.push({ name: currentSection, address, size });
			}
			continue;
		}

		// Match subsections with source file
		const subMatch = SUBSECTION_REGEX.exec(line);
		if (subMatch) {
			const address = parseInt(subMatch[2], 16);
			const size = parseInt(subMatch[3], 16);
			const sourceFile = subMatch[4];
			if (size > 0 && address > 0) {
				// Extract the function/section name from subsection name
				const subName = subMatch[1];
				const dotParts = subName.split(".");
				const symbolName = dotParts.length > 2 ? dotParts.slice(2).join(".") : subName;
				symbols.push({
					name: symbolName,
					address,
					size,
					section: currentSection || subName,
					sourceFile,
				});
			}
			continue;
		}

		// Match standalone symbols (address + name on one line)
		const symMatch = SYMBOL_REGEX.exec(line);
		if (symMatch) {
			const address = parseInt(symMatch[1], 16);
			const name = symMatch[2];
			// Skip internal linker symbols
			if (name.startsWith("_") && name.startsWith("__")) continue;
			if (address > 0 && !name.startsWith("PROVIDE")) {
				symbols.push({
					name,
					address,
					size: 0,
					section: currentSection,
				});
			}
		}
	}

	return { sections, symbols };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * A helper class that provides O(log n) address-to-symbol lookups after
 * the map file has been parsed.
 */
export class MemoryMap {
	private sortedSymbols: MapSymbol[];
	private sections: MapSection[];

	constructor(info: MemoryMapInfo) {
		this.sections = info.sections;
		// Sort by address for binary search
		this.sortedSymbols = [...info.symbols].sort((a, b) => a.address - b.address);
	}

	/**
	 * Find the symbol whose address range contains `addr`, or the nearest
	 * symbol at or below `addr`.
	 */
	public findSymbol(addr: number): MapSymbol | undefined {
		const syms = this.sortedSymbols;
		if (syms.length === 0) return undefined;

		// Binary search for the largest address <= addr
		let lo = 0;
		let hi = syms.length - 1;
		let best = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			if (syms[mid].address <= addr) {
				best = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}

		if (best < 0) return undefined;
		const sym = syms[best];
		// If symbol has known size, check that addr is within range
		if (sym.size > 0 && addr >= sym.address + sym.size) {
			return undefined; // addr is past this symbol
		}
		return sym;
	}

	/**
	 * Find the section containing `addr`.
	 */
	public findSection(addr: number): MapSection | undefined {
		return this.sections.find(s => addr >= s.address && addr < s.address + s.size);
	}

	/**
	 * Annotate an address with a "symbol+offset" label if possible.
	 */
	public annotateAddress(addr: number): string {
		const sym = this.findSymbol(addr);
		if (!sym) {
			const sec = this.findSection(addr);
			if (sec) {
				return `${sec.name}+0x${(addr - sec.address).toString(16)}`;
			}
			return `0x${addr.toString(16)}`;
		}
		const offset = addr - sym.address;
		if (offset === 0) return sym.name;
		return `${sym.name}+0x${offset.toString(16)}`;
	}

	/**
	 * Return all symbols (sorted by address).
	 */
	public get allSymbols(): readonly MapSymbol[] {
		return this.sortedSymbols;
	}

	/**
	 * Return all sections.
	 */
	public get allSections(): readonly MapSection[] {
		return this.sections;
	}
}
