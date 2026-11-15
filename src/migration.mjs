import { exact, workspace, label, clone, canonical, sha256, seal, requireValue, byteLength, aborted, IntakeletError } from './values.mjs';
import { validateOutputRecipe, compileOutputRecipe } from './output-schema.mjs';

export const MIGRATION_LIMITS = Object.freeze({ items: 500, pageBytes: 2097152, batchBytes: 3145728, cursorBytes: 16384, reviewRounds: 10 });
export function migrationCursor(value) { requireValue(byteLength(canonical(value)) <= MIGRATION_LIMITS.cursorBytes, 'cursor', 'Cursor exceeds 16KiB'); return clone(value); }
export function validateMigrationSpec(input) {
  exact(input, ['workspaceId', 'connectionId', 'source', 'output', 'policy']); workspace(input.workspaceId); workspace(input.connectionId);
  exact(input.source, ['id', 'version', 'configuration']); workspace(input.source.id); label(input.source.version, 80);
  requireValue(byteLength(canonical(input.source.configuration)) <= 32768, 'source', 'Source configuration exceeds 32KiB');
  const inspect = value => { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { requireValue(!/^(?:api_?key|access_?token|refresh_?token|token|authorization|password|secret|credentials?)$/i.test(key), 'source', 'Credentials belong in the application adapter, not a migration identity'); inspect(child); } }; inspect(input.source.configuration);
  validateOutputRecipe(input.output); exact(input.policy, ['create', 'update', 'delete']);
  requireValue(Object.values(input.policy).every(value => typeof value === 'boolean'), 'policy', 'Declare every permitted migration operation');
  return clone(input);
}
export async function migrationSpecId(spec) { return 'sha256:' + await sha256(canonical(validateMigrationSpec(spec))); }
export function validateSourcePage(input) {
  exact(input, ['items', 'cursorBefore', 'cursorAfter', 'done']); migrationCursor(input.cursorBefore); migrationCursor(input.cursorAfter);
  requireValue(Array.isArray(input.items) && input.items.length <= MIGRATION_LIMITS.items && typeof input.done === 'boolean' && byteLength(canonical(input)) <= MIGRATION_LIMITS.pageBytes, 'source_page', 'Source page exceeds 500 items or 2MiB');
  requireValue(input.done || canonical(input.cursorBefore) !== canonical(input.cursorAfter), 'source_cursor', 'A continuing page must advance its cursor');
  const seen = new Set();
  for (const item of input.items) {
    exact(item, ['id', 'operation'], ['data', 'revision']); label(item.id, 300);
    requireValue(!seen.has(item.id) && ['upsert', 'delete'].includes(item.operation), 'source_item', 'Source item IDs must be unique and operations explicit'); seen.add(item.id);
    if (item.revision !== undefined) label(item.revision, 200);
    requireValue(item.operation !== 'upsert' || Object.hasOwn(item, 'data'), 'source_item', 'Upserts need source data');
    requireValue(item.operation !== 'delete' || !Object.hasOwn(item, 'data'), 'source_item', 'Delete events carry identity, not replacement data');
  }
  return clone(input);
}
function baseline(value) {
  exact(value, ['revision', 'cursor', 'specId']);
  requireValue(Number.isSafeInteger(value.revision) && value.revision >= 0 && (value.specId === null || /^sha256:[a-f0-9]{64}$/.test(value.specId)), 'baseline', 'Invalid migration baseline'); migrationCursor(value.cursor);
}
function observedRecord(value) {
  exact(value, ['id', 'connectionId', 'sourceKey', 'data', 'dataHash', 'importedHash', 'revision']);
  requireValue(/^row-[a-f0-9]{64}$/.test(value.id) && /^sha256:[a-f0-9]{64}$/.test(value.dataHash) && /^sha256:[a-f0-9]{64}$/.test(value.importedHash) && Number.isSafeInteger(value.revision) && value.revision > 0, 'record', 'Invalid destination record metadata');
  workspace(value.connectionId); label(value.sourceKey, 300); requireValue(byteLength(canonical(value.data)) <= 524288, 'record', 'Destination observation exceeds 512KiB');
}
async function candidates(spec, page) {
  const map = compileOutputRecipe(spec.output), values = [];
  for (const item of page.items) {
    if (item.operation === 'delete') { values.push({ item }); continue; }
    try { const output = map(item.data), id = 'row-' + await sha256(canonical({ namespace: spec.output.id, identity: output.identity })); values.push({ item, id, data: output.data, dataHash: 'sha256:' + await sha256(canonical(output.data)) }); }
    catch (error) { values.push({ item, issue: { code: error.code || 'mapping', message: error.message, details: error.details ?? null } }); }
  }
  return values;
}
export async function prepareMigrationBatch(specInput, pageInput, baselineInput, observed, review = { excludedIds: [] }) {
  const spec = validateMigrationSpec(specInput), page = validateSourcePage(pageInput); baseline(baselineInput); exact(review, ['excludedIds']);
  requireValue(Array.isArray(review.excludedIds) && new Set(review.excludedIds).size === review.excludedIds.length && review.excludedIds.every(id => page.items.some(item => item.id === id)), 'review', 'Exclude only distinct source IDs in this page');
  requireValue(Array.isArray(observed) && observed.length <= MIGRATION_LIMITS.items * 2 && byteLength(canonical(observed)) <= MIGRATION_LIMITS.batchBytes && new Set(observed.map(row => row.id)).size === observed.length, 'record', 'Destination observations must be unique and bounded'); observed.forEach(observedRecord);
  for (const row of observed) requireValue('sha256:' + await sha256(canonical(row.data)) === row.dataHash, 'record', 'Destination observation hash does not match its data');
  const specId = await migrationSpecId(spec); requireValue(baselineInput.specId === null || baselineInput.specId === specId, 'spec_changed', 'The connection belongs to another reviewed source/output definition');
  requireValue(canonical(baselineInput.cursor) === canonical(page.cursorBefore), 'cursor', 'Page does not continue the accepted checkpoint');
  const values = await candidates(spec, page), targets = new Map(observed.map(row => [row.id, row])), sources = new Map();
  for (const row of observed.filter(row => row.connectionId === spec.connectionId)) { requireValue(!sources.has(row.sourceKey), 'record', 'One source identity cannot own multiple target records'); sources.set(row.sourceKey, row); }
  const rows = [], issues = [], identities = new Map();
  // Check identity collisions before row selection: no silent first-wins merge.
  for (const value of values) if (value.id && !review.excludedIds.includes(value.item.id)) { const group = identities.get(value.id) ?? []; group.push(value.item.id); identities.set(value.id, group); }
  for (const value of values) {
    const { item } = value, excluded = review.excludedIds.includes(item.id);
    const issue = (code, message, details = null) => issues.push({ sourceKey: item.id, code, message, details, excluded });
    if (value.issue) { issue(value.issue.code, value.issue.message, value.issue.details); continue; }
    if (excluded) { issue('excluded', 'Explicitly excluded by the reviewer'); continue; }
    if (value.id && identities.get(value.id).length > 1) { issue('duplicate_identity', 'Multiple source rows map to the same destination identity'); continue; }
    const bySource = sources.get(item.id), current = item.operation === 'delete' ? bySource : targets.get(value.id);
    if (bySource && item.operation === 'upsert' && bySource.id !== value.id) { issue('identity_changed', 'A managed source identity changed its target key; review a deliberate rekey before syncing'); continue; }
    if (current && (current.connectionId !== spec.connectionId || current.sourceKey !== item.id)) { issue('foreign_record', 'The target identity is owned by another source or connection'); continue; }
    if (current && current.dataHash !== current.importedHash) { issue('local_change', 'Destination data changed after the last import; it will not be overwritten'); continue; }
    const action = item.operation === 'delete' ? current ? 'delete' : 'unchanged' : !current ? 'create' : current.dataHash === value.dataHash ? 'unchanged' : 'update';
    if (action !== 'unchanged' && !spec.policy[action]) { issue('operation_denied', 'The accepted policy does not permit ' + action); continue; }
    rows.push({ sourceKey: item.id, id: current?.id ?? value.id ?? null, action, data: action === 'delete' || item.operation === 'delete' ? null : value.data, dataHash: action === 'delete' || item.operation === 'delete' ? null : value.dataHash,
      expected: current ? { revision: current.revision, dataHash: current.dataHash } : null });
  }
  const body = { schema: 'intakelet.migration-batch', version: 1, spec, specId, page, baseline: clone(baselineInput), observed: clone(observed), review: clone(review), rows, issues, ready: issues.every(issue => issue.excluded) };
  requireValue(byteLength(canonical(body)) <= MIGRATION_LIMITS.batchBytes, 'batch_size', 'Review batch exceeds 3MiB; request smaller source pages');
  return seal(body, 'batchId');
}
export async function verifyMigrationBatch(input) {
  exact(input, ['schema', 'version', 'spec', 'specId', 'page', 'baseline', 'observed', 'review', 'rows', 'issues', 'ready', 'batchId']);
  requireValue(input.schema === 'intakelet.migration-batch' && input.version === 1, 'batch_version', 'Unsupported migration batch');
  const actual = await prepareMigrationBatch(input.spec, input.page, input.baseline, input.observed, input.review);
  requireValue(canonical(actual) === canonical(input), 'batch_integrity', 'Migration batch differs from its sources, mapping or destination observations'); return actual;
}
export async function inspectMigrationPage(specInput, pageInput, host) {
  const spec = validateMigrationSpec(specInput), page = validateSourcePage(pageInput), status = await host.status(spec.connectionId);
  const values = await candidates(spec, page), observed = await host.readRecords({ connectionId: spec.connectionId, ids: values.flatMap(value => value.id ? [value.id] : []), sourceKeys: page.items.map(item => item.id) });
  return prepareMigrationBatch(spec, page, { revision: status.revision, cursor: status.cursor, specId: status.specId }, observed);
}

