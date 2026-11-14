import { analyzeFiles, createPlan, searchKnowledge, validateSnapshot, LIMITS } from './index.mjs';
import { exact, workspace, requireValue, clone, aborted } from './values.mjs';
export { createIndexedDBHost } from './indexeddb.mjs';
export { researchSameOrigin } from './browser-research.mjs';
const tagName = 'intakelet-onboarding';
function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function button(text, handler, className = 'il-button') { const n = el('button', text, className); n.type = 'button'; n.addEventListener('click', handler); return n; }
function download(value, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' })), a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function defineIntakelet(registry = globalThis.customElements) {
  requireValue(registry && typeof HTMLElement !== 'undefined', 'browser', 'Define the element in a browser effect');
  if (registry.get(tagName)) return registry.get(tagName);
  class IntakeletElement extends HTMLElement {
    #config; #epoch = 0; #contextEpoch = 0; #planEpoch = 0; #readEpoch = 0; #loading = false; #uid = 'intakelet-' + crypto.randomUUID(); #abort; #inputs = []; #draft; #plan; #review = { mappings: {}, excludedRows: [], skipInvalid: false }; #snapshot; #report; #busy = ''; #message = ''; #error = false; #query = ''; #url = ''; #page = new Map(); #receipt;
    #id(role) { return this.#uid + '-' + role; }
    connectedCallback() { if (this.#config) void this.refresh(); else this.#render(); }
    disconnectedCallback() { this.#epoch++; this.#contextEpoch++; this.#planEpoch++; this.#abort?.abort(); this.#busy = ''; this.#loading = false; }
    configure(config) {
      exact(config, ['workspaceId', 'host'], ['research']); workspace(config.workspaceId);
      requireValue(config.host && typeof config.host.snapshot === 'function' && typeof config.host.commit === 'function' && (config.research === undefined || typeof config.research === 'function'), 'host', 'Provide a host snapshot/commit interface and optional research callback');
      if (this.#config?.workspaceId === config.workspaceId && this.#config.host === config.host && this.#config.research === config.research) return;
      if (this.#config?.workspaceId === config.workspaceId && this.#config.host === config.host) {
        this.#config = config;
        if (this.#busy === 'Researching public pages') { this.#epoch++; this.#abort?.abort(); this.#busy = ''; this.#message = 'Research connection changed. The previous review is preserved.'; this.#error = false; }
        this.#render(); return;
      }
      this.#epoch++; this.#contextEpoch++; this.#planEpoch++; this.#abort?.abort(); this.#config = config; this.#inputs = []; this.#draft = this.#plan = this.#snapshot = this.#report = this.#receipt = null; this.#query = ''; this.#url = ''; this.#review = { mappings: {}, excludedRows: [], skipInvalid: false }; this.#page.clear(); this.#message = ''; this.#error = false;
      this.#busy = ''; void this.refresh();
    }
    async refresh() {
      if (!this.#config || this.#busy === 'Importing reviewed plan') return; const contextEpoch = this.#contextEpoch, readEpoch = ++this.#readEpoch, config = this.#config; this.#loading = true; this.#render();
      try { const state = await validateSnapshot(await config.host.snapshot(), config.workspaceId); if (contextEpoch !== this.#contextEpoch || readEpoch !== this.#readEpoch) return; this.#snapshot = state; if (!this.#draft && !this.#error && !this.#busy) { this.#message = `Workspace ready · revision${state.revision}`; this.#error = false; } }
      catch (error) { if (contextEpoch === this.#contextEpoch && readEpoch === this.#readEpoch) { this.#message = error.message; this.#error = true; } }
      finally { if (contextEpoch === this.#contextEpoch && readEpoch === this.#readEpoch) { this.#loading = false; this.#render(); } }
    }
    get reviewPlan() { return this.#plan ? clone(this.#plan) : null; }
    async addSources(sources) { return this.#analyze([...this.#inputs, ...sources]); }
    async #analyze(sources, epoch = ++this.#epoch) {
      this.#abort?.abort(); this.#busy = 'Classifying sources'; this.#render(); const config = this.#config;
      requireValue(config, 'host', 'Configure the application workspace first');
      try {
        const draft = await analyzeFiles(sources, { workspaceId: config.workspaceId }); if (epoch !== this.#epoch) return;
        this.#inputs = sources; this.#draft = draft; this.#receipt = null; this.#review = { mappings: {}, excludedRows: [], skipInvalid: false }; this.#page.clear(); this.#message = 'Sources classified. Review mappings, rows and source evidence before importing.'; this.#error = false; await this.#calculate(epoch);
      } catch (error) { if (epoch === this.#epoch) { this.#message = error.message + '. Previous review and saved data are preserved.'; this.#error = true; } }
      finally { if (epoch === this.#epoch) { this.#busy = ''; this.#render(); } }
    }
    async #files(files) {
      const epoch = ++this.#epoch; this.#abort?.abort(); this.#busy = 'Reading files'; this.#render();
      try {
        requireValue(files.length > 0 && files.length + this.#inputs.length <= LIMITS.files && files.every(f => f.size <= LIMITS.fileBytes) && files.reduce((n, f) => n + f.size, this.#inputs.reduce((n, f) => n + new TextEncoder().encode(f.text).length, 0)) <= LIMITS.totalBytes, 'files', 'Stage at most10 files,512KiB each and2MiB total');
        const sources = []; for (const file of files) { const bytes = await file.arrayBuffer(); if (epoch !== this.#epoch) return; sources.push({ name: file.name, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }); }
        if (epoch === this.#epoch) await this.#analyze([...this.#inputs, ...sources], epoch);
      } catch (error) { if (epoch === this.#epoch) { this.#busy = ''; this.#message = error.message + '. Previous review is preserved.'; this.#error = true; this.#render(); } }
    }
    async #calculate(epoch = this.#epoch) {
      const generation = ++this.#planEpoch, draft = this.#draft, review = clone(this.#review); this.#plan = null; this.#render();
      try { const plan = await createPlan(draft, review); if (epoch === this.#epoch && generation === this.#planEpoch) { this.#plan = plan; this.#message = 'Review ready. Importing sends the staged sources and selected records to your configured host.'; this.#error = false; } }
      catch (error) { if (epoch === this.#epoch && generation === this.#planEpoch) { this.#message = error.message; this.#error = true; } }
      if (epoch === this.#epoch && generation === this.#planEpoch) this.#render();
    }
    async #research(url) {
      if (!this.#config?.research) return; const epoch = ++this.#epoch, config = this.#config, controller = new AbortController(); this.#abort?.abort(); this.#abort = controller; this.#busy = 'Researching public pages'; this.#render();
      try {
        requireValue(this.#inputs.length < LIMITS.files, 'files', 'Remove a staged source before adding website pages');
        const report = await config.research(url, { signal: controller.signal, maxPages: Math.min(8, LIMITS.files - this.#inputs.length) }); aborted(controller.signal); if (epoch !== this.#epoch) return;
        requireValue(report?.schema === 'intakelet.research' && report.version === 1 && Array.isArray(report.files) && Array.isArray(report.pages) && report.coverage && Array.isArray(report.skipped), 'research', 'Host returned an incompatible research report');
        this.#report = report; requireValue(report.files.length, 'no_content', 'No public static content was obtained; previous sources were kept'); this.#abort = null; await this.#analyze([...this.#inputs, ...report.files], epoch);
      } catch (error) { if (epoch === this.#epoch) { this.#message = error.message + '. Previous review and saved data are preserved.'; this.#error = true; } }
      finally { if (epoch === this.#epoch) { this.#busy = ''; this.#abort = null; this.#render(); } }
    }
    async #commit() {
      if (!this.#plan || !this.#snapshot || this.#busy || this.#loading) return;
      const epoch = this.#epoch, config = this.#config, plan = clone(this.#plan), expectedRevision = this.#snapshot.revision; this.#busy = 'Importing reviewed plan'; this.#render();
      try {
        const receipt = await config.host.commit(plan, { expectedRevision });
        requireValue(receipt?.schema === 'intakelet.receipt' && receipt.version === 1 && receipt.workspaceId === config.workspaceId && receipt.planId === plan.planId && Number.isSafeInteger(receipt.revision) && receipt.revision > 0 && ['added', 'deduplicated'].every(key => receipt[key] && ['sources', 'records', 'articles'].every(k => Number.isSafeInteger(receipt[key][k]) && receipt[key][k] >= 0)), 'receipt', 'Host response is not a matching receipt; reload/retry this plan to reconcile its status');
        this.dispatchEvent(new CustomEvent('intakelet-commit', { detail: clone(receipt), bubbles: true, composed: true }));
        if (epoch !== this.#epoch) { if (this.isConnected && this.#config === config) void this.refresh(); return; } this.#receipt = receipt;
        const state = await validateSnapshot(await config.host.snapshot(), config.workspaceId); if (epoch !== this.#epoch) return; requireValue(state.revision >= receipt.revision, 'receipt', 'Import acknowledged; reload the workspace to reconcile its snapshot'); this.#snapshot = state;
        this.#message = `Import acknowledged · revision${receipt.revision}. The receipt is saved by the host; repeating this plan does not create another import.`; this.#error = false;
      } catch (error) { if (epoch === this.#epoch) { this.#message = error.message + '. Keep this plan. Reload the revision and retry to reconcile an uncertain response.'; this.#error = true; } }
      finally { if (epoch === this.#epoch) { this.#busy = ''; this.#render(); } }
    }
    #render() {
      if (!this.isConnected) return;
      const focus = this.contains(document.activeElement) ? document.activeElement.id : null, root = el('section', undefined, 'il-root'); root.setAttribute('aria-label', 'Customer onboarding import');
      const status = el('p', this.#busy || (this.#loading ? 'Loading workspace' : this.#message) || 'Connect a workspace to begin.', 'il-status' + (this.#error ? ' il-error' : '')); status.id = this.#id('status'); status.dataset.intakelet = 'status'; status.setAttribute('role', 'status'); root.append(status);
      if (!this.#config) { root.append(el('p', 'The application must configure its workspace and host before importing.')); this.replaceChildren(root); return; }
      const counts = el('div', undefined, 'il-stats'); for (const [title, value] of [['Saved records', this.#snapshot?.records.length ?? '—'], ['Knowledge chunks', this.#snapshot?.articles.length ?? '—'], ['Revision', this.#snapshot?.revision ?? '—']]) { const box = el('div'); box.append(el('strong', String(value)), el('span', title)); counts.append(box); } root.append(counts);
      const source = el('section', undefined, 'il-card'); source.append(el('h3', '1. Bring your information'), el('p', 'CSV, JSON records, Markdown or text. Classification happens on this device; nothing is written to the host until you import the review.', 'il-muted'));
      const input = el('input'); input.type = 'file'; input.multiple = true; input.accept = '.csv,.json,.md,.markdown,.txt'; input.id = this.#id('files'); input.dataset.intakelet = 'files'; input.disabled = Boolean(this.#busy); const choose = el('label', 'Add files', 'il-file-label'); choose.htmlFor = input.id; choose.append(input); input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) void this.#files(files); }); source.append(choose);
      source.addEventListener('dragover', event => { if (!this.#busy) event.preventDefault(); }); source.addEventListener('drop', event => { event.preventDefault(); if (!this.#busy && event.dataTransfer.files.length) void this.#files([...event.dataTransfer.files]); });
      const urlForm = el('form', undefined, 'il-url-form'), urlLabel = el('label', 'Research a website'), url = el('input'); url.type = 'url'; url.id = this.#id('url'); url.dataset.intakelet = 'url'; url.value = this.#url; url.addEventListener('input', () => { this.#url = url.value; }); url.required = true; url.placeholder = 'https://your-company.example'; url.disabled = Boolean(this.#busy) || !this.#config.research; urlLabel.htmlFor = url.id; urlLabel.append(url); const research = button('Research website', () => {}); research.type = 'submit'; research.disabled = url.disabled; urlForm.append(urlLabel, research); urlForm.addEventListener('submit', event => { event.preventDefault(); if (!this.#busy) void this.#research(url.value); }); source.append(urlForm);
      if (!this.#config.research) source.append(el('p', 'Website research needs your application’s server callback. File import is available here.', 'il-muted'));
      if (this.#busy === 'Researching public pages') source.append(button('Cancel research', () => this.#abort?.abort()));
      for (const [index, file] of this.#inputs.entries()) { const row = el('div', undefined, 'il-source-row'); row.append(el('span', file.name)); const remove = button('Remove source', () => { const files = this.#inputs.filter((_, i) => i !== index); if (files.length) void this.#analyze(files); else { this.#epoch++; this.#draft = this.#plan = null; this.#inputs = []; this.#render(); } }); remove.disabled = Boolean(this.#busy); remove.setAttribute('aria-label', 'Remove ' + file.name); row.append(remove); source.append(row); }
      root.append(source);
      if (this.#report) { const report = el('details', undefined, 'il-card'), summary = el('summary', 'Website coverage · ' + this.#report.status); report.append(summary, el('p', `${this.#report.coverage.pages} pages · ${this.#report.coverage.requests} requests. Bounded static-site research; omitted/failed paths remain below.`)); const pre = el('pre', JSON.stringify({ pages: this.#report.pages.map(p => ({ url: p.url, title: p.title, classification: p.classification })), skipped: this.#report.skipped }, null, 2)); report.append(pre); root.append(report); }
      if (this.#draft) {
        const review = el('section', undefined, 'il-card'); review.append(el('h3', '2. Review the import'), el('p', `${this.#draft.totals.files} sources · ${this.#draft.totals.rows} original rows · ${this.#draft.totals.duplicateFiles} duplicate files. Excluded rows remain in their source file; exclusion is not source redaction.`, 'il-muted'));
        for (const table of this.#draft.tables) {
          const original = this.#draft.sources.find(s => s.id === table.sourceId), box = el('section', undefined, 'il-table-review'); box.append(el('h4', original.name), el('p', table.suggestion.reason, 'il-muted'));
          const choice = this.#review.mappings[table.sourceId] ?? { kind: table.suggestion.kind, mapping: clone(table.suggestion.mapping) };
          const update = () => { this.#review.mappings[table.sourceId] = clone(choice); this.#receipt = null; void this.#calculate(); };
          const kindLabel = el('label', 'Import as'), kind = el('select'); kind.id = this.#id('kind-' + table.sourceId); for (const [value, label] of [['contact', 'Contacts'], ['record', 'Generic records']]) { const option = el('option', label); option.value = value; kind.append(option); } kind.value = choice.kind; kind.disabled = Boolean(this.#busy); kind.addEventListener('change', () => { choice.kind = kind.value; choice.mapping = kind.value === 'contact' ? { email: table.columns[0] } : {}; update(); }); kindLabel.append(kind); box.append(kindLabel);
          if (choice.kind === 'contact') { const mapping = el('div', undefined, 'il-mapping'); for (const key of ['email', 'name', 'company']) { const label = el('label', key === 'email' ? 'Email · required' : key), select = el('select'); select.id = this.#id('map-' + table.sourceId + '-' + key); if (key !== 'email') { const option = el('option', 'Not mapped'); option.value = ''; select.append(option); } for (const col of table.columns) { const option = el('option', col); option.value = col; select.append(option); } select.value = choice.mapping[key] || ''; select.disabled = Boolean(this.#busy); select.addEventListener('change', () => { if (select.value) choice.mapping[key] = select.value; else delete choice.mapping[key]; update(); }); label.append(select); mapping.append(label); } box.append(mapping); }
          const page = this.#page.get(table.sourceId) || 0, items = table.rows.slice(page * 20, page * 20 + 20), listing = el('div', undefined, 'il-rows');
          for (const row of items) { const label = el('label', undefined, 'il-row'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.id = this.#id('row-' + table.sourceId + '-' + row.index); checkbox.checked = !this.#review.excludedRows.some(r => r.sourceId === table.sourceId && r.index === row.index); checkbox.disabled = Boolean(this.#busy); checkbox.setAttribute('aria-label', `Include row${row.index + 1} from ${original.name}`); checkbox.addEventListener('change', () => { this.#review.excludedRows = this.#review.excludedRows.filter(r => !(r.sourceId === table.sourceId && r.index === row.index)); if (!checkbox.checked) this.#review.excludedRows.push({ sourceId: table.sourceId, index: row.index }); this.#receipt = null; void this.#calculate(); }); label.append(checkbox, el('span', Object.entries(row.values).map(([key, value]) => key + ': ' + String(value)).join(' · ').slice(0, 400))); listing.append(label); } box.append(listing);
          if (table.rows.length > 20) { const pages = el('div', undefined, 'il-actions'), previous = button('Previous rows', () => { this.#page.set(table.sourceId, page - 1); this.#render(); }), next = button('Next rows', () => { this.#page.set(table.sourceId, page + 1); this.#render(); }); previous.disabled = page === 0; next.disabled = (page + 1) * 20 >= table.rows.length; pages.append(previous, el('span', `Rows${page * 20 + 1}–${Math.min(table.rows.length, (page + 1) * 20)} of${table.rows.length}`), next); box.append(pages); }
          review.append(box);
        }
        if (this.#draft.tables.length) { const label = el('label', undefined, 'il-check'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.id = this.#id('skip-invalid'); checkbox.dataset.intakelet = 'skip-invalid'; checkbox.checked = this.#review.skipInvalid; checkbox.disabled = Boolean(this.#busy); checkbox.addEventListener('change', () => { this.#review.skipInvalid = checkbox.checked; this.#receipt = null; void this.#calculate(); }); label.append(checkbox, el('span', 'Explicitly exclude invalid/conflicting rows; keep their issues visible in the plan')); review.append(label); }
        if (this.#plan) { const list = el('div', undefined, 'il-insights'); for (const insight of this.#plan.insights) list.append(el('p', `${insight.value} · ${insight.label} (${insight.method})`)); review.append(list); if (this.#plan.issues.length) review.append(el('pre', JSON.stringify(this.#plan.issues, null, 2))); }
        const actions = el('div', undefined, 'il-actions'), commit = button(this.#receipt ? 'Import acknowledged' : 'Import reviewed plan', () => void this.#commit(), 'il-button il-primary'); commit.id = this.#id('import'); commit.dataset.intakelet = 'import'; commit.disabled = !this.#plan || !this.#snapshot || this.#loading || Boolean(this.#busy) || Boolean(this.#receipt); const exported = button('Export review plan', () => download(this.#plan, 'intakelet-plan.json')); exported.id = this.#id('export-plan'); exported.dataset.intakelet = 'export-plan'; exported.disabled = !this.#plan || Boolean(this.#busy); const refresh = button('Reload host revision', () => void this.refresh()); refresh.disabled = Boolean(this.#busy); actions.append(commit, exported, refresh); review.append(actions);
        const evidence = el('details'), summary = el('summary', 'Inspect staged source evidence'); evidence.append(summary); for (const source of this.#draft.sources) evidence.append(el('h4', source.name), el('p', source.sha256, 'il-hash'), el('pre', source.text)); review.append(evidence); root.append(review);
      }
      const knowledge = el('section', undefined, 'il-card'); knowledge.append(el('h3', '3. Use your knowledge'), el('p', 'Saved source quotes and structured records. Search matches literal terms; it does not generate an answer.', 'il-muted'));
      const searchLabel = el('label', 'Search saved knowledge'), search = el('input'); search.type = 'search'; search.id = this.#id('search'); search.dataset.intakelet = 'search'; search.value = this.#query; search.maxLength = 300; searchLabel.append(search); knowledge.append(searchLabel);
      const results = el('div'); results.id = this.#id('results'); results.dataset.intakelet = 'results'; const renderResults = () => { results.replaceChildren(); const articles = this.#snapshot?.articles || [], matches = this.#query.trim() ? searchKnowledge(articles, this.#query).map(r => r.article) : articles.slice(0, 8); if (!matches.length) results.append(el('p', articles.length ? 'No matching source evidence.' : 'Import a reviewed source to create knowledge.', 'il-muted')); for (const article of matches) { const box = el('details', undefined, 'il-result'); box.append(el('summary', article.title), el('p', `${article.method} · ${article.sourceId}`, 'il-hash'), el('pre', article.text)); if (article.url) { try { const url = new URL(article.url); if (url.protocol === 'https:' && !url.username && !url.password) { const link = el('a', 'Open cited source ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link); } } catch {} } results.append(box); } };
      search.addEventListener('input', () => { this.#query = search.value; renderResults(); }); renderResults(); knowledge.append(results); root.append(knowledge); this.replaceChildren(root);
      if (focus) this.querySelector('#' + CSS.escape(focus))?.focus();
    }
  }
  registry.define(tagName, IntakeletElement); return IntakeletElement;
}
