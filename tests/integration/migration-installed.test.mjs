// T2 authored bytes; all SDK imports resolve inside the installed archive.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = join(process.env.INTAKELET_CONSUMER_ROOT, 'node_modules/@alvarovillalbaa/intakelet');
const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
assert.equal(manifest.version, '0.2.0');
const sdk = await import(pathToFileURL(join(base, manifest.exports['.'].default)));
const migration = await import(pathToFileURL(join(base, manifest.exports['./migration'].default)));
const native = await import(pathToFileURL(join(base, manifest.exports['./migration/node'].default)));
const guide = await import(pathToFileURL(join(base, manifest.exports['./onboarding'].default)));
assert.equal(typeof guide.defineOnboarding, 'function');
assert.equal(typeof sdk.syncMigration, 'function');
assert.equal(typeof migration.defineMigration, 'function');
const directory = await mkdtemp(join(process.env.INTAKELET_CONSUMER_TMP, 'installed-assets-'));
try {
  const bytes = new Uint8Array([0, 255, 17, 128, 65]);
  const store = new native.DirectoryAssetStore({ directory });
  const source = await migration.createFileMigrationSource({ collectionId: 'installed-selection', files: [new File([bytes], 'authored.opaque')], assetStore: store });
  const output = migration.buildFileOutput({ id: 'installed-output', fields: [{ source: 'fileId', target: 'externalId' }, { source: 'assetId', target: 'document.asset' }, { source: 'bytes', target: 'document.bytes' }], key: 'externalId' });
  const spec = migration.fileMigration({ workspaceId: 'installed-workspace', connectionId: 'installed-files', source, output });
  const host = new migration.MemoryMigrationHost({ workspaceId: 'installed-workspace' });
  const plans = [], receipts = [];
  const result = await migration.runMigration({ spec, source, host, review: batch => { plans.push(batch); return { decision: 'approve', batchId: batch.batchId }; }, onReceipt: receipt => receipts.push(receipt) });
  assert.equal(result.status, 'complete'); assert.equal(receipts.length, 1);
  const record = plans[0].rows.find(row => row.action === 'create');
  assert.ok(record); const data = record.data;
  assert.equal(data.document.bytes, bytes.length);
  const chunks = []; for await (const chunk of store.read(data.document.asset)) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes));
  console.log(JSON.stringify({ installedVersion: manifest.version, result, plans, receipts, opaqueBytesReadBack: bytes.length }));
} finally { await rm(directory, { recursive: true }); }
