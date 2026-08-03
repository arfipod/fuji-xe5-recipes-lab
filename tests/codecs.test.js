import test from 'node:test';
import assert from 'node:assert/strict';

import { neutralRecipeValues } from '../src/core/schema.js';
import { decodePtpString, encodePtpString, packI16, packU16, readU16 } from '../src/camera/binary.js';
import {
  C_EVIDENCE_LEVEL,
  PTP_PROP,
  X_E5_FS_LAYOUT,
  applyCSlotMenuStatus,
  applyFsRecipeMenuStatus,
  assertXe5Backup,
  buildCSlotWritePlan,
  decodeCSlotProperties,
  describeCSlotProperty,
  decodeFsSlot,
  decodeFsSlots,
  modelFromBackup,
  patchFsSlot,
} from '../src/camera/x-e5-codecs.js';
import { PTP_CONTAINER, packContainer, unpackContainer } from '../src/camera/ptp.js';

function rawMap(values) {
  return new Map(Object.entries(values).map(([code, bytes]) => [Number(code), { code: Number(code), bytes, value: null }]));
}

function blankBackup() {
  const blob = new Uint8Array(X_E5_FS_LAYOUT.blobSize);
  blob.set(new TextEncoder().encode('FUJIFILMX-BACKUP0100').slice(0, 0x14), 0);
  blob.set(new TextEncoder().encode('X-E5\0'), 0x14);
  new DataView(blob.buffer).setUint16(X_E5_FS_LAYOUT.checksumOffset, 0x1000, true);
  return blob;
}

test('decodes only the exact C1 values observed on the physical X-E5 firmware 1.10', () => {
  const properties = rawMap({
    [PTP_PROP.IMAGE_SIZE]: packU16(7),
    [PTP_PROP.IMAGE_QUALITY]: packU16(2),
    [PTP_PROP.DYNAMIC_RANGE]: packU16(100),
    [PTP_PROP.D_RANGE_PRIORITY]: packU16(0),
    [PTP_PROP.FILM_SIMULATION]: packU16(1),
    [PTP_PROP.GRAIN]: packU16(5),
    [PTP_PROP.COLOR_CHROME]: packU16(2),
    [PTP_PROP.COLOR_CHROME_BLUE]: packU16(3),
    [PTP_PROP.SMOOTH_SKIN]: packU16(1),
    [PTP_PROP.WHITE_BALANCE]: packU16(0x8007),
    [PTP_PROP.WB_SHIFT_R]: packI16(-4),
    [PTP_PROP.WB_SHIFT_B]: packI16(1),
    [PTP_PROP.WB_COLOR_TEMP]: packU16(7500),
    [PTP_PROP.HIGHLIGHT]: packI16(-20),
    [PTP_PROP.SHADOW]: packI16(-20),
    [PTP_PROP.COLOR]: packI16(-30),
    [PTP_PROP.SHARPNESS]: packI16(-40),
    [PTP_PROP.HIGH_ISO_NR]: packU16(0x8000),
    [PTP_PROP.CLARITY]: packI16(-40),
    [PTP_PROP.LONG_EXPOSURE_NR]: packU16(1),
    [PTP_PROP.COLOR_SPACE]: packU16(1),
  });
  const values = decodeCSlotProperties(properties);
  assert.equal(values.imageSize, 'L 3:2');
  assert.equal(values.imageQuality, 'F');
  assert.equal(values.filmSimulation, 'Provia');
  assert.equal(values.dynamicRange, 'DR100');
  assert.equal(values.grainStrength, 'Strong');
  assert.equal(values.grainSize, 'Large');
  assert.equal(values.colorChrome, 'Weak');
  assert.equal(values.colorChromeBlue, 'Strong');
  assert.equal(values.smoothSkin, 'Off');
  assert.equal(values.whiteBalanceMode, 'Temperature');
  assert.equal(values.whiteBalanceKelvin, 7500);
  assert.equal(values.wbShiftR, -4);
  assert.equal(values.wbShiftB, 1);
  assert.equal(values.highlight, -2);
  assert.equal(values.shadow, -2);
  assert.equal(values.color, -3);
  assert.equal(values.sharpness, -4);
  assert.equal(values.highIsoNr, -4);
  assert.equal(values.clarity, -4);
  assert.equal(values.longExposureNr, 'On');
  assert.equal(values.colorSpace, 'sRGB');
});

