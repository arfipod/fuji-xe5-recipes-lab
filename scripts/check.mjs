import { readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const ignored = new Set(['.git', 'node_modules', 'coverage']);
const files = walk(root).filter((file) => ['.js', '.mjs'].includes(extname(file)));
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) process.exit(1);
console.log(`Syntax check passed for ${files.length} JavaScript modules.`);

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) output.push(...walk(path));
    else output.push(path);
  }
  return output;
}
