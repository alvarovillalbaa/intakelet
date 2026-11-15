// T2: authored GitHub-shaped HTTP responses. No live API, OAuth or credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubIssuesSource, githubIssuesMigration } from '../../src/github-migration.mjs';
import { runMigration } from '../../src/migration.mjs';
import { MemoryMigrationHost } from '../../src/migration-host.mjs';
const issue = (id, changes = {}) => ({ id, number: id, title: 'Authored issue ' + id, body: null, state: 'open', html_url: 'https://github.com/authored/repo/issues/' + id, user: { login: 'authored' }, labels: [{ name: 'task' }], created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...changes });
const response = (items, { link, status = 200 } = {}) => new Response(JSON.stringify(items), { status, headers: { 'content-type': 'application/json', ...(link ? { link } : {}) } });
const link = page => `https://api.github.com/repos/authored/repo/issues?state=all&sort=created&direction=asc&per_page=2&page=${page}`;
const adapter = request => createGitHubIssuesSource({ owner: 'authored', repo: 'repo', perPage: 2, fetch: request });
const approve = batch => ({ decision: 'approve', batchId: batch.batchId });
test('G01 requests one fixed read-only endpoint, pins API version and omits credentials by default', async () => {
  let request; const source = adapter((url, options) => { request = { url, options }; return response([issue(1)]); });
  const page = await source.readPage(); const url = new URL(request.url); assert.equal(url.origin, 'https://api.github.com'); assert.equal(url.pathname, '/repos/authored/repo/issues'); assert.equal(url.searchParams.get('state'), 'all'); assert.equal(request.options.method, 'GET'); assert.equal(request.options.headers['X-GitHub-Api-Version'], '2026-03-10'); assert.equal(request.options.headers.Authorization, undefined); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error'); assert.equal(page.items[0].data.body, null); assert.equal(page.done, true);
});
test('G02 follows reviewed pages, excludes PRs, preserves stable source IDs and retains end-of-scan boundary', async () => {
  const seen = [], source = adapter(url => { seen.push(new URL(url).searchParams.get('page')); return seen.length === 1 ? response([issue(1), issue(2, { pull_request: {} })], { link: `<${link(2)}>; rel="next", <${link(4)}>; rel="last"` }) : response([issue(3)]); });
  const h = new MemoryMigrationHost({ workspaceId: 'workspace' }), spec = githubIssuesMigration({ workspaceId: 'workspace', connectionId: 'github', source });
  const result = await runMigration({ spec, source, host: h, review: approve }); assert.equal(result.batches, 2); assert.equal(result.items, 2); assert.equal(result.status, 'complete'); assert.deepEqual(seen, ['1', '2']); assert.deepEqual(result.checkpoint, { kind: 'github-issues-v1', cycle: 1, page: 1 });
});
test('G03 subsequent accepted sync scans detect updates and never infer deletions from absence', async () => {
  let turn = 0; const source = adapter(() => response([issue(1, { title: ++turn === 1 ? 'Before' : 'After', updated_at: turn === 1 ? '2026-11-01T00:00:00Z' : '2026-11-02T00:00:00Z' })]));
  const h = new MemoryMigrationHost({ workspaceId: 'workspace' }), spec = githubIssuesMigration({ workspaceId: 'workspace', connectionId: 'github', source }); await runMigration({ spec, source, host: h, review: approve }); await h.acceptRoute(spec, { acceptedBy: 'trusted-owner' }); const next = await runMigration({ spec, source, host: h, continuous: true }); assert.equal(next.lastReceipt.counts.updated, 1); assert.equal(spec.policy.delete, false); assert.equal(next.checkpoint.cycle, 2);
});
test('G04 arbitrary/malformed/looping pagination URLs are refused before another request or checkpoint', async () => {
  for (const url of [link(2).replace('api.github.com', 'other.example'), link(2).replace('&page=2', '&page=1'), link(2).replace('repo/issues', 'other/issues'), link(2) + '&token=authored', 'javascript:alert(1)']) {
    let calls = 0; const source = adapter(() => { calls++; return response([issue(1)], { link: `<${url}>; rel="next"` }); }); await assert.rejects(source.readPage(), error => error.code === 'github_pagination'); assert.equal(calls, 1);
  }
});
test('G05 rate/permission failures stop without retry, leaking response text or advancing checkpoints', async () => {
  for (const status of [403, 404, 429]) { let calls = 0; const source = adapter(() => { calls++; return response({ message: 'private authored diagnostic' }, { status }); }); const h = new MemoryMigrationHost({ workspaceId: 'workspace' }), spec = githubIssuesMigration({ workspaceId: 'workspace', connectionId: 'github', source }); await assert.rejects(runMigration({ spec, source, host: h, review: approve }), error => error.code === 'github_http' && !JSON.stringify(error).includes('private authored')); assert.equal(calls, 1); assert.equal((await h.status('github')).revision, 0); }
});
test('G06 source identity is isolated from caller mutation and app-owned tokens stay outside persisted payloads', async () => {
  let sent; const source = createGitHubIssuesSource({ owner: 'authored', repo: 'repo', token: 'authored-fixture-token', fetch: (url, options) => { sent = options.headers.Authorization; return response([]); } });
  const spec = githubIssuesMigration({ workspaceId: 'workspace', connectionId: 'github', source }); assert.equal(JSON.stringify(spec).includes('authored-fixture-token'), false); const identity = source.identity; identity.configuration.owner = 'mutated'; assert.equal(source.identity.configuration.owner, 'authored'); await source.readPage(); assert.equal(sent, 'Bearer authored-fixture-token');
});
test('G07 malformed UTF-8/JSON, response budgets and unsupported issue shapes fail visibly', async () => {
  for (const create of [() => new Response('[', { headers: { 'content-type': 'application/json' } }), () => response([issue(1, { id: '1' })]), () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }), () => response([issue(1, { body: 'x'.repeat(2097152) })])]) await assert.rejects(adapter(create).readPage());
});
test('G08 invalid repository names, cursors and undersized read budgets never make requests', async () => {
  assert.throws(() => createGitHubIssuesSource({ owner: '../escape', repo: 'repo' })); assert.throws(() => createGitHubIssuesSource({ owner: 'owner', repo: 'repo', token: 'contains space' }));
  let calls = 0; const source = adapter(() => { calls++; return response([]); }); for (const options of [{ limit: 1 }, { cursor: { page: 2 } }, { cursor: { kind: 'github-issues-v1', page: 0, cycle: 1 } }]) await assert.rejects(source.readPage(options)); assert.equal(calls, 0);
});
test('G09 numeric repository pagination links only select the next page on the original endpoint', async () => {
  const requests = [], source = adapter(url => { requests.push(url); return requests.length === 1 ? response([issue(1)], { link: `<${link(2).replace('/repos/authored/repo/', '/repositories/123/')}>; rel="next"` }) : response([]); });
  const first = await source.readPage(); await source.readPage({ cursor: first.cursorAfter }); assert.equal(new URL(requests[1]).pathname, '/repos/authored/repo/issues');
});
test('G10 cancellation releases a stalled HTTP body even when its underlying cancel hook never settles', async () => {
  let started, cancelled = false; const ready = new Promise(resolve => { started = resolve; }), controller = new AbortController();
  const source = adapter(() => new Response(new ReadableStream({ pull() { started(); return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }), { headers: { 'content-type': 'application/json' } }));
  const pending = source.readPage({ signal: controller.signal }); await ready; controller.abort(); await assert.rejects(pending, error => error.code === 'aborted'); assert.equal(cancelled, true);
});
