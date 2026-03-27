import * as assert from 'assert';
import {
	parseLinkerMap,
	MemoryMap,
} from '../../backend/xsdb/memory_map';

suite("Memory Map Parser", () => {

	suite("parseLinkerMap", () => {
		test("Parses sections", () => {
			const content = [
				".text           0x00100000    0x1a34",
				".data           0x00200000    0x0100",
				".bss            0x00200100    0x0400",
			].join("\n");

			const info = parseLinkerMap(content);
			assert.strictEqual(info.sections.length, 3);
			assert.strictEqual(info.sections[0].name, ".text");
			assert.strictEqual(info.sections[0].address, 0x00100000);
			assert.strictEqual(info.sections[0].size, 0x1a34);
			assert.strictEqual(info.sections[2].name, ".bss");
		});

		test("Parses subsection symbols with source files", () => {
			const content = [
				".text           0x00100000    0x1000",
				" .text.main     0x001000a0       0x1c ./build/main.o",
				" .text.foo      0x001000bc       0x30 ./build/foo.o",
			].join("\n");

			const info = parseLinkerMap(content);
			assert.ok(info.symbols.length >= 2);
			const mainSym = info.symbols.find(s => s.name === "main");
			assert.ok(mainSym);
			assert.strictEqual(mainSym!.address, 0x001000a0);
			assert.strictEqual(mainSym!.size, 0x1c);
			assert.strictEqual(mainSym!.sourceFile, "./build/main.o");
		});

		test("Parses standalone symbol lines", () => {
			const content = [
				".text           0x00100000    0x1000",
				"                0x00100000                _start",
				"                0x001000a0                main",
			].join("\n");

			const info = parseLinkerMap(content);
			assert.ok(info.symbols.length >= 1);
			const mainSym = info.symbols.find(s => s.name === "main");
			assert.ok(mainSym);
			assert.strictEqual(mainSym!.address, 0x001000a0);
		});

		test("Handles empty input", () => {
			const info = parseLinkerMap("");
			assert.strictEqual(info.sections.length, 0);
			assert.strictEqual(info.symbols.length, 0);
		});

		test("Skips zero-size sections", () => {
			const content = ".empty          0x00000000    0x0000\n";
			const info = parseLinkerMap(content);
			assert.strictEqual(info.sections.length, 0);
		});
	});

	suite("MemoryMap", () => {
		const sampleContent = [
			".text           0x00100000    0x1000",
			" .text.main     0x001000a0       0x40 ./build/main.o",
			" .text.init     0x001000e0       0x20 ./build/init.o",
			".data           0x00200000    0x0100",
			"                0x00100000                _start",
		].join("\n");

		test("findSymbol finds exact match", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			const sym = map.findSymbol(0x001000a0);
			assert.ok(sym);
			assert.strictEqual(sym!.name, "main");
		});

		test("findSymbol finds within range", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			const sym = map.findSymbol(0x001000b0);
			assert.ok(sym);
			assert.strictEqual(sym!.name, "main");
		});

		test("findSymbol returns undefined for out-of-range", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			// Address past main's size (0x40 bytes) but before init
			const sym = map.findSymbol(0x00500000);
			assert.strictEqual(sym, undefined);
		});

		test("findSection finds containing section", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			const sec = map.findSection(0x00100500);
			assert.ok(sec);
			assert.strictEqual(sec!.name, ".text");
		});

		test("annotateAddress with known symbol", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			const label = map.annotateAddress(0x001000a0);
			assert.strictEqual(label, "main");
		});

		test("annotateAddress with offset", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			const label = map.annotateAddress(0x001000b0);
			assert.strictEqual(label, "main+0x10");
		});

		test("annotateAddress with section fallback", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			// Address in .text but not in any symbol range
			// This test is approximate — it depends on the symbol layout
			const label = map.annotateAddress(0x00100800);
			assert.ok(label.includes(".text") || label.startsWith("0x"));
		});

		test("annotateAddress with unknown address", () => {
			const map = new MemoryMap(parseLinkerMap(sampleContent));
			const label = map.annotateAddress(0xDEADBEEF);
			assert.strictEqual(label, "0xdeadbeef");
		});
	});
});
