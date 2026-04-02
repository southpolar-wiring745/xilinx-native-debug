/**
 * FreeRTOS Crash Analyzer
 *
 * Detects and decodes FreeRTOS fatal error conditions when the debugger
 * is halted inside well-known FreeRTOS/BSP error handlers.
 *
 * Supported stop locations and the data they expose:
 *
 * ┌─────────────────────────────────┬──────────────────────────────────────┐
 * │ Handler / Hook                  │ Extracted info                       │
 * ├─────────────────────────────────┼──────────────────────────────────────┤
 * │ vApplicationAssert              │ pcFileName, ulLine                   │
 * │ vApplicationStackOverflowHook   │ task handle, task name               │
 * │ vApplicationMallocFailedHook    │ (heap exhaustion)                    │
 * │ Xil_DataAbortHandler            │ DataAbortAddr, FaultStatus (CP15)    │
 * │ Xil_PrefetchAbortHandler        │ PrefetchAbortAddr                    │
 * │ Xil_UndefinedExceptionHandler   │ UndefinedExceptionAddr               │
 * │ FreeRTOS_DataAbortHandler (asm) │ DataAbortAddr (from vector stub)     │
 * │ FreeRTOS_PrefetchAbortHandler   │ PrefetchAbortAddr                    │
 * │ DataAbortHandler (CR5 asm)      │ DataAbortAddr                        │
 * │ PrefetchAbortHandler (CR5 asm)  │ PrefetchAbortAddr                    │
 * │ SynchronousInterrupt (CA53)     │ ESR_EL1 / FAR_EL1                   │
 * │ SErrorInterrupt (CA53)          │ ESR_EL1                              │
 * │ vPortExceptionHandler (MB)      │ xRegisterDump (EAR/ESR/EDR/PC/…)    │
 * │ vApplicationExceptionRegDump    │ xRegisterDump                        │
 * └─────────────────────────────────┴──────────────────────────────────────┘
 *
 * Works on all Xilinx FreeRTOS platforms:
 *   - Zynq-7000  (Cortex-A9,  AArch32)
 *   - ZynqMP     (Cortex-R5,  AArch32)
 *   - ZynqMP     (Cortex-A53, AArch64)
 *   - MicroBlaze
 */

import { MI2 } from "../mi2/mi2";
import { MINode } from "../mi_parse";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FreeRTOSCrashReport {
	/** Which handler / hook the CPU is stopped in */
	handler: string;
	/** Human-readable crash category */
	category: FreeRTOSCrashCategory;
	/** Platform that was detected */
	platform: string;
	/** Extracted fields (handler-specific) */
	details: Record<string, string>;
	/** Human-readable description */
	description: string;
}

export type FreeRTOSCrashCategory =
	| "configASSERT failure"
	| "Stack overflow"
	| "Heap exhaustion"
	| "Data abort"
	| "Prefetch abort"
	| "Undefined exception"
	| "Synchronous exception"
	| "SError"
	| "MicroBlaze exception"
	| "Unknown fatal";

// ---------------------------------------------------------------------------
// Known stop-function signatures
// ---------------------------------------------------------------------------

