// @ts-check

import {
  CLARITY_OPTIONS,
  COLOR_LOCKED_FILM_SIMULATIONS,
  COLOR_OPTIONS,
  FILM_SIM_BY_FS,
  FILM_SIM_BY_ID,
  FS_WHITE_BALANCE_BY_VALUE,
  MONO_TONING_OPTIONS,
  MONOCHROME_FILM_SIMULATIONS,
  TONE_OPTIONS,
  WB_SHIFT_OPTIONS,
  X_E5_FS_WHITE_BALANCE,
  X_E5_PTP_WHITE_BALANCE,
} from '../core/catalog.js';
import {
  bytesToHex,
  decodePtpString,
  encodePtpString,
  packI16,
  packU16,
  readI16,
  readU16,
} from './binary.js';

export const FUJI_VENDOR_ID = 0x04cb;
export const X_E5_PRODUCT_ID = 0x0313;

export const PTP_PROP = Object.freeze({
  USB_MODE: 0xd16e,
  RAW_CONVERSION_START: 0xd183,
  RAW_CONVERSION_PROFILE: 0xd185,
  PRESET_SLOT: 0xd18c,
  PRESET_NAME: 0xd18d,
  IMAGE_SIZE: 0xd18e,
  IMAGE_QUALITY: 0xd18f,
  DYNAMIC_RANGE: 0xd190,
  D_RANGE_PRIORITY: 0xd191,
  FILM_SIMULATION: 0xd192,
  MONO_WC: 0xd193,
  MONO_MG: 0xd194,
  GRAIN: 0xd195,
  COLOR_CHROME: 0xd196,
  COLOR_CHROME_BLUE: 0xd197,
  SMOOTH_SKIN: 0xd198,
  WHITE_BALANCE: 0xd199,
  WB_SHIFT_R: 0xd19a,
  WB_SHIFT_B: 0xd19b,
  WB_COLOR_TEMP: 0xd19c,
  HIGHLIGHT: 0xd19d,
  SHADOW: 0xd19e,
  COLOR: 0xd19f,
  SHARPNESS: 0xd1a0,
  HIGH_ISO_NR: 0xd1a1,
  CLARITY: 0xd1a2,
  LONG_EXPOSURE_NR: 0xd1a3,
  COLOR_SPACE: 0xd1a4,
  UNKNOWN_D1A5: 0xd1a5,
});

export const PRESET_PROP_RANGE = Object.freeze({ first: 0xd18e, last: 0xd1a5 });

export const C_SLOT_PROPERTY_METADATA = Object.freeze({
  [PTP_PROP.PRESET_NAME]: { label: 'Slot Name', encoding: 'ptp-string', fields: ['name'] },
  [PTP_PROP.IMAGE_SIZE]: { label: 'Image Size', encoding: 'u16', fields: ['imageSize'] },
  [PTP_PROP.IMAGE_QUALITY]: { label: 'Image Quality', encoding: 'u16', fields: ['imageQuality'] },
  [PTP_PROP.DYNAMIC_RANGE]: { label: 'Dynamic Range', encoding: 'u16', fields: ['dynamicRange'] },
  [PTP_PROP.D_RANGE_PRIORITY]: { label: 'D-Range Priority', encoding: 'u16', fields: ['dRangePriority'] },
  [PTP_PROP.FILM_SIMULATION]: { label: 'Film Simulation', encoding: 'u16', fields: ['filmSimulation'] },
  [PTP_PROP.MONO_WC]: { label: 'Monochromatic Warm/Cool', encoding: 'i16', fields: ['monoWarmCool'] },
  [PTP_PROP.MONO_MG]: { label: 'Monochromatic Magenta/Green', encoding: 'i16', fields: ['monoMagentaGreen'] },
  [PTP_PROP.GRAIN]: { label: 'Grain Effect', encoding: 'u16', fields: ['grainStrength', 'grainSize'] },
  [PTP_PROP.COLOR_CHROME]: { label: 'Color Chrome Effect', encoding: 'u16', fields: ['colorChrome'] },
  [PTP_PROP.COLOR_CHROME_BLUE]: { label: 'Color Chrome FX Blue', encoding: 'u16', fields: ['colorChromeBlue'] },
  [PTP_PROP.SMOOTH_SKIN]: { label: 'Smooth Skin Effect', encoding: 'u16', fields: ['smoothSkin'] },
  [PTP_PROP.WHITE_BALANCE]: { label: 'White Balance', encoding: 'u16', fields: ['whiteBalanceMode'] },
  [PTP_PROP.WB_SHIFT_R]: { label: 'WB Shift Red', encoding: 'i16', fields: ['wbShiftR'] },
  [PTP_PROP.WB_SHIFT_B]: { label: 'WB Shift Blue', encoding: 'i16', fields: ['wbShiftB'] },
  [PTP_PROP.WB_COLOR_TEMP]: { label: 'Color Temperature', encoding: 'u16', fields: ['whiteBalanceKelvin'] },
  [PTP_PROP.HIGHLIGHT]: { label: 'Highlight', encoding: 'i16', fields: ['highlight'] },
  [PTP_PROP.SHADOW]: { label: 'Shadow', encoding: 'i16', fields: ['shadow'] },
  [PTP_PROP.COLOR]: { label: 'Color', encoding: 'i16', fields: ['color'] },
  [PTP_PROP.SHARPNESS]: { label: 'Sharpness', encoding: 'i16', fields: ['sharpness'] },
  [PTP_PROP.HIGH_ISO_NR]: { label: 'High ISO NR', encoding: 'u16', fields: ['highIsoNr'] },
  [PTP_PROP.CLARITY]: { label: 'Clarity', encoding: 'i16', fields: ['clarity'] },
  [PTP_PROP.LONG_EXPOSURE_NR]: { label: 'Long Exposure NR', encoding: 'u16', fields: ['longExposureNr'] },
  [PTP_PROP.COLOR_SPACE]: { label: 'Color Space', encoding: 'u16', fields: ['colorSpace'] },
  [PTP_PROP.UNKNOWN_D1A5]: { label: 'Body-specific 0xD1A5', encoding: 'passthrough', fields: [] },
});

export const C_EVIDENCE_LEVEL = 'PHYSICAL_X_E5_FW_1_10';
export const C_RESEARCH_SOURCE = 'Exact raw-to-menu observations from the owner\'s physical X-E5 C1 and C7 menus on firmware 1.10, recorded 2026-08-02. Unobserved values remain passthrough.';

/*
 * These are deliberately exact observations, not inferred enum tables. Other
 * Fujifilm bodies use different C-slot encodings, and the physical X-E5 menu
 * comparison disproved several previously borrowed mappings. Adding another
 * raw value requires physical X-E5 evidence and a focused test.
 */
