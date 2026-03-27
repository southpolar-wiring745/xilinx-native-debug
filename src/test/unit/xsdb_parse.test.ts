import * as assert from 'assert';
import {
	isPromptReady,
	splitResponses,
	parseError,
	parseTargets,
	parseMemoryDump,
	parseRegisters,
} from '../../backend/xsdb/xsdb_parse';

suite("XSDB Parse", () => {
	suite("Prompt detection", () => {
		test("Detects prompt at end of buffer", () => {
			assert.strictEqual(isPromptReady("some output\nxsdb% "), true);
		});

		test("Rejects incomplete buffer", () => {
			assert.strictEqual(isPromptReady("some output\n"), false);
		});

		test("Rejects prompt in middle of buffer", () => {
			assert.strictEqual(isPromptReady("xsdb% more data"), false);
		});

		test("Detects prompt-only buffer", () => {
			assert.strictEqual(isPromptReady("xsdb% "), true);
		});
	});

	// -------------------------------------------------------------------
	// Response splitting
	// -------------------------------------------------------------------

	suite("splitResponses", () => {
		test("Splits two responses", () => {
			const raw = "output1\nxsdb% output2\nxsdb% ";
			const parts = splitResponses(raw);
			assert.strictEqual(parts.length, 2);
			assert.strictEqual(parts[0], "output1");
			assert.strictEqual(parts[1], "output2");
		});

		test("Handles single response", () => {
			const raw = "hello world\nxsdb% ";
			const parts = splitResponses(raw);
			assert.strictEqual(parts.length, 1);
			assert.strictEqual(parts[0], "hello world");
		});

		test("Handles empty output before prompt", () => {
			const raw = "xsdb% ";
			const parts = splitResponses(raw);
			assert.strictEqual(parts.length, 1);
			assert.strictEqual(parts[0], "");
		});
	});

	// -------------------------------------------------------------------
	// Error parsing
	// -------------------------------------------------------------------

	suite("parseError", () => {
		test("Detects error: prefix", () => {
			const err = parseError("error: no targets found");
			assert.strictEqual(err, "no targets found");
		});

		test("Detects Error: prefix (capitalized)", () => {
			const err = parseError("Error: Invalid target id");
			assert.strictEqual(err, "Invalid target id");
		});

		test("Returns null for non-error text", () => {
			assert.strictEqual(parseError("100% done"), null);
		});

		test("Returns null for empty text", () => {
			assert.strictEqual(parseError(""), null);
		});

		test("Detects 'no targets found' without prefix", () => {
			const err = parseError("no targets found in filter");
			assert.strictEqual(err, "no targets found in filter");
		});
	});

	// -------------------------------------------------------------------
	// Targets parsing
	// -------------------------------------------------------------------

	suite("parseTargets", () => {
		test("Parses simple target list", () => {
			const text = [
				"  1  APU",
				"     2  ARM Cortex-A9 MPCore #0 (Running)",
				"     3  ARM Cortex-A9 MPCore #1 (Running)",
				"  4  xc7z020",
			].join("\n");

			const targets = parseTargets(text);
			assert.strictEqual(targets.length, 4);

			assert.strictEqual(targets[0].id, 1);
			assert.strictEqual(targets[0].name, "APU");
			assert.strictEqual(targets[0].state, "");
			assert.strictEqual(targets[0].selected, false);

			assert.strictEqual(targets[1].id, 2);
			assert.strictEqual(targets[1].name, "ARM Cortex-A9 MPCore #0");
			assert.strictEqual(targets[1].state, "Running");

			assert.strictEqual(targets[3].id, 4);
			assert.strictEqual(targets[3].name, "xc7z020");
		});

		test("Detects selected target", () => {
			const text = [
				"  1  APU",
				"* 2  ARM Cortex-A9 MPCore #0 (Stopped)",
				"  3  xc7z020",
			].join("\n");

			const targets = parseTargets(text);
			assert.strictEqual(targets.length, 3);
			assert.strictEqual(targets[1].selected, true);
			assert.strictEqual(targets[1].state, "Stopped");
			assert.strictEqual(targets[0].selected, false);
		});

		test("Handles empty input", () => {
			assert.strictEqual(parseTargets("").length, 0);
		});

		test("Handles targets with no state", () => {
			const targets = parseTargets("  1  MicroBlaze #0");
			assert.strictEqual(targets.length, 1);
			assert.strictEqual(targets[0].name, "MicroBlaze #0");
			assert.strictEqual(targets[0].state, "");
		});
	});

	// -------------------------------------------------------------------
	// Memory dump parsing
	// -------------------------------------------------------------------

	suite("parseMemoryDump", () => {
		test("Parses mrd output", () => {
			const text = [
				"F8000000:   00000000",
				"F8000004:   DEADBEEF",
				"F8000008:   12345678",
			].join("\n");

			const entries = parseMemoryDump(text);
			assert.strictEqual(entries.length, 3);

			assert.strictEqual(entries[0].address, 0xF8000000);
			assert.strictEqual(entries[0].value, 0x00000000);

			assert.strictEqual(entries[1].address, 0xF8000004);
			assert.strictEqual(entries[1].value, 0xDEADBEEF);

			assert.strictEqual(entries[2].address, 0xF8000008);
			assert.strictEqual(entries[2].value, 0x12345678);
		});

		test("Handles empty input", () => {
			assert.strictEqual(parseMemoryDump("").length, 0);
		});

		test("Ignores non-matching lines", () => {
			const text = "Some info\nF8000000:   AABBCCDD\nMore info";
			const entries = parseMemoryDump(text);
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].value, 0xAABBCCDD);
		});
	});

	// -------------------------------------------------------------------
	// Register parsing
	// -------------------------------------------------------------------

	suite("parseRegisters", () => {
		test("Parses flat register list", () => {
			const text = [
				"      r0: 00000000",
				"      r1: 00000001",
				"      r2: FFFFFFFE",
			].join("\n");

			const regs = parseRegisters(text);
			assert.strictEqual(regs.length, 3);
			assert.strictEqual(regs[0].name, "r0");
			assert.strictEqual(regs[0].value, "00000000");
			assert.strictEqual(regs[2].name, "r2");
			assert.strictEqual(regs[2].value, "FFFFFFFE");
		});

		test("Parses hierarchical registers", () => {
			const text = [
				"    r0: 00000000",
				"    r1: 00000001",
				"    usr:",
				"        r8: 00000008",
				"        r9: 00000009",
				"    pc: 00100000",
			].join("\n");

			const regs = parseRegisters(text);
			assert.strictEqual(regs.length, 4); // r0, r1, usr, pc

			const usr = regs[2];
			assert.strictEqual(usr.name, "usr");
			assert.strictEqual(usr.value, undefined);
			assert.ok(usr.children);
			assert.strictEqual(usr.children!.length, 2);
			assert.strictEqual(usr.children![0].name, "r8");
			assert.strictEqual(usr.children![0].value, "00000008");
			assert.strictEqual(usr.children![1].name, "r9");
			assert.strictEqual(usr.children![1].value, "00000009");

			assert.strictEqual(regs[3].name, "pc");
			assert.strictEqual(regs[3].value, "00100000");
		});

		test("Handles empty input", () => {
			assert.strictEqual(parseRegisters("").length, 0);
		});

		test("Handles deeply nested groups", () => {
			const text = [
				"    cpu:",
				"        core:",
				"            r0: ABCD1234",
				"        fpu:",
				"            s0: 3F800000",
			].join("\n");

			const regs = parseRegisters(text);
			assert.strictEqual(regs.length, 1);
			assert.strictEqual(regs[0].name, "cpu");
			assert.strictEqual(regs[0].children!.length, 2);

			const core = regs[0].children![0];
			assert.strictEqual(core.name, "core");
			assert.strictEqual(core.children!.length, 1);
			assert.strictEqual(core.children![0].name, "r0");
			assert.strictEqual(core.children![0].value, "ABCD1234");

			const fpu = regs[0].children![1];
			assert.strictEqual(fpu.name, "fpu");
			assert.strictEqual(fpu.children!.length, 1);
			assert.strictEqual(fpu.children![0].name, "s0");
			assert.strictEqual(fpu.children![0].value, "3F800000");
		});

		test("Parses multiple register pairs on one line", () => {
			const text = [
				"    r0: 00000000   r1: 00000001   r2: 00000002",
				"    r3: 00000003   r4: 00000004   r5: 00000005",
				"    r6: 00000006   r7: 00000007   r8: 00000008",
				"    r9: 00000009   r10: 0000000A  r11: 0000000B",
				"    r12: 0000000C  sp: 0000000D   lr: 0000000E",
				"    pc: 0000000F   cpsr: 600001D3",
			].join("\n");

			const regs = parseRegisters(text);
			const asMap = new Map<string, string>();
			for (const reg of regs) {
				if (reg.value) {
					asMap.set(reg.name, reg.value);
				}
			}

			assert.strictEqual(asMap.get("r1"), "00000001");
			assert.strictEqual(asMap.get("r5"), "00000005");
			assert.strictEqual(asMap.get("r11"), "0000000B");
			assert.strictEqual(asMap.get("sp"), "0000000D");
			assert.strictEqual(asMap.get("lr"), "0000000E");
			assert.strictEqual(asMap.get("cpsr"), "600001D3");
		});
	});
});
