import { exact, workspace, label, requireValue, canonical, clone, sha256, aborted } from './values.mjs';

const FIELD_TYPES = ['text', 'email', 'url', 'textarea', 'select', 'checkbox'];
export function validateFlow(input) {
  exact(input, ['id', 'version', 'scope', 'steps'], ['title', 'description', 'sequential']);
  workspace(input.id); label(input.version, 80); exact(input.scope, ['actorId', 'workspaceId']);
  workspace(input.scope.actorId); workspace(input.scope.workspaceId);
  if (input.title !== undefined) label(input.title, 200);
  if (input.description !== undefined) label(input.description, 1000);
  requireValue(input.sequential === undefined || typeof input.sequential === 'boolean', 'flow', 'Sequential must be boolean');
  requireValue(Array.isArray(input.steps) && input.steps.length > 0 && input.steps.length <= 40, 'flow', 'Provide 1–40 onboarding steps');
  const ids = new Set();
  for (const step of input.steps) {
    exact(step, ['id', 'title', 'fields'], ['description', 'optional', 'actionLabel']);
    workspace(step.id); label(step.title, 200); requireValue(!ids.has(step.id), 'flow', 'Step IDs must be unique'); ids.add(step.id);
    if (step.description !== undefined) label(step.description, 1000);
    if (step.actionLabel !== undefined) label(step.actionLabel, 100);
    requireValue(step.optional === undefined || typeof step.optional === 'boolean', 'flow', 'Optional must be boolean');
    requireValue(Array.isArray(step.fields) && step.fields.length <= 20, 'flow', 'A step supports at most 20 fields');
    const fields = new Set();
    for (const field of step.fields) {
      exact(field, ['id', 'label', 'type'], ['required', 'maxLength', 'options', 'hint']);
      workspace(field.id); label(field.label, 200); requireValue(!fields.has(field.id) && FIELD_TYPES.includes(field.type), 'field', 'Use unique supported field definitions'); fields.add(field.id);
      if (field.hint !== undefined) label(field.hint, 500);
      requireValue(field.required === undefined || typeof field.required === 'boolean', 'field', 'Required must be boolean');
      requireValue(field.maxLength === undefined || Number.isInteger(field.maxLength) && field.maxLength > 0 && field.maxLength <= 2000, 'field', 'Field length must be 1–2000');
      if (field.type === 'select') {
        requireValue(Array.isArray(field.options) && field.options.length > 0 && field.options.length <= 50, 'field', 'Select fields need 1–50 options');
        const values = new Set();
        for (const option of field.options) { exact(option, ['value', 'label']); label(option.value, 200); label(option.label, 200); requireValue(!values.has(option.value), 'field', 'Select values must be unique'); values.add(option.value); }
      } else requireValue(field.options === undefined, 'field', 'Options belong to select fields');
    }
  }
  canonical(input); return clone({ ...input, sequential: input.sequential ?? true });
}

export function validateStepValues(step, values, { draft = false } = {}) {
  exact(values, [], step.fields.map(field => field.id));
  canonical(values);
  const result = {};
  for (const field of step.fields) {
    const value = Object.hasOwn(values, field.id) ? values[field.id] : (field.type === 'checkbox' ? false : '');
    if (field.type === 'checkbox') requireValue(typeof value === 'boolean', 'field', `${field.label}: choose a checkbox value`);
    else { requireValue(typeof value === 'string' && value.length <= (field.maxLength ?? 200), 'field', `${field.label}: text is too long or invalid`); canonical(value); }
    if (!draft) {
      requireValue(!field.required || (field.type === 'checkbox' ? value : value.trim().length > 0), 'field', `${field.label} is required`);
      if (value && field.type === 'email') requireValue(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value), 'field', `${field.label}: enter a valid email`);
      if (value && field.type === 'url') { let url; try { url = new URL(value); } catch {} requireValue(url?.protocol === 'https:' && !url.username && !url.password, 'field', `${field.label}: use an HTTPS URL without credentials`); }
      if (value && field.type === 'select') requireValue(field.options.some(option => option.value === value), 'field', `${field.label}: choose a listed option`);
    }
    result[field.id] = value;
  }
  return result;
}

export async function stepRequest(flow, stepId, values) {
  const definition = validateFlow(flow), step = definition.steps.find(item => item.id === stepId);
  requireValue(step, 'step', 'Unknown onboarding step');
  const body = { schema: 'intakelet.onboarding-step', version: 1, flowId: definition.id, flowVersion: definition.version, scope: definition.scope, stepId, values: validateStepValues(step, values) };
  return { ...body, requestId: 'sha256:' + await sha256(canonical(body)) };
}
function acknowledgement(value, request) {
  exact(value, ['requestId', 'stepId', 'status', 'receiptId']); label(value.receiptId, 200);
  requireValue(value.requestId === request.requestId && value.stepId === request.stepId && value.status === 'saved', 'acknowledgement', 'The application did not acknowledge this exact step');
  return clone(value);
}

