// @ts-check

import {
  FILM_SIM_BY_ID,
  X_E5_PTP_WHITE_BALANCE,
} from '../core/catalog.js';
import {
  concatBytes,
  encodePtpString,
  packU16,
  packU32,
} from './binary.js';
import { NR_ENCODE } from './x-e5-codecs.js';

const NATIVE_INDEX = Object.freeze({
  EXPOSURE_BIAS: 4,
  DYNAMIC_RANGE: 6,
  D_RANGE_PRIORITY: 7,
  FILM_SIMULATION: 8,
  GRAIN: 9,
  COLOR_CHROME: 10,
  SMOOTH_SKIN: 11,
  WHITE_BALANCE: 12,
  WB_SHIFT_R: 13,
  WB_SHIFT_B: 14,
  WB_COLOR_TEMP: 15,
  HIGHLIGHT: 16,
  SHADOW: 17,
  COLOR: 18,
  SHARPNESS: 19,
  NOISE_REDUCTION: 20,
  COLOR_CHROME_BLUE: 25,
  CLARITY: 27,
});

/**
 * Patch a camera-native D185 profile for an experimental preview.
 *
 * The X-E5 path is gated by profile length and field-count checks. The caller
 * should keep the original profile and expose this feature as experimental.
 *
 * @param {Uint8Array} baseProfile
 * @param {Record<string, any>} values
 * @param {{ exposureEv?: number }} [options]
 */
export function patchD185Profile(baseProfile, values, options = {}) {
  if (baseProfile.byteLength < 120) throw new Error(`D185 profile is unexpectedly short (${baseProfile.byteLength} bytes).`);
  const output = new Uint8Array(baseProfile);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const parameterCount = view.getUint16(0, true);
  if (parameterCount < 28 || parameterCount > 64) throw new Error(`D185 field count ${parameterCount} is outside the supported experimental range.`);
  const parameterOffset = output.byteLength - parameterCount * 4;
  if (parameterOffset < 0 || parameterOffset + 28 * 4 > output.byteLength) throw new Error('D185 parameter array does not fit the profile payload.');

  const set = (index, value) => view.setInt32(parameterOffset + index * 4, value, true);
  const film = FILM_SIM_BY_ID.get(values.filmSimulation);
  if (!film) throw new Error(`Unsupported film simulation: ${String(values.filmSimulation)}.`);
  set(NATIVE_INDEX.FILM_SIMULATION, film.ptp);

  if (options.exposureEv !== undefined) set(NATIVE_INDEX.EXPOSURE_BIAS, Math.round(options.exposureEv * 1000));

  const dr = ({ DR100: 100, DR200: 200, DR400: 400, Auto: 0 })[values.dynamicRange];
  if (dr !== undefined) set(NATIVE_INDEX.DYNAMIC_RANGE, dr);
  const priority = ({ Off: 0, Weak: 1, Strong: 2, Auto: 0x8000 })[values.dRangePriority ?? 'Off'];
  if (priority !== undefined) set(NATIVE_INDEX.D_RANGE_PRIORITY, priority);

  const grain = encodeGrain(values.grainStrength, values.grainSize);
  set(NATIVE_INDEX.GRAIN, grain);
  set(NATIVE_INDEX.COLOR_CHROME, encodeOneStrength(values.colorChrome));
  set(NATIVE_INDEX.COLOR_CHROME_BLUE, encodeOneStrength(values.colorChromeBlue));
  set(NATIVE_INDEX.SMOOTH_SKIN, encodeOneStrength(values.smoothSkin));

  const wb = X_E5_PTP_WHITE_BALANCE[values.whiteBalanceMode];
  if (wb !== undefined) set(NATIVE_INDEX.WHITE_BALANCE, wb);
  if (values.whiteBalanceMode === 'Temperature' && values.whiteBalanceKelvin) set(NATIVE_INDEX.WB_COLOR_TEMP, Number(values.whiteBalanceKelvin));
  if (values.wbShiftR !== null) set(NATIVE_INDEX.WB_SHIFT_R, Number(values.wbShiftR));
  if (values.wbShiftB !== null) set(NATIVE_INDEX.WB_SHIFT_B, Number(values.wbShiftB));

  if (values.highlight !== null) set(NATIVE_INDEX.HIGHLIGHT, Math.round(Number(values.highlight) * 10));
  if (values.shadow !== null) set(NATIVE_INDEX.SHADOW, Math.round(Number(values.shadow) * 10));
  if (values.color !== null) set(NATIVE_INDEX.COLOR, Math.round(Number(values.color) * 10));
  if (values.sharpness !== null) set(NATIVE_INDEX.SHARPNESS, Math.round(Number(values.sharpness) * 10));
  const nr = NR_ENCODE[String(values.highIsoNr ?? 0)];
  if (nr !== undefined) set(NATIVE_INDEX.NOISE_REDUCTION, nr);
  if (values.clarity !== null) set(NATIVE_INDEX.CLARITY, Math.round(Number(values.clarity) * 10));
  return output;
}

/**
 * Build the exact ObjectInfo dataset expected by Fujifilm's RAF upload path.
 *
 * @param {number} size
 */
export function buildRafObjectInfo(size) {
  return concatBytes(
    packU32(0),
    packU16(0xf802),
    packU16(0),
    packU32(size),
    packU16(0),
    packU32(0),
    packU32(0),
    packU32(0),
    packU32(0),
    packU32(0),
    packU32(0),
    packU32(0),
    packU16(0),
    packU32(0),
    packU32(0),
    encodePtpString('FUP_FILE.dat'),
    new Uint8Array([0]),
    new Uint8Array([0]),
    new Uint8Array([0]),
  );
}

/**
 * Build the 1076-byte whole-camera restore ObjectInfo observed in the official
 * backup/restore flow.
 *
 * @param {number} size
 */
export function buildBackupObjectInfo(size) {
  const output = new Uint8Array(1076);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0, true);
  view.setUint16(4, 0x5000, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, size, true);
  return output;
}

/** @param {any} strength @param {any} size */
function encodeGrain(strength, size) {
  if (strength === 'Off') return 1;
  if (strength === 'Weak') return size === 'Large' ? 4 : 2;
  if (strength === 'Strong') return size === 'Large' ? 5 : 3;
  return 1;
}

/** @param {any} strength */
function encodeOneStrength(strength) {
  return strength === 'Strong' ? 3 : strength === 'Weak' ? 2 : 1;
}
