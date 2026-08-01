import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bundleDirectory = join(root, 'bundle');
const expectedHash = '9218c1cdbdd6c146a29d0cd9d79bf061010ef9f7b2ff3130fa64eb1a3a209dd0';
const partNames = readdirSync(bundleDirectory)
  .filter((name) => name.startsWith('index.html.gz.b64.part-'))
  .sort((left, right) => left.localeCompare(right));

if (partNames.length !== 11) {
  throw new Error(`Expected 11 application bundle parts, found ${partNames.length}.`);
}

const encoded = partNames.map((name) => readFileSync(join(bundleDirectory, name), 'utf8').trim()).join('');
const html = gunzipSync(Buffer.from(encoded, 'base64'));
const actualHash = createHash('sha256').update(html).digest('hex');

if (actualHash !== expectedHash) {
  throw new Error(`Application bundle hash mismatch: ${actualHash}`);
}

for (const marker of ['Fuji X-E5 Recipes Lab', 'Camera slots', 'Current', 'Imported', 'Final']) {
  if (!html.includes(marker)) {
    throw new Error(`Application bundle is missing marker: ${marker}`);
  }
}

console.log(`Verified ${partNames.length} bundle parts, ${html.length} bytes, SHA-256 ${actualHash}.`);