/** Functions that indicate a FreeRTOS / BSP fatal stop. */
const KNOWN_HANDLERS: {
	/** Function name (or pattern) that we match against the top frames */
	names: string[];
	category: FreeRTOSCrashCategory;
	handler: string;
}[] = [
	{
		names: ["vApplicationAssert"],
		category: "configASSERT failure",
		handler: "vApplicationAssert",
	},
	{
		names: ["vApplicationStackOverflowHook"],
		category: "Stack overflow",
		handler: "vApplicationStackOverflowHook",
	},
	{
		names: ["vApplicationMallocFailedHook"],
		category: "Heap exhaustion",
		handler: "vApplicationMallocFailedHook",
	},
	// AArch32 abort handlers (CA9, CR5)
	{
		names: [
			"Xil_DataAbortHandler",
			"DataAbortInterrupt",
			"FreeRTOS_DataAbortHandler",
			"DataAbortHandler",
		],
		category: "Data abort",
		handler: "DataAbortHandler",
	},
	{
		names: [
			"Xil_PrefetchAbortHandler",
			"PrefetchAbortInterrupt",
			"FreeRTOS_PrefetchAbortHandler",
			"PrefetchAbortHandler",
		],
		category: "Prefetch abort",
		handler: "PrefetchAbortHandler",
	},
	{
		names: [
			"Xil_UndefinedExceptionHandler",
			"UndefinedException",
			"FreeRTOS_Undefined",
			"Undefined",
		],
		category: "Undefined exception",
		handler: "UndefinedExceptionHandler",
	},
	// AArch64 (CA53)
	{
		names: ["SynchronousInterrupt", "SynchronousInterruptHandler"],
		category: "Synchronous exception",
		handler: "SynchronousInterruptHandler",
	},
	{
		names: ["SErrorInterrupt", "SErrorInterruptHandler"],
		category: "SError",
		handler: "SErrorInterruptHandler",
	},
	// MicroBlaze
	{
		names: ["vPortExceptionHandler", "vApplicationExceptionRegisterDump"],
		category: "MicroBlaze exception",
		handler: "vPortExceptionHandler",
	},
];

// ---------------------------------------------------------------------------
// Stack frame inspection
// ---------------------------------------------------------------------------

/**
 * Try to identify the crash handler by inspecting the top N call-stack
 * frames via GDB.  Returns the matched handler entry or undefined.
 */
export async function detectFreeRTOSCrashHandler(
	gdb: MI2,
): Promise<typeof KNOWN_HANDLERS[number] | undefined> {
	const frames = await getTopFrameFunctions(gdb, 6);
	for (const entry of KNOWN_HANDLERS) {
		for (const fname of frames) {
			if (entry.names.some(n => fname === n || fname.includes(n))) {
				return entry;
			}
		}
	}
	return undefined;
}

/**
 * Read function names from the top N stack frames.
 * Uses MI2.getStack() which correctly parses the MINode result.
 */