const X_E5_FW_1_10_C_READ_OBSERVATIONS = Object.freeze({
  [PTP_PROP.IMAGE_SIZE]: Object.freeze({
    0x0007: observed({ imageSize: 'L 3:2' }, 'The X-E5 menu displayed Image Size L 3:2.'),
  }),
  [PTP_PROP.IMAGE_QUALITY]: Object.freeze({
    0x0002: observed({ imageQuality: 'F' }, 'The saved C1 menu displayed Image Quality F after an explicit C1 selector write.'),
  }),
  [PTP_PROP.DYNAMIC_RANGE]: Object.freeze({
    0x0064: observed({ dynamicRange: 'DR100' }, 'The saved C1 menu displayed DR100 after an explicit C1 selector write.'),
    0x0190: observed({ dynamicRange: 'DR400' }, 'The owner-created C7 menu displayed DR400; the explicit C7 scan returned raw value 400.'),
  }),
  [PTP_PROP.D_RANGE_PRIORITY]: Object.freeze({
    0x0000: observed({ dRangePriority: 'Off' }, 'The X-E5 menu displayed D Range Priority Off.'),
  }),
  [PTP_PROP.FILM_SIMULATION]: Object.freeze({
    0x0001: observed({ filmSimulation: 'Provia' }, 'The X-E5 menu displayed STD (Provia / Standard).'),
    0x000b: observed({ filmSimulation: 'ClassicChrome' }, 'The owner-created C7 menu displayed Classic Chrome.'),
  }),
  [PTP_PROP.GRAIN]: Object.freeze({
    0x0003: observed({ grainStrength: 'Strong', grainSize: 'Small' }, 'The owner-created C7 menu displayed Grain Effect Strong / Small.'),
    0x0005: observed({ grainStrength: 'Strong', grainSize: 'Large' }, 'The saved C1 menu displayed Grain Effect Strong / Large after an explicit C1 selector write.'),
  }),
  [PTP_PROP.COLOR_CHROME]: Object.freeze({
    0x0002: observed({ colorChrome: 'Weak' }, 'The saved C1 menu displayed Color Chrome Effect Weak after an explicit C1 selector write.'),
    0x0003: observed({ colorChrome: 'Strong' }, 'The owner-created C7 menu displayed Color Chrome Effect Strong.'),
  }),
  [PTP_PROP.COLOR_CHROME_BLUE]: Object.freeze({
    0x0001: observed({ colorChromeBlue: 'Off' }, 'The owner-created C7 menu displayed Color Chrome FX Blue Off.'),
    0x0003: observed({ colorChromeBlue: 'Strong' }, 'The saved C1 menu displayed Color Chrome FX Blue Strong after an explicit C1 selector write.'),
  }),
  [PTP_PROP.SMOOTH_SKIN]: Object.freeze({
    0x0001: observed({ smoothSkin: 'Off' }, 'The X-E5 menu displayed Smooth Skin Effect Off.'),
  }),
  [PTP_PROP.WHITE_BALANCE]: Object.freeze({
    0x8007: observed({ whiteBalanceMode: 'Temperature' }, 'The saved C1 menu displayed K (color temperature) after an explicit C1 selector write.'),
  }),
  [PTP_PROP.WB_COLOR_TEMP]: Object.freeze({
    5200: observed(
      { whiteBalanceKelvin: 5200 },
      'The owner-created C7 white-balance setting was confirmed as 5200 K.',
    ),
    7500: observed(
      { whiteBalanceKelvin: 7500 },
      'The X-E5 white-balance detail screen displayed 7500 K.',
    ),
  }),
  [PTP_PROP.WB_SHIFT_R]: Object.freeze({
    0xfffc: observed({ wbShiftR: -4 }, 'The saved C1 white-balance detail screen displayed R -4; the payload is signed identity.'),
    0x0001: observed({ wbShiftR: 1 }, 'The owner-created C7 white-balance setting was confirmed as R +1; the payload is signed identity.'),
  }),
  [PTP_PROP.WB_SHIFT_B]: Object.freeze({
    0xfffa: observed({ wbShiftB: -6 }, 'The owner-created C7 white-balance setting was confirmed as B -6; the payload is signed identity.'),
    0x0001: observed({ wbShiftB: 1 }, 'The saved C1 white-balance detail screen displayed B +1; the payload is signed identity.'),
  }),
  [PTP_PROP.HIGHLIGHT]: Object.freeze({
    0x0000: observed({ highlight: 0 }, 'The owner-created C7 menu displayed Highlight 0.'),
    0xffec: observed({ highlight: -2 }, 'The saved C1 menu displayed Highlight -2 for signed raw value -20.'),
  }),
  [PTP_PROP.SHADOW]: Object.freeze({
    0xffec: observed({ shadow: -2 }, 'The saved C1 menu displayed Shadow -2 for signed raw value -20.'),
  }),
  [PTP_PROP.COLOR]: Object.freeze({
    0x0014: observed({ color: 2 }, 'The owner-created C7 menu displayed Color +2 for signed raw value 20.'),
    0xffe2: observed({ color: -3 }, 'The saved C1 menu displayed Color -3 for signed raw value -30.'),
  }),
  [PTP_PROP.SHARPNESS]: Object.freeze({
    0xffec: observed({ sharpness: -2 }, 'The owner-created C7 menu displayed Sharpness -2 for signed raw value -20.'),
    0xffd8: observed({ sharpness: -4 }, 'The saved C1 menu displayed Sharpness -4 for signed raw value -40.'),
  }),
  [PTP_PROP.HIGH_ISO_NR]: Object.freeze({
    0x8000: observed({ highIsoNr: -4 }, 'The saved C1 menu displayed High ISO NR -4 after an explicit C1 selector write.'),
  }),
  [PTP_PROP.CLARITY]: Object.freeze({
    0xffec: observed({ clarity: -2 }, 'The owner-created C7 menu displayed Clarity -2 for signed raw value -20.'),
    0xffd8: observed({ clarity: -4 }, 'The saved C1 menu displayed Clarity -4 for signed raw value -40.'),
  }),
  [PTP_PROP.LONG_EXPOSURE_NR]: Object.freeze({
    0x0001: observed({ longExposureNr: 'On' }, 'The X-E5 menu displayed Long Exposure NR On.'),
  }),
  [PTP_PROP.COLOR_SPACE]: Object.freeze({
    0x0001: observed({ colorSpace: 'sRGB' }, 'The X-E5 menu displayed Color Space sRGB.'),
  }),
});

const D_RANGE_PRIORITY_ENCODE = Object.freeze({ Off: 0x0000, Weak: 0x0001, Strong: 0x0002, Auto: 0x8000 });
const D_RANGE_PRIORITY_DECODE = new Map(Object.entries(D_RANGE_PRIORITY_ENCODE).map(([key, value]) => [value, key]));
const NR_ENCODE = Object.freeze({
  '-4': 0x8000,
  '-3': 0x7000,
  '-2': 0x4000,
  '-1': 0x3000,
  '0': 0x2000,
  '1': 0x1000,
  '2': 0x0000,
  '3': 0x6000,
  '4': 0x5000,
});
const NR_DECODE = new Map(Object.entries(NR_ENCODE).map(([key, value]) => [value, Number(key)]));

export const X_E5_FS_LAYOUT = Object.freeze({
  blobSize: 70524,
  slots: 3,
  checksumOffset: 0x120,
  recipeEnabledBySlot: Object.freeze([
    Object.freeze({ offset: 34500, size: 1 }),
    null,
    Object.freeze({ offset: 34502, size: 1 }),
  ]),
  fields: Object.freeze({
    filmSimulation: { offset: 1991, step: 3, size: 1 },
    whiteBalanceKelvin: { offset: 34704, step: 2, size: 2 },
    whiteBalanceMode: { offset: 34716, step: 1, size: 1 },
    highIsoNr: { offset: 34722, step: 1, size: 1 },
    clarity: { offset: 34728, step: 1, size: 1 },
    monoWarmCool: { offset: 34731, step: 1, size: 1 },
    monoMagentaGreen: { offset: 34737, step: 1, size: 1 },
    dynamicRange: { offset: 34743, step: 1, size: 1 },
    color: { offset: 34752, step: 1, size: 1 },
    sharpness: { offset: 34758, step: 1, size: 1 },
    highlight: { offset: 34764, step: 1, size: 1 },
    shadow: { offset: 34770, step: 1, size: 1 },
    colorChrome: { offset: 34776, step: 1, size: 1 },
    colorChromeBlue: { offset: 34779, step: 1, size: 1 },
    grainStrength: { offset: 34782, step: 1, size: 1 },
    grainSize: { offset: 34785, step: 1, size: 1 },
    smoothSkin: { offset: 34788, step: 1, size: 1 },
    wbShiftR: { offset: 34864, step: 1, size: 1 },
    wbShiftB: { offset: 34870, step: 1, size: 1 },
  }),
});

