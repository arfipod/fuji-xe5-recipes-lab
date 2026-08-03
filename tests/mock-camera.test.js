import test from 'node:test';
import assert from 'node:assert/strict';

import { MockXe5CameraClient } from '../src/camera/mock-camera.js';
import { neutralRecipeValues } from '../src/core/schema.js';

test('mock camera exercises C-slot backup, write, and read-back flow', async () => {
  const camera = new MockXe5CameraClient();
  const info = await camera.connect();
  assert.equal(info.connected, true);

  const before = await camera.readCSlot(7);
  const values = neutralRecipeValues();
  values.filmSimulation = 'Astia';
  values.dynamicRange = 'DR200';
  values.highlight = -1;
  values.shadow = -2;
  values.color = 1;
  values.sharpness = 1;
  values.highIsoNr = -3;
  values.grainStrength = 'Weak';
  values.grainSize = 'Small';

  const result = await camera.writeCSlot(7, 'ASTIA LAB', values);
  assert.equal(result.verification.ok, true);
  assert.equal(before.id, 'C7');
  const after = await camera.readCSlot(7);
  assert.equal(after.name, 'ASTIA LAB');
  assert.equal(after.values.filmSimulation, 'Astia');
  assert.equal(after.values.highlight, -1);
});

test('mock camera exercises X-E5 FS backup patch, restore, and persistence verification', async () => {
  const camera = new MockXe5CameraClient();
  await camera.connect();
  const values = neutralRecipeValues();
  values.filmSimulation = 'NostalgicNeg';
  values.dynamicRange = 'DR100';
  values.grainStrength = 'Weak';
  values.grainSize = 'Large';
  values.colorChrome = 'Strong';
  values.colorChromeBlue = 'Weak';
  values.whiteBalanceMode = 'Temperature';
  values.whiteBalanceKelvin = 5900;
  values.wbShiftR = -1;
  values.wbShiftB = -6;
  values.highlight = 2;
  values.shadow = -2;
  values.color = -2;
  values.sharpness = -4;
  values.highIsoNr = -4;
  values.clarity = -4;

  const prepared = await camera.prepareFsWrite(3, values);
  assert.equal(prepared.before.size, 70524);
  assert.ok(prepared.changes.some((change) => change.field === 'checksum'));

  const restore = await camera.restoreFullBackup(prepared.target.bytes);
  assert.equal(restore.accepted, true);
  assert.equal(camera.getConnectionInfo().connected, false);

  const verification = await camera.verifyFsSlotAfterReconnect(3, values);
  assert.equal(verification.verification.ok, true);
  assert.equal(verification.slot.values.whiteBalanceKelvin, 5900);
  assert.equal(verification.slot.values.grainSize, 'Large');
});
