// @ts-check

import {
  COLOR_LOCKED_FILM_SIMULATIONS,
  FIELD_BY_KEY,
  FIELD_DEFINITIONS,
  FIELD_STATUS,
  MONOCHROME_FILM_SIMULATIONS,
  NEUTRAL_RECIPE_VALUES,
} from './catalog.js';

/**
 * @typedef {import('./schema.js').CanonicalRecipe} CanonicalRecipe
 * @typedef {'imported'|'current'|'neutral'|'manual'} ResolutionChoice
 */

/**
 * Resolve parsed, current and neutral values into a final recipe proposal.
 *
 * @param {CanonicalRecipe} parsed
 * @param {Record<string, any>|null} currentValues
 * @param {{ defaultMissing?: 'current'|'neutral', choices?: Record<string, ResolutionChoice>, manualValues?: Record<string, any> }} [options]
 * @returns {{ values: Record<string, any>, provenance: Record<string, { choice: ResolutionChoice|'not-applicable', status: string, explanation: string }>, warnings: string[] }}
 */
export function resolveRecipeValues(parsed, currentValues, options = {}) {
  const defaultMissing = options.defaultMissing ?? 'current';
  const choices = options.choices ?? {};
  const manualValues = options.manualValues ?? {};
  /** @type {Record<string, any>} */
  const values = {};
  /** @type {Record<string, { choice: ResolutionChoice|'not-applicable', status: string, explanation: string }>} */
  const provenance = {};
  const warnings = [];

  for (const field of FIELD_DEFINITIONS) {
    const parsedValue = parsed.values[field.key];
    const parsedMeta = parsed.fields[field.key];
    const hasParsed = parsedValue !== null
      && parsedValue !== undefined
      && parsedMeta?.status !== FIELD_STATUS.INVALID
      && parsedMeta?.status !== FIELD_STATUS.NOT_APPLICABLE;

    let choice = choices[field.key];
    if (!choice) choice = hasParsed ? 'imported' : defaultMissing;

    if (choice === 'manual' && field.key in manualValues) {
      values[field.key] = manualValues[field.key];
      provenance[field.key] = {
        choice: 'manual',
        status: FIELD_STATUS.USER,
        explanation: 'Edited in the final-value column.',
      };
      continue;
    }

    if (choice === 'imported' && hasParsed) {
      values[field.key] = parsedValue;
      provenance[field.key] = {
        choice: 'imported',
        status: parsedMeta?.status ?? FIELD_STATUS.EXACT,
        explanation: parsedMeta?.alias
          ? `Parsed from the source through alias “${parsedMeta.alias}”.`
          : 'Parsed from the source.',
      };
      continue;
    }

    if (choice === 'current' && currentValues && currentValues[field.key] !== undefined && currentValues[field.key] !== null) {
      values[field.key] = currentValues[field.key];
      provenance[field.key] = {
        choice: 'current',
        status: FIELD_STATUS.CURRENT,
        explanation: 'The source omitted this field, so the camera slot value is preserved.',
      };
      continue;
    }

    values[field.key] = NEUTRAL_RECIPE_VALUES[field.key] ?? field.neutral ?? null;
    provenance[field.key] = {
      choice: 'neutral',
      status: FIELD_STATUS.NEUTRAL,
      explanation: 'The source omitted this field, so the X-E5 neutral value is used.',
    };
  }

  values.exposureTypical = parsed.values.exposureTypical;
  applyFinalApplicability(values, provenance, warnings);
  return { values, provenance, warnings };
}

/**
 * Re-run cross-field constraints after the user edits a final value.
 *
 * @param {Record<string, any>} values
 * @param {Record<string, { choice: ResolutionChoice|'not-applicable', status: string, explanation: string }>} provenance
 * @param {string[]} warnings
 */
