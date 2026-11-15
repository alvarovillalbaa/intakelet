// T2: controlled nodes/events plus real in-memory host. Not native browser proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineMigration } from '../../src/migration-elements.mjs';
import { MemoryMigrationHost } from '../../src/migration-host.mjs';
import { migrationSurface, until, deferred } from '../fixtures/migration-dom.mjs';
const item = (id = 'one', key = id) => ({ id, operation: 'upsert', data: { key, title: '<img src=x> Authored' } });
function configuration({ items = [item()], workspaceId = 'authored', connectionId = 'collection' } = {}) {
  const source = { identity: { id: 'authored', version: '1', configuration: {} }, readPage: ({ cursor }) => ({ items, cursorBefore: cursor, cursorAfter: { page: 1 }, done: true }) };
  const spec = { workspaceId, connectionId, source: source.identity, output: { id: 'notes', version: '1', schema: { type: 'object', properties: { key: { type: 'string' }, title: { type: 'string' } }, required: ['key', 'title'], additionalProperties: false }, fields: [{ from: ['key'], to: ['key'] }, { from: ['title'], to: ['title'] }], key: [['key']] }, policy: { create: true, update: true, delete: false } };
  return { source, spec, host: new MemoryMigrationHost({ workspaceId }) };
}
const surface = t => { const ui = migrationSurface(); t.after(() => ui.restore()); defineMigration(ui.customElements); return ui; };
const commit = (ui, view) => ui.button(view, 'Commit this batch').click();