const FS_EVIDENCE_LEVEL = 'PUBLIC_RESEARCH';
const FS_RESEARCH_SOURCE = 'Published X-E5 interoperability layout; pending confirmation against the owner\'s physical camera menus.';
const FS1_RECIPE_FLAG_SOURCE = 'Physical X-E5 firmware 1.10 volatile backup comparisons on 2026-08-03: owner-menu FS1 On→Off changed offset 34500 from 01→00, and Off→On changed it from 00→01 while every recipe-value field remained unchanged.';
const FS3_RECIPE_FLAG_SOURCE = 'Physical X-E5 firmware 1.10 volatile backup comparisons on 2026-08-03: owner-menu FS3 On→Off changed only offset 34502 from 01→00, and Off→On changed only 00→01 while every recipe-value field remained unchanged.';
const FS_RECIPE_FLAG_SOURCES = Object.freeze([FS1_RECIPE_FLAG_SOURCE, null, FS3_RECIPE_FLAG_SOURCE]);
const FS_FILM_PHYSICAL_OBSERVATIONS = Object.freeze({
  0x01: 'Provia',
  0x11: 'NostalgicNeg',
  0x0d: 'ProNegStd',
});
const FS_FILM_PHYSICAL_SOURCE = 'Physical X-E5 firmware 1.10 menu comparison: FS1 Provia / Standard, FS2 Nostalgic Negative, FS3 PRO Neg. Std; FS RECIPE was Off for all three.';
const FS1_TARGET_PHYSICAL_SOURCE = 'Physical X-E5 firmware 1.10 owner-menu comparison and volatile read-only backup characterization on 2026-08-02/03. The final enabled FS1 Classic Chrome target was read with exact model and 70,524-byte guards; unobserved raw values remain public research or passthrough.';
const FS1_TARGET_PHYSICAL_OBSERVATIONS = Object.freeze({
  filmSimulation: Object.freeze({ 0x0f: 'ClassicChrome' }),
  whiteBalanceKelvin: Object.freeze({ 5200: 5200 }),
  whiteBalanceMode: Object.freeze({ 0x0a: 'Temperature' }),
  highIsoNr: Object.freeze({ 0x00: -4 }),
  clarity: Object.freeze({ 0x04: -2 }),
  dynamicRange: Object.freeze({ 0x03: 'DR400' }),
  color: Object.freeze({ 0x05: 2 }),
  sharpness: Object.freeze({ 0x06: -2 }),
  highlight: Object.freeze({ 0x04: 0 }),
  shadow: Object.freeze({ 0x00: -2 }),
  colorChrome: Object.freeze({ 0x02: 'Strong' }),
  colorChromeBlue: Object.freeze({ 0x00: 'Off' }),
  grainStrength: Object.freeze({ 0x00: 'Strong' }),
  grainSize: Object.freeze({ 0x00: 'Small' }),
  smoothSkin: Object.freeze({ 0x00: 'Off' }),
  wbShiftR: Object.freeze({ 0x08: 1 }),
  wbShiftB: Object.freeze({ 0x0f: -6 }),
});
const FS2_TARGET_PHYSICAL_SOURCE = 'Physical X-E5 firmware 1.10 owner-menu confirmation and guarded read-only backup on 2026-08-03. The enabled FS2 Classic Chrome target physically showed DR200 and Color -2 even though those bytes conflict with the provisional shared-enum interpretation; the observations are intentionally scoped to FS2.';
const FS2_TARGET_PHYSICAL_OBSERVATIONS = Object.freeze({
  filmSimulation: Object.freeze({ 0x0f: 'ClassicChrome' }),
  whiteBalanceKelvin: Object.freeze({ 3200: 3200 }),
  whiteBalanceMode: Object.freeze({ 0x0a: 'Temperature' }),
  highIsoNr: Object.freeze({ 0x02: -2 }),
  dynamicRange: Object.freeze({ 0x03: 'DR200' }),
  color: Object.freeze({ 0x07: -2 }),
  sharpness: Object.freeze({ 0x05: -1 }),
  highlight: Object.freeze({ 0x08: 2 }),
  shadow: Object.freeze({ 0x08: 2 }),
  wbShiftR: Object.freeze({ 0x01: 8 }),
  wbShiftB: Object.freeze({ 0x11: -8 }),
});
const FS3_TARGET_PHYSICAL_SOURCE = 'Physical X-E5 firmware 1.10 owner-menu confirmation and guarded volatile before/after backups on 2026-08-03. The enabled plain-ACROS FS3 target was read after exact model and 70,524-byte guards; raw WB shifts 01/11 were physically confirmed as neutral R0/B0 only for FS3.';
const FS3_TARGET_PHYSICAL_OBSERVATIONS = Object.freeze({
  filmSimulation: Object.freeze({ 0x16: 'Acros' }),
  whiteBalanceMode: Object.freeze({ 0x00: 'Auto' }),
  highIsoNr: Object.freeze({ 0x00: -4 }),
  clarity: Object.freeze({ 0x0b: 5 }),
  monoWarmCool: Object.freeze({ 0x12: 0 }),
  monoMagentaGreen: Object.freeze({ 0x12: 0 }),
  dynamicRange: Object.freeze({ 0x00: 'Auto' }),
  sharpness: Object.freeze({ 0x08: -4 }),
  highlight: Object.freeze({ 0x0c: 4 }),
  shadow: Object.freeze({ 0x08: 2 }),
  colorChrome: Object.freeze({ 0x00: 'Off' }),
  colorChromeBlue: Object.freeze({ 0x00: 'Off' }),
  grainStrength: Object.freeze({ 0x00: 'Strong' }),
  grainSize: Object.freeze({ 0x01: 'Large' }),
  wbShiftR: Object.freeze({ 0x01: 0 }),
  wbShiftB: Object.freeze({ 0x11: 0 }),
});
const FS_TARGET_PHYSICAL_OBSERVATIONS = Object.freeze([
  FS1_TARGET_PHYSICAL_OBSERVATIONS,
  FS2_TARGET_PHYSICAL_OBSERVATIONS,
  FS3_TARGET_PHYSICAL_OBSERVATIONS,
]);
const FS_TARGET_PHYSICAL_SOURCES = Object.freeze([
  FS1_TARGET_PHYSICAL_SOURCE,
  FS2_TARGET_PHYSICAL_SOURCE,
  FS3_TARGET_PHYSICAL_SOURCE,
]);
const FS_FIELD_LABELS = Object.freeze({
  filmSimulation: 'Film Simulation',
  whiteBalanceKelvin: 'Color Temperature',
  whiteBalanceMode: 'White Balance',
  highIsoNr: 'High ISO NR',
  clarity: 'Clarity',
  monoWarmCool: 'Monochromatic Warm/Cool',
  monoMagentaGreen: 'Monochromatic Magenta/Green',
  dynamicRange: 'Dynamic Range',
  color: 'Color',
  sharpness: 'Sharpness',
  highlight: 'Highlight',
  shadow: 'Shadow',
  colorChrome: 'Color Chrome Effect',
  colorChromeBlue: 'Color Chrome FX Blue',
  grainStrength: 'Grain Strength',
  grainSize: 'Grain Size',
  smoothSkin: 'Smooth Skin Effect',
  wbShiftR: 'WB Shift Red',
  wbShiftB: 'WB Shift Blue',
});

/**
 * @typedef {Object} RawProperty
 * @property {number} code
 * @property {Uint8Array} bytes
 * @property {number|string|null} value
 *
 * @typedef {Map<number, RawProperty>} RawPropertyMap
 */

/**
 * Decode a C1-C7 property snapshot into canonical recipe values.
 *
 * @param {RawPropertyMap} properties
 * @returns {Record<string, any>}
 */
export function decodeCSlotProperties(properties) {
  const u16 = (code) => readExactU16(properties.get(code)?.bytes);
  const value = (code, field) => observedField(code, u16(code), field);
  const film = value(PTP_PROP.FILM_SIMULATION, 'filmSimulation');
  const whiteBalanceMode = value(PTP_PROP.WHITE_BALANCE, 'whiteBalanceMode');

  return {
    imageSize: value(PTP_PROP.IMAGE_SIZE, 'imageSize'),
    imageQuality: value(PTP_PROP.IMAGE_QUALITY, 'imageQuality'),
    filmSimulation: film,
    dynamicRange: value(PTP_PROP.DYNAMIC_RANGE, 'dynamicRange'),
    dRangePriority: value(PTP_PROP.D_RANGE_PRIORITY, 'dRangePriority'),
    grainStrength: value(PTP_PROP.GRAIN, 'grainStrength'),
    grainSize: value(PTP_PROP.GRAIN, 'grainSize'),
    colorChrome: value(PTP_PROP.COLOR_CHROME, 'colorChrome'),
    colorChromeBlue: value(PTP_PROP.COLOR_CHROME_BLUE, 'colorChromeBlue'),
    smoothSkin: value(PTP_PROP.SMOOTH_SKIN, 'smoothSkin'),
    whiteBalanceMode,
    whiteBalanceKelvin: whiteBalanceMode === 'Temperature'
      ? value(PTP_PROP.WB_COLOR_TEMP, 'whiteBalanceKelvin')
      : null,
    wbShiftR: value(PTP_PROP.WB_SHIFT_R, 'wbShiftR'),
    wbShiftB: value(PTP_PROP.WB_SHIFT_B, 'wbShiftB'),
    highlight: value(PTP_PROP.HIGHLIGHT, 'highlight'),
    shadow: value(PTP_PROP.SHADOW, 'shadow'),
    color: film !== null && !COLOR_LOCKED_FILM_SIMULATIONS.has(film)
      ? value(PTP_PROP.COLOR, 'color')
      : null,
    sharpness: value(PTP_PROP.SHARPNESS, 'sharpness'),
    highIsoNr: value(PTP_PROP.HIGH_ISO_NR, 'highIsoNr'),
    clarity: value(PTP_PROP.CLARITY, 'clarity'),
    monoWarmCool: film !== null && MONOCHROME_FILM_SIMULATIONS.has(film)
      ? value(PTP_PROP.MONO_WC, 'monoWarmCool')
      : null,
    monoMagentaGreen: film !== null && MONOCHROME_FILM_SIMULATIONS.has(film)
      ? value(PTP_PROP.MONO_MG, 'monoMagentaGreen')
      : null,
    longExposureNr: value(PTP_PROP.LONG_EXPOSURE_NR, 'longExposureNr'),
    colorSpace: value(PTP_PROP.COLOR_SPACE, 'colorSpace'),
    isoMode: null,
    isoFixed: null,
    isoMin: null,
    isoMax: null,
    exposureMinEv: null,
    exposureMaxEv: null,
    exposureTypical: null,
  };
}

