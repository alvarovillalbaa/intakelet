// T2: installed archive, authored local files/HTTP host, own public website.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
const consumer = process.env.INTAKELET_CONSUMER_ROOT, scratch = process.env.INTAKELET_CONSUMER_TMP, output = process.env.INTAKELET_OUTPUT, cli = join(consumer, 'node_modules/.bin/intakelet');
const require = createRequire(join(consumer, 'package.json'));
const sdk = await import(require.resolve('@alvarovillalbaa/intakelet')), nodeSDK = await import(require.resolve('@alvarovillalbaa/intakelet/node'));
const packageRoot = join(consumer, 'node_modules/@alvarovillalbaa/intakelet'), commands = [];
await mkdir(join(output, 'cli-streams')); await mkdir(join(output, 'cli-products')); await mkdir(join(output, 'native-research'));
const file = name => join(scratch, name), digest = b => createHash('sha256').update(b).digest('hex');
async function run(name, args, expected = 0) {
  const start = performance.now(), child = spawnSync(cli, args, { cwd: scratch, env: process.env, encoding: null, timeout: 120000, maxBuffer: 2097152 });
  for (const [stream, bytes] of [['stdout', child.stdout || Buffer.alloc(0)], ['stderr', child.stderr || Buffer.alloc(0)]]) await writeFile(join(output, 'cli-streams', name + '.' + stream + '.txt'), bytes);
  const item = { name, argv: [cli, ...args], exit: child.status, signal: child.signal, error: child.error?.message ?? null, leaderReaped: child.status !== null, seconds: (performance.now() - start) / 1000, stdoutBytes: child.stdout?.length || 0, stderrBytes: child.stderr?.length || 0, stdoutSha256: digest(child.stdout || Buffer.alloc(0)), stderrSha256: digest(child.stderr || Buffer.alloc(0)) };
  const destination = args[args.indexOf('--out') + 1];
  if (destination) { try { const bytes = await readFile(destination); assert.ok(bytes.length <= 16777216); await writeFile(join(output, 'cli-products', name + '.output'), bytes); item.productBytes = bytes.length; item.productSha256 = digest(bytes); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  commands.push(item);
  await writeFile(join(output, 'cli-receipts.json'), JSON.stringify(commands, null, 2)); assert.equal(child.status, expected, name + ': ' + child.stderr?.toString()); assert.equal(child.signal, null); return child;
}
const read = async name => sdk.parseJSON(await readFile(file(name), 'utf8'), 16777216);
async function baseline(prefix) {
  const files = []; for (const name of ['contacts.csv', 'handbook.md']) files.push({ name, text: await readFile(join(packageRoot, 'examples', name), 'utf8') });
  const plan = await sdk.createPlan(await sdk.analyzeFiles(files, { workspaceId: 'consumer' })), host = new sdk.MemoryHost({ workspaceId: 'consumer' }), receipt = await host.commit(plan, { expectedRevision: 0 });
  await writeFile(file(prefix + '-plan.json'), sdk.canonical(plan)); const applied = { schema: 'intakelet.applied', version: 1, receipt, state: await host.snapshot() }; await writeFile(file(prefix + '-base.json'), sdk.canonical(applied)); return { plan, applied };
}
after(async () => { await writeFile(join(output, 'cli-receipts.json'), JSON.stringify(commands, null, 2)); });
test('M01 installed executable analyzes, plans, applies and searches real source files', async () => {
  await run('inspect', ['inspect', '--workspace', 'consumer', '--out', file('draft.json'), join(packageRoot, 'examples/contacts.csv'), join(packageRoot, 'examples/handbook.md')]);
  const draft = await read('draft.json'); assert.equal(draft.schema, 'intakelet.draft'); assert.equal(draft.totals.rows, 3);
  await run('plan', ['plan', file('draft.json'), '--out', file('plan.json')]); const plan = await read('plan.json'); assert.equal(plan.records.length, 2); assert.equal(plan.insights.find(i => i.id === 'duplicates').value, 1); await sdk.verifyPlan(plan);
  await run('apply', ['apply', file('plan.json'), '--workspace', 'consumer', '--expected-revision', '0', '--out', file('applied.json')]); const result = await read('applied.json'); assert.equal(result.receipt.revision, 1); assert.equal(result.state.records.length, 2); assert.equal(result.state.sources.length, 2);
  await run('search', ['search', file('applied.json'), 'project owner', '--out', file('matches.json')]); const matches = await read('matches.json'); assert.ok(matches.hits.some(h => h.article.method === 'exact_source' && h.article.text.includes('project owner')));
});
test('M02 an existing output is preserved and refused before reading absent input', async () => {
  await writeFile(file('keep.json'), 'KEEP'); const r = await run('exclusive', ['inspect', '--workspace', 'consumer', '--out', file('keep.json'), file('does-not-exist.csv')], 1); assert.match(r.stderr.toString(), /EEXIST/); assert.equal(await readFile(file('keep.json'), 'utf8'), 'KEEP');
});
test('M03 final symlink and invalid UTF-8 cannot become an admitted draft', async () => {
  await symlink(join(packageRoot, 'examples/contacts.csv'), file('linked.csv')); await run('symlink', ['inspect', '--workspace', 'consumer', '--out', file('symlink-result.json'), file('linked.csv')], 1); assert.equal((await read('symlink-result.json')).schema, 'intakelet.command-error');
  await writeFile(file('invalid.txt'), Buffer.from([0xff, 0xfe])); await run('encoding', ['inspect', '--workspace', 'consumer', '--out', file('encoding-result.json'), file('invalid.txt')], 1); assert.equal((await read('encoding-result.json')).schema, 'intakelet.command-error');
});
test('M04 actual snapshot retry is idempotent and other-workspace application fails', async () => {
  const { applied } = await baseline('retry');
  await run('retry', ['apply', file('retry-plan.json'), '--workspace', 'consumer', '--expected-revision', '0', '--state', file('retry-base.json'), '--out', file('retried.json')]); assert.deepEqual(applied, await read('retried.json'));
  await run('other-workspace', ['apply', file('retry-plan.json'), '--workspace', 'other', '--expected-revision', '0', '--out', file('other.json')], 1); assert.equal((await read('other.json')).code, 'workspace');
});
test('M05 native installed CLI research reads our published site with pinned verified TLS', async () => {
  const base = new URL(process.env.INTAKELET_SITE); assert.ok(base.hostname.endsWith('.vercel.app')); assert.equal(base.protocol, 'https:');
  await run('native-research', ['research', new URL('/fixtures/company/', base).href, '--out', file('research.json')]); const report = await read('research.json');
  await writeFile(join(output, 'native-research', 'report.json'), JSON.stringify(report, null, 2));
  assert.equal(report.files.length, 4); assert.equal(report.coverage.pages, 4); assert.equal(report.status, 'partial'); assert.ok(report.skipped.some(p => p.reason === 'robots_denied'));
  assert.equal(report.attempts.some(a => /private\.html|marker\.js/.test(a.url)), false); assert.equal(report.pages.some(p => p.file.text.includes('AUTHORED_ROBOTS_DENIED_MARKER') || p.file.text.includes('__intakeletResearchExecuted')), false);
  for (const attempt of report.attempts) { assert.equal(attempt.security.transport, 'pinned_public_tls'); assert.equal(attempt.security.tlsAuthorized, true); assert.equal(attempt.security.pinnedPeer, true); assert.equal(attempt.bodySha256, attempt.security.bodySha256); }
  for (const page of report.pages) { assert.equal(await sdk.sha256(page.file.text), page.textSha256); assert.equal(new URL(page.url).origin, base.origin); }
  await baseline('website');
  await run('research-inspect', ['inspect', '--research', file('research.json'), '--workspace', 'consumer', '--out', file('research-draft.json')]); await run('research-plan', ['plan', file('research-draft.json'), '--out', file('research-plan.json')]);
  await run('research-apply', ['apply', file('research-plan.json'), '--state', file('website-base.json'), '--workspace', 'consumer', '--expected-revision', '1', '--out', file('research-applied.json')]); const result = await read('research-applied.json'); assert.equal(result.state.revision, 2); assert.equal(result.state.records.length, 2); assert.equal(result.state.sources.length, 6); assert.equal(result.state.articles.filter(a => a.url).length, 4);
  await sdk.validateSnapshot(result.state, 'consumer'); await writeFile(join(output, 'native-research', 'applied.json'), JSON.stringify(result, null, 2));
});
test('M06 rehashed forged plan is refused by the installed CLI without altering its input snapshot', async () => {
  const { plan } = await baseline('forged'); plan.records[0].data.company = 'Invented fixture company'; const { planId, ...body } = plan; plan.planId = 'sha256:' + await sdk.sha256(sdk.canonical(body)); await writeFile(file('forged-plan.json'), sdk.canonical(plan)); const previous = await readFile(file('forged-base.json'));
  await run('forged-plan', ['apply', file('forged-plan.json'), '--state', file('forged-base.json'), '--workspace', 'consumer', '--expected-revision', '1', '--out', file('forged-result.json')], 1); assert.equal((await read('forged-result.json')).code, 'plan_integrity'); assert.equal(digest(await readFile(file('forged-base.json'))), digest(previous));
});
test('M07 installed native API has no private-target or unsafe-option bypass', async () => {
  await assert.rejects(nodeSDK.researchWebsite('https://127.0.0.1'), e => e.code === 'network_denied'); await assert.rejects(nodeSDK.researchWebsite('https://example.com', { allowPrivate: true }), e => e.code === 'shape');
  await run('private-refusal', ['research', 'https://169.254.169.254', '--out', file('private-refusal.json')], 1); assert.equal((await read('private-refusal.json')).code, 'network_denied');
});
test('M08 real authenticated application host reconciles a lost response and isolates workspaces', async () => {
  const hosts = { one: new sdk.MemoryHost({ workspaceId: 'one' }), two: new sdk.MemoryHost({ workspaceId: 'two' }) }, calls = []; let lose = true;
  const server = createServer(async (request, response) => {
    const owner = request.headers.authorization === 'Bearer authored-one' ? 'one' : request.headers.authorization === 'Bearer authored-two' ? 'two' : null; calls.push({ method: request.method, path: request.url, owner });
    if (!owner) { response.writeHead(401).end(); return; }
    try {
      if (request.method === 'GET' && request.url === '/snapshot') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(await hosts[owner].snapshot())); return; }
      if (request.method !== 'POST' || request.url !== '/commit') { response.writeHead(405).end(); return; }
      const buffers = []; let bytes = 0; for await (const buffer of request) { bytes += buffer.length; if (bytes > 1048576) throw Error('Fixture request budget'); buffers.push(buffer); }
      const payload = sdk.parseJSON(Buffer.concat(buffers).toString(), 1048576), receipt = await hosts[owner].commit(payload.plan, { expectedRevision: payload.expectedRevision });
      if (lose) { lose = false; response.destroy(); return; }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(receipt));
    } catch (error) { response.writeHead(error.code === 'workspace' ? 403 : error.code === 'conflict' ? 409 : 400, { 'content-type': 'application/json' }).end(JSON.stringify({ code: error.code || 'fixture' })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const plan = await sdk.createPlan(await sdk.analyzeFiles([{ name: 'note.md', text: '# Host fixture\n\nA source-bound public test note.' }], { workspaceId: 'one' })), body = JSON.stringify({ plan, expectedRevision: 0 }), options = { method: 'POST', headers: { authorization: 'Bearer authored-one', 'content-type': 'application/json' }, body };
    assert.equal((await fetch(base + '/snapshot')).status, 401); await assert.rejects(fetch(base + '/commit', options));
    const state = await (await fetch(base + '/snapshot', { headers: { authorization: 'Bearer authored-one' } })).json(); assert.equal(state.revision, 1); assert.equal(state.receipts.length, 1);
    const retry = await fetch(base + '/commit', options); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), state.receipts[0]);
    assert.equal((await fetch(base + '/commit', { ...options, headers: { ...options.headers, authorization: 'Bearer authored-two' } })).status, 403); assert.equal((await hosts.two.snapshot()).revision, 0);
    const another = await sdk.createPlan(await sdk.analyzeFiles([{ name: 'another.txt', text: 'A different authored source for a stale-revision conflict.' }], { workspaceId: 'one' }));
    assert.equal((await fetch(base + '/commit', { ...options, body: JSON.stringify({ plan: another, expectedRevision: 0 }) })).status, 409); assert.equal((await hosts.one.snapshot()).sources.length, 1); assert.equal((await hosts.one.snapshot()).receipts.length, 1);
    await writeFile(join(output, 'host-http.json'), JSON.stringify({ calls, snapshot: await hosts.one.snapshot(), otherSnapshot: await hosts.two.snapshot() }, null, 2));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(server.listening, false); }
});
