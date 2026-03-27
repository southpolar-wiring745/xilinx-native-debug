import * as assert from 'assert';
import {
	getRegisterGroups,
	getPeripheralGroups,
	isMinimalRegister,
	inferRegisterArchitecture,
} from '../../backend/xsdb/zynq_registers';

suite("Zynq Registers", () => {

	suite("getRegisterGroups", () => {
		test("Returns minimal groups (3 groups for zynq7000)", () => {
			const groups = getRegisterGroups("zynq7000", "minimal");
			assert.ok(groups.length <= 3);
			assert.ok(groups.length > 0);
			const names = groups.map(g => g.label);
			assert.ok(names.includes("General Purpose"));
			assert.ok(names.includes("Stack / Link / PC"));
		});

		test("Returns core groups (no allOnly) for zynq7000", () => {
			const groups = getRegisterGroups("zynq7000", "core");
			assert.ok(groups.length > 0);
			for (const g of groups) {
				assert.strictEqual(g.allOnly, undefined, `Group '${g.label}' should not be allOnly in core preset`);
			}
		});

		test("Returns all groups for zynq7000", () => {
			const groups = getRegisterGroups("zynq7000", "all");
			assert.ok(groups.length > 5); // Should include banked, VFP, CP15
			const labels = groups.map(g => g.label);
			assert.ok(labels.includes("VFP / NEON"));
			assert.ok(labels.includes("Banked (FIQ)"));
		});

		test("Uses A53-64 groups for zynqmp by default", () => {
			const groups = getRegisterGroups("zynqmp", "core");
			const gpGroup = groups.find(g => g.label === "General Purpose");
			assert.ok(gpGroup);
			assert.ok(gpGroup!.names.includes("x0")); // AArch64 register
			assert.ok(!gpGroup!.names.includes("r0")); // Not AArch32
		});

		test("Uses A53-32 groups when architecture is cortex-a53-32", () => {
			const groups = getRegisterGroups("zynqmp", "core", "cortex-a53-32");
			const gpGroup = groups.find(g => g.label === "General Purpose");
			assert.ok(gpGroup);
			assert.ok(gpGroup!.names.includes("r0"));
			assert.ok(!gpGroup!.names.includes("x0"));
		});

		test("Uses R5 groups when architecture is cortex-r5", () => {
			const groups = getRegisterGroups("zynqmp", "all", "cortex-r5");
			const labels = groups.map(g => g.label);
			assert.ok(labels.includes("CP15 / MPU"));
			assert.ok(labels.includes("Banked (FIQ)"));
		});

		test("Uses A53 groups for versal", () => {
			const groups = getRegisterGroups("versal", "all");
			const fpGroup = groups.find(g => g.label === "FP / SIMD");
			assert.ok(fpGroup);
			assert.ok(fpGroup!.names.includes("v0"));
		});

		test("Defaults to A9 groups for unknown board", () => {
			const groups = getRegisterGroups(undefined, "core");
			const gpGroup = groups.find(g => g.label === "General Purpose");
			assert.ok(gpGroup);
			assert.ok(gpGroup!.names.includes("r0")); // AArch32
		});
	});

	suite("inferRegisterArchitecture", () => {
		test("Detects Cortex-R5 from target name", () => {
			const arch = inferRegisterArchitecture("zynqmp", "Cortex-R5 #0");
			assert.strictEqual(arch, "cortex-r5");
		});

		test("Detects A53-32 from register names", () => {
			const arch = inferRegisterArchitecture("zynqmp", undefined, ["r0", "r1", "r15", "cpsr"]);
			assert.strictEqual(arch, "cortex-a53-32");
		});

		test("Detects A53-64 from register names", () => {
			const arch = inferRegisterArchitecture("zynqmp", undefined, ["x0", "x30", "cpsr"]);
			assert.strictEqual(arch, "cortex-a53-64");
		});

		test("Maps zynq7000 32-bit detection to Cortex-A9", () => {
			const arch = inferRegisterArchitecture("zynq7000", undefined, ["r0", "r1", "r15", "cpsr"]);
			assert.strictEqual(arch, "cortex-a9");
		});
	});

	suite("isMinimalRegister", () => {
		test("Recognizes core registers", () => {
			assert.ok(isMinimalRegister("r0"));
			assert.ok(isMinimalRegister("sp"));
			assert.ok(isMinimalRegister("lr"));
			assert.ok(isMinimalRegister("pc"));
			assert.ok(isMinimalRegister("cpsr"));
		});

		test("Rejects non-minimal registers", () => {
			assert.ok(!isMinimalRegister("spsr_fiq"));
			assert.ok(!isMinimalRegister("d0"));
			assert.ok(!isMinimalRegister("sctlr"));
		});

		test("Uses architecture-specific minimal sets", () => {
			assert.ok(isMinimalRegister("x0", "cortex-a53-64"));
			assert.ok(!isMinimalRegister("x0", "cortex-a9"));
			assert.ok(isMinimalRegister("r0", "cortex-r5"));
		});
	});

	suite("getPeripheralGroups", () => {
		test("Returns Zynq-7000 peripherals by default", () => {
			const groups = getPeripheralGroups("zynq7000");
			assert.ok(groups.length > 0);
			const labels = groups.map(g => g.label);
			assert.ok(labels.some(l => l.includes("SLCR")));
			assert.ok(labels.some(l => l.includes("UART")));
			assert.ok(labels.some(l => l.includes("GIC")));
		});

		test("Returns ZynqMP peripherals", () => {
			const groups = getPeripheralGroups("zynqmp");
			assert.ok(groups.length > 0);
			const labels = groups.map(g => g.label);
			assert.ok(labels.some(l => l.includes("CRL_APB")));
		});

		test("Each peripheral group has valid registers", () => {
			const groups = getPeripheralGroups("zynq7000");
			for (const g of groups) {
				assert.ok(g.registers.length > 0, `Group '${g.label}' has no registers`);
				for (const reg of g.registers) {
					assert.ok(reg.address > 0, `Register '${reg.name}' in '${g.label}' has invalid address`);
					assert.ok(reg.name.length > 0, `Register in '${g.label}' has empty name`);
				}
			}
		});

		test("Zynq-7000 peripheral addresses fall in known PS/GIC ranges", () => {
			const groups = getPeripheralGroups("zynq7000");
			for (const group of groups) {
				for (const reg of group.registers) {
					const addr = reg.address >>> 0;
					const inPsRange = (addr >= 0xE0000000 && addr <= 0xE02FFFFF) || (addr >= 0xF8000000 && addr <= 0xF8FFFFFF);
					assert.ok(inPsRange, `Unexpected Zynq-7000 peripheral address 0x${addr.toString(16).toUpperCase()} for '${reg.name}'`);
				}
			}
		});

		test("ZynqMP peripheral addresses fall in known LPD/FPD/GIC ranges", () => {
			const groups = getPeripheralGroups("zynqmp");
			for (const group of groups) {
				for (const reg of group.registers) {
					const addr = reg.address >>> 0;
					const inZynqMpRange = (addr >= 0xFD000000 && addr <= 0xFDFFFFFF)
						|| (addr >= 0xFF000000 && addr <= 0xFFFFFFFF)
						|| (addr >= 0xF9000000 && addr <= 0xF90FFFFF);
					assert.ok(inZynqMpRange, `Unexpected ZynqMP peripheral address 0x${addr.toString(16).toUpperCase()} for '${reg.name}'`);
				}
			}
		});

		test("Falls back to zynq7000 for undefined board", () => {
			const groups = getPeripheralGroups(undefined);
			assert.ok(groups.length > 0);
			const labels = groups.map(g => g.label);
			assert.ok(labels.some(l => l.includes("SLCR")));
		});
	});
});
