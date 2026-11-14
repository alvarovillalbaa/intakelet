import { verifyDraft } from './ingest.mjs';
import { buildKnowledge } from './knowledge.mjs';
import { exact, normalizeEmail, canonical, clone, sha256, seal, requireValue, byteLength, LIMITS } from './values.mjs';

function reviewOptions(draft, value = {}) {
  exact(value, [], ['mappings', 'excludedRows', 'skipInvalid']);
  const mappings = value.mappings ?? {}, excludedRows = value.excludedRows ?? [], skipInvalid = value.skipInvalid ?? false;
  requireValue(typeof skipInvalid === 'boolean' && Array.isArray(excludedRows) && excludedRows.length <= LIMITS.rows, 'review', 'Invalid review options');
  requireValue(mappings && typeof mappings === 'object' && !Array.isArray(mappings), 'mapping', 'Mappings must be keyed by source ID');
  for (const [id, proposed] of Object.entries(mappings)) {
    const table = draft.tables.find(t => t.sourceId === id); requireValue(table, 'mapping', 'Mapping refers to an unknown table'); exact(proposed, ['kind', 'mapping']);
    requireValue(['contact', 'record'].includes(proposed.kind), 'mapping', 'Choose contact or generic record'); exact(proposed.mapping, proposed.kind === 'contact' ? ['email'] : [], proposed.kind === 'contact' ? ['name', 'company'] : []);
    const cols = Object.values(proposed.mapping); requireValue(cols.every(c => typeof c === 'string' && table.columns.includes(c)) && new Set(cols).size === cols.length, 'mapping', 'Each mapped field needs a distinct original column');
  }
  for (const row of excludedRows) { exact(row, ['sourceId', 'index']); const table = draft.tables.find(t => t.sourceId === row.sourceId); requireValue(table && Number.isInteger(row.index) && row.index >= 0 && row.index < table.rows.length, 'selection', 'Excluded row does not exist'); }
  requireValue(new Set(excludedRows.map(r => r.sourceId + ':' + r.index)).size === excludedRows.length, 'selection', 'Excluded rows must be unique');
  return clone({ mappings, excludedRows, skipInvalid });
}
export async function createPlan(input, options = {}) {
  const draft = await verifyDraft(input), review = reviewOptions(draft, options), selected = new Map(), conflicts = new Set(), issues = [], excluded = new Set(review.excludedRows.map(r => r.sourceId + ':' + r.index));
  let duplicateRows = 0, excludedCount = 0;
  for (const table of draft.tables) {
    const choice = review.mappings[table.sourceId] ?? { kind: table.suggestion.kind, mapping: table.suggestion.mapping };
    for (const row of table.rows) {
      if (excluded.has(table.sourceId + ':' + row.index)) { excludedCount++; continue; }
      try {
        let data = clone(row.values);
        if (choice.kind === 'contact') {
          const read = key => { const v = row.values[choice.mapping[key]]; requireValue(v === undefined || v === null || typeof v === 'string', 'contact', 'Mapped contact fields must contain text'); return v?.trim() || ''; };
          data = { email: normalizeEmail(read('email')), name: read('name'), company: read('company') };
          requireValue(data.name.length <= 200 && data.company.length <= 200, 'contact', 'Contact name/company exceeds200 characters');
        }
        const id = 'rec-' + await sha256(canonical(choice.kind === 'contact' ? { kind: choice.kind, email: data.email } : { kind: choice.kind, data }));
        const provenance = { sourceId: table.sourceId, row: row.index, span: clone(row.span) }, previous = selected.get(id);
        if (conflicts.has(id)) { issues.push({ sourceId: table.sourceId, row: row.index, code: 'record_conflict', message: 'Same contact identity has conflicting values; exclude the conflicting rows or correct the source.' }); continue; }
        if (previous && canonical(previous.data) !== canonical(data)) {
          issues.push(...previous.provenance.map(p => ({ sourceId: p.sourceId, row: p.row, code: 'record_conflict', message: 'Conflicting values for the same contact identity.' })), { sourceId: table.sourceId, row: row.index, code: 'record_conflict', message: 'Conflicting values for the same contact identity.' });
          selected.delete(id); conflicts.add(id); continue;
        }
        if (previous) { previous.provenance.push(provenance); duplicateRows++; }
        else selected.set(id, { id, kind: choice.kind, data, provenance: [provenance] });
      } catch (error) { if (!error.code) throw error; issues.push({ sourceId: table.sourceId, row: row.index, code: error.code, message: error.message }); }
    }
  }
  requireValue(!issues.length || review.skipInvalid, 'review_required', `${issues.length} rows need correction or explicit exclusion`, issues);
  const records = [...selected.values()], articles = await buildKnowledge(draft.sources, records);
  requireValue(records.length || articles.length, 'empty_plan', 'No importable records or knowledge remain');
  const contacts = records.filter(r => r.kind === 'contact');
  const insights = [
    { id: 'records', label: 'Reviewed records', value: records.length, method: 'count' },
    { id: 'contacts', label: 'Contact records', value: contacts.length, method: 'count' },
    { id: 'documents', label: 'Source documents', value: draft.documents.length, method: 'count' },
    { id: 'knowledge', label: 'Knowledge chunks', value: articles.length, method: 'count' },
    { id: 'missing_names', label: 'Contacts without a name', value: contacts.filter(r => !r.data.name).length, method: 'field_coverage' },
    { id: 'duplicates', label: 'Identical rows merged', value: duplicateRows, method: 'exact_comparison' },
    { id: 'excluded', label: 'Explicitly excluded rows', value: excludedCount, method: 'review_selection' },
    { id: 'invalid', label: 'Invalid/conflicting rows excluded', value: issues.length, method: 'validated_exclusion' }
  ];
  const body = { schema: 'intakelet.plan', version: 1, workspaceId: draft.workspaceId, draft, review, records, articles, insights, issues };
  requireValue(byteLength(canonical(body)) <= LIMITS.storedBytes, 'plan_size', 'Reviewed plan exceeds12MiB; split the sources');
  return seal(body, 'planId');
}
export async function verifyPlan(plan) {
  exact(plan, ['schema', 'version', 'workspaceId', 'draft', 'review', 'records', 'articles', 'insights', 'issues', 'planId']);
  requireValue(plan.schema === 'intakelet.plan' && plan.version === 1 && plan.workspaceId === plan.draft.workspaceId, 'plan_version', 'Unsupported or mismatched import plan');
  const actual = await createPlan(plan.draft, plan.review);
  requireValue(canonical(actual) === canonical(plan), 'plan_integrity', 'Import plan diverges from its bounded sources and review'); return actual;
}
