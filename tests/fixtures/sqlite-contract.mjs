// T2 authored records. No provider, account, customer or live data.
export const definition = (connectionId = 'durable', namespace = 'durable-notes') => ({
  workspaceId: 'authored-workspace', connectionId,
  source: { id: 'authored-sqlite', version: '1', configuration: { fixture: 'durable-v1' } },
  output: { id: namespace, version: '1', schema: { type: 'object', additionalProperties: false,
    properties: { externalId: { type: 'string' }, note: { type: 'object', additionalProperties: false,
      properties: { title: { type: 'string', maxLength: 100000 } }, required: ['title'] } }, required: ['externalId', 'note'] },
    fields: [{ from: ['key'], to: ['externalId'] }, { from: ['title'], to: ['note', 'title'] }], key: [['externalId']] },
  policy: { create: true, update: true, delete: true },
});
export const item = (id, title = id, key = id) => ({ id, operation: 'upsert', data: { key, title } });
export const page = (items, cursorBefore = null, cursorAfter = { page: 1 }, done = true) => ({ items, cursorBefore, cursorAfter, done });
export const pagedSource = (spec, pages, calls = []) => ({ identity: spec.source, readPage({ cursor = null }) {
  calls.push(cursor); const next = pages.find(value => JSON.stringify(value.cursorBefore) === JSON.stringify(cursor));
  if (!next) throw new Error('Authored source has no page for this checkpoint.'); return structuredClone(next);
} });
