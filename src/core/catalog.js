// @ts-check

/**
 * Canonical recipe vocabulary for the Fujifilm X-E5.
 *
 * Values in this file are UI/domain values, not raw PTP or backup bytes.
 */

export const RECIPE_SCHEMA_VERSION = 1;

export const FILM_SIMULATIONS = Object.freeze([
  { id: 'Provia', label: 'Provia / Standard', ptp: 0x01, fs: 0x01 },
  { id: 'Velvia', label: 'Velvia / Vivid', ptp: 0x02, fs: 0x04 },
  { id: 'Astia', label: 'Astia / Soft', ptp: 0x03, fs: 0x02 },
  { id: 'ProNegHi', label: 'PRO Neg. Hi', ptp: 0x04, fs: 0x0e },
  { id: 'ProNegStd', label: 'PRO Neg. Std', ptp: 0x05, fs: 0x0d },
  { id: 'Monochrome', label: 'Monochrome', ptp: 0x06, fs: 0x09 },
  { id: 'MonochromeY', label: 'Monochrome + Ye', ptp: 0x07, fs: 0x0b },
  { id: 'MonochromeR', label: 'Monochrome + R', ptp: 0x08, fs: 0x0a },
  { id: 'MonochromeG', label: 'Monochrome + G', ptp: 0x09, fs: 0x0c },
  { id: 'Sepia', label: 'Sepia', ptp: 0x0a, fs: 0x06 },
  { id: 'ClassicChrome', label: 'Classic Chrome', ptp: 0x0b, fs: 0x0f },
  { id: 'Acros', label: 'ACROS', ptp: 0x0c, fs: 0x16 },
  { id: 'AcrosY', label: 'ACROS + Ye', ptp: 0x0d, fs: 0x18 },
  { id: 'AcrosR', label: 'ACROS + R', ptp: 0x0e, fs: 0x17 },
  { id: 'AcrosG', label: 'ACROS + G', ptp: 0x0f, fs: 0x19 },
  { id: 'Eterna', label: 'ETERNA / Cinema', ptp: 0x10, fs: 0x13 },
  { id: 'ClassicNeg', label: 'Classic Negative', ptp: 0x11, fs: 0x10 },
  { id: 'EternaBleach', label: 'ETERNA Bleach Bypass', ptp: 0x12, fs: 0x14 },
  { id: 'NostalgicNeg', label: 'Nostalgic Negative', ptp: 0x13, fs: 0x11 },
  { id: 'RealaAce', label: 'REALA ACE', ptp: 0x14, fs: 0x12 },
]);

export const FILM_SIM_BY_ID = new Map(FILM_SIMULATIONS.map((item) => [item.id, item]));
export const FILM_SIM_BY_PTP = new Map(FILM_SIMULATIONS.map((item) => [item.ptp, item]));
export const FILM_SIM_BY_FS = new Map(FILM_SIMULATIONS.map((item) => [item.fs, item]));

export const MONOCHROME_FILM_SIMULATIONS = new Set([
  'Monochrome',
  'MonochromeY',
  'MonochromeR',
  'MonochromeG',
  'Acros',
  'AcrosY',
  'AcrosR',
  'AcrosG',
]);

export const COLOR_LOCKED_FILM_SIMULATIONS = new Set([
  ...MONOCHROME_FILM_SIMULATIONS,
  'Sepia',
]);

export const DYNAMIC_RANGE_OPTIONS = Object.freeze(['Auto', 'DR100', 'DR200', 'DR400']);
export const D_RANGE_PRIORITY_OPTIONS = Object.freeze(['Off', 'Weak', 'Strong', 'Auto']);
export const STRENGTH_OPTIONS = Object.freeze(['Off', 'Weak', 'Strong']);
export const GRAIN_SIZE_OPTIONS = Object.freeze(['Small', 'Large']);
export const WHITE_BALANCE_OPTIONS = Object.freeze([
  'Auto',
  'AutoWhitePriority',
  'AutoAmbiencePriority',
  'Daylight',
  'Shade',
  'Fluorescent1',
  'Fluorescent2',
  'Fluorescent3',
  'Incandescent',
  'Underwater',
  'Temperature',
  'Custom1',
  'Custom2',
  'Custom3',
]);

