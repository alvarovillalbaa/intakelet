// Bundle the public exports from each actual installed React/package consumer.
import { build } from 'esbuild';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
for (const edition of ['react18', 'react19']) {
  const target = join(process.env.INTAKELET_BROWSER_FIXTURES, edition);
  await build({ entryPoints: [join(target, 'browser-entry.mjs')], outfile: join(target, 'consumer.js'), bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], logLevel: 'info' });
  await copyFile(join(target, 'node_modules/@alvarovillalbaa/intakelet/src/element.css'), join(target, 'styles.css'));
  await writeFile(join(target, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authored installed Intakelet consumer</title><link rel="stylesheet" href="styles.css"><script type="module" src="consumer.js"></script></head><body><h1>Authored application fixture</h1><div id="react-root"></div></body></html>');
}
