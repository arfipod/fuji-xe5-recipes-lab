import test from 'node:test';
import assert from 'node:assert/strict';

import { buildValidationSnapshot, sanitizeValidationValue } from '../src/core/diagnostics.js';

test('validation snapshots omit identity keys and retain only hexadecimal PTP payload evidence', () => {
  const snapshot = buildValidationSnapshot({
    validationStage: 'c-scan-complete',
    connection: { model: 'X-E5', serialNumber: 'PHYSICAL-SERIAL-MUST-NOT-CROSS' },
    discovery: { cameraSerial: 'PHYSICAL-SERIAL-MUST-NOT-CROSS' },
    scanReport: {
      slots: [{
        id: 'C1',
        rawProperties: new Map([[0xd190, {
          code: 0xd190,
          bytes: new Uint8Array([0x00, 0x02]),
          payloadWidth: 2,
        }]]),
      }],
    },
    backupReport: {
      sha256: 'a'.repeat(64),
      bytesBase64: 'must-be-omitted',
      backupBytes: new Uint8Array([1, 2, 3]),
      bytes: new Uint8Array([0xde, 0xad]),
      fsSlots: [{
        id: 'FS1',
        rawProperties: [{ key: 'dynamicRange', bytes: new Uint8Array([0x02]), payloadWidth: 1 }],
      }],
    },
  });

  const json = JSON.stringify(snapshot);
  assert.doesNotMatch(json, /PHYSICAL-SERIAL-MUST-NOT-CROSS/);
  assert.doesNotMatch(json, /serial|bytesBase64|backupBytes/i);
  assert.match(json, /00 02/);
  assert.doesNotMatch(json, /DE AD/);
  assert.match(json, /"rawHex":"02"/);
  assert.match(json, /"payloadWidth":2/);
  assert.match(json, /"sha256":"a{64}"/);
  assert.equal(snapshot.fullBackup.bytes, undefined);
  assert.equal(snapshot.readFlow, 'direct-guarded');
  assert.equal(snapshot.cSlotMenuReview, undefined);
  assert.equal(snapshot.fsMenuReview, undefined);
});

test('validation sanitization handles cyclic input without throwing', () => {
  const value = { status: 'OK' };
  value.self = value;
  assert.deepEqual(sanitizeValidationValue(value), { status: 'OK', self: '[circular]' });
});
