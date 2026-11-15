// T2: controlled DOM/lifecycle callbacks, not a native browser/layout proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineOnboarding } from '../../src/onboarding-elements.mjs';
import { initialSetup } from '../../src/onboarding.mjs';
const scope = { actorId: 'authored-actor', workspaceId: 'authored-workspace' };
const ack = request => ({ requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'authored-receipt' });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
async function until(predicate) { const deadline = Date.now() + 2000; while (!predicate()) { if (Date.now() > deadline) assert.fail('Controlled UI did not reach the expected state'); await settle(); } }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

function surface({ clock = false } = {}) {
  const originals = new Map(), globals = {}, observers = new Set(), frames = new Map(), timers = new Map(); let frameId = 0, timerId = 0;
  const walk = node => [node, ...node.children.flatMap(walk)];
  function matches(node, selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector === 'dialog[open]') return node.tagName === 'DIALOG' && node.open;
    return selector.split(',').some(tag => node.tagName.toLowerCase() === tag);
  }
  class Node {
    constructor(tag = 'custom-element') { this.tagName = tag.toUpperCase(); this.children = []; this.events = new Map(); this.attrs = new Map(); this.style = {}; this.parentElement = null; this.classes = new Set(); this.ownText = ''; this.value = ''; this.type = ''; this.hidden = false; this.disabled = false; this.checked = false; this.id = ''; this.rect = { left: 50, top: 100, width: 100, height: 44 }; this.classList = { add: name => this.classes.add(name) }; }
    set className(value) { this.classes = new Set(value.split(' ')); }
    get className() { return [...this.classes].join(' '); }
    set textContent(value) { this.ownText = String(value); this.children = []; }
    get textContent() { return this.ownText + this.children.map(node => node.textContent).join(''); }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    prepend(...nodes) { for (const node of [...nodes].reverse()) { node.remove(); node.parentElement = this; this.children.unshift(node); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.ownText = ''; this.append(...nodes); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key); }
    addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(callback); }
    removeEventListener(type, callback) { this.events.get(type)?.delete(callback); }
    dispatchEvent(event) { for (const callback of this.events.get(event.type) || []) callback(event); return true; }
    async send(type, extra = {}) {
      if (type === 'click' && this.disabled) return;
      let stopped = false; const event = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() { stopped = true; }, ...extra };
      for (let node = this; node && !stopped; node = node.parentElement) for (const callback of node.events.get(type) || []) await callback(event);
      await settle();
    }
    click() { return this.send('click'); }
    focus() { document.activeElement = this; }
    querySelector(selector) { return walk(this).slice(1).find(node => matches(node, selector)) || null; }
    contains(node) { return walk(this).includes(node); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    scrollIntoView() {}
    getBoundingClientRect() { return this.classes.has('il-tour-card') ? { left: 0, top: 0, width: 360, height: 220 } : this.rect; }
  }
  const document = new Node('document'); document.body = new Node('body'); document.activeElement = document.body; document.createElement = tag => new Node(tag); document.querySelector = selector => document.body.querySelector(selector);
  const window = new Node('window'); window.visualViewport = new Node('viewport'); window.visualViewport.width = 390; window.visualViewport.height = 650;
  class Observer { constructor(callback) { this.callback = callback; this.targets = new Set(); } observe(target) { this.targets.add(target); observers.add(this); } disconnect() { observers.delete(this); this.targets.clear(); } }
  class Resize extends Observer {}
  Object.assign(globals, { document, window, HTMLElement: Node, MutationObserver: Observer, ResizeObserver: Resize, innerWidth: 390, innerHeight: 650,
    getComputedStyle: node => ({ visibility: node.hidden ? 'hidden' : 'visible' }),
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
  });
  if (clock) Object.assign(globals, { setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id) });
  for (const [key, value] of Object.entries(globals)) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
  const registered = new Map(), registry = { get: name => registered.get(name), define: (name, constructor) => registered.set(name, constructor) }, constructors = defineOnboarding(registry);
  const create = name => { const node = new constructors[name](); document.body.append(node); node.connectedCallback?.(); return node; };
  const restore = () => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
  return { document, window, observers, frames, timers, create, walk, registry, restore,
    button: (root, text) => walk(root).find(node => node.tagName === 'BUTTON' && node.textContent === text),
    trigger: target => { for (const observer of [...observers]) if (!(observer instanceof Resize) || observer.targets.has(target)) observer.callback([{ target }]); },
    flushFrames: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    fireTimer: delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } },
  };
}

