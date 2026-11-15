// T2: authored onboarding definitions/handlers. No account, network or browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OnboardingSession, initialSetup, validateFlow, validateStepValues, stepRequest, tourPosition } from '../../src/onboarding.mjs';
const scope = { actorId: 'authored-user', workspaceId: 'authored-workspace' };
const ack = request => ({ requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'authored-receipt' });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('O01 user/company defaults are distinct and do not imply authentication or permissions', () => {
  const user = initialSetup('user', scope), company = initialSetup('company', scope);
  assert.notEqual(user.id, company.id); assert.equal(user.steps[0].fields[0].required, true);
  assert.match(company.steps[0].description, /do not verify domain ownership/);
  assert.throws(() => initialSetup('admin', scope));
  const session = new OnboardingSession({ flow: user, submit: ack });
  assert.equal(session.snapshot().complete, false); assert.equal(Object.hasOwn(session.snapshot(), 'authorized'), false);
});
test('O02 duplicate IDs, unknown fields, unsafe keys and invalid scopes cannot enter a flow', () => {
  const flow = initialSetup('user', scope);
  for (const bad of [{ ...flow, steps: [...flow.steps, flow.steps[0]] }, { ...flow, authority: true }, { ...flow, scope: { ...scope, actorId: '' } }]) assert.throws(() => validateFlow(bad));
  const duplicate = structuredClone(flow); duplicate.steps[0].fields.push(duplicate.steps[0].fields[0]); assert.throws(() => validateFlow(duplicate));
  assert.throws(() => validateFlow(JSON.parse('{"id":"x","version":"1","scope":{"actorId":"a","workspaceId":"w"},"steps":[],"__proto__":{}}')));
});
test('O03 invalid raw draft values survive until validation; no handler call and no advance', async () => {
  const flow = initialSetup('company', scope); let calls = 0;
  const session = new OnboardingSession({ flow, submit: request => { calls++; return ack(request); } });
  session.setDraft({ name: '', website: 'http://not-https.example' });
  await assert.rejects(session.save({ name: '', website: 'http://not-https.example' }), /required/);
  assert.deepEqual(session.snapshot().values, { name: '', website: 'http://not-https.example' });
  await assert.rejects(session.save({ name: 'Authored company', website: 'http://not-https.example' }), /HTTPS/);
  assert.equal(calls, 0); assert.equal(session.snapshot().index, 0); assert.equal(session.snapshot().busy, false);
});
test('O04 requests bind actor, workspace, version, step and exact values with a stable retry key', async () => {
  const flow = initialSetup('user', scope), request = await stepRequest(flow, 'profile', { name: 'Authored person' });
  assert.equal((await stepRequest(flow, 'profile', { name: 'Authored person' })).requestId, request.requestId);
  for (const changed of [{ ...flow, version: '2' }, { ...flow, scope: { ...scope, actorId: 'another-actor' } }, { ...flow, scope: { ...scope, workspaceId: 'another-workspace' } }]) assert.notEqual((await stepRequest(changed, 'profile', { name: 'Authored person' })).requestId, request.requestId);
  assert.notEqual((await stepRequest(flow, 'profile', { name: 'Other text' })).requestId, request.requestId);
});
test('O05 required steps cannot be skipped or bypassed; only matching acknowledgements advance', async () => {
  const flow = initialSetup('user', scope), response = deferred(); let request;
  const session = new OnboardingSession({ flow, submit: value => { request = value; return response.promise; } });
  assert.throws(() => session.skip()); assert.throws(() => session.select('purpose'));
  const pending = session.save({ name: 'Authored person' }); while (!request) await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.snapshot().completed.length, 0); assert.throws(() => session.select('profile'), /Wait/);
  response.resolve(ack(request)); assert.equal((await pending).applied, true);
  assert.deepEqual(session.snapshot().completed, ['profile']); session.skip(); assert.equal(session.snapshot().complete, true); assert.deepEqual(session.snapshot().skipped, ['purpose']);
});
test('O06 rejected/mismatched/failed acknowledgements preserve the draft for a same-content retry', async () => {
  const flow = initialSetup('user', scope), requests = []; let good = false;
  const session = new OnboardingSession({ flow, submit: request => { requests.push(request); return good ? ack(request) : { ...ack(request), stepId: 'other' }; } });
  await assert.rejects(session.save({ name: 'Keep this draft' }), /exact step/);
  assert.equal(session.snapshot().values.name, 'Keep this draft'); assert.equal(session.snapshot().index, 0);
  good = true; await session.save({ name: 'Keep this draft' }); assert.equal(requests[0].requestId, requests[1].requestId);
});
test('O07 an acknowledged write remains recorded after cancellation without advancing the view', async () => {
  const response = deferred(); let request;
  const session = new OnboardingSession({ flow: initialSetup('user', scope), submit: value => { request = value; return response.promise; } });
  const pending = session.save({ name: 'Authored person' }); while (!request) await new Promise(resolve => setImmediate(resolve));
  session.cancel(); response.resolve(ack(request)); const result = await pending;
  assert.equal(result.applied, false); assert.equal(result.acknowledgement.status, 'saved'); assert.equal(session.snapshot().index, 0);
  assert.equal(session.snapshot().receipts.length, 1); assert.equal(session.snapshot().completed.length, 0);
});
test('O08 disposing an old scope cannot mutate a new session; returned snapshots cannot mutate state', async () => {
  const response = deferred(); let request;
  const old = new OnboardingSession({ flow: initialSetup('user', scope), submit: value => { request = value; return response.promise; } });
  const pending = old.save({ name: 'First actor' }); while (!request) await new Promise(resolve => setImmediate(resolve)); old.dispose();
  const current = new OnboardingSession({ flow: initialSetup('user', { ...scope, actorId: 'next-actor' }), submit: ack });
  response.resolve(ack(request)); assert.equal((await pending).applied, false); assert.equal(current.snapshot().receipts.length, 0);
  const copy = current.definition; copy.scope.actorId = 'forged'; assert.equal(current.definition.scope.actorId, 'next-actor');
});
test('O09 editing a saved answer removes its completion until acknowledged again', async () => {
  const session = new OnboardingSession({ flow: initialSetup('user', scope), submit: ack });
  await session.save({ name: 'First value' }); session.select('profile'); session.setDraft({ name: '' });
  assert.deepEqual(session.snapshot().completed, []); assert.equal(session.snapshot().values.name, '');
  await assert.rejects(session.save({ name: '' })); assert.equal(session.snapshot().complete, false);
});
test('O10 quickstart actions can complete independently, with optional skip counted once', async () => {
  const flow = { id: 'quickstart', version: '1', scope, sequential: false, steps: [{ id: 'one', title: 'First action', fields: [] }, { id: 'two', title: 'Optional action', optional: true, fields: [] }] };
  const session = new OnboardingSession({ flow, submit: ack }); session.select('two'); await session.save({});
  session.select('two'); session.skip(); assert.deepEqual(session.snapshot().completed, []); assert.deepEqual(session.snapshot().skipped, ['two']);
  session.select('one'); await session.save({}); assert.equal(session.snapshot().complete, true);
});
test('O11 strict checkbox/select/email/URL validation does not coerce unknown or null data', () => {
  const step = { fields: [{ id: 'agree', label: 'Agreement', type: 'checkbox', required: true }, { id: 'choice', label: 'Choice', type: 'select', options: [{ value: 'one', label: 'One' }] }, { id: 'email', label: 'Email', type: 'email' }] };
  assert.deepEqual(validateStepValues(step, { agree: true, choice: 'one', email: 'test@example.test' }), { agree: true, choice: 'one', email: 'test@example.test' });
  for (const values of [{ agree: 'yes' }, { agree: false }, { agree: true, choice: 'made-up' }, { agree: true, email: 'bad' }, { agree: null }, { agree: true, extra: 'value' }]) assert.throws(() => validateStepValues(step, values));
});
test('O12 tour card stays within desktop, 390 and 320 viewports at every edge', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 650 }, { width: 320, height: 480 }]) {
    for (const rect of [{ x: 0, y: 0, width: 40, height: 44 }, { x: viewport.width - 40, y: viewport.height - 44, width: 40, height: 44 }, { x: 50, y: -20, width: 150, height: 70 }]) {
      const layout = tourPosition(rect, viewport, { width: 360, height: 220 });
      assert.ok(layout.x >= 16 && layout.x + layout.width <= viewport.width - 16);
      assert.ok(layout.y >= 16 && layout.y + Math.min(220, layout.maxHeight) <= viewport.height - 16);
      assert.ok(layout.highlight.width >= 0 && layout.highlight.height >= 0);
    }
  }
  assert.equal(tourPosition({ x: 100, y: 500, width: 50, height: 44 }, { width: 390, height: 650 }).placement, 'top');
  assert.throws(() => tourPosition({ x: NaN, y: 0, width: 1, height: 1 }, { width: 320, height: 600 }));
});