async function ownedCall(callback, signal, timeoutMs, name) {
  aborted(signal); const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let finished = false, timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const end = (error, value) => { if (finished) return; finished = true; cleanup(); if (error) { controller.abort(); reject(error); } else resolve(value); };
    const cancel = () => end(new IntakeletError('aborted', 'Migration cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => end(new IntakeletError('operation_timeout', name + ' exceeded its deadline')), timeoutMs);
    Promise.resolve().then(() => { aborted(signal); requireValue(!finished, 'aborted', 'Operation no longer active'); return callback(controller.signal); }).then(value => end(null, value), error => end(error));
  });
}

function acknowledgedReceipt(receipt, plan) {
  try {
    exact(receipt, ['schema', 'version', 'workspaceId', 'connectionId', 'specId', 'batchId', 'revision', 'checkpoint', 'sourceDone', 'counts', 'excludedIds']);
    const counts = { created: 0, updated: 0, deleted: 0, unchanged: 0, excluded: plan.review.excludedIds.length };
    for (const row of plan.rows) counts[{ create: 'created', update: 'updated', delete: 'deleted', unchanged: 'unchanged' }[row.action]]++;
    requireValue(receipt.schema === 'intakelet.migration-receipt' && receipt.version === 1 && receipt.workspaceId === plan.spec.workspaceId && receipt.connectionId === plan.spec.connectionId && receipt.specId === plan.specId && receipt.batchId === plan.batchId && receipt.revision === plan.baseline.revision + 1 && receipt.sourceDone === plan.page.done && canonical(receipt.checkpoint) === canonical(plan.page.cursorAfter) && canonical(receipt.counts) === canonical(counts) && canonical(receipt.excludedIds) === canonical(plan.review.excludedIds), 'receipt', 'Receipt differs from the exact submitted batch');
    return clone(receipt);
  } catch { throw new IntakeletError('receipt_mismatch', 'The application did not acknowledge this exact batch. Its transaction may have been written; inspect the application receipt before retrying.', { unconfirmedBatchId: plan.batchId }); }
}

