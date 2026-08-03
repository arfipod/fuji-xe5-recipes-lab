// @ts-check

import {
  FIELD_STATUS,
  canonicalFilmSimulation,
  canonicalWhiteBalance,
  normalizeCatalogToken,
} from './catalog.js';
import {
  createEmptyRecipe,
  createFieldMeta,
  setRecipeField,
} from './schema.js';
import {
  cleanExtractedValue,
  normalizeLabel,
  normalizeRecipeText,
} from './normalize.js';

/**
 * @typedef {import('./schema.js').CanonicalRecipe} CanonicalRecipe
 */

const LABEL_DEFINITIONS = Object.freeze([
  { canonical: 'colorChromeBlue', label: 'Color Chrome FX Blue', patterns: ['color chrome fx blue', 'color chrome effect blue', 'color chrome blue'] },
  { canonical: 'monoToning', label: 'Monochromatic Color', patterns: ['monochromatic color toning', 'monochromatic color', 'monochrome color toning', 'toning'] },
  { canonical: 'exposureCompensation', label: 'Exposure Compensation', patterns: ['exposure compensation', 'exposure comp'] },
  { canonical: 'dRangePriority', label: 'D-Range Priority', patterns: ['d range priority', 'dynamic range priority', 'dr priority'] },
  { canonical: 'filmSimulation', label: 'Film Simulation', patterns: ['film simulation', 'base film simulation'] },
  { canonical: 'colorChrome', label: 'Color Chrome Effect', patterns: ['color chrome effect', 'color chrome'] },
  { canonical: 'smoothSkin', label: 'Smooth Skin Effect', patterns: ['smooth skin effect', 'smooth skin'] },
  { canonical: 'whiteBalance', label: 'White Balance', patterns: ['white balance', 'wb'] },
  { canonical: 'dynamicRange', label: 'Dynamic Range', patterns: ['dynamic range', 'dr'] },
  { canonical: 'grain', label: 'Grain Effect', patterns: ['grain effect', 'grain'] },
  { canonical: 'highIsoNr', label: 'High ISO NR', patterns: ['high iso nr', 'high iso noise reduction', 'noise reduction', 'nr'] },
  { canonical: 'sharpness', label: 'Sharpness', patterns: ['sharpness', 'sharpening'] },
  { canonical: 'highlight', label: 'Highlight', patterns: ['highlight tone', 'highlight'] },
  { canonical: 'shadow', label: 'Shadow', patterns: ['shadow tone', 'shadow'] },
  { canonical: 'clarity', label: 'Clarity', patterns: ['clarity'] },
  { canonical: 'iso', label: 'ISO', patterns: ['iso'] },
  { canonical: 'color', label: 'Color', patterns: ['color', 'colour'] },
]);

const LABEL_LOOKUP = new Map();
for (const definition of LABEL_DEFINITIONS) {
  for (const pattern of definition.patterns) LABEL_LOOKUP.set(normalizeLabel(pattern), definition);
}

const LABEL_REGEX = buildLabelRegex();

/**
 * Parse recipe text copied from Fuji X Weekly or a similarly formatted source.
 * The parser is label-order independent and also accepts a standalone film
 * simulation on the first line.
 *
 * @param {string} rawText
 * @param {{ kind?: 'text'|'url'|'ocr', url?: string|null, title?: string|null, capturedImageName?: string|null }} [source]
 * @returns {CanonicalRecipe}
 */
export function parseRecipeText(rawText, source = {}) {
  const recipe = createEmptyRecipe();
  const normalizedText = normalizeRecipeText(rawText);
  recipe.source = {
    kind: source.kind ?? 'text',
    rawText: rawText ?? '',
    url: source.url ?? null,
    title: source.title ?? null,
    capturedImageName: source.capturedImageName ?? null,
  };

  if (!normalizedText) {
    recipe.warnings.push('No recipe text was provided.');
    return recipe;
  }

  const segments = extractSegments(normalizedText);
  const duplicateLabels = findDuplicateLabels(segments);
  if (duplicateLabels.length) {
    recipe.warnings.push(`Multiple values were found for ${duplicateLabels.join(', ')}. The first value was selected; review the source for multiple recipe variants.`);
  }

  detectStandaloneFilmAndName(recipe, normalizedText, segments, source.title ?? null);

  for (const segment of segments) {
    // Keep the first occurrence. A page containing multiple recipe variants
    // must not silently merge later values into the first recipe.
    if (segment.canonical !== 'filmSimulation' && recipe.fields[canonicalFieldKey(segment.canonical)]?.status !== FIELD_STATUS.MISSING) {
      continue;
    }
    parseSegment(recipe, segment);
  }

  inferGeneration(recipe, normalizedText);
  applyApplicabilityMetadata(recipe);
  addCompletenessWarnings(recipe);
  return recipe;
}

