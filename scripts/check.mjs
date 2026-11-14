import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.name.endsWith('.mjs')) { const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status || 1); } } }
for (const name of ['src', 'bin', 'scripts', 'web']) await walk(join(root, name));
console.log('JavaScript syntax checked; imports/behavior require separate consumers.');