export async function runMigration({ spec: input, source, host, review, continuous = false, signal, maxBatches = Infinity, onReceipt, readTimeoutMs = 30000, reviewTimeoutMs = 1800000 } = {}) {
  const spec = validateMigrationSpec(input), specId = await migrationSpecId(spec);
  requireValue(source && typeof source.readPage === 'function' && canonical(source.identity) === canonical(spec.source), 'source', 'Source identity must match the reviewed migration definition');
  requireValue(host && ['status', 'claim', 'renew', 'release', 'readRecords', 'commitBatch'].every(method => typeof host[method] === 'function'), 'host', 'Provide a transactional migration host');
  requireValue(typeof continuous === 'boolean' && (continuous || typeof review === 'function') && (maxBatches === Infinity || Number.isSafeInteger(maxBatches) && maxBatches > 0), 'migration', 'Manual migration needs review; batch limits must be positive');
  requireValue(onReceipt === undefined || typeof onReceipt === 'function', 'migration', 'Receipt handlers must be functions');
  requireValue(Number.isSafeInteger(readTimeoutMs) && readTimeoutMs > 0 && readTimeoutMs <= 600000 && Number.isSafeInteger(reviewTimeoutMs) && reviewTimeoutMs > 0 && reviewTimeoutMs <= 86400000, 'migration', 'Declare bounded read/review deadlines');
  aborted(signal); const lease = await host.claim(spec, { continuous }); let status = 'paused', batches = 0, items = 0, lastReceipt = null, failure;
  try {
    while (batches < maxBatches) {
      aborted(signal); await host.renew(lease); const before = await host.status(spec.connectionId);
      requireValue(before.specId === specId, 'spec_changed', 'Migration definition changed');
      const page = validateSourcePage(await ownedCall(readSignal => source.readPage({ cursor: clone(before.cursor), limit: MIGRATION_LIMITS.items, signal: readSignal }), signal, readTimeoutMs, 'Source read')); aborted(signal);
      requireValue(canonical(page.cursorBefore) === canonical(before.cursor), 'source_cursor', 'Source returned a page for another cursor');
      if (page.done && !page.items.length && canonical(page.cursorBefore) === canonical(page.cursorAfter)) { status = 'complete'; break; }
      let plan = await inspectMigrationPage(spec, page, host), accepted = continuous;
      if (!continuous) {
        for (let round = 0; round < MIGRATION_LIMITS.reviewRounds; round++) {
          const decision = await ownedCall(reviewSignal => review(clone(plan), { signal: reviewSignal }), signal, reviewTimeoutMs, 'Batch review'); aborted(signal);
          if (decision?.decision === 'stop') { exact(decision, ['decision']); return { status: 'paused', batches, items, lastReceipt, checkpoint: (await host.status(spec.connectionId)).cursor }; }
          if (decision?.decision === 'revise') { exact(decision, ['decision', 'excludedIds']); plan = await prepareMigrationBatch(spec, page, plan.baseline, plan.observed, { excludedIds: decision.excludedIds }); continue; }
          exact(decision, ['decision', 'batchId']); requireValue(decision.decision === 'approve' && decision.batchId === plan.batchId && plan.ready, 'review', 'Approve this exact ready batch after its final review'); accepted = true; break;
        }
      }
      requireValue(accepted && plan.ready, 'review_required', 'Source rows or conflicts require review before this checkpoint can advance', plan.issues);
      aborted(signal); await host.renew(lease);
      const receipt = acknowledgedReceipt(await host.commitBatch(plan, { lease }), plan);
      // Report acknowledged work before observing cancellation. It cannot roll back.
      batches++; items += page.items.length; lastReceipt = receipt;
      if (onReceipt) { try { await onReceipt(clone(receipt)); } catch (error) { throw new IntakeletError('receipt_handler', 'The batch was committed, but the receipt handler failed', { receipt, cause: String(error.message) }); } }
      if (page.done) { status = 'complete'; break; }
    }
    return { status, batches, items, lastReceipt, checkpoint: (await host.status(spec.connectionId)).cursor };
  } catch (error) {
    failure = new IntakeletError(error.code || 'migration', error.message, { committedBatches: batches, committedItems: items, lastReceipt, cause: error.details ?? null }); throw failure;
  } finally {
    try { await host.release(lease); }
    catch (error) { if (failure) failure.details.releaseError = String(error.message); else throw new IntakeletError('lease_release', 'Migration work was acknowledged, but releasing the worker claim failed', { committedBatches: batches, lastReceipt, cause: String(error.message) }); }
  }
}

