// T2: docs-only native journey; unchanged application flows retain prior proof.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..'), output = process.env.INTAKELET_GUIDE_OUTPUT;
await mkdir(output, { recursive: true });
const build = JSON.parse(await readFile(join(root, 'dist/build.json'), 'utf8')), config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const headers = Object.fromEntries(config.headers[0].headers.map(item => [item.key, item.value]));
const hash = value => createHash('sha256').update(value).digest('hex');
const receipt = { passed: false, bodies: [], errors: [], contextsClosed: false, browserClosed: false, serverClosed: false };
let browser, context, server;
try {
  server = createServer(async (req, res) => {
    try { const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html'; if (name !== 'build.json' && !build.files[name]) return res.writeHead(404).end();
      const bytes = await readFile(join(root, 'dist', name)); res.writeHead(200, { ...headers, 'Content-Type': name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : name.endsWith('.json') ? 'application/json' : 'text/plain' }); res.end(bytes);
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const url = process.env.INTAKELET_GUIDE_URL || 'http://127.0.0.1:' + server.address().port;
  if (process.env.INTAKELET_GUIDE_URL) {
    const body = await readFile(join(root, 'dist/build.json'));
    for (const [name, expected] of [...Object.entries(build.files), ['build.json', { bytes: body.length, sha256: hash(body) }]]) {
      const response = await fetch(new URL(name === 'index.html' ? '/' : '/' + name, url), { redirect: 'error', signal: AbortSignal.timeout(15000) }); const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, 200); assert.equal(bytes.length, expected.bytes); assert.equal(hash(bytes), expected.sha256); for (const [key, value] of Object.entries(headers)) assert.equal(response.headers.get(key), value);
      receipt.bodies.push({ path: name, bytes: bytes.length, sha256: hash(bytes), status: response.status, headers: Object.fromEntries(response.headers) });
    }
  }
  const { chromium } = await import(process.env.INTAKELET_PLAYWRIGHT); browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const page = await context.newPage();
  page.on('pageerror', error => receipt.errors.push(error.message)); await page.goto(url); const guide = page.locator('#document-node-guide'); await guide.scrollIntoViewIfNeeded(); await guide.waitFor({ state: 'visible' });
  assert.match(await guide.innerText(), /PDF text, DOCX paragraphs, XLSX cells/); assert.match(await guide.innerText(), /preserves binary attachments/);
  const link = page.getByRole('link', { name: 'Node document extraction guide ↗' }); assert.equal(await link.getAttribute('href'), 'https://github.com/alvarovillalbaa/intakelet/blob/main/docs/references/document-extraction.md'); assert.equal(await link.getAttribute('target'), '_blank'); assert.match(await link.getAttribute('rel'), /noopener/);
  assert.ok((await page.locator('body').innerText()).includes('npm install ./alvarovillalbaa-intakelet-0.5.0.tgz'));
  receipt.width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })); assert.ok(receipt.width.content <= receipt.width.viewport); assert.deepEqual(receipt.errors, []);
  await page.screenshot({ path: join(output, 'document-guide-390.png'), animations: 'disabled' }); receipt.browserVersion = browser.version(); receipt.passed = true;
} finally {
  if (context) { await context.close(); receipt.contextsClosed = true; }
  if (browser) { await browser.close(); receipt.browserClosed = !browser.isConnected(); }
  if (server) { await new Promise(ok => { server.close(ok); server.closeAllConnections(); }); receipt.serverClosed = !server.listening; }
  receipt.passed = receipt.passed && receipt.contextsClosed && receipt.browserClosed && receipt.serverClosed;
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
assert.equal(receipt.passed, true); console.log(JSON.stringify(receipt));