export class OnboardingSession {
  #flow; #submit; #index = 0; #drafts = {}; #saved = new Map(); #skipped = new Set(); #operation = 0; #busy = false; #active = true; #receipts = [];
  constructor({ flow, submit }) { this.#flow = validateFlow(flow); requireValue(typeof submit === 'function', 'host', 'Provide the application step handler'); this.#submit = submit; }
  get definition() { return clone(this.#flow); }
  snapshot() {
    const step = this.#flow.steps[this.#index] ?? null;
    return clone({ index: this.#index, stepId: step?.id ?? null, busy: this.#busy, complete: this.#flow.steps.every(item => this.#saved.has(item.id) || this.#skipped.has(item.id)), completed: [...this.#saved.keys()], skipped: [...this.#skipped], values: step ? this.#drafts[step.id] ?? {} : {}, receipts: this.#receipts });
  }
  setDraft(values) {
    requireValue(this.#active && !this.#busy, 'busy', 'Wait for the current step');
    const step = this.#flow.steps[this.#index]; requireValue(step, 'step', 'No active onboarding step');
    const normalized = validateStepValues(step, values, { draft: true }); this.#drafts[step.id] = normalized;
    if (this.#saved.has(step.id) && canonical(this.#saved.get(step.id)) !== canonical(normalized)) this.#saved.delete(step.id);
    this.#skipped.delete(step.id);
  }
  select(stepId) {
    requireValue(this.#active && !this.#busy, 'busy', 'Wait for the current step');
    const index = this.#flow.steps.findIndex(step => step.id === stepId); requireValue(index >= 0, 'step', 'Unknown onboarding step');
    const firstPending = this.#flow.steps.findIndex(step => !this.#saved.has(step.id) && !this.#skipped.has(step.id));
    requireValue(!this.#flow.sequential || firstPending < 0 || index <= firstPending, 'step', 'Finish the preceding required steps first'); this.#index = index;
  }
  #advance() {
    const next = this.#flow.steps.findIndex(step => !this.#saved.has(step.id) && !this.#skipped.has(step.id)); this.#index = next < 0 ? this.#flow.steps.length : next;
  }
  skip() {
    requireValue(this.#active && !this.#busy, 'busy', 'Wait for the current step'); const step = this.#flow.steps[this.#index];
    requireValue(step?.optional === true, 'step', 'This step cannot be skipped'); this.#saved.delete(step.id); this.#skipped.add(step.id); this.#advance();
  }
  cancel() { this.#operation++; this.#busy = false; }
  dispose() { this.cancel(); this.#active = false; }
  async save(values, { signal } = {}) {
    requireValue(this.#active && !this.#busy, 'busy', 'Wait for the current step'); aborted(signal);
    this.setDraft(values); const stepId = this.#flow.steps[this.#index].id, operation = ++this.#operation; this.#busy = true;
    try {
      const request = await stepRequest(this.#flow, stepId, values); aborted(signal);
      if (!this.#active || operation !== this.#operation) return { applied: false, acknowledgement: null, request };
      const ack = acknowledgement(await this.#submit(clone(request), { signal }), request);
      // An acknowledged application write remains real after UI cancellation.
      this.#receipts.push({ requestId: request.requestId, stepId, receiptId: ack.receiptId }); this.#receipts = this.#receipts.slice(-80);
      const applied = this.#active && operation === this.#operation;
      if (applied) { this.#saved.set(stepId, clone(request.values)); this.#skipped.delete(stepId); this.#advance(); }
      return { applied, acknowledgement: ack, request };
    } finally { if (operation === this.#operation) this.#busy = false; }
  }
}

export function initialSetup(audience, scope) {
  requireValue(['user', 'company'].includes(audience), 'flow', 'Choose user or company setup');
  const steps = audience === 'user' ? [
    { id: 'profile', title: 'Make this space yours', description: 'Your application decides where these details are saved.', fields: [{ id: 'name', label: 'What should we call you?', type: 'text', required: true, maxLength: 120 }] },
    { id: 'purpose', title: 'What would you like to do first?', optional: true, fields: [{ id: 'goal', label: 'Your first goal', type: 'textarea', maxLength: 1000 }] },
  ] : [
    { id: 'company', title: 'Set up your team’s space', description: 'These details do not verify domain ownership or grant workspace access.', fields: [{ id: 'name', label: 'Company name', type: 'text', required: true, maxLength: 200 }, { id: 'website', label: 'Company website', type: 'url', maxLength: 1000 }] },
    { id: 'preferences', title: 'How will your team work?', optional: true, fields: [{ id: 'timezone', label: 'Preferred time zone', type: 'text', maxLength: 100 }, { id: 'goal', label: 'Your team’s first goal', type: 'textarea', maxLength: 1000 }] },
  ];
  return validateFlow({ id: `initial-${audience}`, version: '1', scope, title: audience === 'user' ? 'A good place to start' : 'Welcome to your workspace', steps });
}

export function tourPosition(rect, viewport, card = { width: 360, height: 220 }, preferred = 'bottom') {
  for (const value of [rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height, card.width, card.height]) requireValue(Number.isFinite(value), 'position', 'Expected finite geometry');
  requireValue(rect.width > 0 && rect.height > 0 && viewport.width > 32 && viewport.height > 32 && card.width > 0 && card.height > 0 && ['top', 'bottom'].includes(preferred), 'position', 'Invalid tour geometry');
  const width = Math.min(card.width, viewport.width - 32), height = Math.min(card.height, viewport.height - 32);
  const clamp = (value, max) => Math.max(16, Math.min(value, max - 16));
  const below = rect.y + rect.height + 14, above = rect.y - height - 14;
  const placement = preferred === 'bottom' ? below + height <= viewport.height - 16 || above < 16 ? 'bottom' : 'top' : above >= 16 || below + height > viewport.height - 16 ? 'top' : 'bottom';
  const left = Math.max(0, rect.x - 5), top = Math.max(0, rect.y - 5);
  return { x: clamp(rect.x + rect.width / 2 - width / 2, viewport.width - width), y: clamp(placement === 'bottom' ? below : above, viewport.height - height), width, maxHeight: viewport.height - 32, placement,
    highlight: { x: left, y: top, width: Math.max(0, Math.min(viewport.width, rect.x + rect.width + 5) - left), height: Math.max(0, Math.min(viewport.height, rect.y + rect.height + 5) - top) } };
}
