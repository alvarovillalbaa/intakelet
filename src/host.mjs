import { verifyPlan } from './plan.mjs';
import { exact, workspace, requireValue, canonical, clone, LIMITS, byteLength, filename, normalizeEmail, sha256 } from './values.mjs';
export function emptyState(workspaceId) { workspace(workspaceId); return { schema: 'intakelet.state', version: 1, workspaceId, revision: 0, sources: [], records: [], articles: [], receipts: [] }; }
export function validateState(state, workspaceId) {
  exact(state, ['schema', 'version', 'workspaceId', 'revision', 'sources', 'records', 'articles', 'receipts']);
  requireValue(state.schema === 'intakelet.state' && state.version === 1 && state.workspaceId === workspace(workspaceId) && Number.isSafeInteger(state.revision) && state.revision >= 0, 'state', 'Stored workspace state/version is invalid');
  for (const kind of ['sources', 'records', 'articles', 'receipts']) {
    requireValue(Array.isArray(state[kind]) && state[kind].length <= LIMITS.records, 'state', 'Stored collection is invalid');
    const key = kind === 'receipts' ? 'planId' : 'id'; requireValue(state[kind].every(row => row && typeof row[key] === 'string') && new Set(state[kind].map(r => r[key])).size === state[kind].length, 'state', 'Stored identities are invalid/duplicated');
  }
  requireValue(state.receipts.length === state.revision && state.receipts.every((r, i) => r.workspaceId === workspaceId && r.revision === i + 1 && r.schema === 'intakelet.receipt' && r.version === 1 && ['added', 'deduplicated'].every(key => r[key] && ['sources', 'records', 'articles'].every(k => Number.isSafeInteger(r[key][k]) && r[key][k] >= 0))), 'state', 'Stored commit history is invalid');
  requireValue(byteLength(canonical(state)) <= LIMITS.storedBytes, 'state_size', 'Workspace exceeds12MiB'); return clone(state);
}
export async function validateSnapshot(input, workspaceId) {
  const state = validateState(input, workspaceId), sources = new Map(state.sources.map(s => [s.id, s])), records = new Map(state.records.map(r => [r.id, r]));
  const reference = p => { const source = sources.get(p.sourceId); requireValue(source && p.span && Number.isSafeInteger(p.span.start) && Number.isSafeInteger(p.span.end) && p.span.start >= 0 && p.span.end > p.span.start && p.span.end <= source.text.length && Number.isInteger(p.row) && p.row >= 0, 'state', 'Stored source reference is invalid'); };
  for (const source of state.sources) {
    filename(source.name); requireValue(['csv', 'json', 'markdown', 'text'].includes(source.format) && typeof source.text === 'string' && byteLength(source.text) === source.bytes && source.bytes <= LIMITS.fileBytes, 'state', 'Stored source shape is invalid');
    requireValue(source.sha256 === await sha256(source.text) && source.id === 'src-' + await sha256(canonical({ format: source.format, hash: source.sha256 })), 'state_integrity', 'Stored source content changed');
  }
  for (const record of state.records) {
    requireValue(['contact', 'record'].includes(record.kind) && record.data && typeof record.data === 'object' && !Array.isArray(record.data) && Array.isArray(record.provenance) && record.provenance.length, 'state', 'Stored record shape is invalid');
    if (record.kind === 'contact') { exact(record.data, ['email', 'name', 'company']); requireValue(normalizeEmail(record.data.email) === record.data.email && typeof record.data.name === 'string' && typeof record.data.company === 'string', 'state', 'Stored contact fields are invalid'); }
    const identity = record.kind === 'contact' ? { kind: record.kind, email: record.data.email } : { kind: record.kind, data: record.data };
    requireValue(record.id === 'rec-' + await sha256(canonical(identity)), 'state_integrity', 'Stored record identity changed'); record.provenance.forEach(reference);
  }
  for (const article of state.articles) {
    const source = sources.get(article.sourceId); requireValue(source && typeof article.title === 'string' && typeof article.text === 'string', 'state', 'Stored knowledge shape is invalid');
    if (article.method === 'exact_source') {
      requireValue(article.span && Number.isSafeInteger(article.span.start) && Number.isSafeInteger(article.span.end) && article.span.start >= 0 && article.span.end > article.span.start && article.span.end <= source.text.length && article.text === source.text.slice(article.span.start, article.span.end), 'state_integrity', 'Stored knowledge diverges from its source');
      requireValue(article.id === 'kb-' + await sha256(canonical({ sourceId: article.sourceId, span: article.span })), 'state_integrity', 'Stored knowledge identity changed');
    } else {
      requireValue(article.method === 'structured_records' && Array.isArray(article.recordIds) && article.recordIds.length && article.recordIds.every(id => records.has(id)) && Array.isArray(article.provenance), 'state', 'Stored structured knowledge is invalid');
      requireValue(article.text === canonical(article.recordIds.map(id => records.get(id).data)) && article.id === 'kb-' + await sha256(canonical(article.recordIds)), 'state_integrity', 'Stored structured knowledge changed'); article.provenance.forEach(reference);
    }
  }
  return state;
}
// Internal synchronous transaction transition. Public hosts verify derivation
// before entry; IndexedDB calls it within its single read/write transaction.
export function applyVerifiedPlan(state, plan, expectedRevision, workspaceId) {
  validateState(state, workspaceId); requireValue(plan.workspaceId === workspaceId, 'workspace', 'Plan belongs to another workspace');
  requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'revision', 'Expected revision must be a nonnegative safe integer');
  const existing = state.receipts.find(r => r.planId === plan.planId); if (existing) return { state: clone(state), receipt: clone(existing), replayed: true };
  requireValue(state.revision === expectedRevision, 'conflict', 'Workspace changed; reload its revision before importing');
  const next = clone(state), counts = {}, repeated = {};
  for (const kind of ['sources', 'records', 'articles']) {
    const incoming = kind === 'sources' ? plan.draft.sources : plan[kind], map = new Map(next[kind].map(r => [r.id, r])); counts[kind] = 0; repeated[kind] = 0;
    for (const item of incoming) {
      if (map.has(item.id)) {
        const previous = map.get(item.id);
        if (kind === 'records') {
          requireValue(previous.kind === item.kind && canonical(previous.data) === canonical(item.data), 'record_conflict', 'An existing record has different values; no part of this plan was written');
          previous.provenance = [...new Map([...previous.provenance, ...item.provenance].map(p => [canonical(p), p])).values()];
        } else if (kind === 'sources') {
          requireValue(previous.format === item.format && previous.sha256 === item.sha256 && previous.text === item.text, 'source_conflict', 'Existing source content differs');
          const alias = { name: item.name, ...(item.url ? { url: item.url } : {}) };
          if (previous.name !== item.name || previous.url !== item.url) previous.aliases = [...new Map([...(previous.aliases || []), alias].map(v => [canonical(v), v])).values()];
        } else if (kind === 'articles' && item.method === 'exact_source') {
          requireValue(previous.method === item.method && previous.sourceId === item.sourceId && previous.text === item.text && canonical(previous.span) === canonical(item.span), 'source_conflict', 'Existing source knowledge differs');
        } else if (kind === 'articles' && item.method === 'structured_records') {
          requireValue(previous.text === item.text && canonical(previous.recordIds) === canonical(item.recordIds), 'record_conflict', 'Existing knowledge differs');
          previous.provenance = [...new Map([...previous.provenance, ...item.provenance].map(p => [canonical(p), p])).values()];
        } else requireValue(canonical(previous) === canonical(item), 'source_conflict', 'Existing source content/metadata differs; no part was written');
        repeated[kind]++;
      } else { map.set(item.id, clone(item)); counts[kind]++; }
    }
    next[kind] = [...map.values()];
  }
  requireValue(state.revision < Number.MAX_SAFE_INTEGER, 'revision', 'Workspace revision exhausted'); next.revision++;
  const receipt = { schema: 'intakelet.receipt', version: 1, workspaceId, planId: plan.planId, revision: next.revision, added: counts, deduplicated: repeated };
  next.receipts.push(receipt); validateState(next, workspaceId); return { state: next, receipt: clone(receipt), replayed: false };
}
export class MemoryHost {
  #state; #workspace;
  constructor({ workspaceId, state } = {}) { this.#workspace = workspace(workspaceId); this.#state = state ? validateState(state, workspaceId) : emptyState(workspaceId); }
  async snapshot() { return validateSnapshot(this.#state, this.#workspace); }
  async commit(input, { expectedRevision } = {}) { const plan = await verifyPlan(input); await validateSnapshot(this.#state, this.#workspace); const result = applyVerifiedPlan(this.#state, plan, expectedRevision, this.#workspace); this.#state = result.state; return clone(result.receipt); }
}
