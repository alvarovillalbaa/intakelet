// T2: actual wrapper functions with controlled hooks, not installed React proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { canonical, requireValue } from '../../src/values.mjs';
import { initialSetup } from '../../src/onboarding.mjs';
const code = (await readFile(new URL('../../src/react.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ') + '\nglobalThis.components = { IntakeletSetup, IntakeletQuickstart, IntakeletTour };';
function wrapper() {
  const hooks = []; let index = 0, effects = [], registrations = 0;
  const element = { config: null, events: new Map(), configure(config) { this.config = config; }, addEventListener(type, callback) { this.events.set(type, callback); }, removeEventListener(type) { this.events.delete(type); }, start() {}, close() {} };
  const context = vm.createContext({ canonical, requireValue, defineOnboarding: () => { registrations++; }, defineIntakelet() {},
    createElement: (type, props) => ({ type, props }),
    useRef: value => { const slot = index++; hooks[slot] ??= { current: value }; return hooks[slot]; },
    useEffect: (callback, dependencies) => { const slot = index++, previous = hooks[slot]; if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) effects.push(() => { previous?.cleanup?.(); hooks[slot] = { dependencies, cleanup: callback() }; }); },
  });
  vm.runInContext(code, context);
  return { element, registrations: () => registrations,
    render(name, props) { index = 0; let output = context.components[name](props); if (typeof output.type === 'function') output = output.type(output.props); output.props.ref.current = element; },
    flush() { const pending = effects; effects = []; pending.forEach(effect => effect()); },
  };
}
const scope = { actorId: 'first-actor', workspaceId: 'first-workspace' };
test('R01 a render that changes scope blocks an old action even before effects reconfigure the element', async () => {
  const ui = wrapper(), first = initialSetup('user', scope), second = initialSetup('user', { ...scope, actorId: 'second-actor' }); let calls = 0;
  ui.render('IntakeletSetup', { flow: first, submit: () => { calls++; } }); assert.equal(ui.registrations(), 0, 'registration waits for the browser effect'); ui.flush();
  const old = ui.element.config.submit;
  ui.render('IntakeletSetup', { flow: second, submit: () => { calls++; } });
  assert.throws(() => old({ stepId: 'profile' }, {}), error => error.code === 'stale_context'); assert.equal(calls, 0);
  ui.flush(); ui.element.config.submit({ stepId: 'profile' }, {}); assert.equal(calls, 1);
});
test('R02 same-definition handler refresh works; a late acknowledgement remains visible while old completion is suppressed', () => {
  const ui = wrapper(), flow = initialSetup('user', scope), acknowledgements = []; let latest = 0, completed = 0;
  ui.render('IntakeletQuickstart', { flow, submit() {}, onAcknowledged: event => acknowledgements.push(event), onComplete: () => { completed++; } }); ui.flush();
  const submit = ui.element.config.submit;
  ui.render('IntakeletQuickstart', { flow: structuredClone(flow), submit: () => { latest++; }, onAcknowledged: event => acknowledgements.push(event), onComplete: () => { completed++; } });
  submit({}, {}); assert.equal(latest, 1); ui.flush();
  ui.render('IntakeletQuickstart', { flow: { ...flow, version: '2' }, submit() {}, onAcknowledged: event => acknowledgements.push(event), onComplete: () => { completed++; } });
  ui.element.events.get('intakelet-onboarding-acknowledged')({ detail: { scope, appliedToView: false } });
  ui.element.events.get('intakelet-onboarding-complete')({ detail: { scope } });
  assert.equal(acknowledgements.length, 1); assert.equal(completed, 0);
});
test('R03 changing tour steps before effect cleanup cannot call a replacement prepare handler with the old step', () => {
  const ui = wrapper(), steps = [{ id: 'first', title: 'First', description: 'Guide', target: '#first' }]; let calls = 0;
  ui.render('IntakeletTour', { steps, prepare: () => { calls++; } }); ui.flush(); const prepare = ui.element.config.prepare;
  ui.render('IntakeletTour', { steps: [{ ...steps[0], target: '#second' }], prepare: () => { calls++; } });
  assert.throws(() => prepare(steps[0], {}), error => error.code === 'stale_context'); assert.equal(calls, 0);
  ui.flush(); ui.element.config.prepare(steps[0], {}); assert.equal(calls, 1);
});