test('decodes the exact owner-created Classic Chrome C7 target observed on the physical X-E5', () => {
  const properties = rawMap({
    [PTP_PROP.IMAGE_SIZE]: packU16(7),
    [PTP_PROP.IMAGE_QUALITY]: packU16(2),
    [PTP_PROP.DYNAMIC_RANGE]: packU16(400),
    [PTP_PROP.D_RANGE_PRIORITY]: packU16(0),
    [PTP_PROP.FILM_SIMULATION]: packU16(0x0b),
    [PTP_PROP.GRAIN]: packU16(3),
    [PTP_PROP.COLOR_CHROME]: packU16(3),
    [PTP_PROP.COLOR_CHROME_BLUE]: packU16(1),
    [PTP_PROP.SMOOTH_SKIN]: packU16(1),
    [PTP_PROP.WHITE_BALANCE]: packU16(0x8007),
    [PTP_PROP.WB_SHIFT_R]: packI16(1),
    [PTP_PROP.WB_SHIFT_B]: packI16(-6),
    [PTP_PROP.WB_COLOR_TEMP]: packU16(5200),
    [PTP_PROP.HIGHLIGHT]: packI16(0),
    [PTP_PROP.SHADOW]: packI16(-20),
    [PTP_PROP.COLOR]: packI16(20),
    [PTP_PROP.SHARPNESS]: packI16(-20),
    [PTP_PROP.HIGH_ISO_NR]: packU16(0x8000),
    [PTP_PROP.CLARITY]: packI16(-20),
    [PTP_PROP.LONG_EXPOSURE_NR]: packU16(1),
    [PTP_PROP.COLOR_SPACE]: packU16(1),
  });

  assert.deepEqual(decodeCSlotProperties(properties), {
    imageSize: 'L 3:2',
    imageQuality: 'F',
    filmSimulation: 'ClassicChrome',
    dynamicRange: 'DR400',
    dRangePriority: 'Off',
    grainStrength: 'Strong',
    grainSize: 'Small',
    colorChrome: 'Strong',
    colorChromeBlue: 'Off',
    smoothSkin: 'Off',
    whiteBalanceMode: 'Temperature',
    whiteBalanceKelvin: 5200,
    wbShiftR: 1,
    wbShiftB: -6,
    highlight: 0,
    shadow: -2,
    color: 2,
    sharpness: -2,
    highIsoNr: -4,
    clarity: -2,
    monoWarmCool: null,
    monoMagentaGreen: null,
    longExposureNr: 'On',
    colorSpace: 'sRGB',
    isoMode: null,
    isoFixed: null,
    isoMin: null,
    isoMax: null,
    exposureMinEv: null,
    exposureMaxEv: null,
    exposureTypical: null,
  });
});

test('preserves arbitrary-width passthrough payloads without assuming uint16', () => {
  const bytes = new Uint8Array([0x01, 0x23, 0x45, 0x67]);
  const diagnostic = describeCSlotProperty(PTP_PROP.UNKNOWN_D1A5, bytes, {});
  assert.equal(diagnostic.payloadWidth, 4);
  assert.equal(diagnostic.encoding, 'passthrough');
  assert.equal(diagnostic.rawHex, '01 23 45 67');
  assert.equal(diagnostic.rawValue, '01 23 45 67');
  assert.match(diagnostic.uncertainty, /preserved/);
  assert.equal(diagnostic.evidenceLevel, C_EVIDENCE_LEVEL);
  assert.match(diagnostic.researchSource, /physical X-E5 .*menus/);
});

test('strictly validates complete PTP strings while retaining sequential dataset parsing', () => {
  const encoded = encodePtpString('C7 test');
  assert.deepEqual(decodePtpString(encoded, 0, { requireExact: true }), { value: 'C7 test', offset: encoded.byteLength });
  assert.deepEqual(decodePtpString(new Uint8Array([0]), 0, { requireExact: true }), { value: '', offset: 1 });

  const withTrailingByte = new Uint8Array([...encoded, 0xff]);
  assert.equal(decodePtpString(withTrailingByte).value, 'C7 test');
  assert.throws(() => decodePtpString(withTrailingByte, 0, { requireExact: true }), /trailing/i);
  assert.throws(() => decodePtpString(new Uint8Array(), 0, { requireExact: true }), /length byte/i);
  assert.throws(() => decodePtpString(new Uint8Array([2, 0x43, 0x00, 0x37, 0x00]), 0, { requireExact: true }), /terminator/i);
  assert.throws(() => decodePtpString(new Uint8Array([3, 0x43, 0x00, 0x00, 0x00, 0x00, 0x00]), 0, { requireExact: true }), /embedded NUL/i);
});

test('rejects malformed D18D payloads instead of treating them as slot names', () => {
  const diagnostic = describeCSlotProperty(
    PTP_PROP.PRESET_NAME,
    new Uint8Array([2, 0x43, 0x00, 0x37, 0x00]),
  );
  assert.equal(diagnostic.rawValue, null);
  assert.deepEqual(diagnostic.decoded, []);
  assert.match(diagnostic.uncertainty, /Malformed PTP string/);
});

