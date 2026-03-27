/**
 * Board-family presets for Xilinx devices.
 *
 * Each preset defines the XSDB init sequence required to bring the
 * device into a state where software can be loaded and debugged via GDB.
 *
 * Users can bypass presets entirely by providing a custom `initScript`.
 */

export type BoardFamily = "zynq7000" | "zynqmp" | "versal" | "fpga" | "auto";

export interface BoardPreset {
	/** Human-readable label. */
	label: string;
	/** Default target filter for selecting the right CPU target. */
	defaultTargetFilter: string;
	/**
	 * Returns the sequence of XSDB Tcl commands to execute for board init.
	 * All path arguments are optional — when supplied they override the defaults
	 * built into the sequence.
	 */
	initSequence(opts: InitSequenceOptions): string[];
}

export interface InitSequenceOptions {
	bitstreamPath?: string;
	hwDesignPath?: string;
	psInitScript?: string;
}

export interface BoardDetectionHints {
	hwDesignPath?: string;
	bitstreamPath?: string;
	psInitScript?: string;
	initScript?: string;
	targetFilter?: string;
	initTargetFilter?: string;
}

// -------------------------------------------------------------------------
// Zynq-7000 (e.g. ZC702, ZedBoard, PYNQ-Z1/Z2)
// -------------------------------------------------------------------------

const zynq7000Preset: BoardPreset = {
	label: "Zynq-7000",
	defaultTargetFilter: "ARM Cortex-A9*",
	initSequence(opts: InitSequenceOptions): string[] {
		const cmds: string[] = [];
		if (opts.hwDesignPath) {
			cmds.push(`loadhw ${opts.hwDesignPath}`);
		}
		if (opts.psInitScript) {
			cmds.push(`source ${opts.psInitScript}`);
			cmds.push("ps7_init");
			cmds.push("ps7_post_config");
		}
		if (opts.bitstreamPath) {
			cmds.push(`fpga ${opts.bitstreamPath}`);
		}
		return cmds;
	},
};

// -------------------------------------------------------------------------
// Zynq UltraScale+ MPSoC (e.g. ZCU102, ZCU104, KV260)
// -------------------------------------------------------------------------

const zynqmpPreset: BoardPreset = {
	label: "Zynq UltraScale+",
	defaultTargetFilter: "Cortex-A53*",
	initSequence(opts: InitSequenceOptions): string[] {
		const cmds: string[] = [];
		if (opts.hwDesignPath) {
			cmds.push(`loadhw ${opts.hwDesignPath}`);
		}
		if (opts.psInitScript) {
			cmds.push(`source ${opts.psInitScript}`);
			cmds.push("psu_init");
			cmds.push("psu_post_config");
		}
		if (opts.bitstreamPath) {
			cmds.push(`fpga ${opts.bitstreamPath}`);
		}
		return cmds;
	},
};

// -------------------------------------------------------------------------
// Versal Adaptive SoC
// -------------------------------------------------------------------------

const versalPreset: BoardPreset = {
	label: "Versal",
	defaultTargetFilter: "Cortex-A72*",
	initSequence(opts: InitSequenceOptions): string[] {
		const cmds: string[] = [];
		// On Versal, the PLM handles most configuration. The user may still
		// need a PDI programmed, but the init flow is simpler.
		if (opts.bitstreamPath) {
			// Versal uses .pdi files rather than .bit
			cmds.push(`device program ${opts.bitstreamPath}`);
		}
		if (opts.hwDesignPath) {
			cmds.push(`loadhw ${opts.hwDesignPath}`);
		}
		if (opts.psInitScript) {
			cmds.push(`source ${opts.psInitScript}`);
		}
		return cmds;
	},
};

// -------------------------------------------------------------------------
// Classic FPGA (Artix-7, Kintex-7, Virtex-7, Spartan-7)
// -------------------------------------------------------------------------

const fpgaPreset: BoardPreset = {
	label: "Classic FPGA",
	defaultTargetFilter: "xc*",
	initSequence(opts: InitSequenceOptions): string[] {
		const cmds: string[] = [];
		// Classic FPGAs have no PS – just program the bitstream.
		if (opts.bitstreamPath) {
			cmds.push(`fpga ${opts.bitstreamPath}`);
		}
		if (opts.hwDesignPath) {
			cmds.push(`loadhw ${opts.hwDesignPath}`);
		}
		// If a MicroBlaze init script is provided, source it.
		if (opts.psInitScript) {
			cmds.push(`source ${opts.psInitScript}`);
		}
		return cmds;
	},
};

// -------------------------------------------------------------------------
// Registry
// -------------------------------------------------------------------------

export const BOARD_PRESETS: Record<Exclude<BoardFamily, "auto">, BoardPreset> = {
	zynq7000: zynq7000Preset,
	zynqmp: zynqmpPreset,
	versal: versalPreset,
	fpga: fpgaPreset,
};

/**
 * Attempt to auto-detect the board family from the hardware design file
 * extension or name.  Returns `undefined` if detection fails.
 */
export function detectBoardFamily(hints?: string | BoardDetectionHints): Exclude<BoardFamily, "auto"> | undefined {
	const normalizedHints: BoardDetectionHints = typeof hints === "string"
		? { hwDesignPath: hints }
		: (hints || {});

	const values = [
		normalizedHints.hwDesignPath,
		normalizedHints.bitstreamPath,
		normalizedHints.psInitScript,
		normalizedHints.initScript,
		normalizedHints.targetFilter,
		normalizedHints.initTargetFilter,
	]
		.filter((v): v is string => !!v)
		.map(v => v.toLowerCase());

	if (values.length === 0) return undefined;

	const text = values.join(" ");

	const hasVersalHint = /versal|vck\d*|vmk\d*|xcv[epc]|\ba72\b|\.pdi\b/.test(text);
	if (hasVersalHint) return "versal";

	const hasZynqMpHint = /zynqmp|mpsoc|zcu\d*|zu\d+|xczu\w*|xck26\w*|kv260|\ba53\b|\br5\b|\brpu\b|\bpsu_init\b/.test(text);
	if (hasZynqMpHint) return "zynqmp";

	const hasZynq7000Hint = /\bzynq\b|\bzc7\d*\b|\bxc7z\w*\b|\ba9\b|\bps7_init\b/.test(text);
	if (hasZynq7000Hint) return "zynq7000";

	// Legacy extensions are weak hints only.
	if (values.some(v => v.endsWith(".pdi"))) return "versal";

	return undefined;
}