/**
 * Expose raw label segmentation for diagnostics and tests.
 *
 * @param {string} rawText
 */
export function inspectRecipeSegments(rawText) {
  return extractSegments(normalizeRecipeText(rawText));
}

/**
 * @typedef {Object} Segment
 * @property {string} canonical
 * @property {string} label
 * @property {string} matchedLabel
 * @property {string} value
 * @property {number} start
 * @property {number} end
 */

/** @param {string} text @returns {Segment[]} */
function extractSegments(text) {
  const matches = [];
  LABEL_REGEX.lastIndex = 0;
  let match;
  while ((match = LABEL_REGEX.exec(text)) !== null) {
    const matchedLabel = match[1];
    const definition = LABEL_LOOKUP.get(normalizeLabel(matchedLabel));
    if (!definition) continue;
    matches.push({
      index: match.index,
      valueStart: LABEL_REGEX.lastIndex,
      matchedLabel,
      definition,
    });
  }

  return matches.map((entry, index) => {
    const nextStart = matches[index + 1]?.index ?? text.length;
    return {
      canonical: entry.definition.canonical,
      label: entry.definition.label,
      matchedLabel: entry.matchedLabel,
      value: cleanExtractedValue(text.slice(entry.valueStart, nextStart)),
      start: entry.index,
      end: nextStart,
    };
  });
}

/** @returns {RegExp} */
function buildLabelRegex() {
  const patterns = LABEL_DEFINITIONS
    .flatMap((definition) => definition.patterns)
    .sort((a, b) => b.length - a.length)
    .map((pattern) => pattern
      .split(/\s+/)
      .map(escapeRegex)
      .join('\\s*'));
  // Labels are colon-terminated and can be concatenated when copied from
  // formatted web pages (for example `LargeColor Chrome Effect:` after
  // Markdown markers are stripped). Requiring whitespace before a label
  // would miss those valid inputs, so matching is intentionally boundary-free.
  return new RegExp(`(${patterns.join('|')})\\s*:`, 'gim');
}

