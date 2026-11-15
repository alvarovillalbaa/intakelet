// Opt-in actual public GET acceptance + T2 in-memory destination state.
// No DB access, credentials, external writes, default-suite or PR-gate use.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(join(process.env.INTAKELET_LIVE_CONSUMER, 'package.json'));
const api = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration')));
const { createGitHubIssuesSource, githubIssuesMigration, MemoryMigrationHost, runMigration, syncMigration } = api;
assert.equal(JSON.parse(await readFile(new URL('../package.json', pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration'))), 'utf8' )).version, '0.4.0');
const output = process.env.INTAKELET_LIVE_OUTPUT;
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
const requests = [], observations = [], cases = [];
const allowed = new Set(['/repos/alvarovillalbaa/intakelet/issues', '/repos/alvarovillalbaa/afs/issues', '/repos/nodejs/node/issues', '/repos/alvarovillalbaa/intakelet-live-missing-20261115-6ea41bd9/issues']);
const deadline = AbortSignal.timeout(80000);
async function observingFetch(url, options) {
  const target = new URL(url), headers = new Headers(options.headers);
  assert.equal(target.origin, 'https://api.github.com'); assert.ok(allowed.has(target.pathname));
  assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
  assert.equal(headers.has('authorization'), false); assert.equal(headers.has('cookie'), false); assert.equal(headers.get('x-github-api-version'), '2026-03-10');
  if (target.pathname === '/repos/nodejs/node/issues' && target.searchParams.get('page') !== '1') {
    const previous = observations.filter(item => new URL(item.row.url).pathname === target.pathname && Number(new URL(item.row.url).searchParams.get('page')) === Number(target.searchParams.get('page')) - 1).at(-1);
    assert.ok(previous); const match = previous.row.link?.match(/<([^>]+)>;\s*rel="next"/); assert.ok(match);
    assert.equal(target.searchParams.get('after'), new URL(match[1]).searchParams.get('after'), 'The actual Link cursor must reach the next actual request');
  }
  assert.ok(requests.length < 12, 'At most12 actual public API requests');
  const started = Date.now(), row = { url: target.href, method: 'GET', authenticated: false, requestedVersion: headers.get('x-github-api-version') }; requests.push(row);
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(15000), ...(options.signal ? [options.signal] : [])]);
  const response = await globalThis.fetch(url, { ...options, signal });
  const clone = response.clone(), reader = clone.body.getReader(), chunks = []; let bytes = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; assert.ok(bytes <= 2097152, 'Bounded public response'); chunks.push(Buffer.from(next.value)); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body = Buffer.concat(chunks), values = JSON.parse(body.toString('utf8'));
  Object.assign(row, { status: response.status, bytes: body.length, sha256: hash(body), selectedVersion: response.headers.get('x-github-api-version-selected'), requestId: response.headers.get('x-github-request-id'), contentType: response.headers.get('content-type'), link: response.headers.get('link'), remaining: response.headers.get('x-ratelimit-remaining'), seconds: (Date.now() - started) / 1000, rawItems: Array.isArray(values) ? values.length : null, pullRequests: Array.isArray(values) ? values.filter(value => Object.hasOwn(value, 'pull_request')).length : null });
  // These live response values remain process-local, never written to artifacts.
  observations.push({ row, values }); return response;
}
const source = (owner, repo, perPage = 5) => createGitHubIssuesSource({ owner, repo, perPage, fetch: observingFetch });
function expectedRecord(value) {
  return { externalId: String(value.id), number: value.number, title: value.title, description: value.body, state: value.state, url: new URL(value.html_url).href, labels: value.labels.map(label => typeof label === 'string' ? label : label.name), author: value.user === null ? null : value.user.login, createdAt: value.created_at, updatedAt: value.updated_at };
}
let reviewedRows = 0;
function review(batch) {
  assert.equal(batch.ready, true);
  const observed = observations.at(-1), expected = observed.values.filter(value => !Object.hasOwn(value, 'pull_request'));
  assert.equal(batch.rows.length, expected.length);
  for (const row of batch.rows) { const original = expected.find(value => String(value.id) === row.data.externalId); assert.ok(original); assert.equal(hash(stable(row.data)), hash(stable(expectedRecord(original)))); reviewedRows++; }
  return { decision: 'approve', batchId: batch.batchId };
}
const retainedReceipts = [];
const onReceipt = receipt => { retainedReceipts.push(receipt); };
let failure = null;
try {
  const empty = source('alvarovillalbaa', 'intakelet'), emptyPage = await empty.readPage({ signal: deadline });
  assert.equal(emptyPage.items.length, 0); assert.equal(emptyPage.done, true); assert.deepEqual(emptyPage.cursorAfter, { kind: 'github-issues-v2', cycle: 1, page: 1, after: null });
  cases.push({ id: 'G01', passed: true, emptyActualRepository: true });
  const pullOnly = source('alvarovillalbaa', 'afs'), pullPage = await pullOnly.readPage({ signal: deadline });
  assert.ok(observations.at(-1).row.pullRequests > 0); assert.equal(pullPage.items.length, 0); assert.equal(pullPage.done, true);
  cases.push({ id: 'G02', passed: true, actualPRsExcluded: observations.at(-1).row.pullRequests });

  const node = source('nodejs', 'node'), host = new MemoryMigrationHost({ workspaceId: 'authored-live' });
  const spec = githubIssuesMigration({ workspaceId: 'authored-live', connectionId: 'node-public-sample', source: node });
  const initial = await runMigration({ spec, source: node, host, review, onReceipt, maxBatches: 1, readTimeoutMs: 15000, signal: deadline });
  assert.equal(initial.status, 'paused'); assert.ok(initial.items > 0); assert.ok(initial.lastReceipt.counts.created > 0); assert.equal(initial.checkpoint.kind, 'github-issues-v2'); assert.equal(initial.checkpoint.page, 2); assert.equal(initial.checkpoint.cycle, 0); assert.equal(typeof initial.checkpoint.after, 'string');
  cases.push({ id: 'G03', passed: true, reviewedRows, receipt: initial.lastReceipt });
  const beforeAdmission = requests.length;
  await assert.rejects(syncMigration({ spec, source: node, host, maxPolls: 1, maxBatches: 1, signal: deadline }), error => error.code === 'route_required'); assert.equal(requests.length, beforeAdmission);
  const route = await host.acceptRoute(spec, { acceptedBy: 'authored-live-owner' });
  const synced = await syncMigration({ spec, source: node, host, onReceipt, maxPolls: 2, maxBatches: 1, intervalMs: 1000, signal: deadline, readTimeoutMs: 15000 });
  assert.equal(synced.polls, 2); assert.equal(synced.checkpoint.kind, 'github-issues-v2'); assert.equal(synced.checkpoint.page, 4); assert.equal(synced.checkpoint.cycle, 0); assert.equal(typeof synced.checkpoint.after, 'string');
  for (const receipt of retainedReceipts.filter(item => item.connectionId === spec.connectionId)) {
    const batch = await host.inspectBatch(receipt.batchId);
    const pageNumber = batch.batch.page.cursorBefore?.page ?? 1;
    const raw = observations.find(item => new URL(item.row.url).pathname === '/repos/nodejs/node/issues' && Number(new URL(item.row.url).searchParams.get('page')) === pageNumber).values.filter(item => !Object.hasOwn(item, 'pull_request'));
    assert.equal(batch.batch.rows.length, raw.length);
    for (const row of batch.batch.rows) {
      assert.equal(hash(stable((await host.inspectRecord(row.id)).data)), hash(stable(row.data)));
      assert.equal(hash(stable(row.data)), hash(stable(expectedRecord(raw.find(item => String(item.id) === row.data.externalId)))));
    }
  }
  host.revokeRoute(spec.connectionId); const beforeRevoke = requests.length, checkpoint = await host.status(spec.connectionId);
  await assert.rejects(syncMigration({ spec, source: node, host, maxPolls: 1, maxBatches: 1, signal: deadline }), error => error.code === 'route_required'); assert.equal(requests.length, beforeRevoke); assert.deepEqual(await host.status(spec.connectionId), checkpoint);
  cases.push({ id: 'G04', passed: true, routeId: route.routeId, polls: synced.polls, sampledPages: 3, checkpoint: synced.checkpoint, unauthorisedReads: 0, authority: 'T2 reference route, not production authentication' });

  const emptyHost = new MemoryMigrationHost({ workspaceId: 'authored-empty' }), emptySpec = githubIssuesMigration({ workspaceId: 'authored-empty', connectionId: 'own-empty', source: empty });
  const first = await runMigration({ spec: emptySpec, source: empty, host: emptyHost, review, onReceipt, signal: deadline, readTimeoutMs: 15000 }); assert.equal(first.status, 'complete'); assert.equal(first.items, 0);
  await emptyHost.acceptRoute(emptySpec, { acceptedBy: 'authored-live-owner' });
  const repeated = await syncMigration({ spec: emptySpec, source: empty, host: emptyHost, onReceipt, maxPolls: 2, maxBatches: 1, intervalMs: 1000, signal: deadline, readTimeoutMs: 15000 });
  assert.equal(repeated.items, 0); assert.deepEqual(repeated.checkpoint, { kind: 'github-issues-v2', cycle: 3, page: 1, after: null });
  cases.push({ id: 'G05', passed: true, completedEmptyCycles: 3, inventedRecords: 0 });

  const missing = source('alvarovillalbaa', 'intakelet-live-missing-20261115-6ea41bd9'), missingHost = new MemoryMigrationHost({ workspaceId: 'authored-missing' }), missingSpec = githubIssuesMigration({ workspaceId: 'authored-missing', connectionId: 'missing', source: missing });
  const beforeMissing = requests.length;
  await assert.rejects(runMigration({ spec: missingSpec, source: missing, host: missingHost, review, signal: deadline, readTimeoutMs: 15000 }), error => error.code === 'github_http' && error.details.cause.status === 404);
  assert.equal(requests.length, beforeMissing + 1); assert.equal((await missingHost.status('missing')).cursor, null);
  cases.push({ id: 'G06', passed: true, actual404: true, retries: 0, checkpoint: null });
} catch (error) {
  failure = { name: error.name, code: error.code || null, frames: String(error.stack).split('\n').filter(line => /^\s+at /.test(line)) };
  process.exitCode = 1;
} finally {
  const result = { passed: !failure && cases.length === 6 && cases.every(item => item.passed), node: process.version, cases, requests, receipts: retainedReceipts, reviewedRows, error: failure, privacy: 'No issue text or author profiles retained; live data existed only in process memory.', limits: 'Unauthenticated public GET; bounded nodejs/node sample and empty cycles, not full-repository migration, mutable-update/delete proof, OAuth, durable host or scheduler.' };
  await writeFile(join(output, 'live-receipt.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed: result.passed, cases: cases.map(item => item.id), requests: requests.length, reviewedRows }));
}