test('V01 lazy registration is repeatable; unconfigured view grants no action', t => {
  assert.throws(() => defineMigration(), /browser effect/); const ui = surface(t), constructor = defineMigration(ui.customElements); assert.equal(constructor, defineMigration(ui.customElements)); const view = ui.create('intakelet-migration'); assert.match(view.textContent, /Connect a source/); assert.equal(view.progress.busy, false); assert.equal(view.reviewBatch, null);
});
test('V02 ready batches show complete literal source/output and commit only after exact approval', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), config = configuration(), events = []; view.configure(config); view.addEventListener('intakelet-migration-acknowledged', event => events.push(event.detail));
  const pending = view.start(); await until(() => view.reviewBatch); assert.equal((await config.host.status('collection')).revision, 0); assert.equal(ui.walk(view).some(node => node.tagName === 'IMG'), false); assert.match(view.textContent, /<img src=x>/); assert.ok(ui.walk(view).find(node => node.tagName === 'PRE').textContent.includes(view.reviewBatch.batchId));
  commit(ui, view); await pending; assert.equal(view.progress.phase, 'complete'); assert.equal(view.progress.lastReceipt.counts.created, 1); assert.equal(events[0].appliedToView, true); const copy = view.progress; copy.lastReceipt.counts.created = 999; assert.equal(view.progress.lastReceipt.counts.created, 1);
});
test('V03 invalid rows block commit and changed exclusions require a rebuilt proposal', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), config = configuration({ items: [item(), { id: 'bad', operation: 'upsert', data: {} }] }); view.configure(config); const pending = view.start(); await until(() => view.reviewBatch); const first = view.reviewBatch.batchId; assert.equal(ui.button(view, 'Commit this batch').disabled, true);
  const check = ui.walk(view).find(node => node.getAttribute('aria-label') === 'Exclude source bad'); check.checked = true; check.dispatchEvent(new Event('change')); assert.equal(ui.button(view, 'Commit this batch').disabled, true); ui.button(view, 'Apply exclusions and review again').click(); await until(() => view.reviewBatch?.batchId !== first && view.reviewBatch?.ready); commit(ui, view); await pending; assert.equal(view.progress.lastReceipt.counts.excluded, 1); assert.equal(view.progress.lastReceipt.counts.created, 1);
});
test('V04 cancellation/late clicks cannot commit an abandoned review and ownership is released', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), config = configuration(); view.configure(config); const pending = view.start(); await until(() => view.reviewBatch); const oldButton = ui.button(view, 'Commit this batch'); view.cancel(); await assert.rejects(pending, error => error.code === 'aborted'); oldButton.click(); assert.equal((await config.host.status('collection')).revision, 0); assert.equal(view.progress.phase, 'paused'); const lease = await config.host.claim(config.spec); await config.host.release(lease);
});
test('V05 a late acknowledged old-scope commit is observable without advancing the new view', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), old = configuration(), next = configuration({ workspaceId: 'next-workspace', connectionId: 'next-collection' }), gate = deferred(), events = []; let receipt;
  old.host = new Proxy(old.host, { get(target, key) { if (key === 'commitBatch') return async (...args) => { receipt = await target.commitBatch(...args); await gate.promise; return receipt; }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  view.configure(old); view.addEventListener('intakelet-migration-acknowledged', event => events.push(event.detail)); const pending = view.start(); await until(() => view.reviewBatch); commit(ui, view); await until(() => receipt); view.configure(next); gate.resolve(); await pending;
  assert.equal(events.length, 1); assert.equal(events[0].receipt.workspaceId, 'authored'); assert.equal(events[0].appliedToView, false); assert.equal(view.progress.connectionId, 'next-collection'); assert.equal(view.progress.lastReceipt, null); assert.equal((await next.host.status('next-collection')).revision, 0);
});
test('V06 cancellation while a commit response is pending retains the acknowledged write', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), config = configuration(), gate = deferred(), events = []; let receipt;
  const target = config.host; config.host = new Proxy(target, { get(host, key) { if (key === 'commitBatch') return async (...args) => { receipt = await host.commitBatch(...args); await gate.promise; return receipt; }; const value = host[key]; return typeof value === 'function' ? value.bind(host) : value; } });
  view.configure(config); view.addEventListener('intakelet-migration-acknowledged', event => events.push(event.detail)); const pending = view.start(); await until(() => view.reviewBatch); commit(ui, view); await until(() => receipt); view.cancel(); gate.resolve(); await pending; assert.equal(view.progress.phase, 'paused'); assert.equal(view.progress.lastReceipt.counts.created, 1); assert.equal(events[0].appliedToView, false); assert.equal((await target.status('collection')).revision, 1);
});
test('V07 stop-before-commit and disconnect preserve an unadvanced checkpoint', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), config = configuration(); view.configure(config); let pending = view.start(); await until(() => view.reviewBatch); ui.button(view, 'Stop before this batch').click(); await pending; assert.equal(view.progress.phase, 'paused'); assert.equal((await config.host.status('collection')).revision, 0);
  pending = view.start(); await until(() => view.reviewBatch); view.disconnectedCallback(); await assert.rejects(pending, error => error.code === 'aborted'); view.connectedCallback(); assert.equal(view.progress.busy, false); assert.equal((await config.host.status('collection')).cursor, null);
});
test('V08 equivalent configuration preserves a pending view, but invalid configuration cannot retire it', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), config = configuration(); view.configure(config); const pending = view.start(); await until(() => view.reviewBatch); const before = ui.button(view, 'Commit this batch'); before.focus(); view.configure({ ...config, spec: structuredClone(config.spec) }); assert.equal(ui.button(view, 'Commit this batch'), before); assert.equal(ui.document.activeElement, before); assert.throws(() => view.configure({ ...config, spec: { ...config.spec, policy: {} } })); assert.equal(view.progress.phase, 'review'); commit(ui, view); await pending;
});
test('V09 detached controls from an earlier batch cannot approve, revise or stop a later review', async t => {
  const ui = surface(t), view = ui.create('intakelet-migration'), config = configuration(); config.source.readPage = ({ cursor }) => ({ items: [item(cursor ? 'two' : 'one')], cursorBefore: cursor, cursorAfter: { page: cursor ? 2 : 1 }, done: Boolean(cursor) }); view.configure(config);
  const pending = view.start(); await until(() => view.reviewBatch); const first = view.reviewBatch.batchId, oldCommit = ui.button(view, 'Commit this batch'), oldStop = ui.button(view, 'Stop before this batch'); oldCommit.click(); await until(() => view.reviewBatch && view.reviewBatch.batchId !== first); oldStop.click(); oldCommit.click(); assert.equal(view.progress.phase, 'review'); assert.equal((await config.host.status('collection')).revision, 1); commit(ui, view); await pending; assert.equal(view.progress.result.batches, 2);
});
