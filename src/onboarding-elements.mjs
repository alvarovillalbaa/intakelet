import { OnboardingSession, validateFlow, tourPosition } from './onboarding.mjs';
import { exact, label, workspace, requireValue, canonical } from './values.mjs';
export { OnboardingSession, validateFlow, tourPosition };
export { initialSetup, validateStepValues, stepRequest } from './onboarding.mjs';

const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function button(text, action, className = 'il-button') { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; }

export function defineOnboarding(registry = globalThis.customElements) {
  requireValue(registry && typeof HTMLElement !== 'undefined', 'browser', 'Register onboarding elements in a browser effect');
  class FlowElement extends HTMLElement {
    #mode; #model; #config; #identity; #epoch = 0; #abort; #completionSent = false; #message = ''; #error = false; #uid = 'il-flow-' + crypto.randomUUID();
    constructor(mode = 'setup') { super(); this.#mode = mode; }
    connectedCallback() { this.#render(); }
    disconnectedCallback() { this.#epoch++; this.#abort?.abort(); this.#model?.cancel(); }
    configure(config) {
      exact(config, ['flow', 'submit']); requireValue(typeof config.submit === 'function', 'host', 'Provide an application step handler');
      const flow = validateFlow({ ...config.flow, sequential: this.#mode === 'setup' });
      if (this.#mode === 'quickstart') requireValue(flow.steps.every(step => step.fields.length === 0), 'flow', 'Quickstart actions have no form fields; use setup for input');
      const identity = canonical(flow); this.#config = config;
      if (identity === this.#identity) return;
      if (identity !== this.#identity) {
        this.#epoch++; this.#abort?.abort(); this.#model?.dispose(); this.#identity = identity;
        this.#model = new OnboardingSession({ flow, submit: (request, options) => this.#config.submit(request, options) }); this.#completionSent = false; this.#message = ''; this.#error = false;
      }
      this.#render();
    }
    get progress() { return this.#model?.snapshot() ?? null; }
    #reportCompletion() {
      const progress = this.#model.snapshot();
      if (!progress.complete) { this.#completionSent = false; return; }
      if (this.#completionSent) return; this.#completionSent = true;
      this.dispatchEvent(new CustomEvent('intakelet-onboarding-complete', { detail: { flowId: this.#model.definition.id, scope: this.#model.definition.scope, progress }, bubbles: true, composed: true }));
    }
    #skip() { this.#model.skip(); this.#reportCompletion(); this.#render(true); }
    async #save(values) {
      const epoch = this.#epoch, model = this.#model; this.#abort = new AbortController(); this.#message = ''; this.#error = false;
      try {
        const pending = model.save(values, { signal: this.#abort.signal }); if (!model.snapshot().complete) this.#completionSent = false; this.#render(); const result = await pending;
        if (result.acknowledgement) this.dispatchEvent(new CustomEvent('intakelet-onboarding-acknowledged', { detail: { ...result.acknowledgement, flowId: result.request.flowId, flowVersion: result.request.flowVersion, scope: result.request.scope, appliedToView: result.applied }, bubbles: true, composed: true }));
        if (epoch !== this.#epoch || model !== this.#model) return;
        if (result.applied) {
          this.#message = 'Your application acknowledged this step.';
          this.#reportCompletion();
        }
      } catch (error) { if (epoch === this.#epoch && model === this.#model) { this.#message = error.message + ' Your draft is still here.'; this.#error = true; } }
      finally { if (epoch === this.#epoch && model === this.#model) this.#render(true); }
    }
    #cancel() {
      this.#epoch++; this.#abort?.abort(); this.#model.cancel(); this.#message = 'Cancellation requested. A write already acknowledged by your application is not rolled back.'; this.#error = false; this.#render();
    }
    #render(focus = false) {
      const root = element('section', undefined, 'il-onboarding il-card');
      if (!this.#model) { root.append(element('h2', 'Connect your onboarding'), element('p', 'Configure a flow and an application handler. Nothing is saved by this component on its own.', 'il-muted')); this.replaceChildren(root); return; }
      const flow = this.#model.definition, state = this.#model.snapshot(), done = state.completed.length + state.skipped.length;
      const heading = element('h2', flow.title || (this.#mode === 'setup' ? 'A good place to start' : 'Your quickstart')); heading.tabIndex = -1; root.append(heading);
      if (flow.description) root.append(element('p', flow.description, 'il-muted'));
      const progress = element('progress'); progress.max = flow.steps.length; progress.value = done; progress.setAttribute('aria-label', 'Onboarding steps acknowledged or intentionally skipped');
      const progressLabel = element('p', `${done} of ${flow.steps.length} steps · ${state.skipped.length} skipped`, 'il-muted'); root.append(progressLabel, progress);
      if (this.#mode === 'quickstart') {
        const list = element('ol', undefined, 'il-quickstart-list');
        for (const step of flow.steps) {
          const row = element('li', undefined, 'il-quickstart-step'), completed = state.completed.includes(step.id), skipped = state.skipped.includes(step.id), copy = element('div');
          copy.append(element('h3', step.title)); if (step.description) copy.append(element('p', step.description, 'il-muted'));
          row.append(element('span', completed ? '✓' : skipped ? '—' : String(flow.steps.indexOf(step) + 1), 'il-step-number'), copy);
          const action = button(completed ? 'Acknowledged' : skipped ? 'Revisit' : step.actionLabel || 'Start', () => { this.#model.select(step.id); void this.#save({}); }); action.disabled = state.busy || completed; row.append(action);
          if (step.optional && !completed && !skipped) { const skip = button('Skip', () => { this.#model.select(step.id); this.#skip(); }); skip.disabled = state.busy; row.append(skip); }
          list.append(row);
        }
        root.append(list);
      } else if (state.complete && state.stepId === null) {
        root.append(element('h3', 'Your next step is ready'), element('p', 'Your application acknowledged the completed steps. This guide does not grant permissions or verify an account.', 'il-muted'));
        root.append(button('Review my answers', () => { this.#model.select(flow.steps[0].id); this.#render(true); }));
      } else {
        const step = flow.steps[state.index], form = element('form', undefined, 'il-setup-form');
        root.append(element('h3', step.title)); if (step.description) root.append(element('p', step.description, 'il-muted'));
        const inputs = new Map();
        for (const field of step.fields) {
          const label = element('label', field.label + (field.required ? ' · required' : ' · optional'));
          const input = element(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input');
          input.id = `${this.#uid}-${step.id}-${field.id}`; label.htmlFor = input.id;
          if (field.type === 'select') {
            const empty = element('option', 'Choose an option'); empty.value = ''; input.append(empty);
            for (const option of field.options) { const node = element('option', option.label); node.value = option.value; input.append(node); }
          } else if (input.tagName.toLowerCase() === 'input') input.type = field.type;
          input.required = Boolean(field.required); input.disabled = state.busy;
          if (field.type === 'checkbox') input.checked = state.values[field.id] ?? false;
          else { input.value = state.values[field.id] ?? ''; input.maxLength = field.maxLength ?? 200; }
          inputs.set(field.id, input); label.append(input);
          if (field.hint) { const hint = element('span', field.hint, 'il-field-hint'); hint.id = input.id + '-help'; input.setAttribute('aria-describedby', hint.id); label.append(hint); }
          form.append(label);
        }
        const values = () => Object.fromEntries([...inputs].map(([id, input]) => [id, input.type === 'checkbox' ? input.checked : input.value]));
        const draft = () => { try { this.#model.setDraft(values()); const state = this.#model.snapshot(), done = state.completed.length + state.skipped.length; if (!state.complete) this.#completionSent = false; progress.value = done; progressLabel.textContent = `${done} of ${flow.steps.length} steps · ${state.skipped.length} skipped`; } catch (error) { this.#message = error.message; } };
        form.addEventListener('input', draft); form.addEventListener('change', draft);
        const actions = element('div', undefined, 'il-actions');
        if (state.index > 0) { const back = button('Back', () => { this.#model.setDraft(values()); this.#model.select(flow.steps[state.index - 1].id); this.#render(true); }); back.disabled = state.busy; actions.append(back); }
        if (step.optional) { const skip = button('Skip this step', () => this.#skip()); skip.disabled = state.busy; actions.append(skip); }
        const save = button(state.busy ? 'Waiting for your application…' : step.actionLabel || 'Save and continue', () => {}, 'il-button il-primary'); save.type = 'submit'; save.disabled = state.busy; actions.append(save); form.append(actions);
        form.addEventListener('submit', event => { event.preventDefault(); void this.#save(values()); }); root.append(form);
      }
      if (state.busy) root.append(button('Cancel waiting', () => this.#cancel()));
      const message = element('p', this.#message, 'il-status' + (this.#error ? ' il-error' : '')); message.setAttribute('role', 'status'); message.tabIndex = -1; root.append(message);
      root.append(element('p', 'Progress stays in this component unless your application stores it. It is separate from account access.', 'il-muted il-small')); this.replaceChildren(root);
      if (focus) (this.#error ? message : this.querySelector('input,textarea,select') || heading).focus();
    }
  }
  class SetupElement extends FlowElement { constructor() { super('setup'); } }
  class QuickstartElement extends FlowElement { constructor() { super('quickstart'); } }

  class TourElement extends HTMLElement {
    #config; #index = 0; #epoch = 0; #abort; #overlay; #target; #cleanups = []; #returnFocus; #open = false; #uid = 'il-tour-' + crypto.randomUUID();
    configure(config) {
      exact(config, ['steps'], ['prepare', 'onComplete', 'onClose']);
      requireValue(Array.isArray(config.steps) && config.steps.length > 0 && config.steps.length <= 40, 'tour', 'Provide 1–40 tour steps'); const ids = new Set();
      for (const step of config.steps) { exact(step, ['id', 'title', 'description', 'target'], ['placement']); workspace(step.id); label(step.title, 200); label(step.description, 1000); label(step.target, 500); requireValue(!ids.has(step.id) && (step.placement === undefined || ['top', 'bottom'].includes(step.placement)), 'tour', 'Use unique steps and top/bottom placement'); ids.add(step.id); }
      for (const key of ['prepare', 'onComplete', 'onClose']) requireValue(config[key] === undefined || typeof config[key] === 'function', 'tour', 'Tour handlers must be functions');
      this.close('reconfigured'); this.#config = { ...config, steps: structuredClone(config.steps) };
    }
    disconnectedCallback() { this.close('disconnected'); }
    get currentStep() { return this.#open ? this.#config.steps[this.#index].id : null; }
    start(stepId) { requireValue(this.#config, 'tour', 'Configure the tour first'); const index = stepId === undefined ? 0 : this.#config.steps.findIndex(step => step.id === stepId); requireValue(index >= 0, 'tour', 'Unknown tour step'); if (!this.#open) this.#returnFocus = document.activeElement; this.#open = true; this.#index = index; return this.#show(); }
    close(reason = 'closed') {
      const wasOpen = this.#open; this.#open = false; this.#epoch++; this.#abort?.abort(); this.#teardown();
      if (wasOpen) { if (this.#returnFocus?.isConnected) this.#returnFocus.focus(); this.#config?.onClose?.({ reason, stepId: this.#config.steps[this.#index].id }); }
    }
    #teardown() { for (const cleanup of this.#cleanups.splice(0)) cleanup(); this.#overlay?.remove(); this.#overlay = this.#target = null; }
    async #show() {
      const epoch = ++this.#epoch; this.#abort?.abort(); this.#abort = new AbortController(); this.#teardown();
      const step = this.#config.steps[this.#index], overlay = element('div', undefined, 'il-tour-overlay'), card = element('section', undefined, 'il-tour-card'); this.#overlay = overlay;
      card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false'); card.setAttribute('aria-labelledby', this.#uid + '-title'); card.setAttribute('aria-describedby', this.#uid + '-description'); card.tabIndex = -1;
      const heading = element('h2', step.title); heading.id = this.#uid + '-title'; const description = element('p', step.description); description.id = this.#uid + '-description';
      const status = element('p', 'Preparing this part of the page…', 'il-status'); status.setAttribute('role', 'status');
      const next = button(this.#index === this.#config.steps.length - 1 ? 'Finish tour' : 'Next', () => {
        if (this.#index === this.#config.steps.length - 1) { const complete = this.#config.onComplete; this.close('completed'); complete?.(); }
        else { this.#index++; void this.#show(); }
      }, 'il-button il-primary'); next.disabled = true;
      const actions = element('div', undefined, 'il-actions');
      if (this.#index > 0) actions.append(button('Back', () => { this.#index--; void this.#show(); }));
      const retry = button('Retry this step', () => void this.#show());
      actions.append(retry, button('Close tour', () => this.close()), next);
      card.append(element('p', `Step ${this.#index + 1} of ${this.#config.steps.length}`, 'il-muted'), heading, description, status, actions); overlay.append(card); document.body.append(overlay); card.focus();
      const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); } }; document.addEventListener('keydown', key, true); this.#cleanups.push(() => document.removeEventListener('keydown', key, true));
      try {
        if (this.#config.prepare) {
          const prepare = this.#config.prepare, controller = this.#abort, signal = controller.signal;
          await new Promise((resolve, reject) => {
            let timer; const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
            const cancel = () => { cleanup(); reject(new Error('Tour preparation cancelled')); };
            signal.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => { cleanup(); controller.abort(); reject(new Error('Preparing this part of the page timed out.')); }, 5000);
            Promise.resolve().then(() => { requireValue(!signal.aborted, 'aborted', 'Tour preparation cancelled'); return prepare(structuredClone(step), { signal }); }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
          });
        }
        if (epoch !== this.#epoch || !this.#open) return;
        const find = () => { const target = document.querySelector(step.target); if (!target?.isConnected) return null; const rect = target.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(target).visibility !== 'hidden' ? target : null; };
        let target = find();
        if (!target) target = await new Promise((resolve, reject) => {
          const signal = this.#abort.signal; let timer; const cleanup = () => { observer.disconnect(); clearTimeout(timer); signal.removeEventListener('abort', cancel); };
          const cancel = () => { cleanup(); reject(new Error('Tour cancelled')); };
          const observer = new MutationObserver(() => { const found = find(); if (found) { cleanup(); resolve(found); } });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true }); signal.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => { cleanup(); reject(new Error('This part of the page is not visible yet.')); }, 2500);
          // Cover insertion between the first lookup and observer registration.
          const found = find(); if (found) { cleanup(); resolve(found); }
        });
        if (epoch !== this.#epoch || !this.#open) return;
        this.#target = target; target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        const modal = target.closest('dialog[open]'); if (modal) modal.append(overlay);
        const highlight = element('div', undefined, 'il-tour-highlight'); highlight.setAttribute('aria-hidden', 'true'); overlay.prepend(highlight);
        const position = () => {
          const rect = target.getBoundingClientRect();
          if (!target.isConnected || rect.width <= 0 || rect.height <= 0 || getComputedStyle(target).visibility === 'hidden') { if (overlay.parentElement?.tagName === 'DIALOG' && !overlay.parentElement.open) document.body.append(overlay); highlight.hidden = true; next.disabled = true; retry.hidden = false; status.textContent = 'The target is no longer visible. Reopen it or retry this step.'; return; }
          const box = card.getBoundingClientRect(), viewport = window.visualViewport, offsetX = viewport?.offsetLeft || 0, offsetY = viewport?.offsetTop || 0;
          const layout = tourPosition({ x: rect.left - offsetX, y: rect.top - offsetY, width: rect.width, height: rect.height }, { width: viewport?.width || innerWidth, height: viewport?.height || innerHeight }, { width: box.width || 360, height: box.height || 220 }, step.placement);
          Object.assign(card.style, { left: layout.x + offsetX + 'px', top: layout.y + offsetY + 'px', width: layout.width + 'px', maxHeight: layout.maxHeight + 'px' });
          Object.assign(highlight.style, { left: layout.highlight.x + offsetX + 'px', top: layout.highlight.y + offsetY + 'px', width: layout.highlight.width + 'px', height: layout.highlight.height + 'px' });
          highlight.hidden = layout.highlight.width <= 0 || layout.highlight.height <= 0; next.disabled = highlight.hidden; retry.hidden = false; status.textContent = highlight.hidden ? 'Scroll the target into view to continue.' : 'This guide only points to the page. Your application still controls every action.';
        };
        let frame;
        const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
        window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
        const observer = new MutationObserver(records => { if (records.some(record => !overlay.contains(record.target))) update(); }); observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update); resize?.observe(target); resize?.observe(card);
        window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update);
        this.#cleanups.push(() => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); observer.disconnect(); resize?.disconnect(); });
        position();
      } catch (error) {
        if (epoch !== this.#epoch || !this.#open) return; status.textContent = error.message; status.classList.add('il-error');
        retry.hidden = false;
      }
    }
  }
  for (const [name, constructor] of [['intakelet-setup', SetupElement], ['intakelet-quickstart', QuickstartElement], ['intakelet-tour', TourElement]]) if (!registry.get(name)) registry.define(name, constructor);
  return { Setup: registry.get('intakelet-setup'), Quickstart: registry.get('intakelet-quickstart'), Tour: registry.get('intakelet-tour') };
}
