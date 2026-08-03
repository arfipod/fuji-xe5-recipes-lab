import test from 'node:test';
import assert from 'node:assert/strict';

import { exportLabJson, importLabJson } from '../src/core/json.js';
import { parseRecipeText } from '../src/core/parser.js';

const SOURCE = `PRO Neg. Std
Dynamic Range: DR400
Highlight: +2
Shadow: +3
Color: +4
Noise Reduction: -3
Sharpening: 0
Grain Effect: Strong
White Balance: Auto, +5 Red & -3 Blue
ISO: Auto up to ISO 6400
Exposure Compensation: +1/3 (typically)`;

test('portable JSON exports and imports canonical recipe provenance', () => {
  const recipe = parseRecipeText(SOURCE, { kind: 'text', title: 'Legacy portrait recipe' });
  const json = exportLabJson({ recipes: [recipe], slotBackups: [], fullBackups: [] });
  const result = importLabJson(json);
  assert.equal(result.ok, true);
  assert.equal(result.value.format, 'fuji-xe5-recipes-lab');
  assert.equal(result.value.recipes[0].values.filmSimulation, 'ProNegStd');
  assert.equal(result.value.recipes[0].fields.highIsoNr.status, 'alias');
  assert.match(result.value.recipes[0].source.rawText, /Noise Reduction/);
});

test('portable JSON rejects unknown formats and incomplete recipes', () => {
  assert.deepEqual(importLabJson('{"format":"other","formatVersion":1}'), {
    ok: false,
    errors: ['Unsupported export format or version.'],
  });

  const invalid = JSON.stringify({
    format: 'fuji-xe5-recipes-lab',
    formatVersion: 1,
    recipes: [{ schemaVersion: 1, id: 'x', name: '', values: {}, fields: {}, source: {} }],
  });
  const result = importLabJson(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Missing canonical value key')));
});

test('portable JSON rejects sensitive full-backup payloads during read-only validation', () => {
  const result = importLabJson(JSON.stringify({
    format: 'fuji-xe5-recipes-lab',
    formatVersion: 1,
    recipes: [],
    slotBackups: [],
    fullBackups: [{ model: 'X-E5', size: 70524, bytesBase64: 'AA==' }],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Portable full-backup import is disabled')));
});
