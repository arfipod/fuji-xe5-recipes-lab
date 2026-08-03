// @ts-check

/**
 * Normalize pasted recipe text while retaining line structure and wording for
 * source traceability.
 *
 * @param {string} input
 */
export function normalizeRecipeText(input) {
  return decodeBasicEntities(String(input ?? ''))
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[−﹣－]/g, '-')
    .replace(/[–—]/g, ' to ')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/⅓/g, '1/3')
    .replace(/⅔/g, '2/3')
    .replace(/½/g, '1/2')
    .replace(/¼/g, '1/4')
    .replace(/¾/g, '3/4')
    .replace(/Monochromatic\s+Color\s*\(\s*Toning\s*\)/gi, 'Monochromatic Color Toning')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** @param {string} input */
export function normalizeLabel(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** @param {string} input */
export function cleanExtractedValue(input) {
  return String(input)
    .replace(/^[\s.:;,*]+/, '')
    .replace(/[\s.*;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode the small entity set commonly encountered in copied WordPress text.
 * The URL importer uses a more complete server-side decoder for page HTML.
 *
 * @param {string} input
 */
function decodeBasicEntities(input) {
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&ndash;': '-',
    '&mdash;': '-',
    '&minus;': '-',
    '&frac13;': '1/3',
    '&frac23;': '2/3',
  };
  return input.replace(/&(?:nbsp|amp|quot|#39|apos|lt|gt|ndash|mdash|minus|frac13|frac23);/gi, (entity) => entities[entity.toLowerCase()] ?? entity);
}