/** @param {string} value */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {Segment[]} segments */
function findDuplicateLabels(segments) {
  const counts = new Map();
  for (const segment of segments) counts.set(segment.canonical, (counts.get(segment.canonical) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([canonical]) => LABEL_DEFINITIONS.find((definition) => definition.canonical === canonical)?.label ?? canonical);
}

/**
 * @param {CanonicalRecipe} recipe
 * @param {string} text
 * @param {Segment[]} segments
 * @param {string|null} title
 */
function detectStandaloneFilmAndName(recipe, text, segments, title) {
  const prefixEnd = segments[0]?.start ?? text.length;
  const prefix = text.slice(0, prefixEnd).trim();
  const lines = prefix
    // Periods are significant inside simulation names such as `PRO Neg. Std`;
    // only line boundaries are safe standalone-title separators.
    .split(/\n/)
    .map((line) => cleanExtractedValue(line))
    .filter(Boolean);

  let filmLineIndex = -1;
  let filmResult = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const result = canonicalFilmSimulation(lines[index]);
    if (result.value) {
      filmLineIndex = index;
      filmResult = result;
      break;
    }
  }

  if (filmResult?.value && recipe.fields.filmSimulation.status === FIELD_STATUS.MISSING) {
    setDetected(recipe, 'filmSimulation', filmResult.value, {
      exact: !filmResult.alias,
      sourceText: lines[filmLineIndex],
      sourceLabel: 'Standalone film simulation',
      alias: filmResult.alias ? lines[filmLineIndex] : null,
    });
  }

  if (title) {
    recipe.name = cleanRecipeTitle(title);
  } else if (filmLineIndex > 0) {
    recipe.name = lines.slice(0, filmLineIndex).join(' — ').slice(0, 80);
  }
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseSegment(recipe, segment) {
  switch (segment.canonical) {
    case 'filmSimulation':
      parseFilmSimulation(recipe, segment);
      break;
    case 'dynamicRange':
      parseDynamicRange(recipe, segment);
      break;
    case 'dRangePriority':
      parseDRangePriority(recipe, segment);
      break;
    case 'grain':
      parseGrain(recipe, segment);
      break;
    case 'colorChrome':
      parseStrength(recipe, 'colorChrome', segment);
      break;
    case 'colorChromeBlue':
      parseStrength(recipe, 'colorChromeBlue', segment);
      break;
    case 'smoothSkin':
      parseStrength(recipe, 'smoothSkin', segment);
      break;
    case 'whiteBalance':
      parseWhiteBalance(recipe, segment);
      break;
    case 'highlight':
      parseScaledNumber(recipe, 'highlight', segment, -2, 4, 0.5);
      break;
    case 'shadow':
      parseScaledNumber(recipe, 'shadow', segment, -2, 4, 0.5);
      break;
    case 'color':
      parseScaledNumber(recipe, 'color', segment, -4, 4, 1);
      break;
    case 'sharpness':
      parseScaledNumber(recipe, 'sharpness', segment, -4, 4, 1, segment.matchedLabel.toLowerCase().includes('sharpening'));
      break;
    case 'highIsoNr':
      parseScaledNumber(recipe, 'highIsoNr', segment, -4, 4, 1, normalizeLabel(segment.matchedLabel) !== 'high iso nr');
      break;
    case 'clarity':
      parseScaledNumber(recipe, 'clarity', segment, -5, 5, 1);
      break;
    case 'monoToning':
      parseMonoToning(recipe, segment);
      break;
    case 'iso':
      parseIso(recipe, segment);
      break;
    case 'exposureCompensation':
      parseExposure(recipe, segment);
      break;
    default:
      break;
  }
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseFilmSimulation(recipe, segment) {
  const result = canonicalFilmSimulation(segment.value);
  if (!result.value) {
    setInvalid(recipe, 'filmSimulation', segment, `Unknown film simulation: “${segment.value}”.`);
    return;
  }
  setDetected(recipe, 'filmSimulation', result.value, {
    exact: !result.alias,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
    alias: result.alias ? segment.value : null,
  });
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseDynamicRange(recipe, segment) {
  const compact = segment.value.toUpperCase().replace(/\s+/g, '');
  const priority = compact.match(/DR-?P(?:RIORITY)?(?:[:=-])?(AUTO|WEAK|STRONG)/i)
    ?? segment.value.match(/(?:priority|dr\s*-?\s*p)\s*(?:is|:|-)?\s*(auto|weak|strong)/i);
  if (priority) {
    const value = titleCase(priority[1]);
    setDetected(recipe, 'dRangePriority', value, {
      exact: false,
      sourceText: segment.value,
      sourceLabel: segment.matchedLabel,
      alias: 'D-Range Priority embedded in Dynamic Range',
    });
    return;
  }

  const match = compact.match(/DR(100|200|400)/);
  if (match) {
    setDetected(recipe, 'dynamicRange', `DR${match[1]}`, {
      exact: true,
      sourceText: segment.value,
      sourceLabel: segment.matchedLabel,
    });
    return;
  }
  if (/\bauto\b/i.test(segment.value)) {
    setDetected(recipe, 'dynamicRange', 'Auto', {
      exact: true,
      sourceText: segment.value,
      sourceLabel: segment.matchedLabel,
    });
    return;
  }
  setInvalid(recipe, 'dynamicRange', segment, `Could not parse Dynamic Range from “${segment.value}”.`);
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseDRangePriority(recipe, segment) {
  const match = segment.value.match(/\b(off|weak|strong|auto)\b/i);
  if (!match) {
    setInvalid(recipe, 'dRangePriority', segment, `Could not parse D-Range Priority from “${segment.value}”.`);
    return;
  }
  setDetected(recipe, 'dRangePriority', titleCase(match[1]), {
    exact: true,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
  });
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseGrain(recipe, segment) {
  const strengthMatch = segment.value.match(/\b(off|weak|strong)\b/i);
  const sizeMatch = segment.value.match(/\b(small|large)\b/i);
  if (!strengthMatch) {
    setInvalid(recipe, 'grainStrength', segment, `Could not parse grain strength from “${segment.value}”.`);
    return;
  }
  setDetected(recipe, 'grainStrength', titleCase(strengthMatch[1]), {
    exact: true,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
  });
  if (sizeMatch) {
    setDetected(recipe, 'grainSize', titleCase(sizeMatch[1]), {
      exact: true,
      sourceText: segment.value,
      sourceLabel: segment.matchedLabel,
    });
  }
}

/**
 * @param {CanonicalRecipe} recipe
 * @param {'colorChrome'|'colorChromeBlue'|'smoothSkin'} key
 * @param {Segment} segment
 */
function parseStrength(recipe, key, segment) {
  const match = segment.value.match(/\b(off|weak|strong)\b/i);
  if (!match) {
    setInvalid(recipe, key, segment, `Could not parse ${segment.label} from “${segment.value}”.`);
    return;
  }
  setDetected(recipe, key, titleCase(match[1]), {
    exact: true,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
  });
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseWhiteBalance(recipe, segment) {
  const kelvinMatch = segment.value.match(/\b(\d{4,5})\s*K\b/i);
  let mode = null;
  let alias = false;
  if (kelvinMatch) {
    mode = 'Temperature';
    const kelvin = Number(kelvinMatch[1]);
    if (kelvin < 2500 || kelvin > 10000) {
      setInvalid(recipe, 'whiteBalanceKelvin', segment, `Color temperature ${kelvin}K is outside the X-E5 range.`);
    } else {
      setDetected(recipe, 'whiteBalanceKelvin', kelvin, {
        exact: true,
        sourceText: kelvinMatch[0],
        sourceLabel: segment.matchedLabel,
      });
    }
  } else {
    const modeText = segment.value
      .split(/,|(?=[+-]\d+\s*(?:red|r\b))/i)[0]
      .trim();
    mode = canonicalWhiteBalance(modeText);
    alias = mode !== null && normalizeCatalogToken(modeText) !== normalizeCatalogToken(mode);
  }

  if (!mode) {
    setInvalid(recipe, 'whiteBalanceMode', segment, `Unknown white-balance mode in “${segment.value}”.`);
  } else {
    setDetected(recipe, 'whiteBalanceMode', mode, {
      exact: !alias,
      sourceText: segment.value,
      sourceLabel: segment.matchedLabel,
      alias: alias ? segment.value.split(',')[0].trim() : null,
    });
  }

  const red = parseColorShift(segment.value, 'red', 'r');
  const blue = parseColorShift(segment.value, 'blue', 'b');
  if (red !== null) {
    setDetected(recipe, 'wbShiftR', red, {
      exact: true,
      sourceText: segment.value,
      sourceLabel: segment.matchedLabel,
    });
  }
  if (blue !== null) {
    setDetected(recipe, 'wbShiftB', blue, {
      exact: true,
      sourceText: segment.value,
      sourceLabel: segment.matchedLabel,
    });
  }
}

/**
 * @param {CanonicalRecipe} recipe
 * @param {string} key
 * @param {Segment} segment
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @param {boolean} [forceAlias]
 */
function parseScaledNumber(recipe, key, segment, min, max, step, forceAlias = false) {
  const value = parseSignedNumber(segment.value);
  if (value === null) {
    setInvalid(recipe, key, segment, `Could not parse ${segment.label} from “${segment.value}”.`);
    return;
  }
  const onStep = Math.abs(Math.round(value / step) * step - value) < 0.0001;
  if (value < min || value > max || !onStep) {
    setInvalid(recipe, key, segment, `${segment.label} ${formatSigned(value)} is outside the supported X-E5 range or step.`);
    return;
  }
  setDetected(recipe, key, value, {
    exact: !forceAlias,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
    alias: forceAlias ? segment.matchedLabel : null,
  });
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseMonoToning(recipe, segment) {
  const wc = segment.value.match(/(?:WC|WARM\s*\/?\s*COOL)\s*[:=]?\s*([+-]?\d+)/i);
  const mg = segment.value.match(/(?:MG|MAGENTA\s*\/?\s*GREEN)\s*[:=]?\s*([+-]?\d+)/i);
  if (!wc && !mg) {
    recipe.warnings.push(`Could not parse monochromatic toning from “${segment.value}”.`);
    return;
  }
  if (wc) parseScaledNumber(recipe, 'monoWarmCool', { ...segment, value: wc[1] }, -18, 18, 1);
  if (mg) parseScaledNumber(recipe, 'monoMagentaGreen', { ...segment, value: mg[1] }, -18, 18, 1);
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseIso(recipe, segment) {
  const value = segment.value;
  const auto = /\bauto\b/i.test(value);
  const numbers = [...value.matchAll(/\bISO\s*(\d{2,6})\b|\b(\d{2,6})\b/gi)]
    .map((match) => Number(match[1] ?? match[2]))
    .filter((number) => Number.isFinite(number));

  if (auto) {
    setDetected(recipe, 'isoMode', 'Auto', {
      exact: true,
      sourceText: value,
      sourceLabel: segment.matchedLabel,
    });
    const maxMatch = value.match(/(?:up\s*to|max(?:imum)?(?:\s*iso)?|≤)\s*(?:ISO\s*)?(\d{2,6})/i);
    if (maxMatch) {
      setDetected(recipe, 'isoMax', Number(maxMatch[1]), {
        exact: true,
        sourceText: value,
        sourceLabel: segment.matchedLabel,
      });
    } else if (numbers.length) {
      setDetected(recipe, 'isoMax', Math.max(...numbers), {
        exact: false,
        sourceText: value,
        sourceLabel: segment.matchedLabel,
        alias: 'ISO number interpreted as Auto ISO maximum',
      });
    }
    const minMatch = value.match(/(?:from|min(?:imum)?(?:\s*iso)?)\s*(?:ISO\s*)?(\d{2,6})/i);
    if (minMatch) {
      setDetected(recipe, 'isoMin', Number(minMatch[1]), {
        exact: true,
        sourceText: value,
        sourceLabel: segment.matchedLabel,
      });
    }
    return;
  }

  if (numbers.length === 1) {
    setDetected(recipe, 'isoMode', 'Fixed', {
      exact: true,
      sourceText: value,
      sourceLabel: segment.matchedLabel,
    });
    setDetected(recipe, 'isoFixed', numbers[0], {
      exact: true,
      sourceText: value,
      sourceLabel: segment.matchedLabel,
    });
    return;
  }

  setInvalid(recipe, 'isoMode', segment, `Could not parse ISO guidance from “${value}”.`);
}

/** @param {CanonicalRecipe} recipe @param {Segment} segment */
function parseExposure(recipe, segment) {
  const tokens = extractEvTokens(segment.value);
  if (!tokens.length) {
    setInvalid(recipe, 'exposureMinEv', segment, `Could not parse exposure compensation from “${segment.value}”.`);
    return;
  }
  const parsed = tokens.map(parseFractionNumber).filter((value) => value !== null);
  if (!parsed.length) {
    setInvalid(recipe, 'exposureMinEv', segment, `Could not parse exposure compensation from “${segment.value}”.`);
    return;
  }
  const min = parsed.length > 1 ? Math.min(...parsed) : parsed[0];
  const max = parsed.length > 1 ? Math.max(...parsed) : parsed[0];
  setDetected(recipe, 'exposureMinEv', min, {
    exact: true,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
  });
  setDetected(recipe, 'exposureMaxEv', max, {
    exact: true,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
  });
  setDetected(recipe, 'exposureTypical', /typical|usually|often/i.test(segment.value), {
    exact: true,
    sourceText: segment.value,
    sourceLabel: segment.matchedLabel,
  });
}

/**
 * @param {CanonicalRecipe} recipe
 * @param {string} text
 */
function inferGeneration(recipe, text) {
  const normalized = normalizeLabel(text);
  if (/x\s*trans\s*v\b|x\s*e\s*5\b|x\s*t\s*5\b|x100vi\b/i.test(text)) {
    recipe.targetGeneration = 'x-trans-v';
    recipe.generationConfidence = 0.98;
    recipe.generationReasons.push('The source explicitly mentions an X-Trans V camera or generation.');
    return;
  }
  if (/x\s*trans\s*iv\b/i.test(text)) {
    recipe.targetGeneration = 'x-trans-iv';
    recipe.generationConfidence = 0.98;
    recipe.generationReasons.push('The source explicitly mentions X-Trans IV.');
    return;
  }
  if (/x\s*trans\s*iii\b/i.test(text)) {
    recipe.targetGeneration = 'x-trans-iii';
    recipe.generationConfidence = 0.98;
    recipe.generationReasons.push('The source explicitly mentions X-Trans III.');
    return;
  }

  const modernFieldCount = [
    recipe.values.grainSize,
    recipe.values.colorChromeBlue,
    recipe.values.clarity,
    recipe.values.smoothSkin,
  ].filter((value) => value !== null).length;
  const genFiveSimulation = ['NostalgicNeg', 'RealaAce'].includes(recipe.values.filmSimulation);
  if (genFiveSimulation) {
    recipe.targetGeneration = 'x-trans-v';
    recipe.generationConfidence = 0.82;
    recipe.generationReasons.push('The selected film simulation is associated with recent X-Processor 5 bodies.');
    return;
  }
  if (modernFieldCount >= 2) {
    recipe.targetGeneration = 'x-trans-v';
    recipe.generationConfidence = 0.62;
    recipe.generationReasons.push('The recipe includes multiple modern image-quality fields; X-Trans V is a likely target but not proven by the text.');
    return;
  }
  if (normalized.includes('noise reduction') || normalized.includes('sharpening')) {
    recipe.targetGeneration = 'legacy';
    recipe.generationConfidence = 0.55;
    recipe.generationReasons.push('Legacy Fuji X Weekly labels were detected; the recipe will need explicit X-E5 choices for fields that did not exist on the source body.');
  }
}

/** @param {CanonicalRecipe} recipe */
function applyApplicabilityMetadata(recipe) {
  const priority = recipe.values.dRangePriority;
  if (priority && priority !== 'Off') {
    for (const key of ['dynamicRange', 'highlight', 'shadow']) {
      if (recipe.values[key] === null) {
        recipe.fields[key] = createFieldMeta(FIELD_STATUS.NOT_APPLICABLE, 1, null, null, {
          notes: ['D-Range Priority controls this setting.'],
        });
      } else {
        recipe.fields[key].notes.push('This value may be ignored while D-Range Priority is active.');
      }
    }
  }

  const film = recipe.values.filmSimulation;
  const mono = typeof film === 'string' && (/^(Acros|Monochrome)/.test(film));
  const colorLocked = mono || film === 'Sepia';
  if (colorLocked && recipe.values.color === null) {
    recipe.fields.color = createFieldMeta(FIELD_STATUS.NOT_APPLICABLE, 1, null, null, {
      notes: ['Color is disabled for this film simulation.'],
    });
  }
  if (!mono) {
    for (const key of ['monoWarmCool', 'monoMagentaGreen']) {
      if (recipe.values[key] === null) {
        recipe.fields[key] = createFieldMeta(FIELD_STATUS.NOT_APPLICABLE, 1, null, null, {
          notes: ['Monochromatic Color is only applicable to ACROS and Monochrome simulations.'],
        });
      }
    }
  }

  if (recipe.values.whiteBalanceMode !== 'Temperature' && recipe.values.whiteBalanceKelvin === null) {
    recipe.fields.whiteBalanceKelvin = createFieldMeta(FIELD_STATUS.NOT_APPLICABLE, 1, null, null, {
      notes: ['Kelvin is only written when White Balance is Color Temperature.'],
    });
  }

  if (recipe.values.grainStrength === 'Off' && recipe.values.grainSize === null) {
    recipe.fields.grainSize = createFieldMeta(FIELD_STATUS.NOT_APPLICABLE, 1, null, null, {
      notes: ['Grain size is not meaningful while Grain Effect is Off.'],
    });
  }
}

/** @param {CanonicalRecipe} recipe */
function addCompletenessWarnings(recipe) {
  if (!recipe.values.filmSimulation) recipe.warnings.push('Film Simulation was not detected.');
  if (recipe.fields.grainStrength.status !== FIELD_STATUS.MISSING && recipe.fields.grainSize.status === FIELD_STATUS.MISSING) {
    recipe.warnings.push('Grain strength was detected, but the source did not specify Small or Large grain size.');
  }
  if (recipe.values.isoMode) {
    recipe.warnings.push('ISO guidance is stored as a shooting reminder and is not written through the initial recipe-slot protocol.');
  }
  if (recipe.values.exposureMinEv !== null) {
    recipe.warnings.push('Exposure compensation must be set manually on the camera dial.');
  }
}

/**
 * @param {CanonicalRecipe} recipe
 * @param {string} key
 * @param {any} value
 * @param {{ exact: boolean, sourceText: string, sourceLabel: string, alias?: string|null }} details
 */
function setDetected(recipe, key, value, details) {
  setRecipeField(recipe, key, value, createFieldMeta(
    details.exact ? FIELD_STATUS.EXACT : FIELD_STATUS.ALIAS,
    details.exact ? 1 : 0.9,
    details.sourceText,
    details.sourceLabel,
    {
      alias: details.alias ?? null,
      notes: [],
    },
  ));
}

/** @param {CanonicalRecipe} recipe @param {string} key @param {Segment} segment @param {string} warning */
function setInvalid(recipe, key, segment, warning) {
  setRecipeField(recipe, key, null, createFieldMeta(FIELD_STATUS.INVALID, 0, segment.value, segment.matchedLabel, {
    notes: [warning],
  }));
  recipe.warnings.push(warning);
}

/** @param {string} canonical */
function canonicalFieldKey(canonical) {
  if (canonical === 'grain') return 'grainStrength';
  if (canonical === 'whiteBalance') return 'whiteBalanceMode';
  if (canonical === 'monoToning') return 'monoWarmCool';
  if (canonical === 'iso') return 'isoMode';
  if (canonical === 'exposureCompensation') return 'exposureMinEv';
  return canonical;
}

/** @param {string} text @param {string} longName @param {string} shortName */
function parseColorShift(text, longName, shortName) {
  const longRegex = new RegExp(`([+-]?\\d+)\\s*${longName}`, 'i');
  const shortRegex = new RegExp(`(?:^|[,;&\\s])${shortName}\\s*[:=]?\\s*([+-]?\\d+)`, 'i');
  const match = text.match(longRegex) ?? text.match(shortRegex);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= -9 && value <= 9 ? value : null;
}

/** @param {string} text */
function parseSignedNumber(text) {
  const token = text.match(/[+-]?(?:\d+(?:\.\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)/)?.[0];
  return token ? parseFractionNumber(token) : null;
}

/** @param {string} text */
function extractEvTokens(text) {
  return text.match(/[+-]?\d+\s+\d+\/\d+|[+-]?\d+\/\d+|[+-]?\d+(?:\.\d+)?/g) ?? [];
}

/** @param {string} token */
export function parseFractionNumber(token) {
  const cleaned = token.trim().replace(/\s+/g, ' ');
  const sign = cleaned.startsWith('-') ? -1 : 1;
  const unsigned = cleaned.replace(/^[+-]/, '');
  if (/^\d+\/\d+$/.test(unsigned)) {
    const [numerator, denominator] = unsigned.split('/').map(Number);
    return denominator ? sign * numerator / denominator : null;
  }
  if (/^\d+\s+\d+\/\d+$/.test(unsigned)) {
    const [wholeText, fractionText] = unsigned.split(' ');
    const [numerator, denominator] = fractionText.split('/').map(Number);
    return denominator ? sign * (Number(wholeText) + numerator / denominator) : null;
  }
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

/** @param {string} value */
function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** @param {number} value */
function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

/** @param {string} title */
function cleanRecipeTitle(title) {
  return title
    .replace(/\s*[|–—-]\s*Fuji\s+X\s+Weekly.*$/i, '')
    .replace(/\s*:\s*A\s+Fujifilm.*$/i, '')
    .trim()
    .slice(0, 80);
}
