/**
 * FreeRTOS awareness for Zynq ARM Cortex-A9/A53 targets.
 *
 * Detects FreeRTOS task lists by reading well-known symbols from GDB,
 * parses the task control block (TCB) structures, and exposes task
 * information (state, priority, stack watermark) that can be shown in
 * the debug adapter as pseudo-threads or a dedicated scope.
 *
 * This module works with GDB commands — it asks GDB to evaluate
 * FreeRTOS-internal symbols. XSDB is only used as a fallback for raw
 * memory reads when GDB symbol evaluation is not available.
 */

import { MI2 } from "../mi2/mi2";
import { MINode } from "../mi_parse";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreeRTOSTaskState = "Running" | "Ready" | "Blocked" | "Suspended" | "Deleted" | "Unknown";

export interface FreeRTOSTask {
	/** TCB address */
	tcbAddress: number;
	/** Task name (up to configMAX_TASK_NAME_LEN chars) */
	name: string;
	/** Task priority */
	priority: number;
	/** Current state */
	state: FreeRTOSTaskState;
	/** Stack high watermark (minimum free stack ever), in words. -1 if unavailable. */
	stackHighWaterMark: number;
	/** Whether this is the currently executing task */
	isCurrent: boolean;
}

// ---------------------------------------------------------------------------
// FreeRTOS symbol names
// ---------------------------------------------------------------------------

const SYM_CURRENT_TCB = "pxCurrentTCB";
const SYM_NUM_TASKS = "uxCurrentNumberOfTasks";
const SYM_READY_LIST = "pxReadyTasksLists";
const SYM_DELAYED_LIST1 = "xDelayedTaskList1";
const SYM_DELAYED_LIST2 = "xDelayedTaskList2";
const SYM_SUSPENDED_LIST = "xSuspendedTaskList";
const SYM_DEAD_LIST = "xTasksWaitingTermination";

/**
 * Checks whether FreeRTOS symbols are present in the loaded ELF, by
 * asking GDB to evaluate `pxCurrentTCB`.  Returns `true` if the symbol
 * is resolvable.
 */
export async function detectFreeRTOS(gdb: MI2): Promise<boolean> {
	try {
		const result = await gdb.sendCommand(`data-evaluate-expression "&${SYM_CURRENT_TCB}"`);
		const val = result.result("value");
		// If it resolves to an address, FreeRTOS is present.
		return val !== undefined && val !== "" && val !== "0x0";
	} catch {
		return false;
	}
}

/**
 * Read the currently running task's TCB address.
 */
async function readCurrentTCB(gdb: MI2): Promise<number> {
	const result = await gdb.sendCommand(`data-evaluate-expression "(unsigned int)${SYM_CURRENT_TCB}"`);
	const val = result.result("value");
	return parseInt(val, val?.startsWith("0x") ? 16 : 10);
}

/**
 * Read a null-terminated C string from target memory at `addr`, up to
 * `maxLen` bytes.  Uses GDB `x` command.
 */
async function readCString(gdb: MI2, addr: number, maxLen: number = 32): Promise<string> {
	try {
		const result = await gdb.sendCommand(
			`data-evaluate-expression "(char*)0x${addr.toString(16)}"`,
		);
		let val: string = result.result("value") || "";
		// GDB returns the string in the format: 0xADDR "string_content"
		const quoteIdx = val.indexOf('"');
		if (quoteIdx >= 0) {
			val = val.substring(quoteIdx + 1);
			const endQuote = val.lastIndexOf('"');
			if (endQuote >= 0) val = val.substring(0, endQuote);
		}
		return val.substring(0, maxLen);
	} catch {
		return "<unknown>";
	}
}

/**
 * Read a 32-bit value from target memory at a given address using GDB.
 */
async function readUint32(gdb: MI2, addr: number): Promise<number> {
	const result = await gdb.sendCommand(
		`data-evaluate-expression "*(unsigned int*)0x${addr.toString(16)}"`,
	);
	const val = result.result("value");
	return parseInt(val, val?.startsWith("0x") ? 16 : 10);
}

