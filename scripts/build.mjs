import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { sha256 } from '../src/values.mjs';
const root = resolve(import.meta.dirname, '..'), output = join(root, 'dist');
async function filesAt(directory) { let result = []; for (const item of await readdir(directory, { withFileTypes: true })) { const path = join(directory, item.name); if (item.isDirectory()) result.push(...await filesAt(path)); else { if (!item.isFile() || item.isSymbolicLink()) throw new Error('Unexpected non-regular generated file'); result.push(path); } } return result; }
let existing = null;
try { existing = await lstat(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Output is not an owned directory');
  const names = await filesAt(output); if (names.length) {
    const prior = JSON.parse(await readFile(join(output, 'build.json'), 'utf8')); if (prior.generator !== 'intakelet-static-v1') throw new Error('Unowned output directory');
    for (const path of names) { const name = relative(output, path); if (name !== 'build.json' && (!prior.files[name] || await sha256(await readFile(path)) !== prior.files[name].sha256)) throw new Error('Generated output changed; preserve it before rebuilding'); }
    for (const path of names) await unlink(path);
    async function removeEmpty(directory) { for (const item of await readdir(directory, { withFileTypes: true })) { const path = join(directory, item.name); if (!item.isDirectory()) throw new Error('Unexpected output entry'); await removeEmpty(path); await rmdir(path); } }
    await removeEmpty(output);
  }
}
await mkdir(output, { recursive: true });
for (const path of await filesAt(join(root, 'web'))) {
  if (path.endsWith('/app.mjs')) continue; const destination = join(output, relative(join(root, 'web'), path)); await mkdir(resolve(destination, '..'), { recursive: true }); await writeFile(destination, await readFile(path));
}
await writeFile(join(output, 'intakelet.css'), await readFile(join(root, 'src/element.css')));
await build({ absWorkingDir: root, entryPoints: ['web/app.mjs'], outfile: 'dist/app.js', bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], legalComments: 'eof', logLevel: 'info', sourcemap: false });
let notices = 'Intakelet original source is MIT licensed. Bundled third-party licenses follow.\n';
for (const name of ['parse5', 'entities', 'robots-parser']) {
  const base = join(root, 'node_modules', name), manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
  const filename = (await readdir(base)).find(file => /^license(?:\.md|\.txt)?$/i.test(file)); if (!filename) throw new Error('Missing bundled third-party license: ' + name);
  notices += '\n\n' + name + '@' + manifest.version + ' — ' + manifest.license + '\n' + await readFile(join(base, filename), 'utf8');
}
await writeFile(join(output, 'third-party-notices.txt'), notices);
const manifest = { generator: 'intakelet-static-v1', files: {} };
for (const path of (await filesAt(output)).sort()) { const bytes = await readFile(path); manifest.files[relative(output, path)] = { bytes: bytes.length, sha256: await sha256(bytes) }; }
await writeFile(join(output, 'build.json'), JSON.stringify(manifest, null, 2) + '\n'); console.log(JSON.stringify({ files: Object.keys(manifest.files).length + 1 }));