async function getTopFrameFunctions(gdb: MI2, depth: number): Promise<string[]> {
	try {
		const stack = await gdb.getStack(0, depth, 0);
		return stack.map((f: any) => {
			const func = typeof f.function === "string" ? f.function : "";
			// getStack sets function to either the name or the "from" address
			// Strip address suffix like "@0x..." if present
			const atIdx = func.indexOf("@");
			return atIdx > 0 ? func.substring(0, atIdx) : func;
		}).filter(Boolean);
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Per-handler data extraction via GDB expressions
// ---------------------------------------------------------------------------

async function evalExprSafe(gdb: MI2, expr: string): Promise<string | undefined> {
	try {
		const res = await gdb.evalExpression(JSON.stringify(expr), 0, 0);
		const val = res.result("value");
		return val || undefined;
	} catch {
		return undefined;
	}
}

async function extractAssertDetails(gdb: MI2): Promise<Record<string, string>> {
	const details: Record<string, string> = {};
	// The handler has two volatile locals that GDB can read
	const fileName = await evalExprSafe(gdb, "(const char*)pcLocalFileName");
	const line = await evalExprSafe(gdb, "(unsigned int)ulLocalLine");
	// Also try raw parameters
	const paramFile = await evalExprSafe(gdb, "(const char*)pcFileName");
	const paramLine = await evalExprSafe(gdb, "(unsigned int)ulLine");

	const file = extractCString(fileName) || extractCString(paramFile);
	const lineNum = extractUint(line) ?? extractUint(paramLine);

	if (file) details["File"] = file;
	if (lineNum !== undefined) details["Line"] = lineNum.toString();
	return details;
}

async function extractStackOverflowDetails(gdb: MI2): Promise<Record<string, string>> {
	const details: Record<string, string> = {};
	const taskName = await evalExprSafe(gdb, "(const char*)pcOverflowingTaskName");
	const taskHandle = await evalExprSafe(gdb, "(unsigned int)xOverflowingTaskHandle");
	// Also try parameters
	const paramName = await evalExprSafe(gdb, "(const char*)pcTaskName");

	const name = extractCString(taskName) || extractCString(paramName);
	if (name) details["Task"] = name;
	if (taskHandle) details["TCB"] = taskHandle;
	return details;
}

async function extractDataAbortDetails(gdb: MI2): Promise<Record<string, string>> {
	const details: Record<string, string> = {};
	// BSP globals set by asm vectors before calling C handler
	const addr = await evalExprSafe(gdb, "(unsigned int)DataAbortAddr");
	const faultStatus = await evalExprSafe(gdb, "(unsigned int)FaultStatus");

	if (addr) details["DataAbortAddr"] = addr;
	if (faultStatus) details["FaultStatus (DFSR)"] = faultStatus;
	return details;
}

async function extractPrefetchAbortDetails(gdb: MI2): Promise<Record<string, string>> {
	const details: Record<string, string> = {};
	const addr = await evalExprSafe(gdb, "(unsigned int)PrefetchAbortAddr");
	if (addr) details["PrefetchAbortAddr"] = addr;
	return details;
}

async function extractUndefinedDetails(gdb: MI2): Promise<Record<string, string>> {
	const details: Record<string, string> = {};
	const addr = await evalExprSafe(gdb, "(unsigned int)UndefinedExceptionAddr");
	if (addr) details["UndefinedExceptionAddr"] = addr;
	return details;
}

async function extractMicroBlazeDetails(gdb: MI2): Promise<Record<string, string>> {
	const details: Record<string, string> = {};
	// The MicroBlaze port fills a static xRegisterDump struct
	const fields: { expr: string; label: string }[] = [
		{ expr: "(const char*)xRegisterDump.pcExceptionCause", label: "Cause" },
		{ expr: "(unsigned int)xRegisterDump.ulPC", label: "PC" },
		{ expr: "(unsigned int)xRegisterDump.ulEAR", label: "EAR" },
		{ expr: "(unsigned int)xRegisterDump.ulESR", label: "ESR" },
		{ expr: "(unsigned int)xRegisterDump.ulEDR", label: "EDR" },
		{ expr: "(unsigned int)xRegisterDump.ulR1_SP", label: "SP (R1)" },
		{ expr: "(unsigned int)xRegisterDump.ulR15_return_address_from_subroutine", label: "R15 (return addr)" },
		{ expr: "(unsigned int)xRegisterDump.ulR17_return_address_from_exceptions", label: "R17 (exception return)" },
		{ expr: "(unsigned int)xRegisterDump.ulMSR", label: "MSR" },
		{ expr: "(const char*)xRegisterDump.pcCurrentTaskName", label: "Task" },
		{ expr: "(unsigned int)xRegisterDump.ulFSR", label: "FSR" },
	];

	for (const { expr, label } of fields) {
		const val = await evalExprSafe(gdb, expr);
		if (val && val !== "0" && val !== "0x0") {
			if (label === "Cause" || label === "Task") {
				const str = extractCString(val);
				if (str) details[label] = str;
			} else {
				details[label] = val;
			}
		}
	}
	return details;
}

async function extractSynchronousDetails(gdb: MI2): Promise<Record<string, string>> {
	const details: Record<string, string> = {};
	// CA53 AArch64: read system registers through GDB if possible
	// The BSP SynchronousInterrupt C handler may have locals or we read via expression
	const esr = await evalExprSafe(gdb, "$esr_el1");
	const far = await evalExprSafe(gdb, "$far_el1");
	const elr = await evalExprSafe(gdb, "$elr_el1");

	if (esr) details["ESR_EL1"] = esr;
	if (far) details["FAR_EL1"] = far;
	if (elr) details["ELR_EL1"] = elr;
	return details;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCString(gdbValue: string | undefined): string | undefined {
	if (!gdbValue) return undefined;
	// GDB returns strings as: 0xADDR "content" or just "content"
	const match = /"([^"]*)"/.exec(gdbValue);
	if (match) return match[1];
	// Sometimes it's just the address — not useful as a string
	if (/^0x[0-9a-fA-F]+$/.test(gdbValue.trim())) return undefined;
	return gdbValue.trim();
}

function extractUint(gdbValue: string | undefined): number | undefined {
	if (!gdbValue) return undefined;
	const trimmed = gdbValue.trim();
	if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
		return parseInt(trimmed, 16);
	}
	const num = parseInt(trimmed, 10);
	return isNaN(num) ? undefined : num;
}