test('does not decode known scalars with an unexpected payload width', () => {
  const properties = rawMap({
    [PTP_PROP.DYNAMIC_RANGE]: new Uint8Array([100, 0, 99]),
    [PTP_PROP.GRAIN]: packU16(0x1234),
  });
  const values = decodeCSlotProperties(properties);
  assert.equal(values.dynamicRange, null);
  assert.equal(values.grainStrength, null);
  assert.equal(values.grainSize, null);

  const diagnostic = describeCSlotProperty(PTP_PROP.DYNAMIC_RANGE, properties.get(PTP_PROP.DYNAMIC_RANGE).bytes, values);
  assert.equal(diagnostic.rawValue, null);
  assert.equal(diagnostic.payloadWidth, 3);
  assert.match(diagnostic.uncertainty, /No numeric decode/);
});

test('keeps plausible but unobserved C-slot enums as passthrough', () => {
  const unobservedProperties = rawMap({
    [PTP_PROP.FILM_SIMULATION]: packU16(5),
    [PTP_PROP.DYNAMIC_RANGE]: packU16(200),
    [PTP_PROP.GRAIN]: packU16(4),
    [PTP_PROP.WHITE_BALANCE]: packU16(2),
    [PTP_PROP.WB_COLOR_TEMP]: packU16(5600),
    [PTP_PROP.WB_SHIFT_R]: packI16(2),
  });
  const values = decodeCSlotProperties(unobservedProperties);
  assert.equal(values.filmSimulation, null);
  assert.equal(values.dynamicRange, null);
  assert.equal(values.grainStrength, null);
  assert.equal(values.whiteBalanceMode, null);
  assert.equal(values.whiteBalanceKelvin, null);
  assert.equal(values.wbShiftR, null);

  for (const code of [PTP_PROP.FILM_SIMULATION, PTP_PROP.DYNAMIC_RANGE, PTP_PROP.GRAIN, PTP_PROP.WHITE_BALANCE, PTP_PROP.WB_SHIFT_R]) {
    const diagnostic = describeCSlotProperty(code, unobservedProperties.get(code).bytes, values);
    assert.ok(diagnostic.decoded.every((item) => item.status === 'unknown-enum'));
    assert.match(diagnostic.uncertainty, /not been mapped by physical X-E5 evidence/);
  }
});

test('keeps film- and white-balance-dependent values unknown until their selectors decode', () => {
  const unknownProperties = rawMap({
    [PTP_PROP.FILM_SIMULATION]: packU16(0xffff),
    [PTP_PROP.COLOR]: packI16(10),
    [PTP_PROP.MONO_WC]: packI16(20),
    [PTP_PROP.WHITE_BALANCE]: packU16(0xffff),
    [PTP_PROP.WB_COLOR_TEMP]: packU16(5600),
  });
  const unknown = decodeCSlotProperties(unknownProperties);
  assert.equal(unknown.color, null);
  assert.equal(unknown.monoWarmCool, null);
  assert.equal(unknown.whiteBalanceKelvin, null);

  for (const [code, pattern] of [
    [PTP_PROP.COLOR, /Film Simulation is unknown/],
    [PTP_PROP.MONO_WC, /Film Simulation is unknown/],
    [PTP_PROP.WB_COLOR_TEMP, /White Balance mode is unknown/],
  ]) {
    const diagnostic = describeCSlotProperty(code, unknownProperties.get(code).bytes, unknown);
    assert.equal(diagnostic.decoded[0].status, 'unknown-enum');
    assert.match(diagnostic.uncertainty, pattern);
  }

  const knownSelectors = { filmSimulation: 'Provia', whiteBalanceMode: 'Auto' };
  assert.equal(describeCSlotProperty(PTP_PROP.MONO_WC, packI16(20), knownSelectors).decoded[0].status, 'not-applicable');
  assert.equal(describeCSlotProperty(PTP_PROP.WB_COLOR_TEMP, packU16(5600), knownSelectors).decoded[0].status, 'not-applicable');
});

test('reports explicit-selector physical X-E5 mappings and confirmed Kelvin detail', () => {
  const grain = describeCSlotProperty(PTP_PROP.GRAIN, packU16(5), { grainStrength: 'Strong', grainSize: 'Large' });
  assert.match(grain.normalization, /displayed Grain Effect Strong \/ Large/);
  assert.match(grain.normalization, /explicit C1 selector write/);
  assert.equal(grain.uncertainty, null);
  const dynamicRange = describeCSlotProperty(PTP_PROP.DYNAMIC_RANGE, packU16(100), { dynamicRange: 'DR100' });
  assert.equal(dynamicRange.decoded[0].canonicalValue, 'DR100');
  assert.match(dynamicRange.normalization, /displayed DR100/);
  const kelvin = describeCSlotProperty(PTP_PROP.WB_COLOR_TEMP, packU16(7500), {
    whiteBalanceMode: 'Temperature',
    whiteBalanceKelvin: 7500,
  });
  assert.equal(kelvin.uncertainty, null);
  assert.match(kelvin.normalization, /displayed 7500 K/);
});