export const WHITE_BALANCE_LABELS = Object.freeze({
  Auto: 'Auto',
  AutoWhitePriority: 'Auto White Priority',
  AutoAmbiencePriority: 'Auto Ambience Priority',
  Daylight: 'Daylight',
  Shade: 'Shade',
  Fluorescent1: 'Fluorescent 1',
  Fluorescent2: 'Fluorescent 2',
  Fluorescent3: 'Fluorescent 3',
  Incandescent: 'Incandescent',
  Underwater: 'Underwater',
  Temperature: 'Color Temperature',
  Custom1: 'Custom 1',
  Custom2: 'Custom 2',
  Custom3: 'Custom 3',
});

export const X_E5_PTP_WHITE_BALANCE = Object.freeze({
  Auto: 0x0002,
  Daylight: 0x0004,
  Incandescent: 0x0006,
  Underwater: 0x0008,
  Fluorescent1: 0x8001,
  Fluorescent2: 0x8002,
  Fluorescent3: 0x8003,
  Shade: 0x8006,
  Temperature: 0x8007,
  Custom1: 0x8008,
  Custom2: 0x8009,
  Custom3: 0x800a,
  AutoWhitePriority: 0x8020,
  AutoAmbiencePriority: 0x8021,
});

export const X_E5_FS_WHITE_BALANCE = Object.freeze({
  Auto: 0x00,
  AutoWhitePriority: 0x01,
  AutoAmbiencePriority: 0x02,
  Daylight: 0x03,
  Shade: 0x04,
  Fluorescent1: 0x05,
  Fluorescent2: 0x06,
  Fluorescent3: 0x07,
  Incandescent: 0x08,
  Underwater: 0x09,
  Temperature: 0x0a,
  Custom1: 0x0b,
  Custom2: 0x0c,
  Custom3: 0x0d,
});

export const PTP_WHITE_BALANCE_BY_VALUE = new Map(
  Object.entries(X_E5_PTP_WHITE_BALANCE).map(([key, value]) => [value, key]),
);
export const FS_WHITE_BALANCE_BY_VALUE = new Map(
  Object.entries(X_E5_FS_WHITE_BALANCE).map(([key, value]) => [value, key]),
);

export const TONE_OPTIONS = Object.freeze(makeNumberRange(-2, 4, 0.5));
export const COLOR_OPTIONS = Object.freeze(makeNumberRange(-4, 4, 1));
export const CLARITY_OPTIONS = Object.freeze(makeNumberRange(-5, 5, 1));
export const WB_SHIFT_OPTIONS = Object.freeze(makeNumberRange(-9, 9, 1));
export const MONO_TONING_OPTIONS = Object.freeze(makeNumberRange(-18, 18, 1));

/** @type {Record<string, unknown>} */
export const NEUTRAL_RECIPE_VALUES = Object.freeze({
  filmSimulation: 'Provia',
  dynamicRange: 'DR100',
  dRangePriority: 'Off',
  grainStrength: 'Off',
  grainSize: 'Small',
  colorChrome: 'Off',
  colorChromeBlue: 'Off',
  smoothSkin: 'Off',
  whiteBalanceMode: 'Auto',
  whiteBalanceKelvin: 5600,
  wbShiftR: 0,
  wbShiftB: 0,
  highlight: 0,
  shadow: 0,
  color: 0,
  sharpness: 0,
  highIsoNr: 0,
  clarity: 0,
  monoWarmCool: 0,
  monoMagentaGreen: 0,
  isoMode: null,
  isoFixed: null,
  isoMin: null,
  isoMax: null,
  exposureMinEv: null,
  exposureMaxEv: null,
  exposureTypical: null,
});

export const FIELD_STATUS = Object.freeze({
  EXACT: 'exact',
  ALIAS: 'alias',
  INFERRED: 'inferred',
  MISSING: 'missing',
  INVALID: 'invalid',
  CURRENT: 'current',
  NEUTRAL: 'neutral',
  USER: 'user',
  NOT_APPLICABLE: 'not-applicable',
});

/**
 * Field definitions drive the comparison/editor UI and write planning.
 * `external` fields are parsed and displayed but are not written to a recipe
 * slot through the initial PTP/FS implementation.
 */