/**
 * Describe one successful C-slot property read without guessing the meaning of
 * body-specific payloads. The caller retains the original Uint8Array.
 *
 * @param {number} code
 * @param {Uint8Array} bytes
 * @param {Record<string, any>} [canonicalValues]
 */
export function describeCSlotProperty(code, bytes, canonicalValues = {}) {
  const metadata = C_SLOT_PROPERTY_METADATA[code] ?? {
    label: `Unknown property 0x${code.toString(16).toUpperCase().padStart(4, '0')}`,
    encoding: 'passthrough',
    fields: [],
  };
  const expectedWidth = metadata.encoding === 'u16' || metadata.encoding === 'i16' ? 2 : null;
  const result = {
    label: metadata.label,
    encoding: metadata.encoding,
    expectedWidth,
    payloadWidth: bytes.byteLength,
    rawHex: bytesToHex(bytes),
    rawValue: null,
    decoded: [],
    normalization: null,
    uncertainty: null,
    evidenceLevel: C_EVIDENCE_LEVEL,
    researchSource: C_RESEARCH_SOURCE,
  };

  if (metadata.encoding === 'passthrough') {
    result.rawValue = result.rawHex;
    result.uncertainty = 'No verified project mapping; the payload is preserved as hexadecimal passthrough data.';
    return result;
  }

  if (metadata.encoding === 'ptp-string') {
    try {
      result.rawValue = decodePtpString(bytes, 0, { requireExact: true }).value;
      result.decoded = [{ field: 'name', canonicalValue: result.rawValue, status: 'decoded' }];
    } catch (error) {
      result.uncertainty = `Malformed PTP string: ${error instanceof Error ? error.message : String(error)}`;
    }
    return result;
  }

  if (bytes.byteLength !== expectedWidth) {
    result.uncertainty = `Expected a ${expectedWidth}-byte ${metadata.encoding} payload; received ${bytes.byteLength} bytes. No numeric decode was attempted.`;
    return result;
  }

  result.rawValue = metadata.encoding === 'i16' ? readI16(bytes) : readU16(bytes);
  let dependencyUncertainty = null;
  result.decoded = metadata.fields.map((field) => {
    const canonicalValue = canonicalValues[field] ?? null;
    let status = canonicalValue === null ? 'unknown-enum' : 'decoded';
    const film = canonicalValues.filmSimulation ?? null;
    const whiteBalanceMode = canonicalValues.whiteBalanceMode ?? null;
    if (field === 'color') {
      if (film === null) dependencyUncertainty = 'Film Simulation is unknown, so Color cannot be decoded safely; the raw payload is preserved.';
      else if (COLOR_LOCKED_FILM_SIMULATIONS.has(film)) status = 'not-applicable';
    }
    if (field === 'monoWarmCool' || field === 'monoMagentaGreen') {
      if (film === null) dependencyUncertainty = 'Film Simulation is unknown, so monochromatic toning cannot be decoded safely; the raw payload is preserved.';
      else if (!MONOCHROME_FILM_SIMULATIONS.has(film)) status = 'not-applicable';
    }
    if (field === 'whiteBalanceKelvin') {
      if (whiteBalanceMode === null) dependencyUncertainty = 'White Balance mode is unknown, so Color Temperature cannot be decoded safely; the raw payload is preserved.';
      else if (whiteBalanceMode !== 'Temperature') status = 'not-applicable';
    }
    return { field, canonicalValue, status };
  });

  const physicalObservation = cReadObservation(code, result.rawValue);
  if (physicalObservation) {
    result.normalization = physicalObservation.menuEvidence;
    result.uncertainty = physicalObservation.uncertainty;
  }
  if (dependencyUncertainty) result.uncertainty = dependencyUncertainty;
  if (result.decoded.some((item) => item.status === 'unknown-enum')) {
    result.uncertainty = result.uncertainty
      ?? cReadMappingUncertainty(metadata.fields, result.rawValue);
  }
  return result;
}

/**
 * Apply the owner's physical EDIT/SAVE CUSTOM SETTING menu observation to a
 * C-slot snapshot without changing or discarding its wire evidence. A
 * CREATE NEW bank can return readable property payloads, but those bytes are
 * latent initialization data and must not be presented as a current recipe.
 *
 * @param {Record<string, any>} slot
 * @param {'SAVED'|'CREATE_NEW'} status
 */
export function applyCSlotMenuStatus(slot, status) {
  if (status !== 'SAVED' && status !== 'CREATE_NEW') {
    throw new Error(`Unsupported C-slot menu status: ${String(status)}.`);
  }
  const decodedValues = { ...(slot.decodedValues ?? slot.values ?? {}) };
  const values = status === 'SAVED'
    ? { ...decodedValues }
    : Object.fromEntries(Object.keys(decodedValues).map((key) => [key, null]));
  const annotate = (property) => ({
    ...property,
    activationStatus: status === 'SAVED' ? 'ACTIVE' : 'LATENT_CREATE_NEW',
    uncertainty: status === 'CREATE_NEW'
      ? [
        property.uncertainty,
        'The physical X-E5 menu labels this bank CREATE NEW. Its readable payload is preserved as latent initialization evidence and is not a current recipe value.',
      ].filter(Boolean).join(' ')
      : property.uncertainty,
  });
  const sourceProperties = slot.rawProperties ?? slot.propertyDiagnostics ?? [];
  const rawProperties = sourceProperties instanceof Map
    ? new Map([...sourceProperties.entries()].map(([code, property]) => [code, annotate(property)]))
    : sourceProperties.map(annotate);
  const propertyDiagnostics = rawProperties instanceof Map
    ? [...rawProperties.values()]
    : rawProperties;
  return {
    ...slot,
    values,
    decodedValues,
    rawProperties,
    propertyDiagnostics,
    initializationStatus: status,
    menuStateLabel: status === 'SAVED' ? 'Saved custom bank' : 'CREATE NEW',
    valuesActive: status === 'SAVED',
    readStatus: status === 'SAVED' ? slot.readStatus : 'UNINITIALIZED_RAW_ONLY',
    activationEvidenceLevel: 'PHYSICAL_X_E5_MENU',
    activationUncertainty: status === 'SAVED'
      ? null
      : 'The bank is uninitialized (CREATE NEW). All decoded property bytes are retained as latent evidence and are not exposed as current recipe values.',
  };
}

/**
 * Build the ordered SetDevicePropValue operations for a C slot.
 * Unknown and unrelated camera properties are preserved by omission.
 *
 * @param {Record<string, any>} values
 * @param {RawPropertyMap|null} currentProperties
 * @returns {{ operations: Array<{ code: number, label: string, bytes: Uint8Array, expected: any, critical?: boolean }>, warnings: string[] }}
 */