test('a saved C-bank menu review keeps decoded values active and preserves raw evidence', () => {
  const rawProperties = rawMap({
    [PTP_PROP.DYNAMIC_RANGE]: packU16(100),
  });
  const slot = {
    id: 'C1',
    values: { filmSimulation: 'Provia', dynamicRange: 'DR100' },
    rawProperties,
    propertyDiagnostics: [...rawProperties.values()],
    readStatus: 'COMPLETE',
  };

  const reviewed = applyCSlotMenuStatus(slot, 'SAVED');
  assert.equal(reviewed.initializationStatus, 'SAVED');
  assert.equal(reviewed.valuesActive, true);
  assert.equal(reviewed.values.dynamicRange, 'DR100');
  assert.equal(reviewed.decodedValues.dynamicRange, 'DR100');
  assert.equal(reviewed.readStatus, 'COMPLETE');
  assert.equal(reviewed.rawProperties.get(PTP_PROP.DYNAMIC_RANGE).activationStatus, 'ACTIVE');
  assert.deepEqual([...reviewed.rawProperties.get(PTP_PROP.DYNAMIC_RANGE).bytes], [100, 0]);
});

test('a CREATE NEW C-bank review exposes no latent bytes as current recipe values', () => {
  const rawProperties = rawMap({
    [PTP_PROP.FILM_SIMULATION]: packU16(1),
    [PTP_PROP.DYNAMIC_RANGE]: packU16(100),
  });
  const slot = {
    id: 'C2',
    values: { filmSimulation: 'Provia', dynamicRange: 'DR100', whiteBalanceMode: null },
    rawProperties,
    propertyDiagnostics: [...rawProperties.values()],
    readStatus: 'COMPLETE',
  };

  const reviewed = applyCSlotMenuStatus(slot, 'CREATE_NEW');
  assert.equal(reviewed.initializationStatus, 'CREATE_NEW');
  assert.equal(reviewed.menuStateLabel, 'CREATE NEW');
  assert.equal(reviewed.valuesActive, false);
  assert.deepEqual(reviewed.values, { filmSimulation: null, dynamicRange: null, whiteBalanceMode: null });
  assert.equal(reviewed.decodedValues.filmSimulation, 'Provia');
  assert.equal(reviewed.decodedValues.dynamicRange, 'DR100');
  assert.equal(reviewed.readStatus, 'UNINITIALIZED_RAW_ONLY');
  for (const property of reviewed.rawProperties.values()) {
    assert.equal(property.activationStatus, 'LATENT_CREATE_NEW');
    assert.match(property.uncertainty, /not a current recipe value/);
  }
  assert.deepEqual([...reviewed.rawProperties.get(PTP_PROP.DYNAMIC_RANGE).bytes], [100, 0]);
  assert.equal(reviewed.propertyDiagnostics.length, 2);
});

test('C-bank menu review rejects an unknown status', () => {
  assert.throws(() => applyCSlotMenuStatus({ values: {} }, 'UNKNOWN'), /Unsupported C-slot menu status/);
});

test('builds an ordered C-slot write plan with WB temperature before shifts', () => {
  const values = neutralRecipeValues();
  Object.assign(values, {
    filmSimulation: 'NostalgicNeg',
    dynamicRange: 'DR100',
    dRangePriority: 'Off',
    grainStrength: 'Weak',
    grainSize: 'Large',
    colorChrome: 'Strong',
    colorChromeBlue: 'Weak',
    whiteBalanceMode: 'Temperature',
    whiteBalanceKelvin: 5900,
    wbShiftR: -1,
    wbShiftB: -6,
    highlight: 2,
    shadow: -2,
    color: -2,
    sharpness: -4,
    highIsoNr: -4,
    clarity: -4,
  });
  const plan = buildCSlotWritePlan(values, null);
  assert.equal(plan.operations[0].code, PTP_PROP.FILM_SIMULATION);
  assert.ok(plan.operations.findIndex((item) => item.code === PTP_PROP.WB_COLOR_TEMP) < plan.operations.findIndex((item) => item.code === PTP_PROP.WB_SHIFT_R));
  assert.equal(readU16(plan.operations.find((item) => item.code === PTP_PROP.GRAIN).bytes), 4);
  assert.equal(readU16(plan.operations.find((item) => item.code === PTP_PROP.HIGH_ISO_NR).bytes), 0x8000);
});

