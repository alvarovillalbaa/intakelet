// T2 real SQLite/files/processes with authored data; no provider/Auth/network.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, lstat, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { definition, item, page, pagedSource } from '../fixtures/sqlite-contract.mjs';

const consumer = process.env.INTAKELET_SQLITE_CONSUMER, root = process.env.INTAKELET_SQLITE_WORK, output = process.env.INTAKELET_SQLITE_OUTPUT;
assert.ok(consumer && root && output);
const require = createRequire(pathToFileURL(consumer + '/package.json'));
const { SQLiteMigrationHost, DirectoryAssetStore } = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration/node')));
const { inspectMigrationPage, prepareMigrationBatch, runMigration, syncMigration } = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration')));
globalThis.fetch = () => { throw new Error('Network is forbidden in SQLite acceptance.'); };
const code = name => error => error.code === name;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const observations = [];
let childNumber = 0;

async function child(directory) {
  const number = ++childNumber, process = fork(fileURLToPath(new URL('../fixtures/sqlite-host-child.mjs', import.meta.url)), [], {
    execArgv: [], env: { PATH: globalThis.process.env.PATH, TMPDIR: globalThis.process.env.TMPDIR, INTAKELET_SQLITE_CONSUMER: consumer, INTAKELET_SQLITE_DIRECTORY: directory },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '', stderr = '', sequence = 0, exited = false;
  process.stdout.on('data', b => { stdout += b; }); process.stderr.on('data', b => { stderr += b; });
  const requests = new Map(); let ready, rejectReady;
  const admission = new Promise((yes, no) => { ready = yes; rejectReady = no; });
  process.on('exit', () => {
    exited = true; rejectReady(new Error('Child exited before admission.'));
    for (const pending of requests.values()) pending.reject(new Error('Child exited before its reply.'));
    requests.clear();
  });
  const closed = new Promise(resolve => process.on('close', (code, signal) => resolve({ code, signal })));
  process.on('message', m => {
    if (Object.hasOwn(m, 'ready')) { if (m.ready) ready(); else rejectReady(new Error('Child admission refused.')); return; }
    const pending = requests.get(m.id); if (!pending) return;
    requests.delete(m.id);
    if (m.error) pending.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
    else pending.resolve(m.observedCommit ? { observedCommit: true, batchId: m.batchId } : m.result);
  });
  await admission;
  let recorded = false;
  async function finish(expectedKill = false) {
    if (!exited && !expectedKill) await request('close');
    if (!exited && expectedKill) process.kill('SIGKILL');
    const result = await closed;
    if (!recorded) {
      recorded = true;
      await writeFile(join(output, `child-${number}.stdout.txt`), stdout);
      await writeFile(join(output, `child-${number}.stderr.txt`), stderr);
      observations.push({ child: number, expectedKill, ...result, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr) });
    }
    if (expectedKill) assert.equal(result.signal, 'SIGKILL'); else { assert.equal(result.code, 0); assert.equal(result.signal, null); }
  }
  function request(operation, ...args) { const id = ++sequence; return new Promise((resolve, reject) => { requests.set(id, { resolve, reject }); process.send({ id, operation, args }); }); }
  return { request, finish, get exited() { return exited; } };
}
async function owned(t, name, settings = {}) {
  const parent = await mkdtemp(join(root, name + '-')), nonce = randomUUID(), marker = join(parent, 'owner');
  await writeFile(marker, nonce); const inode = (await lstat(parent)).ino;
  const directory = join(parent, 'store'), hosts = [], children = [];
  const host = await SQLiteMigrationHost.initialize({ directory, workspaceId: 'authored-workspace', ...settings }); hosts.push(host);
  t.after(async () => {
    for (const worker of children) if (!worker.exited) await worker.finish();
    for (const value of hosts) await value.close();
    assert.equal((await lstat(parent)).ino, inode); assert.equal(await readFile(marker, 'utf8'), nonce);
    await rm(parent, { recursive: true });
    observations.push({ case: name, closed: true, removed: true });
  });
  return { host, directory, parent, async open(extra = {}) { const value = await SQLiteMigrationHost.open({ directory, workspaceId: 'authored-workspace', ...extra }); hosts.push(value); return value; },
    async child() { const value = await child(directory); children.push(value); return value; } };
}
async function commit(host, spec, nextPage) {
  const lease = await host.claim(spec);
  try { const batch = await inspectMigrationPage(spec, nextPage, host); return { batch, receipt: await host.commitBatch(batch, { lease }), lease }; }
  finally { await host.release(lease); }
}
after(async () => { await writeFile(join(output, 'process-cleanup.json'), JSON.stringify({ observations }, null, 2)); });

test('D01 explicit initialization and separate-process reopen reject unknown workspace/schema', async t => {
  const o = await owned(t, 'D01'); await o.host.close();
  const c = await o.child(); assert.equal((await c.request('status', 'new-connection')).revision, 0); await c.finish();
  await assert.rejects(SQLiteMigrationHost.initialize({ directory: o.directory, workspaceId: 'authored-workspace' }), code('sqlite_storage'));
  await assert.rejects(SQLiteMigrationHost.open({ directory: o.directory, workspaceId: 'different-workspace' }), code('workspace'));
  const raw = new DatabaseSync(join(o.directory, 'intakelet.sqlite')); raw.exec('PRAGMA user_version = 99'); raw.close();
  await assert.rejects(o.open(), code('sqlite_schema'));
});

test('D02 real reviewed pages resume in a fresh process with custom outputs and no duplicate rows', async t => {
  const o = await owned(t, 'D02'), spec = definition(), pages = [page([item('one', 'First')], null, { page: 1 }, false), page([item('two', 'Second')], { page: 1 }, { page: 2 })];
  const first = await runMigration({ spec, host: o.host, source: pagedSource(spec, pages), maxBatches: 1, review: batch => ({ decision: 'approve', batchId: batch.batchId }) });
  assert.equal(first.status, 'paused'); assert.equal(first.batches, 1); await o.host.close();
  const c = await o.child(), second = await c.request('run', { spec, pages });
  assert.equal(second.status, 'complete'); assert.deepEqual(second.reads, [{ page: 1 }]); assert.equal(second.lastReceipt.counts.created, 1); await c.finish();
  const reopened = await o.open(), records = await reopened.readRecords({ connectionId: spec.connectionId, ids: [], sourceKeys: ['one', 'two'] });
  assert.equal(records.length, 2); assert.deepEqual(records.map(r => r.data), [{ externalId: 'one', note: { title: 'First' } }, { externalId: 'two', note: { title: 'Second' } }]);
  assert.equal((await reopened.status(spec.connectionId)).revision, 2);
});

test('D03 a withheld caller receipt is recovered after process restart without a second write', async t => {
  const o = await owned(t, 'D03'), spec = definition(), c = await o.child();
  const lease = await c.request('claim', spec), batch = await inspectMigrationPage(spec, page([item('one')]), o.host);
  const observation = await c.request('commitWithoutReply', batch, { lease }); assert.equal(observation.observedCommit, true); assert.equal(observation.batchId, batch.batchId); await c.finish();
  const next = await o.child(), receipt = await next.request('commitBatch', batch, { lease });
  assert.equal(receipt.revision, 1); assert.equal(receipt.counts.created, 1); assert.equal((await next.request('status', spec.connectionId)).revision, 1);
  assert.deepEqual((await next.request('inspectBatch', batch.batchId)).receipt, receipt); await next.finish();
});

test('D04 independent workers contend and persisted expiry fences the older write/release', async t => {
  const o = await owned(t, 'D04', { leaseMs: 1000 }), spec = definition(), c = await o.child();
  const old = await c.request('claim', spec), batch = await inspectMigrationPage(spec, page([item('one')]), o.host);
  await assert.rejects(o.host.claim(spec), code('lease_busy')); await sleep(1100);
  const current = await o.host.claim(spec); assert.ok(Number(current.token.split(':')[0]) > Number(old.token.split(':')[0]));
  await assert.rejects(c.request('commitBatch', batch, { lease: old }), code('lease_lost')); assert.equal(await c.request('release', old), false);
  assert.equal((await o.host.commitBatch(batch, { lease: current })).counts.created, 1); await o.host.release(current); await c.finish();
});

test('D05 accepted routes persist; a fresh revoked/unaccepted poll performs no source read', async t => {
  const o = await owned(t, 'D05'), spec = definition();
  const route = await o.host.acceptRoute(spec, { acceptedBy: 'trusted-owner' }); await o.host.close();
  const c = await o.child(), lease = await c.request('claim', spec, { continuous: true }); assert.equal(lease.routeId, route.routeId);
  await c.request('revokeRoute', spec.connectionId); await assert.rejects(c.request('commitBatch', await prepareMigrationBatch(spec, page([]), { revision: 0, cursor: null, specId: route.specId }, []), { lease }), code('lease_lost')); await c.finish();
  const h = await o.open(), calls = [];
  await assert.rejects(syncMigration({ spec, host: h, source: pagedSource(spec, [page([])], calls), maxPolls: 1 }), code('route_required')); assert.equal(calls.length, 0);
  await assert.rejects(syncMigration({ spec: definition('never-accepted'), host: h, source: pagedSource(definition('never-accepted'), [page([])], calls), maxPolls: 1 }), code('route_required')); assert.equal(calls.length, 0);
});

test('D06 a real trigger refusal rolls back rows, source ownership, checkpoint and receipt together', async t => {
  const o = await owned(t, 'D06'), spec = definition(), first = await commit(o.host, spec, page([item('baseline')], null, { page: 1 }, false));
  const lease = await o.host.claim(spec), batch = await inspectMigrationPage(spec, page([item('safe'), item('deny')], { page: 1 }, { page: 2 }), o.host);
  const raw = new DatabaseSync(join(o.directory, 'intakelet.sqlite'));
  raw.exec("CREATE TRIGGER authored_abort BEFORE INSERT ON intakelet_records WHEN NEW.source_key = 'deny' BEGIN SELECT RAISE(ABORT, 'authored failure'); END");
  try { await assert.rejects(o.host.commitBatch(batch, { lease }), code('sqlite_storage')); }
  finally { raw.exec('DROP TRIGGER authored_abort'); raw.close(); }
  assert.equal((await o.host.readRecords({ connectionId: spec.connectionId, ids: [], sourceKeys: ['safe', 'deny'] })).length, 0);
  assert.deepEqual((await o.host.status(spec.connectionId)).cursor, { page: 1 }); assert.equal(await o.host.inspectBatch(batch.batchId), null);
  assert.deepEqual((await o.host.inspectBatch(first.batch.batchId)).receipt, first.receipt); await o.host.release(lease);
});

test('D07 a killed claimant cannot advance; a new process reclaims only after real expiry', async t => {
  const o = await owned(t, 'D07', { leaseMs: 1000 }), spec = definition(), c = await o.child();
  const old = await c.request('claim', spec); await c.finish(true);
  assert.equal((await o.host.status(spec.connectionId)).revision, 0); await assert.rejects(o.host.claim(spec), code('lease_busy')); await sleep(1100);
  const next = await o.child(), lease = await next.request('claim', spec); assert.notEqual(lease.token, old.token);
  const batch = await inspectMigrationPage(spec, page([item('after-restart')]), o.host);
  assert.equal((await next.request('commitBatch', batch, { lease })).revision, 1); await next.request('release', lease); await next.finish();
});

test('D08 real local edits, foreign source identities and stale checkpoints refuse complete pages', async t => {
  const o = await owned(t, 'D08'), spec = definition(), first = await commit(o.host, spec, page([item('one')], null, { page: 1 }, false));
  const lease = await o.host.claim(spec), update = await inspectMigrationPage(spec, page([item('one', 'Changed')], { page: 1 }, { page: 2 }), o.host);
  await o.host.editLocal(first.batch.rows[0].id, { externalId: 'one', note: { title: 'Local edit' } }, { expectedRevision: 1 });
  await assert.rejects(o.host.commitBatch(update, { lease }), code('record_conflict')); await o.host.release(lease);
  const other = definition('other'), foreignLease = await o.host.claim(other), collision = await inspectMigrationPage(other, page([item('foreign', 'Foreign', 'one')]), o.host);
  assert.equal(collision.ready, false); await assert.rejects(o.host.commitBatch(collision, { lease: foreignLease }), code('review_required')); await o.host.release(foreignLease);
  const staleSpec = definition('stale', 'stale-output'), staleLease = await o.host.claim(staleSpec);
  const a = await inspectMigrationPage(staleSpec, page([item('a')]), o.host), b = await inspectMigrationPage(staleSpec, page([item('b')]), o.host);
  await o.host.commitBatch(a, { lease: staleLease }); await assert.rejects(o.host.commitBatch(b, { lease: staleLease }), code('conflict')); assert.equal(await o.host.inspectRecord(b.rows[0].id), null); await o.host.release(staleLease);
});

test('D09 polling across worker lifetimes retains updates, cancellation and failure checkpoints', async t => {
  const o = await owned(t, 'D09'), spec = definition(); await o.host.acceptRoute(spec, { acceptedBy: 'trusted-owner' });
  const source = { identity: spec.source, readPage({ cursor = null }) { const cycle = (cursor?.cycle ?? 0) + 1; return page([item('one', 'Revision ' + cycle)], cursor, { cycle }); } };
  assert.equal((await syncMigration({ spec, host: o.host, source, maxPolls: 1 })).lastReceipt.counts.created, 1); await o.host.close();
  const h = await o.open(); assert.equal((await syncMigration({ spec, host: h, source, maxPolls: 1 })).lastReceipt.counts.updated, 1);
  const controller = new AbortController();
  await assert.rejects(syncMigration({ spec, host: h, source, maxPolls: 2, intervalMs: 1, signal: controller.signal, onReceipt: () => controller.abort() }), error => error.code === 'aborted' && error.details.lastReceipt.checkpoint.cycle === 3);
  await assert.rejects(syncMigration({ spec, host: h, source: { identity: spec.source, readPage() { throw new Error('Authored source failure'); } }, maxPolls: 1 }));
  assert.deepEqual((await h.status(spec.connectionId)).cursor, { cycle: 3 });
});

test('D10 native SQLite busy, full and read-only errors never acknowledge a write', async t => {
  const o = await owned(t, 'D10'), spec = definition(), raw = new DatabaseSync(join(o.directory, 'intakelet.sqlite'));
  raw.exec('BEGIN IMMEDIATE');
  try { await assert.rejects(o.host.claim(spec), error => error.code === 'sqlite_storage' && (error.details.sqliteCode & 255) === 5); }
  finally { raw.exec('ROLLBACK'); raw.close(); }
  assert.equal((await o.host.status(spec.connectionId)).revision, 0); await o.host.close();
  const readOnly = await o.open({ readOnly: true }); await assert.rejects(readOnly.claim(spec), error => error.code === 'sqlite_storage' && (error.details.sqliteCode & 255) === 8); await readOnly.close();
  const fullDirectory = join(o.parent, 'full-store'), full = await SQLiteMigrationHost.initialize({ directory: fullDirectory, workspaceId: spec.workspaceId, maxDatabaseBytes: 131072, maxJournalBytes: 131072 });
  try {
    const lease = await full.claim(spec), batch = await inspectMigrationPage(spec, page([item('large', 'x'.repeat(40000))]), full);
    await assert.rejects(full.commitBatch(batch, { lease }), error => error.code === 'sqlite_storage' && (error.details.sqliteCode & 255) === 13);
    assert.equal((await full.status(spec.connectionId)).revision, 0); assert.equal(await full.inspectBatch(batch.batchId), null); assert.equal(await full.inspectRecord(batch.rows[0].id), null); await full.release(lease);
  } finally { await full.close(); }
});

test('D11 installed Node exports retain real attachment streaming alongside the new worker/schema', async t => {
  const o = await owned(t, 'D11'), assets = new DirectoryAssetStore({ directory: join(o.parent, 'assets') }), bytes = new TextEncoder().encode('authored attachment');
  const receipt = await assets.put({ size: bytes.length, async *stream() { yield bytes; } }), chunks = [];
  for await (const value of assets.read(receipt.assetId)) chunks.push(value);
  assert.deepEqual(Buffer.concat(chunks.map(value => Buffer.from(value))), Buffer.from(bytes));
  assert.equal(receipt.sha256, 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
});
