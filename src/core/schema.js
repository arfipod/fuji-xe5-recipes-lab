// @ts-check

import {
  FIELD_DEFINITIONS,
  FIELD_STATUS,
  NEUTRAL_RECIPE_VALUES,
  RECIPE_SCHEMA_VERSION,
} from './catalog.js';

/**
 * @typedef {'text'|'url'|'ocr'|'camera'|'library'|'manual'} RecipeSourceKind
 * @typedef {'unknown'|'legacy'|'x-trans-iii'|'x-trans-iv'|'x-trans-v'} SensorGeneration
 * @typedef {'exact'|'alias'|'inferred'|'missing'|'invalid'|'current'|'neutral'|'user'|'not-applicable'} FieldStatus
 *
 * @typedef {Object} FieldMeta
 * @property {FieldStatus} status
 * @property {number} confidence
 * @property {string|null} sourceText
 * @property {string|null} sourceLabel
 * @property {string|null} alias
 * @property {string[]} notes
 *
 * @typedef {Object} RecipeSource
 * @property {RecipeSourceKind} kind
 * @property {string} rawText
 * @property {string|null} url
 * @property {string|null} title
 * @property {string|null} capturedImageName
 *
 * @typedef {Object} CanonicalRecipe
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string|null} parentRecipeId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {SensorGeneration} targetGeneration
 * @property {number} generationConfidence
 * @property {string[]} generationReasons
 * @property {RecipeSource} source
 * @property {Record<string, any>} values
 * @property {Record<string, FieldMeta>} fields
 * @property {string[]} warnings
 * @property {string[]} tags
 * @property {string|null} folder
 * @property {boolean} favorite
 * @property {string|null} referenceImageId
 */

/** @returns {CanonicalRecipe} */
export function createEmptyRecipe() {
  const now = new Date().toISOString();
  /** @type {Record<string, any>} */
  const values = {};
  /** @type {Record<string, FieldMeta>} */
  const fields = {};

  for (const definition of FIELD_DEFINITIONS) {
    values[definition.key] = null;
    fields[definition.key] = createFieldMeta(FIELD_STATUS.MISSING, 0, null, null);
  }

  values.exposureTypical = null;
  fields.exposureTypical = createFieldMeta(FIELD_STATUS.MISSING, 0, null, null);

  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: makeId(),
    name: '',
    parentRecipeId: null,
    createdAt: now,
    updatedAt: now,
    targetGeneration: 'unknown',
    generationConfidence: 0,
    generationReasons: [],
    source: {
      kind: 'text',
      rawText: '',
      url: null,
      title: null,
      capturedImageName: null,
    },
    values,
    fields,
    warnings: [],
    tags: [],
    folder: null,
    favorite: false,
    referenceImageId: null,
  };
}

/**
 * @param {FieldStatus} status
 * @param {number} confidence
 * @param {string|null} sourceText
 * @param {string|null} sourceLabel
 * @param {Partial<FieldMeta>} [extra]
 * @returns {FieldMeta}
 */
export function createFieldMeta(status, confidence, sourceText, sourceLabel, extra = {}) {
  return {
    status,
    confidence,
    sourceText,
    sourceLabel,
    alias: null,
    notes: [],
    ...extra,
  };
}

/**
 * @param {CanonicalRecipe} recipe
 * @param {string} key
 * @param {any} value
 * @param {FieldMeta} meta
 */
export function setRecipeField(recipe, key, value, meta) {
  recipe.values[key] = value;
  recipe.fields[key] = meta;
  recipe.updatedAt = new Date().toISOString();
}

/**
 * @param {CanonicalRecipe} recipe
 * @returns {CanonicalRecipe}
 */
export function cloneRecipe(recipe) {
  return structuredCloneSafe(recipe);
}

/**
 * Return a fully populated neutral recipe values object.
 * External shooting reminders remain null.
 *
 * @returns {Record<string, any>}
 */
export function neutralRecipeValues() {
  return structuredCloneSafe(NEUTRAL_RECIPE_VALUES);
}

/**
 * Validate the shape needed by this application. This intentionally avoids a
 * dependency on a schema library so exported JSON remains easy to consume from
 * a future Android application.
 *
 * @param {unknown} input
 * @returns {{ ok: true, value: CanonicalRecipe } | { ok: false, errors: string[] }}
 */
export function validateCanonicalRecipe(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Recipe must be a JSON object.'] };
  }

  const candidate = /** @type {Record<string, any>} */ (input);
  if (candidate.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion ${String(candidate.schemaVersion)}; expected ${RECIPE_SCHEMA_VERSION}.`);
  }
  if (typeof candidate.id !== 'string' || !candidate.id) errors.push('Recipe id is required.');
  if (typeof candidate.name !== 'string') errors.push('Recipe name must be a string.');
  if (!candidate.values || typeof candidate.values !== 'object') errors.push('Recipe values are required.');
  if (!candidate.fields || typeof candidate.fields !== 'object') errors.push('Recipe field metadata is required.');
  if (!candidate.source || typeof candidate.source !== 'object') errors.push('Recipe source metadata is required.');

  for (const definition of FIELD_DEFINITIONS) {
    if (!(definition.key in (candidate.values ?? {}))) {
      errors.push(`Missing canonical value key: ${definition.key}.`);
    }
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: /** @type {CanonicalRecipe} */ (candidate) };
}

/**
 * Create a stable, portable JSON export document.
 *
 * @param {{ recipes?: CanonicalRecipe[], slotBackups?: unknown[], fullBackups?: unknown[], exportedBy?: string }} data
 */
export function createExportEnvelope(data) {
  return {
    format: 'fuji-xe5-recipes-lab',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: data.exportedBy ?? 'Fuji X-E5 Recipes Lab',
    recipes: data.recipes ?? [],
    slotBackups: data.slotBackups ?? [],
    fullBackups: data.fullBackups ?? [],
  };
}

/** @returns {string} */
function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `recipe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** @template T @param {T} value @returns {T} */
function structuredCloneSafe(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