test('patches and decodes an X-E5 FS slot round trip', () => {
  const values = neutralRecipeValues();
  Object.assign(values, {
    filmSimulation: 'ClassicNeg',
    dynamicRange: 'DR200',
    dRangePriority: 'Off',
    grainStrength: 'Weak',
    grainSize: 'Large',
    colorChrome: 'Strong',
    colorChromeBlue: 'Weak',
    smoothSkin: 'Strong',
    whiteBalanceMode: 'Temperature',
    whiteBalanceKelvin: 5000,
    wbShiftR: 2,
    wbShiftB: -1,
    highlight: -1.5,
    shadow: 1,
    color: 3,
    sharpness: -2,
    highIsoNr: -3,
    clarity: 4,
  });
  const before = blankBackup();
  const result = patchFsSlot(before, 2, values);
  const decoded = decodeFsSlot(result.blob, 2);
  assert.equal(decoded.filmSimulation, 'ClassicNeg');
  assert.equal(decoded.dynamicRange, 'DR200');
  assert.equal(decoded.whiteBalanceKelvin, 5000);
  assert.equal(decoded.wbShiftR, 2);
  assert.equal(decoded.wbShiftB, -1);
  assert.equal(decoded.highlight, -1.5);
  assert.equal(decoded.shadow, 1);
  assert.equal(decoded.color, 3);
  assert.equal(decoded.sharpness, -2);
  assert.equal(decoded.highIsoNr, -3);
  assert.equal(decoded.clarity, 4);
  assert.ok(result.changes.some((change) => change.field === 'checksum'));
});

test('FS decoding preserves exact field evidence and never invents D-Range Priority', () => {
  const blob = blankBackup();
  blob[X_E5_FS_LAYOUT.recipeEnabledBySlot[0].offset] = 1;
  blob[X_E5_FS_LAYOUT.fields.filmSimulation.offset] = 0x10;
  blob[X_E5_FS_LAYOUT.fields.whiteBalanceMode.offset] = 0x0a;
  new DataView(blob.buffer).setUint16(X_E5_FS_LAYOUT.fields.whiteBalanceKelvin.offset, 5000, true);

  const [slot] = decodeFsSlots(blob);
  const kelvin = slot.rawProperties.find((property) => property.key === 'whiteBalanceKelvin');
  const priority = slot.rawProperties.find((property) => property.key === 'dRangePriority');

  assert.equal(slot.values.dRangePriority, null);
  assert.equal(slot.rawProperties.length, Object.keys(X_E5_FS_LAYOUT.fields).length + 2);
  assert.equal(kelvin.offset, X_E5_FS_LAYOUT.fields.whiteBalanceKelvin.offset);
  assert.equal(kelvin.payloadWidth, 2);
  assert.equal(kelvin.rawHex, '88 13');
  assert.equal(kelvin.rawValue, 5000);
  assert.equal(kelvin.canonicalValue, 5000);
  assert.equal(kelvin.readStatus, 'OK');
  assert.equal(kelvin.evidenceLevel, 'PUBLIC_RESEARCH');
  assert.match(kelvin.researchSource, /pending confirmation/);
  assert.equal(priority.payloadWidth, null);
  assert.equal(priority.readStatus, 'UNAVAILABLE');
  assert.match(priority.uncertainty, /not inferred as Off/);
});

test('an FS RECIPE Off menu review keeps only the film assignment active', () => {
  const blob = blankBackup();
  blob[X_E5_FS_LAYOUT.fields.filmSimulation.offset] = 0x01;
  blob[X_E5_FS_LAYOUT.fields.dynamicRange.offset] = 1;
  blob[X_E5_FS_LAYOUT.fields.whiteBalanceMode.offset] = 0;
  const [decoded] = decodeFsSlots(blob);
  assert.equal(decoded.fsRecipeStatus, 'OFF');
  assert.equal(decoded.valuesActive, false);
  assert.equal(decoded.values.dynamicRange, null);
  assert.equal(decoded.decodedValues.dynamicRange, 'DR100');

  const reviewed = applyFsRecipeMenuStatus(decoded, 'OFF');
  assert.equal(reviewed.fsRecipeStatus, 'OFF');
  assert.equal(reviewed.valuesActive, false);
  assert.equal(reviewed.values.filmSimulation, 'Provia');
  assert.equal(reviewed.values.dynamicRange, null);
  assert.equal(reviewed.decodedValues.dynamicRange, 'DR100');
  assert.equal(reviewed.rawProperties.find((property) => property.key === 'dynamicRange').activationStatus, 'LATENT_FS_RECIPE_OFF');
  assert.equal(reviewed.rawProperties.find((property) => property.key === 'filmSimulation').activationStatus, 'ACTIVE');
  assert.match(reviewed.activationUncertainty, /Only the film-simulation assignment is active/);
});

