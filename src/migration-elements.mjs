import { validateMigrationSpec, runMigration } from './migration.mjs';
import { exact, canonical, clone, requireValue, IntakeletError } from './values.mjs';

const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
const button = (text, action, primary = false) => { const value = node('button', text, 'il-button' + (primary ? ' il-primary' : '')); value.type = 'button'; value.addEventListener('click', action); return value; };

export function defineMigration(registry = globalThis.customElements) {
  requireValue(registry && typeof HTMLElement !== 'undefined', 'browser', 'Register migration elements in a browser effect');
  if (registry.get('intakelet-migration')) return registry.get('intakelet-migration');
  class MigrationElement extends HTMLElement {
    #config; #identity; #epoch = 0; #controller; #busy = false; #phase = 'idle'; #message = ''; #plan = null; #pending = null; #lastReceipt = null; #result = null;
    connectedCallback() { this.#render(); }
    disconnectedCallback() { this.cancel('disconnected'); }
    configure(config) {
      exact(config, ['spec', 'source', 'host'], ['maxBatches', 'readTimeoutMs', 'reviewTimeoutMs']);
      const spec = validateMigrationSpec(config.spec), identity = canonical(spec);
      requireValue(config.source && typeof config.source.readPage === 'function' && canonical(config.source.identity) === canonical(spec.source), 'source', 'Connect the source declared in this migration');
      requireValue(config.host && ['status', 'claim', 'renew', 'release', 'readRecords', 'commitBatch'].every(method => typeof config.host[method] === 'function'), 'host', 'Provide an application migration host');
      for (const [key, maximum] of [['maxBatches', Number.MAX_SAFE_INTEGER], ['readTimeoutMs', 600000], ['reviewTimeoutMs', 86400000]]) if (config[key] !== undefined) requireValue(Number.isSafeInteger(config[key]) && config[key] > 0 && config[key] <= maximum, 'migration', 'Invalid ' + key);
      if (this.#identity === identity && this.#config.source === config.source && this.#config.host === config.host && ['maxBatches', 'readTimeoutMs', 'reviewTimeoutMs'].every(key => this.#config[key] === config[key])) return;
      this.#controller?.abort(); this.#epoch++; this.#config = { ...config, spec }; this.#identity = identity; this.#busy = false; this.#phase = 'idle'; this.#message = ''; this.#plan = null; this.#pending = null; this.#lastReceipt = null; this.#result = null; this.#render();
    }
    get progress() { return clone({ phase: this.#phase, busy: this.#busy, connectionId: this.#config?.spec.connectionId ?? null, lastReceipt: this.#lastReceipt, result: this.#result }); }
    get reviewBatch() { return this.#plan ? clone(this.#plan) : null; }
    cancel(reason = 'cancelled') {
      if (!this.#busy) return;
      this.#controller?.abort(); this.#phase = 'paused'; this.#message = `Cancellation requested (${reason}). Acknowledged batches remain committed.`; this.#render();
    }
    async start() {
      requireValue(this.#config && !this.#busy, 'migration', 'Configure a migration and wait for the current run');
      const config = this.#config, epoch = this.#epoch, controller = new AbortController(); this.#controller = controller; this.#busy = true; this.#phase = 'reading'; this.#message = 'Reading the next source page…'; this.#result = null; this.#render();
      try {
        const result = await runMigration({ ...config, maxBatches: config.maxBatches ?? 100, signal: controller.signal,
          review: (plan, { signal }) => this.#review(plan, signal, epoch),
          onReceipt: receipt => {
            const current = epoch === this.#epoch && config === this.#config, appliedToView = current && !controller.signal.aborted;
            if (current) { this.#lastReceipt = clone(receipt); if (appliedToView) { this.#phase = 'reading'; this.#message = 'Your application acknowledged this batch. Reading the next page…'; } this.#render(); }
            this.dispatchEvent(new CustomEvent('intakelet-migration-acknowledged', { detail: { receipt: clone(receipt), appliedToView }, bubbles: true, composed: true }));
          }
        });
        if (epoch === this.#epoch && config === this.#config) { this.#result = result; this.#phase = controller.signal.aborted ? 'paused' : result.status; this.#message = controller.signal.aborted ? 'Stopped after an acknowledged batch.' : `${result.batches} batch(es) acknowledged in this run. ${result.status === 'complete' ? 'This source run is complete.' : 'Continue from the accepted checkpoint when ready.'}`; }
        return result;
      } catch (error) {
        if (epoch === this.#epoch && config === this.#config) { this.#phase = error.code === 'aborted' ? 'paused' : 'error'; this.#message = error.message; }
        throw error;
      } finally { if (epoch === this.#epoch && config === this.#config) { this.#busy = false; this.#plan = null; this.#pending = null; this.#render(true); } }
    }
    #review(plan, signal, epoch) {
      requireValue(epoch === this.#epoch && !signal.aborted, 'aborted', 'The migration view changed');
      return new Promise((resolve, reject) => {
        const pending = { epoch, plan, finish: decision => { cleanup(); resolve(decision); } };
        const cleanup = () => { signal.removeEventListener('abort', cancel); if (this.#pending === pending) { this.#pending = null; this.#plan = null; } };
        const cancel = () => { cleanup(); reject(new IntakeletError('aborted', 'Migration review cancelled')); };
        signal.addEventListener('abort', cancel, { once: true }); this.#pending = pending; this.#plan = plan; this.#phase = 'review'; this.#message = 'Review source data, output changes and exclusions before committing.'; this.#render(true);
      });
    }
    #decide(decision, batchId) {
      const pending = this.#pending; if (!pending || pending.epoch !== this.#epoch || pending.plan.batchId !== batchId) return;
      this.#phase = decision.decision === 'approve' ? 'writing' : 'reading'; this.#message = decision.decision === 'approve' ? 'Waiting for your application to commit this exact batch…' : decision.decision === 'revise' ? 'Rebuilding the proposal for another review…' : 'Stopping before this batch is committed.';
      pending.finish(decision); this.#render();
    }
    #render(focus = false) {
      const root = node('section', undefined, 'il-onboarding il-migration'), title = node('h2', 'Review your migration'); title.tabIndex = -1; root.append(title);
      if (!this.#config) { root.append(node('p', 'Connect a source, output recipe and application host to begin.', 'il-muted')); this.replaceChildren(root); return; }
      const { spec } = this.#config; root.append(node('p', `${spec.source.id} → ${spec.output.id} · ${spec.connectionId}`, 'il-muted'));
      const status = node('p', this.#message || 'Each page needs your review. Your application owns storage and permissions.', 'il-status' + (this.#phase === 'error' ? ' il-error' : '')); status.setAttribute('role', this.#phase === 'error' ? 'alert' : 'status'); root.append(status);
      if (this.#plan) {
        const plan = this.#plan, excluded = new Set(plan.review.excludedIds), counts = ['create', 'update', 'delete', 'unchanged'].map(action => `${plan.rows.filter(row => row.action === action).length} ${action}`).join(' · ');
        root.append(node('p', counts + ` · ${plan.review.excludedIds.length} excluded`, 'il-small'));
        if (plan.issues.length) { const issues = node('ul', undefined, 'il-migration-issues'); for (const issue of plan.issues) issues.append(node('li', `${issue.sourceKey}: ${issue.message}${issue.excluded ? ' (excluded)' : ''}`)); root.append(issues); }
        const details = node('details'), summary = node('summary', 'Inspect the complete source, output and mapping'); details.append(summary, node('pre', JSON.stringify(plan, null, 2))); root.append(details);
        const fieldset = node('fieldset', undefined, 'il-migration-selection'); fieldset.append(node('legend', 'Exclude source rows explicitly'));
        const approve = button('Commit this batch', () => this.#decide({ decision: 'approve', batchId: plan.batchId }, plan.batchId), true), revise = button('Apply exclusions and review again', () => this.#decide({ decision: 'revise', excludedIds: [...excluded] }, plan.batchId));
        const changed = () => canonical([...excluded].sort()) !== canonical([...plan.review.excludedIds].sort());
        const update = () => { approve.disabled = !plan.ready || changed(); revise.disabled = !changed(); };
        for (const item of plan.page.items) {
          const label = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = excluded.has(item.id); check.setAttribute('aria-label', 'Exclude source ' + item.id);
          check.addEventListener('change', () => { if (check.checked) excluded.add(item.id); else excluded.delete(item.id); update(); }); label.append(check, node('span', item.id)); fieldset.append(label);
        }
        root.append(fieldset); update(); const actions = node('div', undefined, 'il-actions'); actions.append(approve, revise, button('Stop before this batch', () => this.#decide({ decision: 'stop' }, plan.batchId))); root.append(actions);
      }
      const epoch = this.#epoch, config = this.#config, controller = this.#controller, actions = node('div', undefined, 'il-actions'), start = button(this.#lastReceipt ? 'Continue / check for updates' : 'Review next batch', () => { if (epoch === this.#epoch && config === this.#config) void this.start().catch(() => {}); }, true); start.disabled = this.#busy; actions.append(start);
      if (this.#busy) actions.append(button('Cancel migration', () => { if (epoch === this.#epoch && controller === this.#controller) this.cancel(); })); root.append(actions);
      if (this.#lastReceipt) { const details = node('details'), receipt = this.#lastReceipt; details.append(node('summary', `Last acknowledged batch · revision ${receipt.revision}`), node('pre', JSON.stringify(receipt, null, 2))); root.append(details); }
      this.replaceChildren(root); if (focus && this.isConnected) title.focus();
    }
  }
  registry.define('intakelet-migration', MigrationElement); return MigrationElement;
}