export const FIELD_DEFINITIONS = Object.freeze([
  { key: 'filmSimulation', label: 'Film Simulation', group: 'Base', type: 'film', neutral: 'Provia', writable: true },
  { key: 'dynamicRange', label: 'Dynamic Range', group: 'Base', type: 'choice', options: DYNAMIC_RANGE_OPTIONS, neutral: 'DR100', writable: true },
  { key: 'dRangePriority', label: 'D-Range Priority', group: 'Base', type: 'choice', options: D_RANGE_PRIORITY_OPTIONS, neutral: 'Off', writable: true },
  { key: 'grainStrength', label: 'Grain Strength', group: 'Effects', type: 'choice', options: STRENGTH_OPTIONS, neutral: 'Off', writable: true },
  { key: 'grainSize', label: 'Grain Size', group: 'Effects', type: 'choice', options: GRAIN_SIZE_OPTIONS, neutral: 'Small', writable: true },
  { key: 'colorChrome', label: 'Color Chrome Effect', group: 'Effects', type: 'choice', options: STRENGTH_OPTIONS, neutral: 'Off', writable: true },
  { key: 'colorChromeBlue', label: 'Color Chrome FX Blue', group: 'Effects', type: 'choice', options: STRENGTH_OPTIONS, neutral: 'Off', writable: true },
  { key: 'smoothSkin', label: 'Smooth Skin Effect', group: 'Effects', type: 'choice', options: STRENGTH_OPTIONS, neutral: 'Off', writable: true },
  { key: 'whiteBalanceMode', label: 'White Balance', group: 'White Balance', type: 'white-balance', options: WHITE_BALANCE_OPTIONS, neutral: 'Auto', writable: true },
  { key: 'whiteBalanceKelvin', label: 'Color Temperature', group: 'White Balance', type: 'kelvin', min: 2500, max: 10000, step: 10, neutral: 5600, writable: true },
  { key: 'wbShiftR', label: 'WB Shift Red', group: 'White Balance', type: 'wb-shift', options: WB_SHIFT_OPTIONS, neutral: 0, writable: true },
  { key: 'wbShiftB', label: 'WB Shift Blue', group: 'White Balance', type: 'wb-shift', options: WB_SHIFT_OPTIONS, neutral: 0, writable: true },
  { key: 'highlight', label: 'Highlight', group: 'Tone', type: 'scale', options: TONE_OPTIONS, neutral: 0, writable: true },
  { key: 'shadow', label: 'Shadow', group: 'Tone', type: 'scale', options: TONE_OPTIONS, neutral: 0, writable: true },
  { key: 'color', label: 'Color', group: 'Tone', type: 'scale', options: COLOR_OPTIONS, neutral: 0, writable: true },
  { key: 'sharpness', label: 'Sharpness', group: 'Tone', type: 'scale', options: COLOR_OPTIONS, neutral: 0, writable: true },
  { key: 'highIsoNr', label: 'High ISO NR', group: 'Tone', type: 'scale', options: COLOR_OPTIONS, neutral: 0, writable: true },
  { key: 'clarity', label: 'Clarity', group: 'Tone', type: 'scale', options: CLARITY_OPTIONS, neutral: 0, writable: true },
  { key: 'monoWarmCool', label: 'Monochromatic Warm/Cool', group: 'Monochrome', type: 'scale', options: MONO_TONING_OPTIONS, neutral: 0, writable: true },
  { key: 'monoMagentaGreen', label: 'Monochromatic Magenta/Green', group: 'Monochrome', type: 'scale', options: MONO_TONING_OPTIONS, neutral: 0, writable: true },
  { key: 'isoMode', label: 'ISO Mode', group: 'Shooting Reminder', type: 'external', neutral: null, writable: false },
  { key: 'isoFixed', label: 'Fixed ISO', group: 'Shooting Reminder', type: 'external', neutral: null, writable: false },
  { key: 'isoMin', label: 'Minimum ISO', group: 'Shooting Reminder', type: 'external', neutral: null, writable: false },
  { key: 'isoMax', label: 'Maximum ISO', group: 'Shooting Reminder', type: 'external', neutral: null, writable: false },
  { key: 'exposureMinEv', label: 'Exposure Compensation Min', group: 'Shooting Reminder', type: 'external', neutral: null, writable: false },
  { key: 'exposureMaxEv', label: 'Exposure Compensation Max', group: 'Shooting Reminder', type: 'external', neutral: null, writable: false },
]);

export const FIELD_BY_KEY = new Map(FIELD_DEFINITIONS.map((field) => [field.key, field]));
export const WRITABLE_FIELD_KEYS = Object.freeze(FIELD_DEFINITIONS.filter((field) => field.writable).map((field) => field.key));
export const EXTERNAL_FIELD_KEYS = Object.freeze(FIELD_DEFINITIONS.filter((field) => !field.writable).map((field) => field.key));