test('physically mapped FS1 and FS3 RECIPE flags decode both directions without guessing FS2', () => {
  const blob = blankBackup();
  const fs1Flag = X_E5_FS_LAYOUT.recipeEnabledBySlot[0];
  const fs3Flag = X_E5_FS_LAYOUT.recipeEnabledBySlot[2];
  assert.equal(fs1Flag.offset, 34500);
  assert.equal(X_E5_FS_LAYOUT.recipeEnabledBySlot[1], null);
  assert.equal(fs3Flag.offset, 34502);

  blob[fs1Flag.offset] = 1;
  let slots = decodeFsSlots(blob);
  assert.equal(slots[0].fsRecipeStatus, 'ON');
  assert.equal(slots[0].valuesActive, true);
  assert.equal(slots[0].rawProperties.find((property) => property.key === 'fsRecipeEnabled').rawHex, '01');
  assert.equal(slots[0].rawProperties.find((property) => property.key === 'fsRecipeEnabled').evidenceLevel, 'PHYSICAL_X_E5_FW_1_10');
  assert.equal(slots[1].fsRecipeStatus, 'UNKNOWN_FROM_BACKUP');
  assert.equal(slots[2].fsRecipeStatus, 'OFF');
  assert.equal(slots[1].rawProperties.find((property) => property.key === 'fsRecipeEnabled').offset, null);

  blob[fs1Flag.offset] = 0;
  slots = decodeFsSlots(blob);
  assert.equal(slots[0].fsRecipeStatus, 'OFF');
  assert.equal(slots[0].valuesActive, false);
  assert.equal(slots[0].rawProperties.find((property) => property.key === 'fsRecipeEnabled').rawHex, '00');

  blob[fs1Flag.offset] = 2;
  slots = decodeFsSlots(blob);
  assert.equal(slots[0].fsRecipeStatus, 'UNKNOWN_FROM_BACKUP');
  assert.equal(slots[0].valuesActive, null);
  assert.equal(slots[0].rawProperties.find((property) => property.key === 'fsRecipeEnabled').readStatus, 'PASSTHROUGH');

  blob[fs3Flag.offset] = 1;
  slots = decodeFsSlots(blob);
  assert.equal(slots[2].fsRecipeStatus, 'ON');
  assert.equal(slots[2].valuesActive, true);
  assert.equal(slots[2].rawProperties.find((property) => property.key === 'fsRecipeEnabled').rawHex, '01');
  assert.match(slots[2].rawProperties.find((property) => property.key === 'fsRecipeEnabled').researchSource, /FS3 On→Off/);

  blob[fs3Flag.offset] = 0;
  slots = decodeFsSlots(blob);
  assert.equal(slots[2].fsRecipeStatus, 'OFF');
  assert.equal(slots[2].valuesActive, false);

  blob[fs3Flag.offset] = 2;
  slots = decodeFsSlots(blob);
  assert.equal(slots[2].fsRecipeStatus, 'UNKNOWN_FROM_BACKUP');
  assert.equal(slots[2].valuesActive, null);
});

test('decodes the exact enabled FS1 Classic Chrome target as physical X-E5 evidence', () => {
  const blob = blankBackup();
  const fields = X_E5_FS_LAYOUT.fields;
  blob[X_E5_FS_LAYOUT.recipeEnabledBySlot[0].offset] = 1;
  blob[fields.filmSimulation.offset] = 0x0f;
  new DataView(blob.buffer).setUint16(fields.whiteBalanceKelvin.offset, 5200, true);
  blob[fields.whiteBalanceMode.offset] = 0x0a;
  blob[fields.highIsoNr.offset] = 0;
  blob[fields.clarity.offset] = 4;
  blob[fields.dynamicRange.offset] = 3;
  blob[fields.color.offset] = 5;
  blob[fields.sharpness.offset] = 6;
  blob[fields.highlight.offset] = 4;
  blob[fields.shadow.offset] = 0;
  blob[fields.colorChrome.offset] = 2;
  blob[fields.colorChromeBlue.offset] = 0;
  blob[fields.grainStrength.offset] = 0;
  blob[fields.grainSize.offset] = 0;
  blob[fields.smoothSkin.offset] = 0;
  blob[fields.wbShiftR.offset] = 8;
  blob[fields.wbShiftB.offset] = 15;

  const [slot] = decodeFsSlots(blob);
  assert.equal(slot.fsRecipeStatus, 'ON');
  assert.deepEqual(
    Object.fromEntries([
      'filmSimulation', 'dynamicRange', 'grainStrength', 'grainSize', 'colorChrome',
      'colorChromeBlue', 'smoothSkin', 'whiteBalanceMode', 'whiteBalanceKelvin',
      'wbShiftR', 'wbShiftB', 'highlight', 'shadow', 'color', 'sharpness',
      'highIsoNr', 'clarity',
    ].map((key) => [key, slot.values[key]])),
    {
      filmSimulation: 'ClassicChrome',
      dynamicRange: 'DR400',
      grainStrength: 'Strong',
      grainSize: 'Small',
      colorChrome: 'Strong',
      colorChromeBlue: 'Off',
      smoothSkin: 'Off',
      whiteBalanceMode: 'Temperature',
      whiteBalanceKelvin: 5200,
      wbShiftR: 1,
      wbShiftB: -6,
      highlight: 0,
      shadow: -2,
      color: 2,
      sharpness: -2,
      highIsoNr: -4,
      clarity: -2,
    },
  );
  for (const key of ['filmSimulation', 'dynamicRange', 'color', 'sharpness', 'wbShiftR', 'wbShiftB']) {
    const property = slot.rawProperties.find((item) => item.key === key);
    assert.equal(property.evidenceLevel, 'PHYSICAL_X_E5_FW_1_10');
    assert.match(property.researchSource, /enabled FS1 Classic Chrome target/);
  }
});