// ---------------------------------------------------------------------------
// Main analyzer entry point
// ---------------------------------------------------------------------------

/**
 * Run FreeRTOS-aware crash analysis.
 *
 * 1. Inspects the call stack for known FreeRTOS/BSP fatal handlers.
 * 2. Extracts handler-specific data via GDB expression evaluation.
 * 3. Returns a formatted crash report, or undefined if the CPU is not
 *    stopped in a recognized handler.
 */
export async function analyzeFreeRTOSCrash(
	gdb: MI2,
	platform: string,
): Promise<FreeRTOSCrashReport | undefined> {
	const matched = await detectFreeRTOSCrashHandler(gdb);
	if (!matched) return undefined;

	let details: Record<string, string> = {};

	switch (matched.category) {
		case "configASSERT failure":
			details = await extractAssertDetails(gdb);
			break;
		case "Stack overflow":
			details = await extractStackOverflowDetails(gdb);
			break;
		case "Heap exhaustion":
			// No extra data to extract — the handler is evidence enough
			break;
		case "Data abort":
			details = await extractDataAbortDetails(gdb);
			break;
		case "Prefetch abort":
			details = await extractPrefetchAbortDetails(gdb);
			break;
		case "Undefined exception":
			details = await extractUndefinedDetails(gdb);
			break;
		case "Synchronous exception":
		case "SError":
			details = await extractSynchronousDetails(gdb);
			break;
		case "MicroBlaze exception":
			details = await extractMicroBlazeDetails(gdb);
			break;
	}

	// Try to get the current FreeRTOS task name for context
	if (!details["Task"]) {
		const taskName = await evalExprSafe(gdb, "(const char*)((char*)pxCurrentTCB + 52)");
		const name = extractCString(taskName);
		if (name) details["Current Task"] = name;
	}

	const description = buildDescription(matched.category, matched.handler, details, platform);

	return {
		handler: matched.handler,
		category: matched.category,
		platform,
		details,
		description,
	};
}

