// T2: authored in-memory source pages/records/clock. No API or production host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMigrationSpec, validateSourcePage, migrationSpecId, prepareMigrationBatch, verifyMigrationBatch, inspectMigrationPage, runMigration, syncMigration } from '../../src/migration.mjs';
import { MemoryMigrationHost } from '../../src/migration-host.mjs';
import { canonical, sha256 } from '../../src/values.mjs';

const spec = () => ({ workspaceId: 'workspace', connectionId: 'issues', source: { id: 'authored', version: '1', configuration: { repository: 'authored/repo' } }, output: { id: 'tasks', version: '1', schema: { type: 'object', properties: { key: { type: 'string' }, title: { type: 'string' } }, required: ['key', 'title'], additionalProperties: false }, fields: [{ from: ['key'], to: ['key'] }, { from: ['title'], to: ['title'] }], key: [['key']] }, policy: { create: true, update: true, delete: true } });
const item = (id, key = id, title = 'Authored ' + id) => ({ id, operation: 'upsert', data: { key, title } });
const page = (items, cursorBefore = null, cursorAfter = { page: 1 }, done = true) => ({ items, cursorBefore, cursorAfter, done });
const host = options => new MemoryMigrationHost({ workspaceId: 'workspace', ...options });
const approve = batch => ({ decision: 'approve', batchId: batch.batchId });
const source = (definition, readPage) => ({ identity: definition.source, readPage });
const commit = async (h, definition, nextPage) => { const lease = await h.claim(definition); try { const plan = await inspectMigrationPage(definition, nextPage, h); return { plan, receipt: await h.commitBatch(plan, { lease }) }; } finally { await h.release(lease); } };
const code = name => error => error.code === name;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('M01 complete definitions exclude credentials, validate policy and bind every output/source choice', async () => {
  const definition = spec(), first = await migrationSpecId(definition);
  for (const change of [s => s.source.configuration.repository = 'another/repo', s => s.output.version = '2', s => s.policy.delete = false]) { const changed = spec(); change(changed); assert.notEqual(await migrationSpecId(changed), first); }
  const credentials = spec(); credentials.source.configuration.nested = { access_token: 'authored' }; assert.throws(() => validateMigrationSpec(credentials), code('source'));
  const missing = spec(); delete missing.policy.update; assert.throws(() => validateMigrationSpec(missing));
});
test('M02 source pages reject duplicate identities, non-advancing continuations and invalid tombstones', () => {
  for (const bad of [page([item('one'), item('one')]), page([], null, null, false), page([{ id: 'one', operation: 'delete', data: {} }]), page([{ id: 'one', operation: 'upsert' }]), page(Array.from({ length: 501 }, (_, i) => item(String(i))))]) assert.throws(() => validateSourcePage(bad));
});
test('M03 first import and response-loss replay write once; receipts and provenance cannot mutate state', async () => {
  const h = host(), definition = spec(), lease = await h.claim(definition), plan = await inspectMigrationPage(definition, page([item('one')]), h);
  const receipt = await h.commitBatch(plan, { lease }); await h.release(lease);
  assert.deepEqual(await h.commitBatch(plan, { lease }), receipt); assert.equal(receipt.counts.created, 1); assert.equal((await h.status('issues')).revision, 1);
  const evidence = await h.inspectBatch(plan.batchId); evidence.batch.rows[0].data.title = 'mutated';
  assert.equal((await h.inspectRecord(plan.rows[0].id)).data.title, 'Authored one'); assert.equal((await h.inspectBatch(plan.batchId)).batch.rows[0].data.title, 'Authored one');
});
test('M04 update/unchanged/delete pages preserve lineage and advance checkpoints atomically', async () => {
  const h = host(), definition = spec(), first = await commit(h, definition, page([item('one'), item('two')]));
  const next = await commit(h, definition, page([item('one', 'one', 'Changed'), item('two')], first.receipt.checkpoint, { page: 2 }));
  assert.equal(next.receipt.counts.updated, 1); assert.equal(next.receipt.counts.unchanged, 1);
  const last = await commit(h, definition, page([{ id: 'one', operation: 'delete' }, { id: 'missing', operation: 'delete' }], next.receipt.checkpoint, { page: 3 }));
  assert.equal(last.receipt.counts.deleted, 1); assert.equal(last.receipt.counts.unchanged, 1); assert.equal(await h.inspectRecord(first.plan.rows[0].id), null); assert.deepEqual((await h.status('issues')).cursor, { page: 3 });
});
test('M05 invalid/duplicate mapped rows block all writes until explicit final reviewed exclusions', async () => {
  const h = host(), definition = spec(); let rounds = 0;
  const result = await runMigration({ spec: definition, host: h, source: source(definition, () => page([item('one', 'same'), item('two', 'same'), { id: 'bad', operation: 'upsert', data: {} }])), review: batch => {
    rounds++; if (rounds === 1) { assert.equal(batch.ready, false); assert.equal(batch.issues.filter(i => i.code === 'duplicate_identity').length, 2); return { decision: 'revise', excludedIds: ['two', 'bad'] }; }
    assert.equal(batch.ready, true); return approve(batch);
  } });
  assert.equal(rounds, 2); assert.equal(result.lastReceipt.counts.created, 1); assert.equal(result.lastReceipt.counts.excluded, 2); assert.deepEqual(result.lastReceipt.excludedIds, ['two', 'bad']);
});
test('M06 approval of invalid or stale batch IDs cannot write or advance the checkpoint', async () => {
  for (const review of [batch => ({ ...approve(batch), batchId: 'sha256:' + '0'.repeat(64) }), approve]) {
    const definition = spec(), h = host(); await assert.rejects(runMigration({ spec: definition, host: h, source: source(definition, () => page([{ id: 'bad', operation: 'upsert', data: {} }])), review }), code('review')); assert.deepEqual((await h.status('issues')).cursor, null); assert.equal((await h.status('issues')).revision, 0);
  }
});
test('M07 destination edits after review cause zero writes across the entire page', async () => {
  const h = host(), definition = spec(), first = await commit(h, definition, page([item('one')])); const lease = await h.claim(definition);
  const plan = await inspectMigrationPage(definition, page([item('new'), item('one', 'one', 'Source changed')], first.receipt.checkpoint, { page: 2 }), h);
  await h.editLocal(first.plan.rows[0].id, { key: 'one', title: 'Keep local edit' }, { expectedRevision: 1 });
  await assert.rejects(h.commitBatch(plan, { lease }), code('record_conflict')); assert.equal(await h.inspectRecord(plan.rows[0].id), null); assert.equal((await h.status('issues')).revision, 1); await h.release(lease);
  const reread = await inspectMigrationPage(definition, plan.page, h); assert.ok(reread.issues.some(i => i.code === 'local_change')); assert.equal(reread.ready, false);
});
test('M08 omitted lineage, foreign connection and changed target keys cannot overwrite managed records', async () => {
  const h = host(), definition = spec(), first = await commit(h, definition, page([item('one')]));
  const rekey = await inspectMigrationPage(definition, page([item('one', 'different')], first.receipt.checkpoint, { page: 2 }), h); assert.equal(rekey.issues[0].code, 'identity_changed');
  const forged = await prepareMigrationBatch(definition, rekey.page, rekey.baseline, []), lease = await h.claim(definition); assert.equal(forged.ready, true); await assert.rejects(h.commitBatch(forged, { lease }), code('record_conflict')); await h.release(lease);
  const other = spec(); other.connectionId = 'other'; const collision = await inspectMigrationPage(other, page([item('one')]), h); assert.equal(collision.issues[0].code, 'foreign_record');
});
test('M09 full derivation rejects a maliciously rehashed batch and false observation hashes', async () => {
  const definition = spec(), h = host(), lease = await h.claim(definition), plan = await inspectMigrationPage(definition, page([item('one')]), h);
  const forged = structuredClone(plan); forged.rows[0].data.title = 'Injected'; const { batchId, ...body } = forged; forged.batchId = 'sha256:' + await sha256(canonical(body));
  await assert.rejects(verifyMigrationBatch(forged), code('batch_integrity')); await assert.rejects(h.commitBatch(forged, { lease }), code('batch_integrity')); assert.equal((await h.status('issues')).revision, 0); await h.release(lease);
  const first = await commit(h, definition, plan.page), row = await h.inspectRecord(plan.rows[0].id); row.data.title = 'False hash'; await assert.rejects(prepareMigrationBatch(definition, page([item('one')], first.receipt.checkpoint, { page: 2 }), { revision: 1, cursor: first.receipt.checkpoint, specId: plan.specId }, [row]), code('record'));
});
test('M10 denied updates/deletes and changed contracts remain visible without writes', async () => {
  const definition = spec(); definition.policy.update = false; definition.policy.delete = false; const h = host(), first = await commit(h, definition, page([item('one')]));
  for (const event of [item('one', 'one', 'Changed'), { id: 'one', operation: 'delete' }]) { const plan = await inspectMigrationPage(definition, page([event], first.receipt.checkpoint, { page: 2 }), h); assert.equal(plan.ready, false); assert.equal(plan.issues[0].code, 'operation_denied'); }
  const changed = spec(); await assert.rejects(h.claim(changed), code('spec_changed'));
});
test('M11 worker ownership is serialized, fenced after reclaim and cannot release the new worker', async () => {
  let now = 1000; const definition = spec(), h = host({ now: () => now, leaseMs: 1000 }), first = await h.claim(definition), plan = await inspectMigrationPage(definition, page([item('one')]), h);
  await assert.rejects(h.claim(definition), code('lease_busy')); now = 2000; const second = await h.claim(definition);
  await assert.rejects(h.commitBatch(plan, { lease: first }), code('lease_lost')); assert.equal(await h.release(first), false); await assert.rejects(h.claim(definition), code('lease_busy'));
  assert.equal((await h.commitBatch(plan, { lease: second })).counts.created, 1); await h.release(second);
});
test('M12 continuous sync needs an accepted complete route, and revocation fences outstanding workers', async () => {
  const definition = spec(), h = host(); await assert.rejects(h.claim(definition, { continuous: true }), code('route_required'));
  const route = await h.acceptRoute(definition, { acceptedBy: 'trusted-owner' }); assert.deepEqual(route.spec, definition);
  const lease = await h.claim(definition, { continuous: true }), plan = await inspectMigrationPage(definition, page([item('one')]), h); h.revokeRoute('issues');
  await assert.rejects(h.commitBatch(plan, { lease }), code('lease_lost')); assert.equal((await h.status('issues')).revision, 0);
  await h.acceptRoute(definition, { acceptedBy: 'trusted-owner' }); const result = await runMigration({ spec: definition, host: h, source: source(definition, () => plan.page), continuous: true }); assert.equal(result.status, 'complete'); assert.equal(result.lastReceipt.counts.created, 1);
});
test('M13 quota failure and stale checkpoint cause no partial writes', async () => {
  const definition = spec(), h = host({ maxRecords: 1 }), lease = await h.claim(definition), plan = await inspectMigrationPage(definition, page([item('one'), item('two')]), h);
  await assert.rejects(h.commitBatch(plan, { lease }), code('host_quota')); assert.equal(await h.inspectRecord(plan.rows[0].id), null); assert.equal((await h.status('issues')).revision, 0);
  const small = await inspectMigrationPage(definition, page([item('one')]), h); await h.commitBatch(small, { lease }); await assert.rejects(h.commitBatch(plan, { lease }), code('conflict')); await h.release(lease);
});
test('M14 stop and bounded jobs resume from acknowledged cursors rather than diagnostic reads', async () => {
  const definition = spec(), h = host(), reads = [], adapter = source(definition, ({ cursor }) => { reads.push(cursor); const index = cursor?.page ?? 0; return page([item(String(index))], cursor, { page: index + 1 }, index === 2); });
  const stopped = await runMigration({ spec: definition, host: h, source: adapter, review: () => ({ decision: 'stop' }) }); assert.equal(stopped.batches, 0); assert.equal(stopped.checkpoint, null);
  const partial = await runMigration({ spec: definition, host: h, source: adapter, review: approve, maxBatches: 1 }); assert.equal(partial.status, 'paused'); assert.deepEqual(partial.checkpoint, { page: 1 });
  const complete = await runMigration({ spec: definition, host: h, source: adapter, review: approve }); assert.equal(complete.status, 'complete'); assert.equal(complete.batches, 2); assert.deepEqual(reads, [null, null, { page: 1 }, { page: 2 }]);
});
test('M15 source timeout/cancellation release ownership and ignore adapter completion after cancellation', async () => {
  for (const cancel of [false, true]) {
    const definition = spec(), h = host(), pending = deferred(), started = deferred(), controller = new AbortController(); let sourceSignal;
    const result = runMigration({ spec: definition, host: h, source: source(definition, ({ signal }) => { sourceSignal = signal; started.resolve(); return pending.promise; }), review: approve, signal: controller.signal, readTimeoutMs: cancel ? 1000 : 15 }); await started.promise; if (cancel) controller.abort();
    await assert.rejects(result, code(cancel ? 'aborted' : 'operation_timeout')); assert.equal(sourceSignal.aborted, true); pending.resolve(page([item('late')])); await new Promise(resolve => setImmediate(resolve)); assert.equal((await h.status('issues')).revision, 0); const lease = await h.claim(definition); await h.release(lease);
  }
});
test('M16 review timeout/cancel preserve checkpoint and a late approval cannot commit', async () => {
  const definition = spec(), h = host(), late = deferred(); const result = runMigration({ spec: definition, host: h, source: source(definition, () => page([item('one')])), review: () => late.promise, reviewTimeoutMs: 15 });
  await assert.rejects(result, code('operation_timeout')); late.resolve({ decision: 'approve', batchId: 'late' }); await new Promise(resolve => setImmediate(resolve)); assert.equal((await h.status('issues')).revision, 0); const lease = await h.claim(definition); await h.release(lease);
});
test('M17 acknowledged work survives a later source failure or receipt-handler failure', async () => {
  const definition = spec(), h = host(); await assert.rejects(runMigration({ spec: definition, host: h, source: source(definition, ({ cursor }) => { if (cursor) throw new Error('Authored later failure'); return page([item('one')], null, { page: 1 }, false); }), review: approve }), error => error.details.committedBatches === 1 && error.details.lastReceipt.counts.created === 1); assert.deepEqual((await h.status('issues')).cursor, { page: 1 });
  const nextHost = host(); await assert.rejects(runMigration({ spec: definition, host: nextHost, source: source(definition, () => page([item('one')])), review: approve, onReceipt: () => { throw new Error('Authored handler failure'); } }), error => error.code === 'receipt_handler' && error.details.committedBatches === 1); assert.equal((await nextHost.status('issues')).revision, 1);
});
test('M18 row/page/review budgets fail explicitly instead of hitting the shared serializer limit', async () => {
  const definition = spec(), h = host(), rows = [item('one', 'one', 'x'.repeat(360000)), item('two', 'two', 'x'.repeat(360000)), item('three', 'three', 'x'.repeat(360000))];
  const first = await commit(h, definition, page(rows)); assert.equal(first.receipt.counts.created, 3);
  const changed = rows.map(value => ({ ...value, data: { ...value.data, title: 'y'.repeat(360000) } })); await assert.rejects(inspectMigrationPage(definition, page(changed, first.receipt.checkpoint, { page: 2 }), h), code('batch_size')); assert.equal((await h.status('issues')).revision, 1);
});
test('M19 owned continuous polling reclaims each run and keeps only accepted checkpoints', async () => {
  const definition = spec(), h = host(), reads = []; await h.acceptRoute(definition, { acceptedBy: 'trusted-owner' });
  const result = await syncMigration({ spec: definition, host: h, source: source(definition, ({ cursor }) => { reads.push(cursor); return page([item('one')], cursor, { poll: (cursor?.poll ?? 0) + 1 }); }), intervalMs: 1, maxPolls: 2 });
  assert.equal(result.polls, 2); assert.equal(result.batches, 2); assert.equal(result.lastReceipt.counts.unchanged, 1); assert.deepEqual(reads, [null, { poll: 1 }]);
});
test('M20 abort between polls clears the wait, releases ownership and reports prior committed work', async () => {
  const definition = spec(), h = host(), controller = new AbortController(); await h.acceptRoute(definition, { acceptedBy: 'trusted-owner' });
  const result = syncMigration({ spec: definition, host: h, source: source(definition, () => page([item('one')])), signal: controller.signal, intervalMs: 10000, onReceipt: () => controller.abort() });
  await assert.rejects(result, error => error.code === 'aborted' && error.details.committedBatches === 1 && error.details.lastReceipt.counts.created === 1); const lease = await h.claim(definition); await h.release(lease);
});
test('M21 a partially committed first poll reports its last accepted checkpoint on a later read failure', async () => {
  const definition = spec(), h = host(); await h.acceptRoute(definition, { acceptedBy: 'trusted-owner' });
  await assert.rejects(syncMigration({ spec: definition, host: h, source: source(definition, ({ cursor }) => { if (cursor) throw new Error('Authored failure'); return page([item('one')], null, { page: 1 }, false); }), intervalMs: 1 }), error => error.details.committedBatches === 1 && error.details.checkpoint.page === 1 && error.details.completedPolls === 0);
});
test('M22 malformed/foreign acknowledgements are unconfirmed writes, never reported as accepted receipts', async () => {
  for (const alter of [receipt => ({ ...receipt, batchId: 'other' }), receipt => ({ ...receipt, counts: { ...receipt.counts, created: 99 } }), receipt => ({ ...receipt, checkpoint: null }), () => undefined]) {
    const definition = spec(), target = host(); let notifications = 0;
    const application = new Proxy(target, { get(value, key) { if (key === 'commitBatch') return async (...args) => alter(await value.commitBatch(...args)); const method = value[key]; return typeof method === 'function' ? method.bind(value) : method; } });
    await assert.rejects(runMigration({ spec: definition, host: application, source: source(definition, () => page([item('one')])), review: approve, onReceipt: () => { notifications++; } }), error => error.code === 'receipt_mismatch' && error.details.committedBatches === 0 && error.details.cause.unconfirmedBatchId.startsWith('sha256:'));
    assert.equal(notifications, 0); assert.equal((await target.status('issues')).revision, 1);
  }
});