// ---------------------------------------------------------------------------
// TCB layout offsets (FreeRTOS 10.x, ARM 32-bit)
// These are approximate and depend on FreeRTOS config. They can be
// overridden by the user in future versions.
// ---------------------------------------------------------------------------

export interface TCBOffsets {
	/** Offset of pxTopOfStack (first field, always 0) */
	topOfStack: number;
	/** Offset of xStateListItem (xListItem embedded struct) */
	stateListItem: number;
	/** Offset of xEventListItem */
	eventListItem: number;
	/** Offset of uxPriority */
	priority: number;
	/** Offset of pxStack (start of stack buffer) */
	stackStart: number;
	/** Offset of pcTaskName (char array) */
	taskName: number;
}

/** Default offsets for FreeRTOS 10.x on ARM 32-bit (Cortex-A9). */
export const DEFAULT_TCB_OFFSETS_ARM32: TCBOffsets = {
	topOfStack: 0,
	stateListItem: 4,
	eventListItem: 24,
	priority: 44,
	stackStart: 48,
	taskName: 52,
};

/** Default offsets for FreeRTOS 10.x on ARM 64-bit (Cortex-A53). */
export const DEFAULT_TCB_OFFSETS_ARM64: TCBOffsets = {
	topOfStack: 0,
	stateListItem: 8,
	eventListItem: 48,
	priority: 88,
	stackStart: 96,
	taskName: 104,
};

// ---------------------------------------------------------------------------
// List traversal
// ---------------------------------------------------------------------------