test('E01 registration/import is repeatable and setup preserves invalid input after handler refusal', async () => {
  const ui = surface();
  try {
    assert.equal(defineOnboarding(ui.registry).Setup, ui.registry.get('intakelet-setup'));
    const setup = ui.create('Setup'); let calls = 0;
    setup.configure({ flow: initialSetup('company', scope), submit: () => { calls++; throw new Error('Application unavailable'); } });
    const inputs = ui.walk(setup).filter(node => node.tagName === 'INPUT'); inputs[0].value = 'Authored company'; inputs[1].value = 'http://invalid.example'; await inputs[1].send('input');
    await setup.querySelector('form').send('submit'); await until(() => setup.textContent.includes('HTTPS')); assert.equal(calls, 0); assert.equal(setup.querySelector('input').value, 'Authored company'); assert.match(setup.textContent, /HTTPS/);
    ui.walk(setup).filter(node => node.tagName === 'INPUT')[1].value = 'https://example.test'; await setup.querySelector('form').send('submit');
    await until(() => setup.textContent.includes('Application unavailable')); assert.equal(calls, 1); assert.equal(setup.progress.stepId, 'company'); assert.equal(setup.querySelector('input').value, 'Authored company'); assert.match(setup.textContent, /Application unavailable/);
  } finally { ui.restore(); }
});
test('E02 a same-definition callback refresh preserves focus; changed scope cannot receive an old acknowledgement', async () => {
  const ui = surface();
  try {
    const setup = ui.create('Setup'), flow = initialSetup('user', scope), response = deferred(); let request;
    setup.configure({ flow, submit: value => { request = value; return response.promise; } }); const input = setup.querySelector('input'); input.value = 'Keep my draft'; await input.send('input'); input.focus();
    setup.configure({ flow: structuredClone(flow), submit: value => { request = value; return response.promise; } }); assert.equal(setup.querySelector('input'), input); assert.equal(ui.document.activeElement, input);
    const events = []; setup.addEventListener('intakelet-onboarding-acknowledged', event => events.push(event.detail));
    const pending = setup.querySelector('form').send('submit'); while (!request) await settle(); assert.equal(setup.progress.busy, true);
    setup.configure({ flow: initialSetup('user', { ...scope, actorId: 'other-actor' }), submit: ack });
    response.resolve(ack(request)); await pending; await until(() => events.length === 1); assert.equal(setup.progress.completed.length, 0); assert.equal(setup.querySelector('input').value, '');
    assert.equal(events.length, 1); assert.equal(events[0].scope.actorId, scope.actorId); assert.equal(events[0].appliedToView, false);
  } finally { ui.restore(); }
});
test('E03 quickstart waits for its application and does not complete rejected actions', async () => {
  const ui = surface();
  try {
    const checklist = ui.create('Quickstart'); let allowed = false;
    checklist.configure({ flow: { id: 'quickstart', version: '1', scope, steps: [{ id: 'one', title: '<img src=x>', fields: [] }, { id: 'two', title: 'Optional', fields: [], optional: true }] }, submit: request => { if (!allowed) throw new Error('Do the actual task first'); return ack(request); } });
    assert.equal(checklist.querySelector('img'), null); const start = ui.button(checklist, 'Start'); await start.click(); await until(() => checklist.textContent.includes('actual task first')); assert.equal(checklist.progress.completed.length, 0); assert.match(checklist.textContent, /actual task first/);
    allowed = true; await ui.button(checklist, 'Start').click(); await until(() => checklist.progress.completed.includes('one')); assert.deepEqual(checklist.progress.completed, ['one']); await ui.button(checklist, 'Skip').click(); assert.equal(checklist.progress.complete, true);
  } finally { ui.restore(); }
});
test('E04 tour highlights a visible target without changing its styles; close removes all observers/listeners and restores focus', async () => {
  const ui = surface();
  try {
    const target = ui.document.createElement('button'); target.id = 'target'; target.style.color = 'owned-style'; ui.document.body.append(target); target.focus();
    const before = JSON.stringify(target.style), tour = ui.create('Tour'); tour.configure({ steps: [{ id: 'first', title: 'A guide', description: 'Literal source', target: '#target' }] });
    await tour.start(); assert.equal(tour.currentStep, 'first'); assert.equal(ui.walk(ui.document.body).filter(node => node.classes.has('il-tour-highlight')).length, 1);
    const overlay = ui.walk(ui.document.body).find(node => node.classes.has('il-tour-overlay'));
    ui.trigger(overlay.querySelector('p')); assert.equal(ui.frames.size, 0, 'own overlay changes do not schedule a positioning loop');
    ui.trigger(target); assert.equal(ui.frames.size, 1); ui.flushFrames();
    tour.close(); assert.equal(tour.currentStep, null); assert.equal(ui.observers.size, 0); assert.equal(ui.frames.size, 0);
    assert.equal(ui.window.events.get('resize').size, 0); assert.equal(ui.document.events.get('keydown').size, 0);
    assert.equal(ui.document.activeElement, target); assert.equal(JSON.stringify(target.style), before);
  } finally { ui.restore(); }
});
test('E05 disappearing/missing targets cannot finish a tour; disconnect cancels the selector wait', async () => {
  const ui = surface();
  try {
    const target = ui.document.createElement('button'); target.id = 'target'; ui.document.body.append(target); let complete = 0;
    const tour = ui.create('Tour'); tour.configure({ steps: [{ id: 'first', title: 'First', description: 'Guide', target: '#target' }], onComplete: () => { complete++; } });
    await tour.start(); target.remove(); ui.trigger(ui.document.body); ui.flushFrames();
    const finish = ui.button(ui.document.body, 'Finish tour'); assert.equal(finish.disabled, true); await finish.click(); assert.equal(complete, 0);
    const replacement = ui.document.createElement('button'); replacement.id = 'target'; ui.document.body.append(replacement);
    await ui.button(ui.document.body, 'Retry this step').click(); assert.equal(ui.button(ui.document.body, 'Finish tour').disabled, false); tour.close();
    tour.configure({ steps: [{ id: 'missing', title: 'Missing', description: 'Guide', target: '#absent' }] });
    const pending = tour.start(); await settle(); assert.equal(ui.button(ui.document.body, 'Finish tour').disabled, true); tour.disconnectedCallback(); await pending;
    assert.equal(ui.observers.size, 0); assert.equal(tour.currentStep, null);
  } finally { ui.restore(); }
});
test('E06 immediate close cancels prepare before it can act; Escape closes a running guide', async () => {
  const ui = surface();
  try {
    const target = ui.document.createElement('button'); target.id = 'target'; ui.document.body.append(target); let prepared = 0;
    const tour = ui.create('Tour'); tour.configure({ steps: [{ id: 'first', title: 'First', description: 'Guide', target: '#target' }], prepare: () => { prepared++; } });
    const pending = tour.start(); tour.close(); await pending; assert.equal(prepared, 0);
    await tour.start(); assert.equal(prepared, 1); await ui.document.send('keydown', { key: 'Escape' }); assert.equal(tour.currentStep, null); assert.equal(ui.observers.size, 0);
  } finally { ui.restore(); }
});
test('E07 a visible final step can complete once, with cleanup before the host callback', async () => {
  const ui = surface();
  try {
    const target = ui.document.createElement('button'); target.id = 'target'; ui.document.body.append(target); let complete = 0;
    const tour = ui.create('Tour'); tour.configure({ steps: [{ id: 'first', title: 'First', description: 'Guide', target: '#target' }], onComplete: () => { assert.equal(ui.observers.size, 0); complete++; } });
    await tour.start(); await ui.button(ui.document.body, 'Finish tour').click(); assert.equal(complete, 1); assert.equal(tour.currentStep, null);
  } finally { ui.restore(); }
});
test('E08 preparation timeout requests cancellation and exposes retry without claiming completion', async () => {
  const ui = surface({ clock: true });
  try {
    const pendingPrepare = deferred(); let signal;
    const tour = ui.create('Tour'); tour.configure({ steps: [{ id: 'first', title: 'First', description: 'Guide', target: '#absent' }], prepare: (_step, options) => { signal = options.signal; return pendingPrepare.promise; } });
    const pending = tour.start(); await settle(); assert.equal(signal.aborted, false); ui.fireTimer(5000); await pending;
    assert.equal(signal.aborted, true); assert.match(ui.document.body.textContent, /timed out/);
    assert.equal(ui.button(ui.document.body, 'Finish tour').disabled, true); assert.equal(ui.button(ui.document.body, 'Retry this step').disabled, false);
    tour.close(); pendingPrepare.resolve(); await settle(); assert.equal(ui.timers.size, 0); assert.equal(ui.observers.size, 0);
  } finally { ui.restore(); }
});
test('E09 optional final skip completes the guide once without fabricating a saved step', async () => {
  const ui = surface();
  try {
    const setup = ui.create('Setup'), events = []; setup.configure({ flow: initialSetup('user', scope), submit: ack });
    setup.addEventListener('intakelet-onboarding-complete', event => events.push(event.detail));
    setup.querySelector('input').value = 'Authored person'; await setup.querySelector('form').send('submit'); await until(() => setup.progress.stepId === 'purpose'); assert.equal(events.length, 0);
    await ui.button(setup, 'Skip this step').click(); assert.equal(events.length, 1); assert.deepEqual(events[0].progress.completed, ['profile']); assert.deepEqual(events[0].progress.skipped, ['purpose']);
    assert.equal(events[0].progress.receipts.length, 1); assert.equal(setup.progress.complete, true);
  } finally { ui.restore(); }
});
