// T2 actual wrapper with controlled hooks, not installed/native React proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { canonical, requireValue } from '../../src/values.mjs';
const code = (await readFile(new URL('../../src/react.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ') + '\nglobalThis.component = IntakeletMigration;';
function wrapper() {
  const hooks = []; let index = 0, effects = [], registrations = 0, cancellations = 0;
  const element = { config: null, events: new Map(), configure(config) { this.config = config; }, cancel() { cancellations++; }, addEventListener(type, callback) { this.events.set(type, callback); }, removeEventListener(type) { this.events.delete(type); } };
  const context = vm.createContext({ canonical, requireValue, defineMigration: () => { registrations++; }, createElement: (type, props) => ({ type, props }), useRef: value => { const slot = index++; hooks[slot] ??= { current: value }; return hooks[slot]; }, useEffect: (callback, dependencies) => { const slot = index++, previous = hooks[slot]; if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) effects.push(() => { previous?.cleanup?.(); hooks[slot] = { dependencies, cleanup: callback() }; }); } }); vm.runInContext(code, context);
  return { element, registrations: () => registrations, cancellations: () => cancellations, render(props) { index = 0; const output = context.component(props); output.props.ref.current = element; return output; }, flush() { const pending = effects; effects = []; pending.forEach(effect => effect()); }, unmount() { hooks.forEach(hook => hook.cleanup?.()); } };
}
const configuration = () => {
  const calls = [], source = { identity: { id: 'authored' }, readPage: () => { calls.push('source'); } }, host = Object.fromEntries(['status', 'claim', 'renew', 'release', 'readRecords', 'commitBatch'].map(method => [method, () => calls.push(method)])); return { props: { spec: { workspaceId: 'authored' }, source, host }, calls };
};
test('MR01 SSR renders a custom element; changing scope before effects blocks old reads/writes but allows release', () => {
  const ui = wrapper(), { props, calls } = configuration(); assert.equal(ui.render(props).type, 'intakelet-migration'); assert.equal(ui.registrations(), 0); ui.flush(); const old = ui.element.config;
  ui.render({ ...props, spec: { workspaceId: 'another-workspace' } }); assert.throws(() => old.source.readPage({}), error => error.code === 'stale_context'); assert.throws(() => old.host.commitBatch({}), error => error.code === 'stale_context'); old.host.release({}); assert.deepEqual(calls, ['release']); ui.flush(); assert.equal(ui.cancellations(), 1);
});
test('MR02 same-content renders preserve the effect and route receipts to the latest callback', () => {
  const ui = wrapper(), { props } = configuration(), events = []; ui.render({ ...props, onAcknowledged: () => assert.fail('Old callback') }); ui.flush(); const config = ui.element.config; ui.render({ ...props, spec: structuredClone(props.spec), onAcknowledged: detail => events.push(detail) }); ui.flush(); assert.equal(ui.element.config, config); ui.element.events.get('intakelet-migration-acknowledged')({ detail: { receipt: { workspaceId: 'authored' }, appliedToView: true } }); assert.equal(events.length, 1); assert.equal(events[0].appliedToView, true);
});
test('MR03 replacing source/host suppresses old-view progress before effects, retains receipt scope and cancels on unmount', () => {
  const ui = wrapper(), first = configuration(), second = configuration(), events = []; ui.render({ ...first.props, onAcknowledged: detail => events.push(detail) }); ui.flush(); const old = ui.element.config;
  ui.render({ ...first.props, source: second.props.source, host: second.props.host, onAcknowledged: detail => events.push(detail) }); ui.element.events.get('intakelet-migration-acknowledged')({ detail: { receipt: { workspaceId: 'authored' }, appliedToView: true } }); assert.equal(events[0].appliedToView, false); assert.equal(events[0].receipt.workspaceId, 'authored'); assert.throws(() => old.host.claim({}), error => error.code === 'stale_context'); ui.flush(); ui.unmount(); assert.equal(ui.cancellations(), 2); assert.equal(ui.element.events.size, 0);
});