function buildDescription(
	category: FreeRTOSCrashCategory,
	handler: string,
	details: Record<string, string>,
	platform: string,
): string {
	switch (category) {
		case "configASSERT failure": {
			const file = details["File"] || "unknown";
			const line = details["Line"] || "?";
			return `FreeRTOS configASSERT() failed at ${file}:${line}. ` +
				`A FreeRTOS API was called incorrectly or a critical invariant was violated.`;
		}
		case "Stack overflow": {
			const task = details["Task"] || "unknown";
			return `Stack overflow detected in task "${task}". ` +
				`Increase the task's stack size in xTaskCreate() or reduce stack usage.`;
		}
		case "Heap exhaustion":
			return `Heap allocation failed (pvPortMalloc returned NULL). ` +
				`Increase configTOTAL_HEAP_SIZE or reduce dynamic allocations.`;
		case "Data abort": {
			const addr = details["DataAbortAddr"] || "unknown";
			const dfsr = details["FaultStatus (DFSR)"] || "N/A";
			return `Data abort at address ${addr} (DFSR=${dfsr}). ` +
				`The CPU attempted an invalid data memory access.`;
		}
		case "Prefetch abort": {
			const addr = details["PrefetchAbortAddr"] || "unknown";
			return `Prefetch abort at address ${addr}. ` +
				`The CPU attempted to fetch an instruction from an invalid address.`;
		}
		case "Undefined exception": {
			const addr = details["UndefinedExceptionAddr"] || "unknown";
			return `Undefined instruction exception at address ${addr}. ` +
				`The CPU encountered an instruction it cannot decode.`;
		}
		case "Synchronous exception": {
			const esr = details["ESR_EL1"] || "N/A";
			const far = details["FAR_EL1"] || "N/A";
			return `AArch64 synchronous exception. ESR_EL1=${esr}, FAR_EL1=${far}.`;
		}
		case "SError": {
			const esr = details["ESR_EL1"] || "N/A";
			return `AArch64 SError (asynchronous external abort). ESR_EL1=${esr}.`;
		}
		case "MicroBlaze exception": {
			const cause = details["Cause"] || "unknown";
			const pc = details["PC"] || "N/A";
			return `MicroBlaze exception: ${cause} at PC=${pc}.`;
		}
		default:
			return `CPU stopped in ${handler}.`;
	}
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export function formatFreeRTOSCrashReport(report: FreeRTOSCrashReport): string {
	const lines: string[] = [];
	lines.push("═══════════════════════════════════════════════");
	lines.push("[FreeRTOS Crash Analyzer]");
	lines.push("═══════════════════════════════════════════════");
	lines.push(`Category:   ${report.category}`);
	lines.push(`Handler:    ${report.handler}`);
	lines.push(`Platform:   ${report.platform}`);
	lines.push("");
	lines.push(report.description);
	lines.push("");

	const detailEntries = Object.entries(report.details);
	if (detailEntries.length > 0) {
		lines.push("Details:");
		const maxKeyLen = Math.max(...detailEntries.map(([k]) => k.length));
		for (const [key, value] of detailEntries) {
			lines.push(`  ${key.padEnd(maxKeyLen)}  ${value}`);
		}
	}

	lines.push("");
	lines.push("Recommendation:");
	lines.push(`  ${getRecommendation(report.category)}`);
	lines.push("═══════════════════════════════════════════════");
	return lines.join("\n");
}

function getRecommendation(category: FreeRTOSCrashCategory): string {
	switch (category) {
		case "configASSERT failure":
			return "Check the failing file:line for API misuse. Common causes: calling " +
				"API from wrong context (ISR vs task), invalid handle, scheduler not started.";
		case "Stack overflow":
			return "Increase the failing task's stack allocation. Use " +
				"uxTaskGetStackHighWaterMark() to find tasks close to overflow. " +
				"Enable configCHECK_FOR_STACK_OVERFLOW=2 for runtime detection.";
		case "Heap exhaustion":
			return "Increase configTOTAL_HEAP_SIZE in FreeRTOSConfig.h. " +
				"Use xPortGetFreeHeapSize() / xPortGetMinimumEverFreeHeapSize() to monitor.";
		case "Data abort":
			return "Check the faulting address — it may be a NULL pointer dereference, " +
				"an access to unmapped peripheral space, or a DMA buffer in non-accessible memory. " +
				"If using MMU/MPU, verify region configuration.";
		case "Prefetch abort":
			return "The PC jumped to an invalid address. Common causes: corrupted function " +
				"pointer, stack corruption overwriting LR, or branch to non-executable region.";
		case "Undefined exception":
			return "Possible causes: corrupted code section, branch to data region, " +
				"or missing coprocessor instructions (VFP/NEON not enabled).";
		case "Synchronous exception":
		case "SError":
			return "Decode ESR_EL1 to identify the exception class. Check FAR_EL1 for the " +
				"faulting address. Common causes: translation fault, permission fault, alignment.";
		case "MicroBlaze exception":
			return "Check EAR (Exception Address Register) and ESR (Exception Status Register). " +
				"Common causes: unaligned access, bus error, illegal opcode, divide-by-zero.";
		default:
			return "Inspect the call stack and register state for more information.";
	}
}
