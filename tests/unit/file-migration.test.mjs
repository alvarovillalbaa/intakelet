// T2: tiny authored bytes, private test-owned temporary directories, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DirectoryAssetStore, createFileMigrationSource, fileMigration } from '../../src/migration-node.mjs';
import { runMigration } from '../../src/migration.mjs';
import { MemoryMigrationHost } from '../../src/migration-host.mjs';
const fixture = async t => { const directory = await mkdtemp(join(tmpdir(), 'intakelet-assets-t2-')); t.after(() => rm(directory, { recursive: true, force: true })); return { directory, store: new DirectoryAssetStore({ directory, maxAssetBytes: 2048 }) }; };
const bytes = new Uint8Array([0, 255, 128, 10, 13, 42]);
const file = (name = 'authored.unknown', content = bytes) => new File([content], name, { type: 'application/octet-stream', lastModified: 1 });
const approve = plan => ({ decision: 'approve', batchId: plan.batchId });
const consume = async iterable => { const chunks = []; for await (const value of iterable) chunks.push(...value); return new Uint8Array(chunks); };

test('F01 preserves arbitrary binary bytes, empty files and content-addressed retries without overwriting', async t => {
  const { directory, store } = await fixture(t), first = await store.put(file()); assert.deepEqual(await consume(store.read(first.assetId)), bytes); assert.deepEqual(await store.put(file('another.pdf')), first); assert.equal((await readdir(directory)).length, 1);
  const empty = await store.put(file('empty.zip', new Uint8Array())); assert.equal(empty.bytes, 0); assert.equal((await consume(store.read(empty.assetId))).length, 0); assert.equal((await readdir(directory)).length, 2);
});
test('F02 bulk collections exceed the old ten-file cap, resume and keep duplicate filenames distinct', async t => {
  const { store } = await fixture(t), files = Array.from({ length: 53 }, () => file('same.pdf')), source = await createFileMigrationSource({ collectionId: 'selection', files, assetStore: store, filesPerPage: 7 });
  const spec = fileMigration({ workspaceId: 'workspace', connectionId: 'files', source }), host = new MemoryMigrationHost({ workspaceId: 'workspace' });
  const first = await runMigration({ spec, host, source, review: approve, maxBatches: 2 }); assert.equal(first.items, 14); assert.equal(first.status, 'paused');
  const last = await runMigration({ spec, host, source, review: approve }); assert.equal(last.items, 39); assert.equal(last.status, 'complete'); assert.deepEqual(last.checkpoint, { kind: 'file-collection-v1', next: 53 });
});
test('F03 metadata ordering and decoder versions bind identity; custom outputs use actual decoded data', async t => {
  const { store } = await fixture(t), files = [file('note.txt', 'Authored text')], source = await createFileMigrationSource({ collectionId: 'selection', files, assetStore: store, decode: async ({ file }) => ({ text: await file.text() }), decoderVersion: 'authored-text-v1' });
  const other = await createFileMigrationSource({ collectionId: 'selection', files: [file('different.txt', 'Authored text')], assetStore: store }); assert.notEqual(source.identity.configuration.manifestHash, other.identity.configuration.manifestHash);
  const output = { id: 'notes', version: '1', schema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false }, fields: [{ from: ['fileId'], to: ['id'] }, { from: ['extracted', 'text'], to: ['text'] }], key: [['id']] }, spec = fileMigration({ workspaceId: 'workspace', connectionId: 'notes', source, output }), host = new MemoryMigrationHost({ workspaceId: 'workspace' });
  const result = await runMigration({ spec, source, host, review: approve }), batch = await host.inspectBatch(result.lastReceipt.batchId); assert.equal(batch.batch.rows[0].data.text, 'Authored text'); assert.equal(Object.hasOwn(batch.batch.rows[0].data, 'assetPath'), false);
});
test('F04 failed, truncated, oversized and cancelled streams remove only their owned temporary files', async t => {
  const { directory, store } = await fixture(t); const existing = await store.put(file());
  for (const candidate of [{ size: 3, async *stream() { yield new Uint8Array([1]); } }, { size: 1, async *stream() { yield new Uint8Array([1, 2]); } }, { size: 1, async *stream() { throw new Error('Authored stream failure'); } }, { size: 2049, stream() {} }]) { await assert.rejects(store.put(candidate)); assert.deepEqual(await readdir(directory), [existing.assetId.slice(7)]); }
  const controller = new AbortController(); await assert.rejects(store.put({ size: 2, async *stream() { yield new Uint8Array([1]); controller.abort(); yield new Uint8Array([2]); } }, { signal: controller.signal }), error => error.code === 'aborted'); assert.deepEqual(await consume(store.read(existing.assetId)), bytes); assert.equal((await readdir(directory)).length, 1);
});
test('F05 corrupt existing assets and symlinks are rejected without overwriting their targets', async t => {
  const { directory, store } = await fixture(t), asset = await store.put(file()), path = join(directory, asset.assetId.slice(7)); await writeFile(path, new Uint8Array(bytes.length));
  await assert.rejects(store.put(file()), error => error.code === 'asset_integrity'); await assert.rejects(consume(store.read(asset.assetId)), error => error.code === 'asset_integrity');
  await rm(path); const external = join(directory, 'authored-target'); await writeFile(external, bytes); await symlink(external, path); await assert.rejects(store.put(file())); assert.deepEqual(new Uint8Array(await readFile(external)), bytes); assert.equal((await readdir(directory)).some(name => name.startsWith('.intakelet-')), false);
});
test('F06 a later file failure leaves only earlier acknowledged pages and explicitly staged assets', async t => {
  const { directory, store } = await fixture(t), malformed = { name: 'broken.bin', type: '', size: 1, async *stream() { throw new Error('Authored failure'); } }, source = await createFileMigrationSource({ collectionId: 'selection', files: [file(), malformed], filesPerPage: 1, assetStore: store }), spec = fileMigration({ workspaceId: 'workspace', connectionId: 'files', source }), host = new MemoryMigrationHost({ workspaceId: 'workspace' });
  await assert.rejects(runMigration({ spec, source, host, review: approve }), error => error.details.committedBatches === 1); assert.deepEqual((await host.status('files')).cursor, { kind: 'file-collection-v1', next: 1 }); assert.equal((await readdir(directory)).length, 1);
});
test('F07 source rejects changed descriptors, malformed cursors and missing byte acknowledgements', async t => {
  const { store } = await fixture(t), mutable = { name: 'a.bin', type: '', size: 0, stream: () => new Blob([]).stream() }, source = await createFileMigrationSource({ collectionId: 'selection', files: [mutable], assetStore: store }); mutable.name = 'b.bin'; await assert.rejects(source.readPage(), error => error.code === 'file_changed'); await assert.rejects(source.readPage({ cursor: { kind: 'file-collection-v1', next: 2 } }));
  const broken = await createFileMigrationSource({ collectionId: 'selection', files: [file()], assetStore: { put: () => ({}) } }); await assert.rejects(broken.readPage(), error => error.code === 'asset');
  await assert.rejects(createFileMigrationSource({ collectionId: 'selection', files: [file()], assetStore: store, decode: () => ({}) }));
});
test('F08 page byte budgets stop at an accepted file boundary instead of buffering the whole job', async t => {
  const { store } = await fixture(t), source = await createFileMigrationSource({ collectionId: 'selection', files: Array.from({ length: 5 }, () => file()), assetStore: store, decode: () => ({ text: 'x'.repeat(500000) }), decoderVersion: 'authored-large-v1' });
  const first = await source.readPage(); assert.equal(first.items.length, 4); assert.equal(first.done, false); assert.deepEqual(first.cursorAfter, { kind: 'file-collection-v1', next: 4 }); const next = await source.readPage({ cursor: first.cursorAfter }); assert.equal(next.items.length, 1); assert.equal(next.done, true);
});
test('F09 a stalled adapter cannot retain an owned file handle or temporary file after cancellation', async t => {
  const { directory, store } = await fixture(t), controller = new AbortController(); let started; const ready = new Promise(resolve => { started = resolve; }); let finish;
  const pending = store.put({ size: 1, stream: () => ({ [Symbol.asyncIterator]() { return this; }, next() { started(); return new Promise(resolve => { finish = resolve; }); }, return() { return new Promise(() => {}); } }) }, { signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(pending, error => error.code === 'aborted'); assert.deepEqual(await readdir(directory), []); finish({ done: false, value: new Uint8Array([1]) }); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(await readdir(directory), []);
});