/** FreeRTOS xList struct: uxNumberOfItems at offset 0, then xListEnd, etc. */
async function readListItems(gdb: MI2, listAddr: number, pointerSize: number): Promise<number[]> {
	const tcbAddresses: number[] = [];
	try {
		const numItems = await readUint32(gdb, listAddr);
		if (numItems === 0 || numItems > 256) return tcbAddresses; // sanity

		// xListEnd is a MiniListItem embedded in the list struct.
		// On 32-bit: offset 4 is uxNumberOfItems, sentinel at offset 4 + 4 = 8
		// We walk pxIndex -> xListItem -> pxNext chain.
		// Using GDB expression evaluation is safer than raw offsets.
		const indexAddr = await readUint32(gdb, listAddr + pointerSize);
		let current = indexAddr;

		for (let i = 0; i < numItems + 1; i++) {
			// xListItem.pxNext is at offset 4 on 32-bit
			const next = await readUint32(gdb, current + pointerSize);
			if (next === indexAddr) break; // wrapped around to sentinel

			// xListItem.pvOwner is at offset 12 on 32-bit (after pxNext, pxPrevious, xItemValue)
			const owner = await readUint32(gdb, next + 3 * pointerSize);
			if (owner !== 0) {
				tcbAddresses.push(owner);
			}
			current = next;
			if (tcbAddresses.length > 256) break; // safety
		}
	} catch {
		// silent — the list might not be initialized
	}
	return tcbAddresses;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query FreeRTOS task list from target. Returns an array of tasks with
 * name, state, priority, and stack watermark.
 *
 * @param gdb The MI2 GDB backend.
 * @param is64bit True for AArch64 (Cortex-A53), false for AArch32 (Cortex-A9).
 */
export async function getFreeRTOSTasks(
	gdb: MI2,
	is64bit: boolean = false,
): Promise<FreeRTOSTask[]> {
	const tasks: FreeRTOSTask[] = [];
	const offsets = is64bit ? DEFAULT_TCB_OFFSETS_ARM64 : DEFAULT_TCB_OFFSETS_ARM32;
	const pointerSize = is64bit ? 8 : 4;

	let currentTCB: number;
	try {
		currentTCB = await readCurrentTCB(gdb);
	} catch {
		return tasks; // FreeRTOS not active
	}

	// Collect TCBs from all known FreeRTOS lists
	const listsToQuery: { symbol: string; state: FreeRTOSTaskState }[] = [
		{ symbol: SYM_DELAYED_LIST1, state: "Blocked" },
		{ symbol: SYM_DELAYED_LIST2, state: "Blocked" },
		{ symbol: SYM_SUSPENDED_LIST, state: "Suspended" },
		{ symbol: SYM_DEAD_LIST, state: "Deleted" },
	];

	const allTCBs = new Map<number, FreeRTOSTaskState>();

	// Ready lists (one per priority level, typically configMAX_PRIORITIES = 5..64)
	try {
		const readyListBase = await evalAddress(gdb, `&${SYM_READY_LIST}[0]`);
		// Try up to 64 priority levels
		for (let prio = 0; prio < 64; prio++) {
			const listAddr = readyListBase + prio * getListStructSize(pointerSize);
			const items = await readListItems(gdb, listAddr, pointerSize);
			if (items.length === 0 && prio > 10) break; // heuristic: stop if empty and past common range
			for (const tcb of items) {
				allTCBs.set(tcb, "Ready");
			}
		}
	} catch {
		// ready list not available
	}

	// Other lists
	for (const { symbol, state } of listsToQuery) {
		try {
			const addr = await evalAddress(gdb, `&${symbol}`);
			const items = await readListItems(gdb, addr, pointerSize);
			for (const tcb of items) {
				allTCBs.set(tcb, state);
			}
		} catch {
			// list not present
		}
	}

	// Always include current TCB
	if (!allTCBs.has(currentTCB)) {
		allTCBs.set(currentTCB, "Running");
	} else {
		allTCBs.set(currentTCB, "Running");
	}

	// Read task info from each TCB
	for (const [tcbAddr, state] of allTCBs) {
		try {
			const name = await readCString(gdb, tcbAddr + offsets.taskName);
			const priority = await readUint32(gdb, tcbAddr + offsets.priority);
			let watermark = -1;
			try {
				const stackStart = await readUint32(gdb, tcbAddr + offsets.stackStart);
				// FreeRTOS fills stack with 0xA5A5A5A5 pattern; count untouched words
				watermark = await countStackWaterMark(gdb, stackStart, 256);
			} catch { /* watermark not available */ }

			tasks.push({
				tcbAddress: tcbAddr,
				name,
				priority,
				state: tcbAddr === currentTCB ? "Running" : state,
				stackHighWaterMark: watermark,
				isCurrent: tcbAddr === currentTCB,
			});
		} catch {
			tasks.push({
				tcbAddress: tcbAddr,
				name: `<0x${tcbAddr.toString(16)}>`,
				priority: -1,
				state,
				stackHighWaterMark: -1,
				isCurrent: tcbAddr === currentTCB,
			});
		}
	}

	// Sort: current first, then by priority descending
	tasks.sort((a, b) => {
		if (a.isCurrent && !b.isCurrent) return -1;
		if (!a.isCurrent && b.isCurrent) return 1;
		return b.priority - a.priority;
	});

	return tasks;
}

/**
 * Evaluate a GDB expression and return the result as a number (address).
 */
async function evalAddress(gdb: MI2, expr: string): Promise<number> {
	const result = await gdb.sendCommand(`data-evaluate-expression "(unsigned long)${expr}"`);
	const val: string = result.result("value") || "0";
	return parseInt(val, val.startsWith("0x") ? 16 : 10);
}

/** Approximate size of an xList struct based on pointer size. */
function getListStructSize(pointerSize: number): number {
	// xList = { uxNumberOfItems(4/8), pxIndex(ptr), xMiniListItem { xItemValue(4/8), pxNext(ptr), pxPrev(ptr) } }
	return pointerSize + pointerSize + pointerSize + pointerSize + pointerSize;
}

/**
 * Count the stack high watermark by looking for the FreeRTOS fill pattern
 * (0xA5A5A5A5) from the bottom of the stack upward.
 */
async function countStackWaterMark(
	gdb: MI2,
	stackBottom: number,
	maxWords: number,
): Promise<number> {
	let count = 0;
	const FILL_PATTERN = 0xA5A5A5A5;
	// Read in chunks to reduce round-trips
	const chunkSize = 16;
	for (let offset = 0; offset < maxWords; offset += chunkSize) {
		for (let w = 0; w < chunkSize && (offset + w) < maxWords; w++) {
			try {
				const val = await readUint32(gdb, stackBottom + (offset + w) * 4);
				if (val === FILL_PATTERN) {
					count++;
				} else {
					return count;
				}
			} catch {
				return count;
			}
		}
	}
	return count;
}
