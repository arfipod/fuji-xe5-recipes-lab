import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBackupObjectInfo,
  buildRafObjectInfo,
  patchD185Profile,
} from '../src/camera/raw-preview.js';
import { decodePtpString, readU16, readU32 } from '../src/camera/binary.js';
import { neutralRecipeValues } from '../src/core/schema.js';

test('builds the exact-size full-backup ObjectInfo dataset', () => {
  const info = buildBackupObjectInfo(70524);
  assert.equal(info.byteLength, 1076);
  assert.equal(readU32(info, 0), 0);
  assert.equal(readU16(info, 4), 0x5000);
  assert.equal(readU32(info, 8), 70524);
  assert.ok(info.slice(12).every((byte) => byte === 0));
});

test('builds a RAF ObjectInfo dataset with Fujifilm format and filename', () => {
  const info = buildRafObjectInfo(41_000_000);
  assert.equal(readU16(info, 4), 0xf802);
  assert.equal(readU32(info, 8), 41_000_000);
  assert.equal(decodePtpString(info, 52).value, 'FUP_FILE.dat');
});

test('patches a synthetic native D185 profile without changing its size', () => {
  const profile = new Uint8Array(625);
  const count = 29;
  new DataView(profile.buffer).setUint16(0, count, true);
  const values = neutralRecipeValues();
  values.filmSimulation = 'Astia';
  values.dynamicRange = 'DR200';
  values.grainStrength = 'Weak';
  values.grainSize = 'Large';
  values.colorChrome = 'Strong';
  values.whiteBalanceMode = 'Auto';
  values.wbShiftR = 5;
  values.wbShiftB = -3;
  values.highlight = -1;
  values.shadow = -2;
  values.color = 1;
  values.sharpness = 1;
  values.highIsoNr = -3;
  values.clarity = -4;

  const patched = patchD185Profile(profile, values, { exposureEv: 1 / 3 });
  assert.equal(patched.byteLength, profile.byteLength);
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
  const offset = patched.byteLength - count * 4;
  assert.equal(view.getInt32(offset + 4 * 4, true), 333);
  assert.equal(view.getInt32(offset + 8 * 4, true), 3); // Astia PTP enum
  assert.equal(view.getInt32(offset + 9 * 4, true), 4); // Weak / Large
  assert.equal(view.getInt32(offset + 16 * 4, true), -10);
  assert.equal(view.getInt32(offset + 20 * 4, true), 0x7000);
  assert.equal(view.getInt32(offset + 27 * 4, true), -40);
});