export function buildCSlotWritePlan(values, currentProperties = null) {
  const operations = [];
  const warnings = [];
  const film = FILM_SIM_BY_ID.get(values.filmSimulation);
  if (!film) throw new Error(`Unsupported film simulation: ${String(values.filmSimulation)}.`);

  operations.push(operation(PTP_PROP.FILM_SIMULATION, 'Film Simulation', packU16(film.ptp), values.filmSimulation, true));

  const isMono = MONOCHROME_FILM_SIMULATIONS.has(film.id);
  if (isMono) {
    for (const [key, code, label] of [
      ['monoWarmCool', PTP_PROP.MONO_WC, 'Monochromatic Warm/Cool'],
      ['monoMagentaGreen', PTP_PROP.MONO_MG, 'Monochromatic Magenta/Green'],
    ]) {
      const value = values[key];
      if (typeof value === 'number' && value !== 0) {
        operations.push(operation(code, label, packI16(Math.round(value * 10)), value));
      } else if (value === 0) {
        const current = currentProperties ? decodeX10(readI16(currentProperties.get(code)?.bytes ?? new Uint8Array())) : null;
        if (current && current !== 0) warnings.push(`${label} cannot yet be reset to neutral safely through the documented PTP sequence; verify it on the camera.`);
      }
    }
  }

  const priority = values.dRangePriority ?? 'Off';
  const priorityRaw = D_RANGE_PRIORITY_ENCODE[priority];
  if (priorityRaw === undefined) throw new Error(`Unsupported D-Range Priority: ${String(priority)}.`);
  operations.push(operation(PTP_PROP.D_RANGE_PRIORITY, 'D-Range Priority', packU16(priorityRaw), priority));

  if (priority === 'Off') {
    const drRaw = encodeDynamicRange(values.dynamicRange, currentProperties);
    if (drRaw === null) {
      warnings.push('DR Auto could not be encoded safely because this X-E5 has not yet exposed an observed Auto raw value. Dynamic Range was left unchanged.');
    } else {
      operations.push(operation(PTP_PROP.DYNAMIC_RANGE, 'Dynamic Range', packU16(drRaw), values.dynamicRange));
    }
  }

  operations.push(operation(PTP_PROP.GRAIN, 'Grain Effect', packU16(encodeGrain(values.grainStrength, values.grainSize)), `${values.grainStrength}/${values.grainSize}`));
  operations.push(operation(PTP_PROP.COLOR_CHROME, 'Color Chrome Effect', packU16(encodeStrength(values.colorChrome)), values.colorChrome));
  operations.push(operation(PTP_PROP.COLOR_CHROME_BLUE, 'Color Chrome FX Blue', packU16(encodeStrength(values.colorChromeBlue)), values.colorChromeBlue));
  operations.push(operation(PTP_PROP.SMOOTH_SKIN, 'Smooth Skin Effect', packU16(encodeStrength(values.smoothSkin)), values.smoothSkin));

  const wbRaw = X_E5_PTP_WHITE_BALANCE[values.whiteBalanceMode];
  if (wbRaw === undefined) throw new Error(`Unsupported white balance: ${String(values.whiteBalanceMode)}.`);
  operations.push(operation(PTP_PROP.WHITE_BALANCE, 'White Balance', packU16(wbRaw), values.whiteBalanceMode, true));
  if (values.whiteBalanceMode === 'Temperature') {
    const kelvin = Number(values.whiteBalanceKelvin);
    if (!Number.isFinite(kelvin) || kelvin < 2500 || kelvin > 10000) throw new Error('Color Temperature must be between 2500K and 10000K.');
    operations.push(operation(PTP_PROP.WB_COLOR_TEMP, 'Color Temperature', packU16(kelvin), kelvin, true));
  }
  operations.push(operation(PTP_PROP.WB_SHIFT_R, 'WB Shift Red', packI16(Number(values.wbShiftR ?? 0)), values.wbShiftR ?? 0));
  operations.push(operation(PTP_PROP.WB_SHIFT_B, 'WB Shift Blue', packI16(Number(values.wbShiftB ?? 0)), values.wbShiftB ?? 0));

  if (values.highlight !== null) operations.push(operation(PTP_PROP.HIGHLIGHT, 'Highlight', packI16(Math.round(values.highlight * 10)), values.highlight));
  if (values.shadow !== null) operations.push(operation(PTP_PROP.SHADOW, 'Shadow', packI16(Math.round(values.shadow * 10)), values.shadow));
  if (!COLOR_LOCKED_FILM_SIMULATIONS.has(film.id) && values.color !== null) {
    operations.push(operation(PTP_PROP.COLOR, 'Color', packI16(Math.round(values.color * 10)), values.color));
  }
  operations.push(operation(PTP_PROP.SHARPNESS, 'Sharpness', packI16(Math.round(Number(values.sharpness ?? 0) * 10)), values.sharpness ?? 0));

  const nr = NR_ENCODE[String(values.highIsoNr ?? 0)];
  if (nr === undefined) throw new Error(`Unsupported High ISO NR value: ${String(values.highIsoNr)}.`);
  operations.push(operation(PTP_PROP.HIGH_ISO_NR, 'High ISO NR', packU16(nr), values.highIsoNr ?? 0));
  operations.push(operation(PTP_PROP.CLARITY, 'Clarity', packI16(Math.round(Number(values.clarity ?? 0) * 10)), values.clarity ?? 0));

  return { operations, warnings };
}

/**
 * Decode all three X-E5 FS dial recipe positions from a full settings backup.
 *
 * @param {Uint8Array} blob
 */
export function decodeFsSlots(blob) {
  assertXe5Backup(blob);
  return [0, 1, 2].map((slot) => {
    const snapshot = decodeFsSlotSnapshot(blob, slot);
    const activation = decodeFsRecipeActivation(blob, slot);
    const rawProperties = [activation.property, ...snapshot.rawProperties];
    const hasUnknown = rawProperties.some((property) => property.readStatus === 'PASSTHROUGH');
    const values = fsValuesForActivation(snapshot.values, activation.status);
    return {
      id: `FS${slot + 1}`,
      type: 'FS',
      index: slot + 1,
      name: `FS${slot + 1}`,
      values,
      decodedValues: snapshot.values,
      fsRecipeStatus: activation.status,
      valuesActive: activation.status === 'ON' ? true : activation.status === 'OFF' ? false : null,
      rawProperties,
      propertyDiagnostics: rawProperties,
      readStatus: activation.status === 'OFF'
        ? hasUnknown ? 'FILM_ONLY_FS_RECIPE_OFF_WITH_PASSTHROUGH' : 'FILM_ONLY_FS_RECIPE_OFF'
        : hasUnknown ? 'COMPLETE_WITH_PASSTHROUGH' : 'COMPLETE_WITH_UNAVAILABLE_PROPERTIES',
      complete: true,
      allKnownMappingsDecoded: !hasUnknown,
      evidenceLevel: FS_EVIDENCE_LEVEL,
      researchSource: FS_RESEARCH_SOURCE,
      activationEvidenceLevel: activation.evidenceLevel,
      activationUncertainty: activation.uncertainty,
    };
  });
}

/**
 * @param {Uint8Array} blob
 * @param {number} slot Zero-based FS slot.
 */
export function decodeFsSlot(blob, slot) {
  return decodeFsSlotSnapshot(blob, slot).values;
}

/**
 * Apply an owner-observed FS RECIPE menu state without altering raw backup
 * evidence. When Off, only the film assignment is active; decoded recipe
 * fields remain available under decodedValues as explicitly latent data.
 *
 * @param {Record<string, any>} slot
 * @param {'ON'|'OFF'} status
 */
export function applyFsRecipeMenuStatus(slot, status) {
  if (status !== 'ON' && status !== 'OFF') throw new Error(`Unsupported FS RECIPE menu status: ${String(status)}.`);
  const decodedValues = { ...(slot.decodedValues ?? slot.values ?? {}) };
  const values = fsValuesForActivation(decodedValues, status);
  const rawProperties = (slot.rawProperties ?? slot.propertyDiagnostics ?? []).map((property) => ({
    ...property,
    activationStatus: status === 'ON' || property.key === 'filmSimulation' || property.key === 'fsRecipeEnabled'
      ? 'ACTIVE'
      : 'LATENT_FS_RECIPE_OFF',
  }));
  const encodedStatus = slot.fsRecipeStatus === 'ON' || slot.fsRecipeStatus === 'OFF' ? slot.fsRecipeStatus : null;
  const menuDisagreesWithBackup = encodedStatus !== null && encodedStatus !== status;
  return {
    ...slot,
    values,
    decodedValues,
    rawProperties,
    propertyDiagnostics: rawProperties,
    fsRecipeStatus: status,
    valuesActive: status === 'ON',
    readStatus: status === 'ON' ? slot.readStatus : 'FILM_ONLY_FS_RECIPE_OFF',
    activationEvidenceLevel: encodedStatus === status
      ? 'PHYSICAL_X_E5_BACKUP_AND_MENU'
      : 'PHYSICAL_X_E5_MENU',
    activationUncertainty: menuDisagreesWithBackup
      ? `The guarded backup encoded FS RECIPE ${encodedStatus}, but the later physical-menu review recorded ${status}. Treat this as a time-of-observation mismatch until refreshed.`
      : status === 'ON' ? null
      : 'FS RECIPE is Off. Only the film-simulation assignment is active; all other decoded backup fields are retained as latent evidence and are not current recipe values.',
  };
}

/**
 * Decode an FS RECIPE enable flag only for positions with an exact physical
 * X-E5 mapping. FS2 deliberately remains unavailable rather than assuming it
 * follows the physically verified FS1 and FS3 bytes.
 *
 * @param {Uint8Array} blob
 * @param {number} slot
 */