function pollDelay(milliseconds, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(new IntakeletError('aborted', 'Sync cancelled between polls')); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds); signal?.addEventListener('abort', cancel, { once: true });
  });
}
// An owned process loop, not a cloud scheduler. Each run claims the accepted
// route again; revocation, errors and cancellation stop further polls.
export async function syncMigration({ intervalMs = 60000, maxPolls = Infinity, maxBatches = 100, ...options } = {}) {
  requireValue(Number.isSafeInteger(intervalMs) && intervalMs > 0 && intervalMs <= 86400000 && (maxPolls === Infinity || Number.isSafeInteger(maxPolls) && maxPolls > 0), 'sync', 'Use a positive poll interval and poll budget');
  let polls = 0, batches = 0, items = 0, lastReceipt = null, checkpoint = null;
  try {
    while (polls < maxPolls) {
      aborted(options.signal); const result = await runMigration({ ...options, continuous: true, maxBatches }); polls++; batches += result.batches; items += result.items; lastReceipt = result.lastReceipt ?? lastReceipt; checkpoint = result.checkpoint;
      if (polls < maxPolls) await pollDelay(intervalMs, options.signal);
    }
    return { status: 'paused', polls, batches, items, lastReceipt, checkpoint };
  } catch (error) { const acknowledged = error.details?.lastReceipt ?? lastReceipt; throw new IntakeletError(error.code || 'sync', error.message, { completedPolls: polls, committedBatches: batches + (error.details?.committedBatches ?? 0), committedItems: items + (error.details?.committedItems ?? 0), lastReceipt: acknowledged, checkpoint: acknowledged ? acknowledged.checkpoint : checkpoint, cause: error.details ?? null }); }
}
