// T2 authored files/controlled UI. No network, browser, accounts or persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFileOutput, fileOutputFields } from '../../src/file-output.mjs';
import { mapOutput } from '../../src/output-schema.mjs';
import { demoAssetStore, demoTextDecoder, configureMigrationDemo } from '../../examples/migration-playground.mjs';
import { migrationSurface, until, deferred } from '../fixtures/migration-dom.mjs';
import { defineMigration } from '../../src/migration-elements.mjs';
const fields = [{ source: 'fileId', target: 'externalId' }, { source: 'name', target: 'file.title' }, { source: 'bytes', target: 'file.size' }, { source: 'text', target: 'file.text' }];
function playground(t, count = 13) {
  const ui = migrationSurface(); t.after(() => ui.restore()); defineMigration();
  const ids = { 'bulk-migration': 'intakelet-migration', 'bulk-files': 'input', 'bulk-configuration': 'form', 'output-fields': 'div', 'output-key': 'select', 'bulk-status': 'p', 'output-preview': 'pre', 'output-add': 'button', 'output-namespace': 'input', 'bulk-text': 'input', 'bulk-receipts': 'ol', 'bulk-configure': 'button' }; for (const [id, tag] of Object.entries(ids)) ui.create(tag, id);
  const doc = ui.document, view = doc.getElementById('bulk-migration'); doc.getElementById('output-namespace').value = 'files'; doc.getElementById('bulk-files').files = Array.from({ length: count }, (_, i) => new File(['Authored ' + i], 'same.bin', { lastModified: 1 })); const demo = configureMigrationDemo(doc); t.after(() => demo.dispose());
  return { ui, doc, view, demo, async prepare() { doc.getElementById('bulk-configuration').dispatchEvent(new Event('submit', { cancelable: true })); await until(() => !view.hidden && doc.getElementById('output-preview').textContent); } };
}
test('D01 visual field builder preserves types/nesting, declares required paths and nullable text', () => {
  const output = buildFileOutput({ id: 'files', fields, key: 'externalId' }); assert.deepEqual(mapOutput({ fileId: 'selection:1', name: 'Authored', bytes: 7, extracted: null }, output).data, { externalId: 'selection:1', file: { title: 'Authored', size: 7, text: null } }); assert.deepEqual(output.schema.required, ['externalId', 'file']); const copy = fileOutputFields(); copy[0].schema.type = 'number'; assert.equal(fileOutputFields()[0].schema.type, 'string');
});
test('D02 field editor cannot create ambiguous/unsafe paths, unknown sources or undeclared keys', () => {
  for (const extra of [{ source: 'name', target: 'file' }, { source: 'name', target: 'file.title' }, { source: 'name', target: '__proto__.x' }, { source: 'name', target: 'file..x' }, { source: 'invented', target: 'field' }]) assert.throws(() => buildFileOutput({ id: 'files', fields: [...fields, extra], key: 'externalId' })); assert.throws(() => buildFileOutput({ id: 'files', fields, key: 'missing' }));
});
test('D03 session adapter hashes actual bytes, deduplicates storage and checks per-file/total budgets', async () => {
  const store = demoAssetStore({ maxAssetBytes: 4, maxStoredBytes: 5 }), first = await store.put(new File(['abc'], 'a.bin')); assert.equal(first.bytes, 3); assert.deepEqual(await store.put(new File(['abc'], 'b.bin')), first); assert.equal(store.bytes, 3); await assert.rejects(store.put(new File(['abcd'], 'c.bin')), error => error.code === 'demo_budget'); await assert.rejects(store.put(new File(['abcde'], 'd.bin')), error => error.code === 'demo_budget'); assert.equal(store.bytes, 3);
});
test('D04 cancelled reads cannot store late bytes; text extraction is bounded, literal and UTF-8 strict', async () => {
  const store = demoAssetStore(), gate = deferred(), controller = new AbortController(), pending = store.put({ size: 1, arrayBuffer: () => gate.promise }, { signal: controller.signal }); controller.abort(); gate.resolve(new Uint8Array([1]).buffer); await assert.rejects(pending, error => error.code === 'aborted'); assert.equal(store.bytes, 0);
  assert.deepEqual(await demoTextDecoder({ file: new File(['<script>authored</script>'], 'note.md') }), { text: '<script>authored</script>' }); assert.deepEqual(await demoTextDecoder({ file: new File([new Uint8Array([255])], 'image.png') }), { text: null }); await assert.rejects(demoTextDecoder({ file: new File([new Uint8Array([255])], 'note.txt') }), /UTF-8/);
});
test('D05 the authored website flow accepts 13 files, builds its recipe and reviews actual multi-batch writes', async t => {
  const { ui, doc, view, prepare } = playground(t); await prepare(); assert.match(doc.getElementById('bulk-status').textContent, /13 file/);
  const pending = view.start(); for (let batch = 0; batch < 4; batch++) { await until(() => view.reviewBatch); ui.button(view, 'Commit this batch').click(); await until(() => view.progress.lastReceipt?.revision === batch + 1); } await pending; assert.equal(view.progress.result.items, 13); assert.equal(doc.getElementById('bulk-receipts').children.length, 4); assert.equal(view.progress.phase, 'complete');
});
test('D06 editing configuration cancels old review; ambiguous file-name identities stay blocked; disposal removes owned handlers', async t => {
  const { ui, doc, view, demo, prepare } = playground(t, 2); await prepare(); const pending = view.start(); await until(() => view.reviewBatch); const oldCommit = ui.button(view, 'Commit this batch'); doc.getElementById('output-namespace').value = 'changed'; doc.getElementById('output-namespace').dispatchEvent(new Event('input')); await assert.rejects(pending, error => error.code === 'aborted'); oldCommit.click(); assert.equal(view.hidden, true); assert.equal(view.progress.lastReceipt, null);
  doc.getElementById('output-key').value = 'file.name'; doc.getElementById('output-key').dispatchEvent(new Event('change')); await prepare(); const next = view.start(); await until(() => view.reviewBatch); assert.equal(view.reviewBatch.ready, false); assert.equal(view.reviewBatch.issues.filter(issue => issue.code === 'duplicate_identity').length, 2); assert.equal(ui.button(view, 'Commit this batch').disabled, true); ui.button(view, 'Stop before this batch').click(); await next; assert.equal(doc.getElementById('bulk-receipts').children.length, 0);
  demo.dispose(); const status = doc.getElementById('bulk-status'); status.textContent = 'owned after dispose'; doc.getElementById('output-namespace').dispatchEvent(new Event('input')); doc.getElementById('bulk-configuration').dispatchEvent(new Event('submit')); doc.defaultView.dispatchEvent(new Event('pagehide')); assert.equal(status.textContent, 'owned after dispose');
});
