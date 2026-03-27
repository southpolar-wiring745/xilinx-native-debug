/**
 * XSDB output parser.
 *
 * XSDB (Xilinx System Debugger) uses a Tcl-based interactive console.
 * Output is plain text delimited by the `xsdb%` prompt. This module
 * provides helpers to split raw stdout into individual command responses,
 * and to parse well-known output formats (target tables, memory dumps,
 * register trees, and errors).
 */

/** Represents a single target entry returned by the `targets` command. */
export interface XSDBTarget {
	id: number;
	name: string;
	state: string;
	/** Additional context (e.g. "APU", "RPU", "MicroBlaze") */
	context?: string;
	/** Whether this target is currently selected (marked with `*`). */
	selected: boolean;
}

/** A single address-value pair from `mrd`. */
export interface XSDBMemoryEntry {
	address: number;
	value: number;
}

/** A register entry from `rrd`.  May be a group (with children) or a leaf. */
export interface XSDBRegisterEntry {
	name: string;
	value?: string;
	children?: XSDBRegisterEntry[];
}

// ---------------------------------------------------------------------------
// Prompt detection
// ---------------------------------------------------------------------------

/** The prompt that XSDB prints when it is ready for the next command. */
export const XSDB_PROMPT = "xsdb% ";
const PROMPT_REGEX = /xsdb% $/;

/**
 * Detect whether the accumulated buffer ends with the XSDB prompt,
 * indicating the previous command has completed.
 */
export function isPromptReady(buffer: string): boolean {
	return PROMPT_REGEX.test(buffer);
}

/**
 * Given raw stdout data that may contain one or more prompt-delimited
 * responses, split it into individual response texts.  The prompt itself
 * is stripped from each chunk.
 */
export function splitResponses(raw: string): string[] {
	const parts = raw.split(XSDB_PROMPT);
	// The last element is either empty (if the string ended with prompt)
	// or an incomplete chunk (not yet terminated).  We keep only complete ones.
	const complete = parts.slice(0, -1);
	return complete.map(p => p.trimEnd());
}

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

const ERROR_PREFIX = /^(error:|Error:)\s*/im;

/** Return an error message if the text looks like an XSDB error, else null. */
export function parseError(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	// XSDB sometimes prefixes errors with "error:" or prints stack traces.
	const m = ERROR_PREFIX.exec(trimmed);
	if (m) {
		return trimmed.substring(m.index + m[0].length).trim();
	}
	// Some errors don't have a prefix but contain "no targets" etc.
	if (/^no targets found/i.test(trimmed) || /^unknown option/i.test(trimmed)) {
		return trimmed;
	}
	if (/can't read|can't find|no such file or directory|invalid command name|invalid option|error while evaluating/i.test(trimmed)) {
		return trimmed;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Target table parser
// ---------------------------------------------------------------------------

/**
 * Parse the output of the XSDB `targets` command.
 *
 * Example output:
 * ```
 *   1  APU
 *      2  ARM Cortex-A9 MPCore #0 (Running)
 *   3  ARM Cortex-A9 MPCore #1 (Running)
 * * 4  xc7z020
 * ```
 *
 * Each line has optional leading `*` (selected marker), leading whitespace
 * encoding hierarchy depth, a numeric ID, a name, and an optional `(state)`.
 */
const TARGET_LINE_REGEX = /^(\*?)\s*(\d+)\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/;

export function parseTargets(text: string): XSDBTarget[] {
	const targets: XSDBTarget[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = TARGET_LINE_REGEX.exec(line);
		if (!m) continue;
		targets.push({
			selected: m[1] === "*",
			id: parseInt(m[2], 10),
			name: m[3].trim(),
			state: m[4] || "",
		});
	}
	return targets;
}

// ---------------------------------------------------------------------------
// Memory dump parser  (`mrd`)
// ---------------------------------------------------------------------------

/**
 * Parse the output of `mrd <addr> <count>`.
 *
 * Example:
 * ```
 * F8000000:   00000000
 * F8000004:   00000000
 * ```
 */
const MRD_LINE_REGEX = /^\s*([0-9A-Fa-f]+)\s*:\s*([0-9A-Fa-f]+)\s*$/;

export function parseMemoryDump(text: string): XSDBMemoryEntry[] {
	const entries: XSDBMemoryEntry[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = MRD_LINE_REGEX.exec(line);
		if (!m) continue;
		entries.push({
			address: parseInt(m[1], 16),
			value: parseInt(m[2], 16),
		});
	}
	return entries;
}

// ---------------------------------------------------------------------------
// Register tree parser  (`rrd`)
// ---------------------------------------------------------------------------

/**
 * Parse the output of `rrd`.
 *
 * Example:
 * ```
 *      r0: 00000000
 *      r1: 00000000
 *     usr:
 *          r8: 00000000
 *          r9: 00000000
 * ```
 *
 * The indentation communicates a tree structure.  Groups have no value
 * (the colon is followed by nothing), while leaves have a hex value.
 */
const REG_GROUP_LINE_REGEX = /^(\s*)([^\s:][^:]*):\s*$/;
const REG_VALUE_PAIR_REGEX = /([A-Za-z_][A-Za-z0-9_.$#-]*)\s*:\s*(0x[0-9A-Fa-f]+|[0-9A-Fa-f]+)/g;
const REG_SINGLE_VALUE_REGEX = /^(\s*)(\S+):\s*(\S+)\s*$/;

export function parseRegisters(text: string): XSDBRegisterEntry[] {
	const root: XSDBRegisterEntry[] = [];
	const stack: { indent: number; children: XSDBRegisterEntry[] }[] = [
		{ indent: -1, children: root },
	];

	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;

		const groupMatch = REG_GROUP_LINE_REGEX.exec(line);
		if (groupMatch) {
			const indent = groupMatch[1].length;
			const name = groupMatch[2].trim();

			while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
				stack.pop();
			}

			const entry: XSDBRegisterEntry = { name, children: [] };
			stack[stack.length - 1].children.push(entry);
			stack.push({ indent, children: entry.children! });
			continue;
		}

		const indent = line.length - line.trimStart().length;

		// Pop stack until we find a parent with smaller indent.
		while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}

		let matchedAny = false;
		let valuePairMatch: RegExpExecArray | null;
		REG_VALUE_PAIR_REGEX.lastIndex = 0;
		while ((valuePairMatch = REG_VALUE_PAIR_REGEX.exec(line)) !== null) {
			matchedAny = true;
			stack[stack.length - 1].children.push({
				name: valuePairMatch[1],
				value: valuePairMatch[2],
			});
		}

		if (!matchedAny) {
			// Fallback for uncommon formats where value contains non-hex tokens.
			const single = REG_SINGLE_VALUE_REGEX.exec(line);
			if (single) {
				stack[stack.length - 1].children.push({
					name: single[2],
					value: single[3],
				});
			}
		}
	}

	return root;
}
