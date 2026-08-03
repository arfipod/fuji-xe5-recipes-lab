import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const css = read('src/styles.css');
const render = read('src/ui/render.js');
const index = read('index.html');
const violations = [];

for (const required of ['PRODUCT.md', 'DESIGN.md', '.impeccable/surfaces/workspace.md']) {
  if (!existsSync(resolve(root, required))) {
    violations.push(`Missing design-context file: ${required}`);
  }
}

const forbiddenPatterns = [
  [/\b(?:linear|radial|conic)-gradient\s*\(/i, 'Decorative gradients are not part of the X-E5 interface.'],
  [/\bbackdrop-filter\s*:/i, 'Glassmorphism/backdrop blur is not allowed.'],
  [/\bfilter\s*:\s*blur\s*\(/i, 'Blur effects are not allowed.'],
  [/\b(?:Inter|Geist|Space Grotesk|Poppins|Montserrat)\b/i, 'Avoid overused AI-default font families.'],
  [/\b(?:eyebrow|kicker)\b/i, 'Decorative eyebrow/kicker labels are not allowed.'],
  [/\bdrop-shadow\s*\(/i, 'Decorative drop shadows are not allowed.'],
  [/\b(?:purple|violet|cyan|beige)\b/i, 'The visual system is monochrome.'],
];

for (const [pattern, message] of forbiddenPatterns) {
  if (pattern.test(`${css}\n${render}\n${index}`)) violations.push(message);
}

for (const match of css.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
  const raw = match[1];
  const hex = raw.length === 3 ? raw.split('').map((value) => value + value).join('') : raw;
  const [r, g, b] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((value) => Number.parseInt(value, 16));
  if (!(r === g && g === b)) violations.push(`Non-monochrome color found: #${raw}`);
}

for (const match of css.matchAll(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
  if (Number(match[1]) > 8) violations.push(`Excessive literal border radius: ${match[0]}`);
}

if (!/body\s*\{[\s\S]*?font-size\s*:\s*16px\s*;/m.test(css)) {
  violations.push('Body copy must retain a 16px minimum desktop/mobile base size.');
}

const paragraphMeasure = css.match(/p\s*\{[\s\S]*?max-width\s*:\s*(\d+)ch\s*;/m);
if (!paragraphMeasure || Number(paragraphMeasure[1]) < 45 || Number(paragraphMeasure[1]) > 75) {
  violations.push('Paragraph measure must remain between 45ch and 75ch.');
}

if (!/class="skip-link"/.test(render)) violations.push('The app shell must include a keyboard skip link.');
if (!/aria-current="page"/.test(render)) violations.push('Active navigation must expose aria-current="page".');
if (!/prefers-reduced-motion/.test(css)) violations.push('Reduced-motion behavior is required.');
if (!/focus-visible/.test(css)) violations.push('Visible keyboard focus states are required.');

if (violations.length) {
  console.error('Design-system check failed:');
  for (const violation of [...new Set(violations)]) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Design-system check passed: monochrome palette, restrained geometry, context files, typography, and accessibility guards are intact.');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}