function decodeFsRecipeActivation(blob, slot) {
  const field = X_E5_FS_LAYOUT.recipeEnabledBySlot[slot];
  if (!field) {
    return {
      status: 'UNKNOWN_FROM_BACKUP',
      evidenceLevel: FS_EVIDENCE_LEVEL,
      uncertainty: `The FS${slot + 1} RECIPE enable offset has not been physically mapped. It is not inferred from the adjacent FS1 byte.`,
      property: {
        code: 'not-mapped',
        offset: null,
        key: 'fsRecipeEnabled',
        canonicalKey: 'fsRecipeEnabled',
        label: 'FS RECIPE',
        encoding: 'unmapped',
        expectedWidth: null,
        payloadWidth: null,
        bytes: null,
        rawHex: '',
        rawValue: null,
        canonicalValue: null,
        decoded: [{ field: 'fsRecipeEnabled', canonicalValue: null, status: 'unavailable' }],
        readStatus: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        normalization: null,
        uncertainty: `No physical X-E5 FS${slot + 1} RECIPE enable offset is known.`,
        evidenceLevel: FS_EVIDENCE_LEVEL,
        researchSource: FS_RESEARCH_SOURCE,
        activationStatus: 'ACTIVE',
      },
    };
  }

  const bytes = blob.slice(field.offset, field.offset + field.size);
  if (bytes.byteLength !== field.size) throw new Error(`FS${slot + 1} RECIPE flag is outside the guarded backup.`);
  const rawValue = bytes[0];
  const status = rawValue === 1 ? 'ON' : rawValue === 0 ? 'OFF' : 'UNKNOWN_FROM_BACKUP';
  const mapped = status !== 'UNKNOWN_FROM_BACKUP';
  return {
    status,
    evidenceLevel: 'PHYSICAL_X_E5_FW_1_10',
    uncertainty: mapped
      ? status === 'OFF'
        ? 'FS RECIPE is Off. Only the film-simulation assignment is active; all other decoded backup fields are retained as latent evidence and are not current recipe values.'
        : null
      : `Physical offset ${field.offset} returned unobserved raw value ${rawValue}; activation remains unknown.`,
    property: {
      code: field.offset,
      offset: field.offset,
      key: 'fsRecipeEnabled',
      canonicalKey: 'fsRecipeEnabled',
      label: 'FS RECIPE',
      encoding: 'u8',
      expectedWidth: 1,
      payloadWidth: bytes.byteLength,
      bytes,
      rawHex: bytesToHex(bytes),
      rawValue,
      canonicalValue: mapped ? status : null,
      decoded: [{ field: 'fsRecipeEnabled', canonicalValue: mapped ? status : null, status: mapped ? 'decoded' : 'unknown-enum' }],
      readStatus: mapped ? 'OK' : 'PASSTHROUGH',
      status: mapped ? 'OK' : 'PASSTHROUGH',
      normalization: mapped ? `Physical FS${slot + 1} menu and two-way volatile backup comparison confirmed ${rawValue} = ${status}.` : null,
      uncertainty: mapped ? null : `Raw value ${rawValue} is not physically mapped for the FS${slot + 1} RECIPE flag.`,
      evidenceLevel: 'PHYSICAL_X_E5_FW_1_10',
      researchSource: FS_RECIPE_FLAG_SOURCES[slot],
      activationStatus: 'ACTIVE',
    },
  };
}

/** @param {Record<string, any>} decodedValues @param {string} status */
function fsValuesForActivation(decodedValues, status) {
  if (status !== 'OFF') return { ...decodedValues };
  return Object.fromEntries(Object.keys(decodedValues).map((key) => [
    key,
    key === 'filmSimulation' ? decodedValues[key] : null,
  ]));
}

/**
 * Decode one FS slot while retaining the exact field slices used by every
 * project-known mapping. Unknown bytes remain passthrough observations.
 *
 * @param {Uint8Array} blob
 * @param {number} slot Zero-based FS slot.
 */
function decodeFsSlotSnapshot(blob, slot) {
  assertXe5Backup(blob);
  assertFsSlot(slot);
  const observations = new Map();
  for (const [key, field] of Object.entries(X_E5_FS_LAYOUT.fields)) {
    const offset = fsOffset(key, slot);
    if (!Number.isInteger(field.size) || field.size < 1 || offset < 0 || offset + field.size > blob.byteLength) {
      throw new Error(`FS${slot + 1} field ${key} at offset ${offset} with width ${field.size} is outside the ${blob.byteLength}-byte backup.`);
    }
    const bytes = blob.slice(offset, offset + field.size);
    const rawValue = field.size === 1 ? bytes[0] : field.size === 2 ? readU16(bytes) : null;
    observations.set(key, { key, offset, bytes, rawValue, size: field.size });
  }
  const readByte = (key) => observations.get(key)?.rawValue ?? null;
  const readWord = (key) => observations.get(key)?.rawValue ?? null;
  const film = FILM_SIM_BY_FS.get(readByte('filmSimulation'))?.id ?? null;
  const grainStrengthRaw = readByte('grainStrength');
  const whiteBalanceMode = FS_WHITE_BALANCE_BY_VALUE.get(readByte('whiteBalanceMode')) ?? null;
  const whiteBalanceKelvinRaw = readWord('whiteBalanceKelvin');
  const values = {
    filmSimulation: film,
    dynamicRange: ({ 0: 'Auto', 1: 'DR100', 2: 'DR200', 3: 'DR400' })[readByte('dynamicRange')] ?? null,
    dRangePriority: null,
    grainStrength: ({ 0: 'Strong', 1: 'Weak', 2: 'Off' })[grainStrengthRaw] ?? null,
    grainSize: ({ 0: 'Small', 1: 'Large' })[readByte('grainSize')] ?? null,
    colorChrome: decodeZeroStrength(readByte('colorChrome')),
    colorChromeBlue: decodeZeroStrength(readByte('colorChromeBlue')),
    smoothSkin: decodeZeroStrength(readByte('smoothSkin')),
    whiteBalanceMode,
    whiteBalanceKelvin: whiteBalanceMode === 'Temperature' && decodeKelvin(whiteBalanceKelvinRaw) !== null ? whiteBalanceKelvinRaw : null,
    wbShiftR: decodeFsOffsetScale(readByte('wbShiftR'), 0, 18, (raw) => 9 - raw),
    wbShiftB: decodeFsOffsetScale(readByte('wbShiftB'), 0, 18, (raw) => 9 - raw),
    highlight: decodeFsOffsetScale(readByte('highlight'), 0, 12, (raw) => raw / 2 - 2),
    shadow: decodeFsOffsetScale(readByte('shadow'), 0, 12, (raw) => raw / 2 - 2),
    color: film === null || COLOR_LOCKED_FILM_SIMULATIONS.has(film) ? null : decodeFsOffsetScale(readByte('color'), 3, 11, (raw) => 7 - raw),
    sharpness: decodeFsOffsetScale(readByte('sharpness'), 0, 8, (raw) => 4 - raw),
    highIsoNr: decodeFsOffsetScale(readByte('highIsoNr'), 0, 8, (raw) => raw - 4),
    clarity: decodeFsOffsetScale(readByte('clarity'), 1, 11, (raw) => raw - 6),
    monoWarmCool: MONOCHROME_FILM_SIMULATIONS.has(film ?? '') ? decodeFsOffsetScale(readByte('monoWarmCool'), 0, 36, (raw) => 18 - raw) : null,
    monoMagentaGreen: MONOCHROME_FILM_SIMULATIONS.has(film ?? '') ? decodeFsOffsetScale(readByte('monoMagentaGreen'), 0, 36, (raw) => 18 - raw) : null,
    isoMode: null,
    isoFixed: null,
    isoMin: null,
    isoMax: null,
    exposureMinEv: null,
    exposureMaxEv: null,
    exposureTypical: null,
  };

  const slotPhysicalObservations = FS_TARGET_PHYSICAL_OBSERVATIONS[slot];
  if (slotPhysicalObservations) {
    for (const [key, mappings] of Object.entries(slotPhysicalObservations)) {
      const rawValue = observations.get(key)?.rawValue;
      if (rawValue !== undefined && Object.hasOwn(mappings, rawValue)) values[key] = mappings[rawValue];
    }
  }

  const rawProperties = [...observations.values()].map((observation) => {
    const notApplicable = isFsFieldNotApplicable(observation.key, film, whiteBalanceMode);
    const canonicalValue = values[observation.key] ?? null;
    const mapped = canonicalValue !== null && canonicalValue !== undefined;
    const readStatus = notApplicable ? 'NOT_APPLICABLE' : mapped ? 'OK' : 'PASSTHROUGH';
    const physicalTargetValue = slotPhysicalObservations?.[observation.key]?.[observation.rawValue];
    const physicalTargetMatch = physicalTargetValue !== undefined && Object.is(physicalTargetValue, canonicalValue);
    const physicalFilmMatch = observation.key === 'filmSimulation'
      && FS_FILM_PHYSICAL_OBSERVATIONS[observation.rawValue] === canonicalValue;
    return {
      code: observation.offset,
      offset: observation.offset,
      key: observation.key,
      canonicalKey: observation.key,
      label: FS_FIELD_LABELS[observation.key] ?? observation.key,
      encoding: observation.size === 2 ? 'u16le' : 'u8',
      expectedWidth: observation.size,
      payloadWidth: observation.bytes.byteLength,
      bytes: observation.bytes,
      rawHex: bytesToHex(observation.bytes),
      rawValue: observation.rawValue,
      canonicalValue,
      decoded: [{
        field: observation.key,
        canonicalValue,
        status: notApplicable ? 'not-applicable' : mapped ? 'decoded' : 'unknown-enum',
      }],
      readStatus,
      status: readStatus,
      normalization: physicalTargetMatch
        ? `The enabled FS${slot + 1} menu and guarded backup physically confirmed raw ${String(observation.rawValue)} as ${String(canonicalValue)}.`
        : null,
      uncertainty: notApplicable
        ? 'The raw backup field is preserved, but it is not applicable to the decoded film simulation or white-balance mode.'
        : mapped ? null : fsDependencyUncertainty(observation.key, film, whiteBalanceMode)
          ?? knownDomainUncertainty([observation.key], observation.rawValue)
          ?? `Raw value ${String(observation.rawValue)} has no project-verified mapping and remains passthrough data.`,
      evidenceLevel: physicalTargetMatch || physicalFilmMatch ? 'PHYSICAL_X_E5_FW_1_10' : FS_EVIDENCE_LEVEL,
      researchSource: physicalTargetMatch
        ? FS_TARGET_PHYSICAL_SOURCES[slot]
        : physicalFilmMatch ? FS_FILM_PHYSICAL_SOURCE : FS_RESEARCH_SOURCE,
    };
  });

  rawProperties.push({
    code: 'not-mapped',
    offset: null,
    key: 'dRangePriority',
    canonicalKey: 'dRangePriority',
    label: 'D-Range Priority',
    encoding: 'unmapped',
    expectedWidth: null,
    payloadWidth: null,
    bytes: null,
    rawHex: '',
    rawValue: null,
    canonicalValue: null,
    decoded: [{ field: 'dRangePriority', canonicalValue: null, status: 'unavailable' }],
    readStatus: 'UNAVAILABLE',
    status: 'UNAVAILABLE',
    normalization: null,
    uncertainty: 'No X-E5 FS backup offset is known to this project. The value is not inferred as Off or from recipe defaults.',
    evidenceLevel: FS_EVIDENCE_LEVEL,
    researchSource: FS_RESEARCH_SOURCE,
  });

  return { values, rawProperties };
}