test('uses slot-scoped physical mappings for the owner-confirmed FS2 target', () => {
  const blob = blankBackup();
  const fields = X_E5_FS_LAYOUT.fields;
  const writeByte = (key, value) => { blob[fields[key].offset + fields[key].step] = value; };
  const kelvinOffset = fields.whiteBalanceKelvin.offset + fields.whiteBalanceKelvin.step;
  writeByte('filmSimulation', 0x0f);
  new DataView(blob.buffer).setUint16(kelvinOffset, 3200, true);
  writeByte('whiteBalanceMode', 0x0a);
  writeByte('highIsoNr', 0x02);
  writeByte('dynamicRange', 0x03);
  writeByte('color', 0x07);
  writeByte('sharpness', 0x05);
  writeByte('highlight', 0x08);
  writeByte('shadow', 0x08);
  writeByte('wbShiftR', 0x01);
  writeByte('wbShiftB', 0x11);

  const slot = decodeFsSlots(blob)[1];
  assert.equal(slot.fsRecipeStatus, 'UNKNOWN_FROM_BACKUP');
  assert.equal(slot.valuesActive, null);
  assert.deepEqual(
    Object.fromEntries([
      'filmSimulation', 'dynamicRange', 'whiteBalanceMode', 'whiteBalanceKelvin',
      'wbShiftR', 'wbShiftB', 'highlight', 'shadow', 'color', 'sharpness', 'highIsoNr',
    ].map((key) => [key, slot.values[key]])),
    {
      filmSimulation: 'ClassicChrome',
      dynamicRange: 'DR200',
      whiteBalanceMode: 'Temperature',
      whiteBalanceKelvin: 3200,
      wbShiftR: 8,
      wbShiftB: -8,
      highlight: 2,
      shadow: 2,
      color: -2,
      sharpness: -1,
      highIsoNr: -2,
    },
  );
  for (const key of ['dynamicRange', 'color', 'sharpness']) {
    const property = slot.rawProperties.find((item) => item.key === key);
    assert.equal(property.evidenceLevel, 'PHYSICAL_X_E5_FW_1_10');
    assert.match(property.researchSource, /enabled FS2 Classic Chrome target/i);
  }
});

test('decodes the enabled owner-confirmed neutral ACROS FS3 target and activation flag', () => {
  const blob = blankBackup();
  const fields = X_E5_FS_LAYOUT.fields;
  const writeByte = (key, value) => { blob[fields[key].offset + 2 * fields[key].step] = value; };
  blob[X_E5_FS_LAYOUT.recipeEnabledBySlot[2].offset] = 1;
  writeByte('filmSimulation', 0x16);
  writeByte('whiteBalanceMode', 0x00);
  writeByte('highIsoNr', 0x00);
  writeByte('clarity', 0x0b);
  writeByte('monoWarmCool', 0x12);
  writeByte('monoMagentaGreen', 0x12);
  writeByte('dynamicRange', 0x00);
  writeByte('sharpness', 0x08);
  writeByte('highlight', 0x0c);
  writeByte('shadow', 0x08);
  writeByte('colorChrome', 0x00);
  writeByte('colorChromeBlue', 0x00);
  writeByte('grainStrength', 0x00);
  writeByte('grainSize', 0x01);
  writeByte('wbShiftR', 0x01);
  writeByte('wbShiftB', 0x11);

  const slot = decodeFsSlots(blob)[2];
  assert.equal(slot.fsRecipeStatus, 'ON');
  assert.equal(slot.valuesActive, true);
  assert.deepEqual(
    Object.fromEntries([
      'filmSimulation', 'dynamicRange', 'grainStrength', 'grainSize',
      'colorChrome', 'colorChromeBlue', 'whiteBalanceMode', 'wbShiftR', 'wbShiftB',
      'highlight', 'shadow', 'color', 'sharpness', 'highIsoNr', 'clarity',
      'monoWarmCool', 'monoMagentaGreen',
    ].map((key) => [key, slot.values[key]])),
    {
      filmSimulation: 'Acros',
      dynamicRange: 'Auto',
      grainStrength: 'Strong',
      grainSize: 'Large',
      colorChrome: 'Off',
      colorChromeBlue: 'Off',
      whiteBalanceMode: 'Auto',
      wbShiftR: 0,
      wbShiftB: 0,
      highlight: 4,
      shadow: 2,
      color: null,
      sharpness: -4,
      highIsoNr: -4,
      clarity: 5,
      monoWarmCool: 0,
      monoMagentaGreen: 0,
    },
  );
  for (const key of ['filmSimulation', 'wbShiftR', 'wbShiftB', 'clarity']) {
    const property = slot.rawProperties.find((item) => item.key === key);
    assert.equal(property.evidenceLevel, 'PHYSICAL_X_E5_FW_1_10');
    assert.match(property.researchSource, /plain-ACROS FS3/i);
  }
});

