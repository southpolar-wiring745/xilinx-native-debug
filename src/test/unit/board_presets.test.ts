import * as assert from 'assert';
import { detectBoardFamily } from '../../backend/xsdb/board_presets';

suite('Board Presets', () => {
	suite('detectBoardFamily', () => {
		test('Detects zynqmp from target filter', () => {
			const detected = detectBoardFamily({ targetFilter: 'Cortex-R5*' });
			assert.strictEqual(detected, 'zynqmp');
		});

		test('Detects zynq7000 from ps7 init script hint', () => {
			const detected = detectBoardFamily({ psInitScript: './hw/ps7_init.tcl' });
			assert.strictEqual(detected, 'zynq7000');
		});

		test('Detects versal from pdi bitstream', () => {
			const detected = detectBoardFamily({ bitstreamPath: './images/base.pdi' });
			assert.strictEqual(detected, 'versal');
		});

		test('Does not force zynq7000 for generic hdf without other hints', () => {
			const detected = detectBoardFamily('./export/system.hdf');
			assert.strictEqual(detected, undefined);
		});

		test('Detects zynqmp from hw design filename hints', () => {
			const detected = detectBoardFamily('./platform/zcu102_wrapper.xsa');
			assert.strictEqual(detected, 'zynqmp');
		});

		test('Detects versal from hw design filename hints', () => {
			const detected = detectBoardFamily('./platform/versal_vck190.xsa');
			assert.strictEqual(detected, 'versal');
		});
	});
});
