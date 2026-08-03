// @ts-check

import { createExportEnvelope, validateCanonicalRecipe } from './schema.js';

/**
 * @param {{ recipes?: unknown[], slotBackups?: unknown[], fullBackups?: unknown[] }} data
 */
export function exportLabJson(data) {
  return JSON.stringify(createExportEnvelope({
    recipes: /** @type {any[]} */ (data.recipes ?? []),
    slotBackups: data.slotBackups ?? [],
    fullBackups: data.fullBackups ?? [],
  }), null, 2);
}

/**
 * @param {string} json
 * @returns {{ ok: true, value: any } | { ok: false, errors: string[] }}
 */
export function importLabJson(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }

  if (!parsed || parsed.format !== 'fuji-xe5-recipes-lab' || parsed.formatVersion !== 1) {
    return { ok: false, errors: ['Unsupported export format or version.'] };
  }

  const errors = [];
  if (!Array.isArray(parsed.recipes ?? [])) errors.push('The recipes field must be an array.');
  if (!Array.isArray(parsed.slotBackups ?? [])) errors.push('The slotBackups field must be an array.');
  if (!Array.isArray(parsed.fullBackups ?? [])) errors.push('The fullBackups field must be an array.');
  if (Array.isArray(parsed.fullBackups) && parsed.fullBackups.length > 0) {
    errors.push('Portable full-backup import is disabled during physical read-only validation; keep sensitive backup bytes in local IndexedDB or a user-selected file.');
  }
  for (const [index, recipe] of (Array.isArray(parsed.recipes) ? parsed.recipes : []).entries()) {
    const validation = validateCanonicalRecipe(recipe);
    if (!validation.ok) errors.push(...validation.errors.map((message) => `Recipe ${index + 1}: ${message}`));
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: parsed };
}

/**
 * Download text from the browser without a dependency.
 *
 * @param {string} filename
 * @param {string} text
 * @param {string} [mime]
 */
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
