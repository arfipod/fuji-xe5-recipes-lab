import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeScanCapture } from '../scripts/decode-ptp-scan.mjs';

const emptyName = {
  property: { code: 0xD18D, hex: '0xD18D', name: 'FUJI_RECIPE_NAME' },
  rawHex: '01 00 00',
  payloadWidth: 3,
  rawValue: '',
  readStatus: 'OK',
};
const provia = {
  property: { code: 0xD192, hex: '0xD192', name: 'FUJI_RECIPE_FILM_SIMULATION' },
  rawHex: '01 00',
  payloadWidth: 2,
  rawValue: 1,
  readStatus: 'OK',
};

test('decodes a completed serial-free CLI scan through the maintained X-E5 codec', () => {
  const capture = {
    stage: 'CLI_C1_C7_SCAN',
    completed: true,
    model: 'X-E5',
    normalizedModel: 'XE5',
    firmware: '1.10',
    originalSlot: 1,
    originalSelectorRawHex: '01 00',
    slots: Array.from({ length: 7 }, (_, index) => ({
      id: `C${index + 1}`,
      slot: index + 1,
      selector: { confirmed: true },
      properties: [emptyName, provia],
    })),
    cleanup: { restoreConfirmed: true, sessionClosed: true },
    usb: { serial: 'MUST-NOT-CROSS' },
  };

  const decoded = decodeScanCapture(capture);
  assert.equal(decoded.slots.length, 7);
  assert.equal(decoded.slots[0].name, '');
  assert.equal(decoded.slots[0].canonical.filmSimulation, 'Provia');
  assert.equal(decoded.slots[0].initializationStatus, 'UNKNOWN_FROM_PTP');
  assert.equal(decoded.slots[0].properties[1].rawHex, '01 00');
  assert.equal(decoded.slots[0].properties[1].rawEvidenceLevel, 'PHYSICAL_X_E5');
  assert.equal(decoded.slots[0].properties[1].canonicalEvidenceLevel, 'PHYSICAL_X_E5_FW_1_10_EXACT_MENU_OBSERVATION');
  assert.equal(decoded.canonicalEvidenceLevel, 'PHYSICAL_X_E5_FW_1_10_EXACT_OBSERVATIONS_ONLY');
  assert.doesNotMatch(JSON.stringify(decoded), /MUST-NOT-CROSS/);
});