/**
 * Patch one X-E5 FS slot and delta-update the observed checksum.
 *
 * @param {Uint8Array} blob
 * @param {number} slot Zero-based FS slot.
 * @param {Record<string, any>} values
 * @returns {{ blob: Uint8Array, changes: Array<{ offset: number, before: number[], after: number[], field: string }>, warnings: string[] }}
 */
export function patchFsSlot(blob, slot, values) {
  assertXe5Backup(blob);
  assertFsSlot(slot);
  const output = new Uint8Array(blob);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const changes = [];
  const warnings = [];
  let delta = 0;

  const writeByte = (key, value) => {
    const offset = fsOffset(key, slot);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${key} encoded outside a byte: ${value}.`);
    const before = output[offset];
    if (before === value) return;
    output[offset] = value;
    delta += value - before;
    changes.push({ offset, before: [before], after: [value], field: key });
  };

  const writeWord = (key, value) => {
    const offset = fsOffset(key, slot);
    const before = [output[offset], output[offset + 1]];
    view.setUint16(offset, value, true);
    const after = [output[offset], output[offset + 1]];
    if (before[0] === after[0] && before[1] === after[1]) return;
    delta += after[0] + after[1] - before[0] - before[1];
    changes.push({ offset, before, after, field: key });
  };

  const film = FILM_SIM_BY_ID.get(values.filmSimulation);
  if (!film?.fs) throw new Error(`Film simulation ${String(values.filmSimulation)} has no verified X-E5 FS code.`);
  writeByte('filmSimulation', film.fs);

  if (values.dynamicRange === 'Auto') writeByte('dynamicRange', 0);
  else if (values.dynamicRange === 'DR100') writeByte('dynamicRange', 1);
  else if (values.dynamicRange === 'DR200') writeByte('dynamicRange', 2);
  else if (values.dynamicRange === 'DR400') writeByte('dynamicRange', 3);
  else warnings.push(`Dynamic Range ${String(values.dynamicRange)} was not written.`);

  if (values.dRangePriority && values.dRangePriority !== 'Off') {
    warnings.push('D-Range Priority is not present in the currently verified X-E5 FS array map and was not written.');
  }

  writeByte('highIsoNr', Number(values.highIsoNr ?? 0) + 4);
  writeByte('clarity', Number(values.clarity ?? 0) + 6);
  writeByte('sharpness', 4 - Number(values.sharpness ?? 0));
  if (!COLOR_LOCKED_FILM_SIMULATIONS.has(film.id) && values.color !== null) writeByte('color', 7 - Number(values.color));
  if (values.highlight !== null) writeByte('highlight', Math.round((Number(values.highlight) + 2) * 2));
  if (values.shadow !== null) writeByte('shadow', Math.round((Number(values.shadow) + 2) * 2));
  writeByte('colorChrome', encodeZeroStrength(values.colorChrome));
  writeByte('colorChromeBlue', encodeZeroStrength(values.colorChromeBlue));
  writeByte('smoothSkin', encodeZeroStrength(values.smoothSkin));
  writeByte('grainStrength', ({ Strong: 0, Weak: 1, Off: 2 })[values.grainStrength] ?? 2);
  if (values.grainStrength !== 'Off') writeByte('grainSize', values.grainSize === 'Large' ? 1 : 0);

  const wbMode = X_E5_FS_WHITE_BALANCE[values.whiteBalanceMode];
  if (wbMode === undefined) warnings.push(`White Balance ${String(values.whiteBalanceMode)} has no verified FS code and was left unchanged.`);
  else {
    writeByte('whiteBalanceMode', wbMode);
    if (values.whiteBalanceMode === 'Temperature') writeWord('whiteBalanceKelvin', Number(values.whiteBalanceKelvin));
    writeByte('wbShiftR', 9 - Number(values.wbShiftR ?? 0));
    writeByte('wbShiftB', 9 - Number(values.wbShiftB ?? 0));
  }

  if (MONOCHROME_FILM_SIMULATIONS.has(film.id)) {
    writeByte('monoWarmCool', 18 - Number(values.monoWarmCool ?? 0));
    writeByte('monoMagentaGreen', 18 - Number(values.monoMagentaGreen ?? 0));
  }

  const checksumOffset = X_E5_FS_LAYOUT.checksumOffset;
  const checksumBefore = view.getUint16(checksumOffset, true);
  const checksumAfter = (checksumBefore + delta) & 0xffff;
  view.setUint16(checksumOffset, checksumAfter, true);
  if (checksumBefore !== checksumAfter) {
    changes.push({
      offset: checksumOffset,
      before: [checksumBefore & 0xff, checksumBefore >>> 8],
      after: [checksumAfter & 0xff, checksumAfter >>> 8],
      field: 'checksum',
    });
  }

  return { blob: output, changes, warnings };
}

/** @param {Uint8Array} blob */
export function modelFromBackup(blob) {
  if (blob.byteLength < 0x34 || new TextDecoder('ascii').decode(blob.slice(0, 8)) !== 'FUJIFILM') return null;
  const raw = blob.slice(0x14, 0x34);
  const zero = raw.indexOf(0);
  return new TextDecoder('ascii').decode(zero >= 0 ? raw.slice(0, zero) : raw).trim() || null;
}

/** @param {Uint8Array} blob */
export function assertXe5Backup(blob) {
  const model = modelFromBackup(blob);
  if (normalizeModel(model) !== 'XE5') throw new Error(`Backup model is ${model ?? 'unknown'}, not X-E5.`);
  if (blob.byteLength !== X_E5_FS_LAYOUT.blobSize) throw new Error(`X-E5 backup is ${blob.byteLength} bytes; expected ${X_E5_FS_LAYOUT.blobSize}.`);
}

/** @param {string|null} model */
export function normalizeModel(model) {
  return String(model ?? '').toUpperCase().replace('FUJIFILM', '').replace(/[^A-Z0-9]+/g, '');
}

/** @param {number} slot */
function assertFsSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= X_E5_FS_LAYOUT.slots) throw new Error(`FS slot index ${slot} is outside 0..${X_E5_FS_LAYOUT.slots - 1}.`);
}

/** @param {string} key @param {number} slot */
function fsOffset(key, slot) {
  const field = X_E5_FS_LAYOUT.fields[key];
  if (!field) throw new Error(`Unknown FS field: ${key}.`);
  return field.offset + slot * field.step;
}

/** @param {Uint8Array|undefined} bytes */
function readExactU16(bytes) {
  return bytes?.byteLength === 2 ? readU16(bytes) : null;
}

/** @param {Uint8Array|undefined} bytes */
function readExactI16(bytes) {
  return bytes?.byteLength === 2 ? readI16(bytes) : null;
}

/** @param {Record<string, any>} values @param {string} menuEvidence @param {string|null} [uncertainty] */
function observed(values, menuEvidence, uncertainty = null) {
  return Object.freeze({ values: Object.freeze(values), menuEvidence, uncertainty });
}

/** @param {number} code @param {number|null} raw */
function cReadObservation(code, raw) {
  if (!Number.isInteger(raw)) return null;
  return X_E5_FW_1_10_C_READ_OBSERVATIONS[code]?.[raw & 0xffff] ?? null;
}

/** @param {number} code @param {number|null} raw @param {string} field */
function observedField(code, raw, field) {
  return cReadObservation(code, raw)?.values?.[field] ?? null;
}

/** @param {string[]} fields @param {number|null} rawValue */
function cReadMappingUncertainty(fields, rawValue) {
  const labels = fields.length > 0 ? fields.join(', ') : 'this property';
  return `Raw value ${formatRawScalar(rawValue)} for ${labels} has not been mapped by physical X-E5 evidence; the exact payload remains passthrough data.`;
}

/** @param {number|null} value */
function formatRawScalar(value) {
  if (!Number.isInteger(value)) return String(value);
  const unsigned = Number(value) & 0xffff;
  return `${String(value)} (0x${unsigned.toString(16).toUpperCase().padStart(4, '0')})`;
}

/** @param {number|null} raw */
function decodeDynamicRange(raw) {
  if (raw === 100) return 'DR100';
  if (raw === 200) return 'DR200';
  if (raw === 400) return 'DR400';
  if (raw === 0 || raw === 0xffff) return 'Auto';
  return null;
}

/** @param {any} value @param {RawPropertyMap|null} currentProperties */
function encodeDynamicRange(value, currentProperties) {
  if (value === 'DR100') return 100;
  if (value === 'DR200') return 200;
  if (value === 'DR400') return 400;
  if (value !== 'Auto') throw new Error(`Unsupported Dynamic Range: ${String(value)}.`);
  const observed = currentProperties ? readU16(currentProperties.get(PTP_PROP.DYNAMIC_RANGE)?.bytes ?? new Uint8Array()) : null;
  return observed === 0 || observed === 0xffff ? observed : null;
}

/** @param {number|null} raw */
function decodeGrain(raw) {
  if (raw === 1) return { strength: 'Off', size: 'Small' };
  if (raw === 2) return { strength: 'Weak', size: 'Small' };
  if (raw === 3) return { strength: 'Strong', size: 'Small' };
  if (raw === 4) return { strength: 'Weak', size: 'Large' };
  if (raw === 5) return { strength: 'Strong', size: 'Large' };
  if (raw === 6) return { strength: 'Off', size: 'Small' };
  if (raw === 7) return { strength: 'Off', size: 'Large' };
  return { strength: null, size: null };
}

/** @param {any} strength @param {any} size */
function encodeGrain(strength, size) {
  if (strength === 'Off') return 1;
  if (strength === 'Weak') return size === 'Large' ? 4 : 2;
  if (strength === 'Strong') return size === 'Large' ? 5 : 3;
  throw new Error(`Unsupported Grain Effect: ${String(strength)}/${String(size)}.`);
}

/** @param {number|null} raw */
function decodeStrength(raw) {
  return raw === 2 ? 'Weak' : raw === 3 ? 'Strong' : raw === 1 ? 'Off' : null;
}

/** @param {any} value */
function encodeStrength(value) {
  if (value === 'Off') return 1;
  if (value === 'Weak') return 2;
  if (value === 'Strong') return 3;
  throw new Error(`Unsupported strength value: ${String(value)}.`);
}

/** @param {number|null} raw */
function decodeZeroStrength(raw) {
  if (raw === 0) return 'Off';
  if (raw === 1) return 'Weak';
  if (raw === 2) return 'Strong';
  return null;
}

/** @param {any} value */
function encodeZeroStrength(value) {
  if (value === 'Off') return 0;
  if (value === 'Weak') return 1;
  if (value === 'Strong') return 2;
  return 0;
}

/** @param {number|null} raw */
function decodeX10(raw) {
  if (raw === null || raw === -32768) return null;
  return raw / 10;
}

/** @param {number|null} raw @param {readonly number[]} options */
function decodeExactOption(raw, options) {
  return raw !== null && options.includes(raw) ? raw : null;
}

/** @param {number|null} raw @param {readonly number[]} options */
function decodeX10Option(raw, options) {
  if (raw === null || raw === -32768) return null;
  const decoded = raw / 10;
  return options.includes(decoded) ? decoded : null;
}

/** @param {number|null} raw */
function decodeKelvin(raw) {
  return Number.isInteger(raw) && raw >= 2500 && raw <= 10000 && raw % 10 === 0 ? raw : null;
}

/** @param {string[]} fields @param {number|null} rawValue */
function knownDomainUncertainty(fields, rawValue) {
  const domain = fields.map((field) => ({
    highlight: '-2 through +4 in 0.5 steps',
    shadow: '-2 through +4 in 0.5 steps',
    color: '-4 through +4 in whole steps',
    sharpness: '-4 through +4 in whole steps',
    clarity: '-5 through +5 in whole steps',
    wbShiftR: '-9 through +9 in whole steps',
    wbShiftB: '-9 through +9 in whole steps',
    monoWarmCool: '-18 through +18 in whole steps',
    monoMagentaGreen: '-18 through +18 in whole steps',
    whiteBalanceKelvin: '2500 through 10000 K in 10 K steps',
  })[field]).find(Boolean);
  return domain
    ? `Raw value ${String(rawValue)} is outside the project-known domain (${domain}); the payload is preserved as passthrough evidence.`
    : null;
}

/** @param {number|null} raw @param {number} minimum @param {number} maximum @param {(raw: number) => number} transform */
function decodeFsOffsetScale(raw, minimum, maximum, transform) {
  return inRange(raw, minimum, maximum) ? transform(raw) : null;
}

/** @param {number|null} value @param {number} minimum @param {number} maximum */
function inRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

/** @param {string} key @param {string|null} film @param {string|null} whiteBalanceMode */
function isFsFieldNotApplicable(key, film, whiteBalanceMode) {
  if (key === 'whiteBalanceKelvin') return whiteBalanceMode !== null && whiteBalanceMode !== 'Temperature';
  if (key === 'color') return COLOR_LOCKED_FILM_SIMULATIONS.has(film ?? '');
  if (key === 'monoWarmCool' || key === 'monoMagentaGreen') return film !== null && !MONOCHROME_FILM_SIMULATIONS.has(film);
  return false;
}

/** Explain dependency-gated FS fields without treating unknown dependencies as Off/not-applicable. */
function fsDependencyUncertainty(key, film, whiteBalanceMode) {
  if (film === null && ['color', 'monoWarmCool', 'monoMagentaGreen'].includes(key)) {
    return 'Film simulation is unknown, so this dependent field remains passthrough evidence rather than being decoded or marked not applicable.';
  }
  if (whiteBalanceMode === null && key === 'whiteBalanceKelvin') {
    return 'White-balance mode is unknown, so the Kelvin field remains passthrough evidence.';
  }
  return null;
}

/** @param {number} code @param {string} label @param {Uint8Array} bytes @param {any} expected @param {boolean} [critical] */
function operation(code, label, bytes, expected, critical = false) {
  return { code, label, bytes, expected, critical };
}

/**
 * A PTP string helper is exported here so camera clients do not need to know
 * the binary representation of preset names.
 */
export { encodePtpString, decodePtpString, NR_ENCODE, NR_DECODE };
