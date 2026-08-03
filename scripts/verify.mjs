import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requiredFiles = [
  'index.html',
  'server.mjs',
  'src/main.js',
  'src/app.js',
  'src/styles.css',
  'src/camera/binary.js',
  'src/camera/mock-camera.js',
  'src/camera/ptp.js',
  'src/camera/raw-preview.js',
  'src/camera/x-e5-client.js',
  'src/camera/x-e5-codecs.js',
  'src/core/catalog.js',
  'src/core/diagnostics.js',
  'src/core/json.js',
  'src/core/normalize.js',
  'src/core/parser.js',
  'src/core/recipe-resolution.js',
  'src/core/schema.js',
  'src/storage/db.js',
  'src/ui/components.js',
  'src/ui/render.js',
  'PRODUCT.md',
  'DESIGN.md',
  'AGENTS.md',
  'docs/PROTOCOL_NOTES.md',
  'docs/HARDWARE_VALIDATION.md',
  'docs/BASELINE_REPORT.md',
  'docs/PROPOSED_C7_WRITE_PLAN.md',
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) throw new Error(`Required source file is missing: ${file}`);
}

const index = read('index.html');
const renderer = read('src/ui/render.js');
const server = read('server.mjs');
const app = read('src/app.js');
const footer = 'Made with 💙 by arrf';

if ((index.match(new RegExp(footer, 'g')) ?? []).length !== 1) throw new Error('index.html must contain the exact footer once.');
if (!/<script type="module" src="\/src\/main\.js(?:\?[^"<>]+)?"><\/script>/.test(index)) {
  throw new Error('index.html does not load the modular application source.');
}
if (!read('src/main.js').includes("import './app.js?v=")) throw new Error('The source entry point does not load the versioned application module.');
for (const marker of ['Camera', 'Import/Edit', 'Library', 'Backups', 'RAF Preview', 'System']) {
  if (!renderer.includes(`label: '${marker}'`)) throw new Error(`Renderer is missing the ${marker} view.`);
}
if (server.includes('bundle-loader') || server.includes("from './bundle")) throw new Error('The runtime server still depends on generated bundle output.');
if (server.includes("'unsafe-inline'") || server.includes("script-src 'self' blob:")) throw new Error('The modular server must not require inline or Blob scripts.');
if (!app.includes("validationStage: 'disconnected'") || !app.includes('writesEnabled: false')) throw new Error('The physical-camera read-only state gate is missing.');

const digest = createHash('sha256');
for (const file of requiredFiles) digest.update(file).update('\0').update(read(file)).update('\0');
console.log(`Verified ${requiredFiles.length} maintainable source/context files; aggregate SHA-256 ${digest.digest('hex')}.`);

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}
