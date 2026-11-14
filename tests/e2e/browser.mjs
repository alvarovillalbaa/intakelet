// T2 authored data, actual Chromium/IndexedDB and installed-package consumers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(join(process.env.INTAKELET_BROWSER_TOOLS, 'package.json'));
const { chromium } = require('playwright');
const repo = resolve(import.meta.dirname, '../..'), output = process.env.INTAKELET_OUTPUT;
const artifact = join(output, 'browser'); await mkdir(artifact);
const site = new URL(process.env.INTAKELET_SITE);
assert.equal(site.protocol, 'https:'); assert.ok(/^intakelet-[a-z0-9]+-my-team-4f230354\.vercel\.app$/.test(site.hostname));
assert.equal(site.pathname, '/'); assert.equal(site.search, ''); assert.equal(site.hash, '');
const hash = b => createHash('sha256').update(b).digest('hex');
const receipt = { cases: [], contexts: [], hosted: [], browserClosed: false, serverClosed: false, passed: false };
let browser, server;
const selection = process.env.INTAKELET_CASES ? new Set(process.env.INTAKELET_CASES.split(',')) : null;
const ids = ['E01', 'E02', 'E03', 'E04-18', 'E04-19', 'E05', 'E06-390', 'E06-320'];
if (selection) assert.ok(selection.size && [...selection].every(id => ids.includes(id)));
const files = await Promise.all(['contacts.csv', 'handbook.md'].map(async name => ({ name, mimeType: 'text/plain', buffer: await readFile(join(repo, 'examples', name)) })));
const control = '[data-intakelet=import]', status = '[data-intakelet=status]';
async function enabled(page, selector = control) { await page.waitForFunction(s => { const el = document.querySelector(s); return el && !el.disabled; }, selector); }
async function ready(page) { await page.waitForFunction(() => document.querySelector('[data-intakelet=status]')?.textContent.includes('Workspace ready')); }
async function stats(page, expected) { await page.waitForFunction(values => JSON.stringify([...document.querySelectorAll('.il-stats strong')].map(n => n.textContent)) === JSON.stringify(values.map(String)), expected); }
async function snapshot(page) { return page.evaluate(async () => { const request = indexedDB.open('intakelet-playground-v1', 1); const db = await new Promise((ok, no) => { request.onsuccess = () => ok(request.result); request.onerror = () => no(request.error); }); try { return await new Promise((ok, no) => { const tx = db.transaction('workspaces'), request = tx.objectStore('workspaces').get('playground'); let value; request.onsuccess = () => { value = request.result; }; tx.oncomplete = () => ok(value); tx.onabort = () => no(tx.error); }); } finally { db.close(); } }); }
async function screenshot(page, name) { await page.screenshot({ path: join(artifact, name + '.png'), fullPage: true, animations: 'disabled' }); }
async function attempt(id, options, run) {
  if (selection && !selection.has(id)) return;
  const row = { id, passed: false }, record = { id, closed: false };
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1365, height: 900 }, ...options }); receipt.contexts.push(record);
  const page = await context.newPage(), errors = [], requests = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.stack)); page.on('request', request => requests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType() }));
  try { await run(page, context, row); assert.deepEqual(errors, [], 'No unhandled browser exception'); row.passed = true; }
  catch (error) { row.error = error.stack; await writeFile(join(artifact, id + '-failure.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable')); await screenshot(page, id + '-failure').catch(() => {}); }
  finally { row.errors = errors; await writeFile(join(artifact, id + '-requests.json'), JSON.stringify(requests, null, 2)); await context.close(); record.closed = true; receipt.cases.push(row); console.log(JSON.stringify(row)); }
}
try {
  // Ordinary anonymous HTTPS, before browser instrumentation. Every exact body is retained.
  const manifest = JSON.parse(await readFile(join(repo, 'dist/build.json'), 'utf8'));
  const bodies = Object.entries(manifest.files); const build = await readFile(join(repo, 'dist/build.json')); bodies.push(['build.json', { bytes: build.length, sha256: hash(build) }]);
  for (const [name, expected] of bodies) {
    const url = new URL(name === 'index.html' ? '/' : '/' + name, site), response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    const bytes = Buffer.from(await response.arrayBuffer()), actual = { path: name, status: response.status, bytes: bytes.length, sha256: hash(bytes), headers: Object.fromEntries(response.headers) };
    receipt.hosted.push(actual); assert.equal(response.status, 200); assert.equal(bytes.length, expected.bytes); assert.equal(actual.sha256, expected.sha256);
    const destination = join(artifact, 'hosted-bodies', name); await mkdir(resolve(destination, '..'), { recursive: true }); await writeFile(destination, bytes);
  }
  await writeFile(join(artifact, 'hosted-bodies.json'), JSON.stringify(receipt.hosted, null, 2));
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname, match = /^\/(react18|react19)\/(index.html|consumer.js|styles.css)$/.exec(path);
      if (!match) { response.writeHead(404).end(); return; }
      const file = join(process.env.INTAKELET_BROWSER_FIXTURES, match[1], match[2]);
      response.writeHead(200, { 'Content-Type': match[2].endsWith('.js') ? 'application/javascript' : match[2].endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' }); response.end(await readFile(file));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok)); const fixture = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true }); receipt.browserVersion = browser.version();
  async function harness(page, edition = 'react19') { await page.goto(fixture + '/' + edition + '/index.html'); await page.waitForFunction(() => window.fixtureReady); }

  await attempt('E01', {}, async (page, context, row) => {
    await page.goto(site.href); await ready(page);
    await page.locator('[data-intakelet=files]').setInputFiles(files); await enabled(page);
    const original = await page.locator('#onboarding').evaluate(el => el.reviewPlan);
    assert.equal(original.records.length, 2); assert.equal(original.draft.totals.rows, 3); assert.equal(original.draft.sources.length, 2);
    await page.locator('[data-intakelet=files]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"same":1,"same":2}') });
    await page.waitForFunction(() => document.querySelector('[data-intakelet=status]')?.textContent.includes('Previous review'));
    assert.equal(await page.locator('#onboarding').evaluate(el => el.reviewPlan.planId), original.planId);
    await page.locator('[data-intakelet=files]').setInputFiles({ name: 'literal.md', mimeType: 'text/markdown', buffer: Buffer.from('# Literal\n<script>window.__intakeletInjected=true</script>\n<img src=x onerror=window.__intakeletInjected=true>') }); await enabled(page);
    assert.equal(await page.evaluate(() => window.__intakeletInjected), undefined);
    const plan = await page.locator('#onboarding').evaluate(el => el.reviewPlan); assert.equal(plan.draft.sources.length, 3);
    const waiting = page.waitForEvent('download'); await page.locator('[data-intakelet=export-plan]').click(); const download = await waiting;
    assert.equal(download.suggestedFilename(), 'intakelet-plan.json'); const target = join(artifact, 'E01-plan.json'); await download.saveAs(target); assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), plan);
    await page.locator(control).click(); await page.waitForFunction(() => document.querySelector('[data-intakelet=status]').textContent.includes('Import acknowledged')); await stats(page, [2, 3, 1]);
    const state = await snapshot(page); assert.equal(state.receipts[0].planId, plan.planId); assert.equal(state.sources.length, 3);
    for (const article of state.articles.filter(a => a.method === 'exact_source')) { const source = state.sources.find(s => s.id === article.sourceId); assert.equal(article.text, source.text.slice(article.span.start, article.span.end)); }
    await page.locator('[data-intakelet=search]').fill('confirms scope'); assert.equal(await page.locator('[data-intakelet=results] details').count(), 1);
    await page.locator('[data-intakelet=results] summary').click(); assert.match(await page.locator('[data-intakelet=results]').innerText(), /project owner confirms scope/);
    await screenshot(page, 'E01-imported-desktop'); await page.reload(); await ready(page); await stats(page, [2, 3, 1]); assert.deepEqual(await snapshot(page), state);
    row.planId = plan.planId; row.revision = state.revision; row.downloadSha256 = hash(await readFile(target)); row.literalContentExecuted = false;
  });

  await attempt('E02', {}, async (page, context, row) => {
    await harness(page);
    await page.evaluate(async () => {
      const { MemoryHost, defineIntakelet } = window.sdk; defineIntakelet(); const primary = new MemoryHost({ workspaceId: 'primary' }), other = new MemoryHost({ workspaceId: 'other' });
      let releaseRead; const waitRead = new Promise(ok => { releaseRead = ok; });
      const delayed = { snapshot: async () => { await waitRead; return primary.snapshot(); }, commit: (p, o) => primary.commit(p, o) };
      const element = document.createElement('intakelet-onboarding'); element.id = 'first'; document.body.append(element); element.configure({ workspaceId: 'primary', host: delayed });
      window.fx = { primary, other, element, delayed, releaseRead, acks: [] }; element.addEventListener('intakelet-commit', e => window.fx.acks.push(e.detail));
      await element.addSources([{ name: 'eager.md', text: '# Eager\nStaged before the first snapshot resolves.' }]);
    });
    assert.equal(await page.locator('#first ' + control).isDisabled(), true); await page.evaluate(() => window.fx.releaseRead()); await enabled(page, '#first ' + control);
    await page.evaluate(() => { const second = document.createElement('intakelet-onboarding'); second.id = 'second'; document.body.append(second); second.configure({ workspaceId: 'other', host: window.fx.other }); });
    const ids = await page.locator('input[id],select[id]').evaluateAll(nodes => nodes.map(n => n.id)); assert.equal(new Set(ids).size, ids.length);
    await page.evaluate(() => {
      const f = window.fx; const research = () => new Promise(ok => { f.releaseResearch = ok; }); f.element.configure({ workspaceId: 'primary', host: f.delayed, research });
    });
    await page.locator('#first [data-intakelet=url]').fill('https://authored.example.test'); await page.locator('#first').getByRole('button', { name: 'Research website', exact: true }).click();
    await page.waitForFunction(() => typeof window.fx.releaseResearch === 'function');
    await page.evaluate(() => {
      const f = window.fx; f.element.configure({ workspaceId: 'other', host: f.other }); f.releaseResearch({ schema: 'intakelet.research', version: 1, files: [{ name: 'late.md', text: '# Late\nMust not enter another workspace.' }], pages: [], skipped: [], coverage: { pages: 1, requests: 1 } });
    });
    await page.waitForFunction(() => document.querySelector('#first [data-intakelet=status]').textContent.includes('Workspace ready')); assert.equal(await page.locator('#first').evaluate(el => el.reviewPlan), null); assert.doesNotMatch(await page.locator('#first').innerText(), /late.md/);
    await page.evaluate(async () => {
      const f = window.fx; const delayedCommit = { snapshot: () => f.primary.snapshot(), commit: async (plan, options) => { const receipt = await f.primary.commit(plan, options); f.commitStarted = true; await new Promise(ok => { f.releaseCommit = ok; }); return receipt; } };
      f.element.configure({ workspaceId: 'primary', host: delayedCommit }); await f.element.addSources([{ name: 'ack.md', text: '# Acknowledged\nA write stays in its original host.' }]);
    });
    await enabled(page, '#first ' + control); await page.locator('#first ' + control).click(); await page.waitForFunction(() => window.fx.commitStarted);
    await page.evaluate(() => { const f = window.fx; f.element.configure({ workspaceId: 'other', host: f.other }); f.releaseCommit(); });
    await page.waitForFunction(() => window.fx.acks.length === 1 && document.querySelector('#first [data-intakelet=status]').textContent.includes('Workspace ready'));
    const result = await page.evaluate(async () => ({ primary: await window.fx.primary.snapshot(), other: await window.fx.other.snapshot(), acks: window.fx.acks }));
    assert.equal(result.primary.revision, 1); assert.equal(result.other.revision, 0); assert.equal(result.acks[0].workspaceId, 'primary'); assert.equal(await page.locator('#first').evaluate(el => el.reviewPlan), null);
    await screenshot(page, 'E02-isolated-components'); row.eagerSnapshotResolved = true; row.uniqueInputIds = ids.length; row.acknowledgedOriginalRevision = 1; row.otherRevision = 0;
  });

  await attempt('E03', {}, async (page, context, row) => {
    await harness(page); const second = await context.newPage(); await harness(second);
    const prepare = async (p, text) => p.evaluate(async text => { const { createIndexedDBHost, analyzeFiles, createPlan } = window.sdk; window.host = createIndexedDBHost({ workspaceId: 'shared', databaseName: 'intakelet-e03' }); window.plan = await createPlan(await analyzeFiles([{ name: text + '.md', text: '# ' + text + '\nAuthored concurrent source.' }], { workspaceId: 'shared' })); return (await window.host.snapshot()).revision; }, text);
    assert.equal(await prepare(page, 'First'), 0); assert.equal(await prepare(second, 'Second'), 0);
    const commit = p => p.evaluate(async () => { try { return { ok: true, receipt: await window.host.commit(window.plan, { expectedRevision: 0 }) }; } catch (error) { return { ok: false, code: error.code }; } });
    const outcomes = await Promise.all([commit(page), commit(second)]); assert.equal(outcomes.filter(x => x.ok).length, 1); assert.equal(outcomes.find(x => !x.ok).code, 'conflict');
    const winner = outcomes[0].ok ? page : second, loser = outcomes[0].ok ? second : page, original = outcomes.find(x => x.ok).receipt;
    assert.deepEqual((await commit(winner)).receipt, original);
    const after = await loser.evaluate(async () => { const state = await window.host.snapshot(); const receipt = await window.host.commit(window.plan, { expectedRevision: state.revision }); return { receipt, state: await window.host.snapshot() }; });
    assert.equal(after.state.revision, 2); assert.equal(after.state.sources.length, 2); assert.equal(after.state.receipts.length, 2);
    const denied = await page.evaluate(async () => { const other = window.sdk.createIndexedDBHost({ workspaceId: 'other', databaseName: 'intakelet-e03' }); try { await other.commit(window.plan, { expectedRevision: 0 }); return 'unexpected'; } catch (error) { return { code: error.code, revision: (await other.snapshot()).revision }; } finally { other.close(); } }); assert.deepEqual(denied, { code: 'workspace', revision: 0 });
    await page.evaluate(() => window.host.close()); await second.evaluate(() => window.host.close()); await page.reload(); await page.waitForFunction(() => window.fixtureReady);
    const persisted = await page.evaluate(async () => { const host = window.sdk.createIndexedDBHost({ workspaceId: 'shared', databaseName: 'intakelet-e03' }); try { return await host.snapshot(); } finally { host.close(); } }); assert.deepEqual(persisted, after.state);
    await writeFile(join(artifact, 'E03-state.json'), JSON.stringify(persisted, null, 2)); row.concurrent = outcomes; row.finalRevision = 2; row.reloadEqual = true;
  });

  for (const edition of ['18', '19']) await attempt('E04-' + edition, {}, async (page, context, row) => {
    await harness(page, 'react' + edition); assert.ok((await page.evaluate(() => window.reactVersion)).startsWith(edition + '.'));
    await page.evaluate(() => { const host = new window.sdk.MemoryHost({ workspaceId: 'react' }), other = new window.sdk.MemoryHost({ workspaceId: 'next' }); window.reactFixture = { host, other, acks: [], stale: [] }; window.renderIntakelet({ id: 'wrapper', workspaceId: 'react', host, onCommit: value => window.reactFixture.stale.push(value) }); });
    await page.waitForSelector('#wrapper [data-intakelet=files]'); await ready(page);
    await page.locator('#wrapper [data-intakelet=files]').setInputFiles(files); await enabled(page); const planId = await page.locator('#wrapper').evaluate(el => el.reviewPlan.planId);
    await page.evaluate(() => { const f = window.reactFixture; window.renderIntakelet({ id: 'wrapper', workspaceId: 'react', host: f.host, research: async () => { throw Error('Authored unused callback'); }, onCommit: value => f.acks.push(value) }); });
    await page.waitForFunction(() => !document.querySelector('#wrapper [data-intakelet=url]').disabled); assert.equal(await page.locator('#wrapper').evaluate(el => el.reviewPlan.planId), planId);
    await page.locator(control).click(); await page.waitForFunction(() => window.reactFixture.acks.length === 1); assert.equal(await page.evaluate(() => window.reactFixture.stale.length), 0); await stats(page, [2, 2, 1]);
    await screenshot(page, 'E04-react' + edition);
    await page.evaluate(() => { const f = window.reactFixture; window.renderIntakelet({ id: 'wrapper', workspaceId: 'next', host: f.other, onCommit: value => f.acks.push(value) }); }); await ready(page); await stats(page, [0, 0, 0]); assert.equal(await page.locator('#wrapper').evaluate(el => el.reviewPlan), null);
    const states = await page.evaluate(async () => ({ original: await window.reactFixture.host.snapshot(), next: await window.reactFixture.other.snapshot() })); assert.equal(states.original.revision, 1); assert.equal(states.next.revision, 0); await page.evaluate(() => window.unmountIntakelet()); assert.equal(await page.locator('intakelet-onboarding').count(), 0);
    row.version = await page.evaluate(() => window.reactVersion); row.strictMode = true; row.latestCallbackCount = 1; row.staleCallbackCount = 0;
  });

  await attempt('E05', {}, async (page, context, row) => {
    await page.goto(site.href); await ready(page); await page.getByRole('button', { name: 'Load sample files', exact: true }).click(); await enabled(page); const before = await page.locator('#onboarding').evaluate(el => el.reviewPlan.planId);
    const researchRequests = []; page.on('request', request => researchRequests.push(request.url()));
    await page.locator('[data-intakelet=url]').fill('https://authored-offsite.example.test'); await page.getByRole('button', { name: 'Research website', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-intakelet=status]').textContent.includes('only its own authored sample'));
    assert.equal(researchRequests.length, 0); assert.equal(await page.locator('#onboarding').evaluate(el => el.reviewPlan.planId), before);
    let release, reach; const stalled = new Promise(ok => { release = ok; }), reached = new Promise(ok => { reach = ok; }); let routed = false;
    // Cancel at the actual content request, while robots is served normally.
    await page.route('**/fixtures/company/', async route => { routed = true; reach(); await stalled; await route.abort().catch(() => {}); });
    await page.getByRole('button', { name: 'Use sample website', exact: true }).click(); await page.getByRole('button', { name: 'Research website', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-intakelet=status]').textContent === 'Researching public pages');
    await Promise.race([reached, new Promise((_, no) => { const timer = setTimeout(() => no(Error('Authored content request was not reached')), 10000); timer.unref(); })]);
    await page.getByRole('button', { name: 'Cancel research', exact: true }).click(); release(); await page.waitForFunction(() => !document.querySelector('[data-intakelet=status]').textContent.includes('Researching public pages')); await page.unrouteAll({ behavior: 'wait' });
    assert.equal(await page.locator('#onboarding').evaluate(el => el.reviewPlan.planId), before);
    researchRequests.length = 0; await page.getByRole('button', { name: 'Research website', exact: true }).click(); await enabled(page);
    const plan = await page.locator('#onboarding').evaluate(el => el.reviewPlan); assert.equal(plan.draft.sources.length, 6); assert.equal(plan.draft.sources.filter(s => s.url).length, 4);
    const coverage = page.getByText('Website coverage · partial', { exact: true }); await coverage.click(); assert.match(await page.locator('#onboarding').innerText(), /robots_denied/);
    assert.ok(researchRequests.some(url => url.endsWith('/robots.txt'))); assert.equal(researchRequests.filter(url => /marker\.js|private\.html/.test(url)).length, 0); assert.equal(await page.evaluate(() => window.__intakeletResearchExecuted), undefined);
    await page.locator(control).click(); await page.waitForFunction(() => document.querySelector('[data-intakelet=status]').textContent.includes('Import acknowledged'));
    const state = await snapshot(page); assert.equal(state.sources.length, 6); assert.equal(state.records.length, 2); const cited = state.articles.filter(a => a.url); assert.equal(cited.length, 4); assert.ok(cited.every(a => !a.text.includes('AUTHORED_ROBOTS_DENIED_MARKER')));
    await writeFile(join(artifact, 'E05-researched-plan.json'), JSON.stringify(plan, null, 2)); await writeFile(join(artifact, 'E05-research-requests.json'), JSON.stringify(researchRequests, null, 2)); await screenshot(page, 'E05-website-evidence'); row.pages = 4; row.offsiteRequests = 0; row.scriptExecuted = false; row.cancelPreservedPlan = true; row.stalledContentReached = routed;
  });

  for (const width of [390, 320]) await attempt('E06-' + width, { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, async (page, context, row) => {
    await page.goto(site.href); await ready(page);
    const chooserWaiting = page.waitForEvent('filechooser'); await page.getByText('Add files', { exact: true }).tap(); const chooser = await chooserWaiting; await chooser.setFiles(files); await enabled(page);
    const included = page.getByRole('checkbox', { name: 'Include row2 from contacts.csv', exact: true }); await included.tap(); await enabled(page); assert.equal(await included.isChecked(), false);
    await page.locator('[data-intakelet=search]').focus(); await page.keyboard.type('project'); assert.equal(await page.locator('[data-intakelet=search]').inputValue(), 'project');
    await page.locator(control).tap(); await page.waitForFunction(() => document.querySelector('[data-intakelet=status]').textContent.includes('Import acknowledged')); await stats(page, [1, 2, 1]);
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, touch: navigator.maxTouchPoints })); assert.ok(dimensions.touch > 0); assert.ok(dimensions.scroll <= dimensions.client + 1);
    await screenshot(page, 'E06-' + width + '-imported'); await page.reload(); await ready(page); await stats(page, [1, 2, 1]);
    // Actual keyboard focus and visible outline through Tab, no click-synthesized focus claim.
    await page.locator('[data-intakelet=search]').focus(); await page.keyboard.press('Shift+Tab'); const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, outline: getComputedStyle(document.activeElement).outlineStyle })); assert.notEqual(focus.tag, 'BODY'); assert.equal(focus.outline, 'solid');
    row.dimensions = dimensions; row.nativeChooser = true; row.touchRowAndImport = true; row.keyboardFocus = focus;
  });
  receipt.passed = receipt.cases.length === (selection?.size ?? ids.length) && receipt.cases.every(row => row.passed);
} catch (error) { receipt.error = error.stack; }
finally {
  if (browser) { await browser.close(); receipt.browserClosed = !browser.isConnected(); }
  if (server) { server.closeAllConnections(); await new Promise((ok, no) => server.close(error => error ? no(error) : ok())); receipt.serverClosed = true; }
  receipt.passed = receipt.passed && receipt.browserClosed && receipt.serverClosed && receipt.contexts.every(context => context.closed);
  await writeFile(join(artifact, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
}
if (!receipt.passed) process.exitCode = 1;