function applyFinalApplicability(values, provenance, warnings) {
  const priority = values.dRangePriority;
  if (priority && priority !== 'Off') {
    for (const key of ['dynamicRange', 'highlight', 'shadow']) {
      values[key] = null;
      provenance[key] = {
        choice: 'not-applicable',
        status: FIELD_STATUS.NOT_APPLICABLE,
        explanation: 'Disabled because D-Range Priority is active.',
      };
    }
  }

  const film = values.filmSimulation;
  if (COLOR_LOCKED_FILM_SIMULATIONS.has(film)) {
    values.color = null;
    provenance.color = {
      choice: 'not-applicable',
      status: FIELD_STATUS.NOT_APPLICABLE,
      explanation: 'Color is disabled for this film simulation.',
    };
  }

  if (!MONOCHROME_FILM_SIMULATIONS.has(film)) {
    for (const key of ['monoWarmCool', 'monoMagentaGreen']) {
      values[key] = null;
      provenance[key] = {
        choice: 'not-applicable',
        status: FIELD_STATUS.NOT_APPLICABLE,
        explanation: 'Monochromatic Color is only available for ACROS and Monochrome simulations.',
      };
    }
  }

  if (values.whiteBalanceMode !== 'Temperature') {
    values.whiteBalanceKelvin = null;
    provenance.whiteBalanceKelvin = {
      choice: 'not-applicable',
      status: FIELD_STATUS.NOT_APPLICABLE,
      explanation: 'Kelvin is only written for Color Temperature white balance.',
    };
  }

  if (values.grainStrength === 'Off') {
    provenance.grainSize = {
      choice: 'not-applicable',
      status: FIELD_STATUS.NOT_APPLICABLE,
      explanation: 'The camera retains a grain-size state, but it has no visible effect while grain is Off.',
    };
  }

  if (values.isoMode || values.isoFixed || values.isoMax) {
    warnings.push('ISO is retained as a shooting reminder; the initial slot writer does not change Auto ISO.');
  }
  if (values.exposureMinEv !== null || values.exposureMaxEv !== null) {
    warnings.push('Exposure compensation must be set on the physical exposure-compensation dial.');
  }
}

/**
 * Compare camera values with a final proposal.
 *
 * @param {Record<string, any>|null} current
 * @param {Record<string, any>} finalValues
 * @returns {Array<{ key: string, label: string, current: any, next: any, changed: boolean, writable: boolean }>}
 */
export function diffRecipeValues(current, finalValues) {
  return FIELD_DEFINITIONS.map((field) => {
    const before = current?.[field.key] ?? null;
    const after = finalValues[field.key] ?? null;
    return {
      key: field.key,
      label: field.label,
      current: before,
      next: after,
      changed: !equivalentValue(before, after),
      writable: field.writable,
    };
  });
}

/** @param {any} a @param {any} b */
export function equivalentValue(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0001;
  return false;
}

/**
 * Human-readable value formatting shared by the UI and reports.
 *
 * @param {string} key
 * @param {any} value
 */
export function formatRecipeValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key === 'whiteBalanceKelvin') return `${value}K`;
    if (key.toLowerCase().includes('ev') || ['highlight', 'shadow', 'color', 'sharpness', 'highIsoNr', 'clarity', 'wbShiftR', 'wbShiftB', 'monoWarmCool', 'monoMagentaGreen'].includes(key)) {
      return value > 0 ? `+${trimNumber(value)}` : trimNumber(value);
    }
    return trimNumber(value);
  }
  const field = FIELD_BY_KEY.get(key);
  if (field?.type === 'white-balance') {
    return String(value)
      .replace('AutoWhitePriority', 'Auto White Priority')
      .replace('AutoAmbiencePriority', 'Auto Ambience Priority')
      .replace(/Fluorescent(\d)/, 'Fluorescent $1')
      .replace(/Custom(\d)/, 'Custom $1')
      .replace('Temperature', 'Color Temperature');
  }
  return String(value);
}

/** @param {number} value */
function trimNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