/**
 * Convert common film-simulation spelling variants to a canonical ID.
 *
 * @param {string} raw
 * @returns {{ value: string | null, alias: boolean }}
 */
export function canonicalFilmSimulation(raw) {
  const normalized = normalizeCatalogToken(raw);
  const exact = FILM_SIMULATIONS.find((item) => normalizeCatalogToken(item.label) === normalized || normalizeCatalogToken(item.id) === normalized);
  if (exact) return { value: exact.id, alias: normalizeCatalogToken(exact.label) !== normalized && normalizeCatalogToken(exact.id) !== normalized };

  const aliases = new Map([
    ['proviastandard', 'Provia'],
    ['standard', 'Provia'],
    ['velviavivid', 'Velvia'],
    ['vivid', 'Velvia'],
    ['astiasoft', 'Astia'],
    ['soft', 'Astia'],
    ['proneghi', 'ProNegHi'],
    ['pronegativehi', 'ProNegHi'],
    ['pronegstd', 'ProNegStd'],
    ['pronegstandard', 'ProNegStd'],
    ['pronegativestd', 'ProNegStd'],
    ['pronegativestandard', 'ProNegStd'],
    ['monochromeye', 'MonochromeY'],
    ['monochromeyellow', 'MonochromeY'],
    ['monochromer', 'MonochromeR'],
    ['monochromered', 'MonochromeR'],
    ['monochromeg', 'MonochromeG'],
    ['monochromegreen', 'MonochromeG'],
    ['classicchrome', 'ClassicChrome'],
    ['acrosye', 'AcrosY'],
    ['acrosyellow', 'AcrosY'],
    ['acrosr', 'AcrosR'],
    ['acrosred', 'AcrosR'],
    ['acrosg', 'AcrosG'],
    ['acrosgreen', 'AcrosG'],
    ['eternacinema', 'Eterna'],
    ['cinema', 'Eterna'],
    ['classicneg', 'ClassicNeg'],
    ['classicnegative', 'ClassicNeg'],
    ['eternableachbypass', 'EternaBleach'],
    ['bleachbypass', 'EternaBleach'],
    ['nostalgicneg', 'NostalgicNeg'],
    ['nostalgicnegative', 'NostalgicNeg'],
    ['reala', 'RealaAce'],
    ['realaace', 'RealaAce'],
  ]);

  return { value: aliases.get(normalized) ?? null, alias: aliases.has(normalized) };
}

/** @param {string} raw */
export function canonicalWhiteBalance(raw) {
  const token = normalizeCatalogToken(raw);
  const aliases = new Map([
    ['auto', 'Auto'],
    ['awb', 'Auto'],
    ['autowhitepriority', 'AutoWhitePriority'],
    ['whitepriority', 'AutoWhitePriority'],
    ['autoambiencepriority', 'AutoAmbiencePriority'],
    ['autoambientpriority', 'AutoAmbiencePriority'],
    ['ambiencepriority', 'AutoAmbiencePriority'],
    ['ambientpriority', 'AutoAmbiencePriority'],
    ['daylight', 'Daylight'],
    ['fine', 'Daylight'],
    ['daylightfine', 'Daylight'],
    ['shade', 'Shade'],
    ['fluorescent1', 'Fluorescent1'],
    ['fluorescent2', 'Fluorescent2'],
    ['fluorescent3', 'Fluorescent3'],
    ['incandescent', 'Incandescent'],
    ['tungsten', 'Incandescent'],
    ['underwater', 'Underwater'],
    ['temperature', 'Temperature'],
    ['colortemperature', 'Temperature'],
    ['kelvin', 'Temperature'],
    ['custom1', 'Custom1'],
    ['custom2', 'Custom2'],
    ['custom3', 'Custom3'],
  ]);
  return aliases.get(token) ?? null;
}

/** @param {string} raw */
export function normalizeCatalogToken(raw) {
  return String(raw)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * @param {number} min
 * @param {number} max
 * @param {number} step
 */
function makeNumberRange(min, max, step) {
  const values = [];
  for (let value = min; value <= max + Number.EPSILON; value += step) {
    values.push(Number(value.toFixed(3)));
  }
  return values;
}