test('unknown FS bytes remain passthrough instead of becoming implausible canonical values', () => {
  const blob = blankBackup();
  for (const key of ['filmSimulation', 'colorChrome', 'highIsoNr', 'wbShiftR']) {
    blob[X_E5_FS_LAYOUT.fields[key].offset] = 0xff;
  }

  const [slot] = decodeFsSlots(blob);
  assert.equal(slot.values.filmSimulation, null);
  assert.equal(slot.values.color, null);
  assert.equal(slot.values.colorChrome, null);
  assert.equal(slot.values.highIsoNr, null);
  assert.equal(slot.values.wbShiftR, null);
  assert.equal(slot.allKnownMappingsDecoded, false);
  assert.equal(slot.readStatus, 'FILM_ONLY_FS_RECIPE_OFF_WITH_PASSTHROUGH');
  for (const key of ['filmSimulation', 'colorChrome', 'highIsoNr', 'wbShiftR']) {
    const property = slot.rawProperties.find((item) => item.key === key);
    assert.equal(property.rawValue, 0xff);
    assert.equal(property.rawHex, 'ff');
    assert.equal(property.readStatus, 'PASSTHROUGH');
    assert.match(property.uncertainty, /passthrough/);
  }
  const dependentColor = slot.rawProperties.find((item) => item.key === 'color');
  assert.equal(dependentColor.readStatus, 'PASSTHROUGH');
  assert.match(dependentColor.uncertainty, /Film simulation is unknown/);
});

test('FS Kelvin decoding enforces the documented 10 K step', () => {
  const blob = blankBackup();
  blob[X_E5_FS_LAYOUT.fields.filmSimulation.offset] = 0x10;
  blob[X_E5_FS_LAYOUT.fields.whiteBalanceMode.offset] = 0x0a;
  new DataView(blob.buffer).setUint16(X_E5_FS_LAYOUT.fields.whiteBalanceKelvin.offset, 5001, true);

  const [slot] = decodeFsSlots(blob);
  const kelvin = slot.rawProperties.find((property) => property.key === 'whiteBalanceKelvin');
  assert.equal(slot.values.whiteBalanceKelvin, null);
  assert.equal(kelvin.rawValue, 5001);
  assert.equal(kelvin.readStatus, 'PASSTHROUGH');
  assert.match(kelvin.uncertainty, /10 K steps/);
});

test('the directly exported FS slot decoder enforces X-E5 model and exact-size guards', () => {
  const wrongModel = blankBackup();
  wrongModel.set(new TextEncoder().encode('X-T5\0'), 0x14);
  assert.throws(() => decodeFsSlot(wrongModel, 0), /not X-E5/);
  assert.throws(() => decodeFsSlot(blankBackup().slice(0, 100), 0), /expected/);
});

test('X-E5 backup model and size guards reject mismatches', () => {
  const good = blankBackup();
  assert.equal(modelFromBackup(good), 'X-E5');
  assert.doesNotThrow(() => assertXe5Backup(good));
  const wrong = new Uint8Array(good);
  wrong.set(new TextEncoder().encode('X-T5\0'), 0x14);
  assert.throws(() => assertXe5Backup(wrong), /not X-E5/);
  assert.throws(() => assertXe5Backup(good.slice(0, 100)), /expected/);
});

test('packs and unpacks a PTP command container', () => {
  const packed = packContainer({ type: PTP_CONTAINER.COMMAND, code: 0x1015, transactionId: 9, params: [0xd192], data: new Uint8Array() });
  const unpacked = unpackContainer(packed);
  assert.equal(unpacked.type, PTP_CONTAINER.COMMAND);
  assert.equal(unpacked.code, 0x1015);
  assert.equal(unpacked.transactionId, 9);
  // Command params are intentionally not decoded by unpackContainer because it
  // is used for camera responses; the raw packet length still includes them.
  assert.equal(unpacked.length, 16);
});
