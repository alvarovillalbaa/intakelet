// T2 authored application fixtures. Run only in an owned remote environment.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(join(process.env.INTAKELET_BROWSER_TOOLS, 'node_modules/playwright/index.mjs')));
const root = resolve(import.meta.dirname, '../..'), output = process.env.INTAKELET_NATIVE_OUTPUT;
await mkdir(output, { recursive: true });
const receipt = { tier: 'T2', cases: [], contexts: [], hosted: [], browserClosed: false, serverClosed: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const selected = process.env.INTAKELET_CASES ? new Set(process.env.INTAKELET_CASES.split(',')) : null;
const known = ['N01', 'N02', 'N03', 'N04-18', 'N04-19', 'N05-320', 'N05-390'];
assert.ok(!selected || [...selected].every(id => known.includes(id)));
let browser, server;
async function run(id, options, action) {
  if (selected && !selected.has(id)) return;
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, ...options });
  const state = { id, closed: false }; receipt.contexts.push(state);
  const page = await context.newPage(), errors = [], requests = [], row = { id, passed: false };
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.stack));
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  try { await action(page, row); assert.deepEqual(errors, []); row.passed = true; }
  catch (error) { row.error = error.stack; await writeFile(join(output, id + '-failure.txt'), await page.locator('body').innerText().catch(() => 'Unavailable')); }
  finally {
    await page.screenshot({ path: join(output, id + '.png'), animations: 'disabled' }).catch(error => { row.screenshotError = error.message; row.passed = false; });
    await writeFile(join(output, id + '-requests.json'), JSON.stringify(requests, null, 2));
    row.errors = errors; await context.close(); state.closed = true; receipt.cases.push(row); console.log(JSON.stringify(row));
  }
}
try {
  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const consumer = /^\/(react18|react19)\/(index.html|consumer.js|styles.css)$/.exec(pathname);
      let path;
      if (consumer) path = join(process.env.INTAKELET_BROWSER_FIXTURES, consumer[1], consumer[2]);
      else {
        const name = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (!name || name.includes('..') || name.includes('\\')) { response.writeHead(400).end(); return; }
        path = join(root, 'dist', name);
      }
      const bytes = await readFile(path), mime = path.endsWith('.js') || path.endsWith('.mjs') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : path.endsWith('.html') ? 'text/html' : 'text/plain';
      const headers = Object.fromEntries(config.headers[0].headers.map(item => [item.key, item.value]));
      response.writeHead(200, { ...headers, 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const fixture = 'http://127.0.0.1:' + server.address().port;
  const site = process.env.INTAKELET_SITE || fixture;
  if (process.env.INTAKELET_SITE) {
    const url = new URL(site); assert.equal(url.protocol, 'https:'); assert.equal(url.username + url.password, '');
    const manifest = JSON.parse(await readFile(join(root, 'dist/build.json'), 'utf8'));
    const build = await readFile(join(root, 'dist/build.json'));
    const entries = [...Object.entries(manifest.files), ['build.json', { bytes: build.length, sha256: hash(build) }]];
    for (const [name, expected] of entries) {
      const response = await fetch(new URL(name === 'index.html' ? '/' : '/' + name, site), { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const bytes = Buffer.from(await response.arrayBuffer()), row = { path: name, status: response.status, bytes: bytes.length, sha256: hash(bytes), headers: Object.fromEntries(response.headers) }; receipt.hosted.push(row);
      assert.equal(row.status, 200); assert.equal(row.bytes, expected.bytes); assert.equal(row.sha256, expected.sha256);
      for (const header of config.headers[0].headers) assert.equal(row.headers[header.key.toLowerCase()], header.value);
      const path = join(output, 'hosted-bodies', name); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes);
    }
  }
  browser = await chromium.launch({ headless: true }); receipt.browserVersion = browser.version();
  const ready = async page => { await page.goto(site); await page.waitForSelector('#user-setup input'); await page.waitForSelector('#output-fields input'); };
  const harness = async (page, edition = '19') => { await page.goto(fixture + '/react' + edition + '/index.html'); await page.waitForFunction(() => window.fixtureReady); };
  await run('N01', {}, async (page, row) => {
    await ready(page);
    await page.locator('#quickstart').getByRole('button', { name: 'Check setup', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#quickstart [role=status]')?.textContent.includes('Complete the first user setup step'));
    assert.equal(await page.locator('#quickstart progress').evaluate(el => el.value), 0);
    await page.locator('#user-setup input').fill('Authored person'); await page.locator('#user-setup button[type=submit]').click();
    await page.waitForSelector('#user-setup textarea'); await page.locator('#user-setup textarea').fill('Learn a useful first step');
    await page.locator('#user-setup button[type=submit]').click(); await page.waitForFunction(() => document.querySelector('#user-setup').progress.complete);
    await page.locator('#company-setup input').nth(0).fill('Authored team'); await page.locator('#company-setup input').nth(1).fill('https://authored.example.test'); await page.locator('#company-setup button[type=submit]').click();
    await page.locator('#company-setup').getByRole('button', { name: 'Skip this step', exact: true }).click();
    await page.locator('#quickstart').getByRole('button', { name: 'Check setup', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#quickstart').progress.completed.includes('profile'));
    const ids = await page.locator('input[id],textarea[id],select[id]').evaluateAll(nodes => nodes.map(node => node.id)); assert.equal(new Set(ids).size, ids.length);
    row.person = await page.locator('#user-setup').evaluate(el => el.progress); row.company = await page.locator('#company-setup').evaluate(el => el.progress); row.quickstart = await page.locator('#quickstart').evaluate(el => el.progress);
    assert.equal(row.person.receipts.length, 2); assert.deepEqual(row.company.skipped, ['preferences']);
    await page.locator('#quickstart').scrollIntoViewIfNeeded();
  });
  await run('N02', {}, async (page, row) => {
    await ready(page); await page.locator('#start-tour').click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Next', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.il-tour-card .il-primary').disabled);
    assert.equal(await dialog.getAttribute('aria-modal'), 'false');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#guided-tour').currentStep === 'files' && !document.querySelector('.il-tour-card .il-primary').disabled);
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0); assert.equal(await page.evaluate(() => document.activeElement.id), 'start-tour');
    await page.locator('#guided-tour').evaluate(el => { window.missingCompleted = 0; el.configure({ steps: [{ id: 'missing', title: 'Missing target', description: 'A missing target cannot complete.', target: '#absent-authored-target' }], onComplete: () => window.missingCompleted++ }); void el.start(); });
    await page.waitForFunction(() => document.querySelector('.il-tour-card [role=status]')?.textContent.includes('not visible yet'));
    assert.equal(await dialog.getByRole('button', { name: 'Finish tour', exact: true }).isDisabled(), true);
    await page.locator('#guided-tour').evaluate(el => el.remove()); assert.equal(await dialog.count(), 0); assert.equal(await page.evaluate(() => window.missingCompleted), 0);
    row.realTargetAdvanced = true; row.escapeReturnedFocus = true; row.missingTargetCompleted = false; row.disconnectedOverlayRemoved = true;
    await page.locator('#start-tour').scrollIntoViewIfNeeded();
  });
  async function migrate(page, count, row, touch = false) {
    const click = async locator => touch ? locator.tap() : locator.click();
    const files = Array.from({ length: count }, (_, i) => ({ name: 'authored-' + i + (i === 0 ? '.opaque' : '.txt'), mimeType: i === 0 ? 'application/octet-stream' : 'text/plain', buffer: i === 0 ? Buffer.from([0, 255, 128, 17]) : Buffer.from('Authored file ' + i) }));
    await page.locator('#bulk-files').setInputFiles(files);
    for (const [index, target] of ['migration.id', 'document.name', 'document.asset', 'document.bytes'].entries()) await page.locator('#output-fields input').nth(index).fill(target);
    await click(page.locator('#bulk-configure')); await page.waitForFunction(() => !document.querySelector('#bulk-migration').hidden);
    await click(page.getByText('Generated output recipe for your integration', { exact: true }));
    assert.match(await page.locator('#output-preview').innerText(), /document/);
    await page.locator('#bulk-migration').evaluate(el => { window.nativeAcks = []; el.addEventListener('intakelet-migration-acknowledged', e => window.nativeAcks.push(e.detail)); });
    await click(page.locator('#bulk-migration').getByRole('button', { name: 'Review next batch', exact: true }));
    const plans = []; let batch = 0;
    while (batch < Math.ceil(count / 4)) {
      await page.waitForFunction(() => document.querySelector('#bulk-migration').reviewBatch);
      const original = await page.locator('#bulk-migration').evaluate(el => el.reviewBatch); plans.push(original);
      if (batch === 0 && count > 4) {
        await page.locator('#bulk-migration input[type=checkbox]').first().check(); assert.equal(await page.locator('#bulk-migration').getByRole('button', { name: 'Commit this batch', exact: true }).isDisabled(), true);
        await click(page.locator('#bulk-migration').getByRole('button', { name: 'Apply exclusions and review again', exact: true }));
        await page.waitForFunction(id => { const plan = document.querySelector('#bulk-migration').reviewBatch; return plan && plan.batchId !== id; }, original.batchId);
        plans.push(await page.locator('#bulk-migration').evaluate(el => el.reviewBatch));
      }
      const plan = plans.at(-1); for (const item of plan.rows.filter(item => item.action === 'create')) { assert.equal(typeof item.data.migration.id, 'string'); assert.equal(typeof item.data.document.asset, 'string'); }
      await click(page.locator('#bulk-migration').getByRole('button', { name: 'Commit this batch', exact: true })); batch++;
      await page.waitForFunction(n => window.nativeAcks.length === n, batch);
    }
    await page.waitForFunction(() => document.querySelector('#bulk-migration').progress.phase === 'complete' && !document.querySelector('#bulk-migration').progress.busy);
    row.plans = plans; row.acknowledgements = await page.evaluate(() => window.nativeAcks); row.progress = await page.locator('#bulk-migration').evaluate(el => el.progress);
    assert.equal(row.acknowledgements.reduce((sum, item) => sum + item.receipt.counts.created, 0), count - (count > 4 ? 1 : 0));
    assert.ok(row.acknowledgements.every(item => item.appliedToView));
    await page.locator('#bulk-migration').scrollIntoViewIfNeeded();
  }
  await run('N03', {}, async (page, row) => { await ready(page); await migrate(page, 13, row); assert.equal(await page.locator('#bulk-receipts li').count(), 4); });
  for (const edition of ['18', '19']) await run('N04-' + edition, {}, async (page, row) => {
    await harness(page, edition); assert.ok((await page.evaluate(() => window.reactVersion)).startsWith(edition + '.'));
    await page.evaluate(() => {
      const { initialSetup } = window.sdk;
      window.fx = { acks: [], requests: [], complete: 0 };
      const f = window.fx; f.old = initialSetup('user', { actorId: 'old-actor', workspaceId: 'old-workspace' }); f.next = initialSetup('user', { actorId: 'next-actor', workspaceId: 'next-workspace' });
      f.props = flow => ({ id: 'react-setup', flow, onAcknowledged: detail => f.acks.push(detail), onComplete: () => f.complete++, submit: async request => { f.requests.push(request); if (request.scope.workspaceId === 'old-workspace') await new Promise(ok => { f.release = ok; }); return { requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'authored-' + request.scope.workspaceId }; } });
      window.renderGuide(f.props(f.old));
    });
    await page.locator('#react-setup input').fill('Old authored person'); await page.locator('#react-setup button[type=submit]').click(); await page.waitForFunction(() => typeof window.fx.release === 'function');
    await page.evaluate(() => window.renderGuide(window.fx.props(window.fx.next))); await page.waitForFunction(() => document.querySelector('#react-setup').progress.values.name === undefined);
    await page.evaluate(() => window.fx.release()); await page.waitForFunction(() => window.fx.acks.length === 1);
    assert.equal(await page.evaluate(() => window.fx.acks[0].appliedToView), false); assert.equal(await page.evaluate(() => window.fx.acks[0].scope.workspaceId), 'old-workspace'); assert.equal(await page.locator('#react-setup input').inputValue(), '');
    await page.locator('#react-setup input').fill('Next authored person'); await page.locator('#react-setup button[type=submit]').click(); await page.waitForSelector('#react-setup textarea'); await page.locator('#react-setup').getByRole('button', { name: 'Skip this step', exact: true }).click(); await page.waitForFunction(() => window.fx.complete === 1);
    await page.evaluate(async () => {
      const f = window.fx, sdk = window.sdk;
      const bytes = new Uint8Array([0, 255, 17]), digest = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      const source = await sdk.createFileMigrationSource({ collectionId: 'react-selection', files: [new File([bytes], 'authored.bin')], assetStore: { put: async () => ({ bytes: bytes.length, sha256: digest, assetId: digest }) } });
      f.host = new sdk.MemoryMigrationHost({ workspaceId: 'react-migration' }); f.migrationAcks = [];
      window.renderMigration({ id: 'react-migration', source, host: f.host, spec: sdk.fileMigration({ workspaceId: 'react-migration', connectionId: 'react-files', source }), onAcknowledged: detail => f.migrationAcks.push(detail) });
    });
    await page.locator('#react-migration').getByRole('button', { name: 'Review next batch', exact: true }).click(); await page.locator('#react-migration').getByRole('button', { name: 'Commit this batch', exact: true }).click(); await page.waitForFunction(() => window.fx.migrationAcks.length === 1 && !document.querySelector('#react-migration').progress.busy);
    row.setupAcks = await page.evaluate(() => window.fx.acks); row.migrationAcks = await page.evaluate(() => window.fx.migrationAcks); assert.equal(row.migrationAcks[0].receipt.counts.created, 1);
    await page.evaluate(() => {
      const target = document.createElement('button'); target.id = 'fixture-target'; target.textContent = 'Authored target'; document.body.append(target);
      const f = window.fx; f.checkAcks = []; f.tourCompleted = 0;
      window.renderOtherGuides({ quickstart: { flow: { id: 'react-checklist', version: '1', scope: { actorId: 'authored', workspaceId: 'react' }, steps: [{ id: 'one', title: 'First step', fields: [] }] }, submit: async request => ({ requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'authored-checklist' }), onAcknowledged: detail => f.checkAcks.push(detail) }, tour: { active: true, steps: [{ id: 'target', title: 'React guide', description: 'An actual installed wrapper.', target: '#fixture-target' }], onComplete: () => f.tourCompleted++ } });
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Finish tour', exact: true }).click(); await page.locator('intakelet-quickstart').getByRole('button', { name: 'Start', exact: true }).click(); await page.waitForFunction(() => window.fx.checkAcks.length === 1 && window.fx.tourCompleted === 1);
    await page.evaluate(() => window.unmountSDK()); assert.equal(await page.locator('intakelet-setup,intakelet-migration,intakelet-quickstart,intakelet-tour,.il-tour-overlay').count(), 0);
    row.version = await page.evaluate(() => window.reactVersion); row.strictMode = true; row.allFourWrappers = true;
  });
  for (const width of [320, 390]) await run('N05-' + width, { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, async (page, row) => {
    await ready(page); await page.locator('#user-setup input').fill('Authored mobile'); await page.locator('#user-setup input').press('Enter'); await page.waitForSelector('#user-setup textarea');
    await page.locator('#user-setup').getByRole('button', { name: 'Skip this step', exact: true }).tap(); await migrate(page, 2, row, true);
    row.viewport = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth })); assert.ok(row.viewport.documentWidth <= width + 1, 'No horizontal page overflow');
    await page.locator('#start-tour').tap(); await page.waitForFunction(() => !document.querySelector('.il-tour-card .il-primary').disabled);
    row.initialTourBox = await page.getByRole('dialog').boundingBox();
    await page.waitForFunction(() => { const box = document.querySelector('.il-tour-card').getBoundingClientRect(); return box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; });
    const box = await page.getByRole('dialog').boundingBox(); row.settledTourBox = box; assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 845);
    await page.screenshot({ path: join(output, 'N05-' + width + '-tour.png'), animations: 'disabled' });
    await page.getByRole('dialog').getByRole('button', { name: 'Close tour', exact: true }).tap(); assert.equal(await page.getByRole('dialog').count(), 0);
    await page.locator('#bulk-migration').scrollIntoViewIfNeeded(); row.touchMigration = true;
  });
} finally {
  if (browser) { await browser.close(); receipt.browserClosed = !browser.isConnected(); }
  if (server) { await new Promise((ok, no) => { server.close(error => error ? no(error) : ok()); server.closeAllConnections(); }); receipt.serverClosed = !server.listening; }
  receipt.passed = receipt.cases.length === (selected?.size ?? known.length) && receipt.cases.every(item => item.passed) && receipt.contexts.every(item => item.closed) && receipt.browserClosed && receipt.serverClosed;
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ passed: receipt.passed, cases: receipt.cases.map(({ id, passed, error }) => ({ id, passed, error })), browserClosed: receipt.browserClosed, serverClosed: receipt.serverClosed }));
}
assert.equal(receipt.passed, true, 'Every selected native case and owned teardown must pass');
