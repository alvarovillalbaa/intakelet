import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, lstat, realpath, open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateMigrationSpec, migrationSpecId, verifyMigrationBatch, migrationCursor } from './migration.mjs';
import { exact, workspace, label, canonical, clone, parseJSON, requireValue, byteLength, IntakeletError } from './values.mjs';
import { SQLITE_SCHEMA_VERSION, SQLITE_SCHEMA_OBJECTS, SQLITE_SCHEMA_SQL } from './sqlite-schema-v1.mjs';

const options = workerData.options;
const defaults = { leaseMs: 60000, maxRecords: 10000, maxReceipts: 10000, maxJournalBytes: 33554432, maxDatabaseBytes: 67108864, busyTimeoutMs: 100 };
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const schemaHash = sha(SQLITE_SCHEMA_SQL);
let db, settings;
function query(method, sql, args = []) { const statement = db.prepare(sql); try { return statement[method](...args); } finally { statement.close(); } }
const get = (sql, ...args) => query('get', sql, args);
const run = (sql, ...args) => query('run', sql, args);
const now = () => { const value = Date.now(); requireValue(Number.isSafeInteger(value + settings.leaseMs) && value >= 0, 'clock', 'SQLite host needs a valid lease clock.'); return value; };

function validateSettings(value) {
  exact(value, Object.keys(defaults));
  for (const [key, maximum] of [['leaseMs', 600000], ['maxRecords', 1000000000], ['maxReceipts', 10000000], ['maxJournalBytes', 1073741824], ['maxDatabaseBytes', 2147483648], ['busyTimeoutMs', 1000]]) {
    const minimum = key === 'leaseMs' ? 1000 : key.endsWith('Bytes') ? 65536 : key === 'busyTimeoutMs' ? 0 : 1;
    requireValue(Number.isSafeInteger(value[key]) && value[key] >= minimum && value[key] <= maximum, 'sqlite_settings', 'SQLite budgets must be bounded safe integers.');
  }
  requireValue(value.maxJournalBytes <= value.maxDatabaseBytes, 'sqlite_settings', 'Journal budget must fit the database budget.');
  return value;
}
function transaction(callback, immediate = true) {
  let began = false, commitAttempted = false;
  try { db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN'); began = true; const value = callback(); commitAttempted = true; db.exec('COMMIT'); return value; }
  catch (error) {
    let rolledBack = !began || !commitAttempted;
    if (began && db.isTransaction) { try { db.exec('ROLLBACK'); rolledBack = !db.isTransaction; } catch { rolledBack = false; } }
    if (error instanceof IntakeletError && rolledBack) throw error;
    throw new IntakeletError('sqlite_storage', 'SQLite transaction failed; no receipt is acknowledged.', { sqliteCode: Number.isInteger(error.errcode) ? error.errcode : null, unconfirmed: !rolledBack });
  }
}
function checkSchema() {
  const normalize = sql => sql.replace(/\s+/g, ' ').trim();
  const actual = query('all', "SELECT name, type, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name");
  const expected = [...SQLITE_SCHEMA_OBJECTS].sort((a, b) => a.name.localeCompare(b.name));
  requireValue(actual.length === expected.length && actual.every((row, index) => row.name === expected[index].name && row.type === expected[index].type && normalize(row.sql) === normalize(expected[index].sql)), 'sqlite_schema', 'SQLite schema differs from the supported immutable version.');
  requireValue(get('PRAGMA user_version').user_version === SQLITE_SCHEMA_VERSION, 'sqlite_schema', 'SQLite schema version is unsupported.');
}
async function start() {
  workspace(options.workspaceId);
  requireValue(options.readOnly === undefined || typeof options.readOnly === 'boolean', 'sqlite_open', 'Declare read-only mode explicitly.');
  requireValue(!workerData.initialize || !options.readOnly, 'sqlite_open', 'Initialization requires a writable new store.');
  const artifact = await readFile(new URL('./sqlite-host-v1.sql', import.meta.url), 'utf8');
  requireValue(artifact === SQLITE_SCHEMA_SQL, 'sqlite_schema', 'Packaged schema differs from its generator.');
  if (workerData.initialize) await mkdir(options.directory, { mode: 0o700 });
  const directory = await lstat(options.directory);
  requireValue(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o077) === 0 && typeof process.getuid === 'function' && directory.uid === process.getuid(), 'sqlite_directory', 'Use a private application-owned directory on a supported local filesystem.');
  const path = join(await realpath(options.directory), 'intakelet.sqlite');
  if (workerData.initialize) { const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); await handle.close(); }
  const file = await lstat(path);
  requireValue(file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0 && file.uid === process.getuid() && (workerData.initialize || file.size > 0), 'sqlite_file', 'Use a private initialized regular database file.');
  const busyTimeoutMs = options.busyTimeoutMs ?? defaults.busyTimeoutMs;
  requireValue(Number.isSafeInteger(busyTimeoutMs) && busyTimeoutMs >= 0 && busyTimeoutMs <= 1000, 'sqlite_settings', 'Use a bounded SQLite lock wait.');
  db = new DatabaseSync(path, { readOnly: options.readOnly ?? false, allowExtension: false, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, defensive: true, timeout: busyTimeoutMs });
  db.exec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA synchronous = FULL;');
  if (workerData.initialize) {
    settings = validateSettings(Object.fromEntries(Object.keys(defaults).map(key => [key, options[key] ?? defaults[key]])));
    db.exec('PRAGMA journal_mode = DELETE;');
    transaction(() => {
      db.exec(artifact); db.exec('PRAGMA user_version = ' + SQLITE_SCHEMA_VERSION);
      run('INSERT INTO intakelet_meta VALUES (1, ?, ?, ?, ?)', SQLITE_SCHEMA_VERSION, schemaHash, options.workspaceId, canonical(settings));
    });
  }
  checkSchema();
  const meta = get('SELECT * FROM intakelet_meta WHERE singleton = 1');
  requireValue(meta && meta.workspace_id === options.workspaceId, 'workspace', 'SQLite store belongs to another trusted workspace.');
  requireValue(meta.schema_version === SQLITE_SCHEMA_VERSION && meta.schema_hash === schemaHash && byteLength(meta.settings) < 4096, 'sqlite_schema', 'SQLite store metadata is unsupported.');
  settings = validateSettings(parseJSON(meta.settings));
  for (const key of Object.keys(defaults)) requireValue(options[key] === undefined || options[key] === settings[key], 'sqlite_settings', 'Opening a store cannot silently change its budgets.');
  db.exec('PRAGMA busy_timeout = ' + settings.busyTimeoutMs);
  requireValue(file.size <= settings.maxDatabaseBytes, 'sqlite_quota', 'Database exceeds its declared byte budget.');
  const pageSize = get('PRAGMA page_size').page_size;
  requireValue(Number.isSafeInteger(pageSize) && pageSize > 0, 'sqlite_schema', 'Invalid SQLite page size.');
  if (!options.readOnly) db.exec('PRAGMA max_page_count = ' + Math.floor(settings.maxDatabaseBytes / pageSize));
}
function connection(id) { return get('SELECT * FROM intakelet_connections WHERE id = ?', id); }
function bindConnection(spec, specId) {
  const previous = connection(spec.connectionId);
  requireValue(!previous || previous.spec_id === specId, 'spec_changed', 'Use a new connection for a changed source/output contract.');
  if (!previous) run('INSERT INTO intakelet_connections (id, spec_id) VALUES (?, ?)', spec.connectionId, specId);
  return previous ?? connection(spec.connectionId);
}
function checkLease(lease, expired = false) {
  exact(lease, ['connectionId', 'specId', 'token', 'continuous', 'routeId']);
  const current = connection(lease.connectionId);
  requireValue(current && current.lease_token === lease.token && current.spec_id === lease.specId && Boolean(current.continuous) === lease.continuous && current.route_id === lease.routeId, 'lease_lost', 'This worker no longer owns the connection.');
  requireValue(expired || current.lease_deadline > now(), 'lease_expired', 'Renew the connection claim before writing.');
  requireValue(!lease.continuous || get('SELECT route_id FROM intakelet_routes WHERE connection_id = ?', lease.connectionId)?.route_id === lease.routeId, 'route_required', 'The complete accepted route was revoked or replaced.');
  return current;
}
function record(row) {
  if (!row) return null;
  const data = parseJSON(row.data);
  requireValue(byteLength(row.data) <= 524288 && canonical(data) === row.data && sha(row.data) === row.data_hash && /^sha256:[a-f0-9]{64}$/.test(row.imported_hash), 'sqlite_integrity', 'Stored record bytes/hash are inconsistent.');
  return { id: row.id, connectionId: row.connection_id, sourceKey: row.source_key, data, dataHash: row.data_hash, importedHash: row.imported_hash, revision: row.revision };
}
function receiptFor(plan) {
  requireValue(plan.ready, 'review_required', 'Unresolved rows cannot be committed.');
  const counts = { created: 0, updated: 0, deleted: 0, unchanged: 0, excluded: plan.review.excludedIds.length };
  for (const row of plan.rows) counts[{ create: 'created', update: 'updated', delete: 'deleted', unchanged: 'unchanged' }[row.action]]++;
  return { schema: 'intakelet.migration-receipt', version: 1, workspaceId: options.workspaceId, connectionId: plan.spec.connectionId, specId: plan.specId, batchId: plan.batchId, revision: plan.baseline.revision + 1, checkpoint: migrationCursor(plan.page.cursorAfter), sourceDone: plan.page.done, counts, excludedIds: clone(plan.review.excludedIds) };
}
const methods = {
  async acceptRoute(input, { acceptedBy } = {}) {
    const spec = validateMigrationSpec(input); requireValue(spec.workspaceId === options.workspaceId, 'workspace', 'Route belongs to another workspace.'); workspace(acceptedBy);
    const specId = await migrationSpecId(spec), route = { schema: 'intakelet.accepted-route', version: 1, workspaceId: options.workspaceId, connectionId: spec.connectionId, spec, specId, acceptedBy };
    route.routeId = sha(canonical(route));
    return transaction(() => {
      const current = bindConnection(spec, specId);
      run('INSERT INTO intakelet_routes VALUES (?, ?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET spec_id = excluded.spec_id, route_id = excluded.route_id, payload = excluded.payload', spec.connectionId, specId, route.routeId, canonical(route));
      if (current.continuous && current.route_id !== route.routeId) run('UPDATE intakelet_connections SET lease_token = NULL, lease_deadline = NULL, continuous = 0, route_id = NULL WHERE id = ?', spec.connectionId);
      return route;
    });
  },
  revokeRoute(connectionId) {
    workspace(connectionId);
    return transaction(() => { run('DELETE FROM intakelet_routes WHERE connection_id = ?', connectionId); run('UPDATE intakelet_connections SET lease_token = NULL, lease_deadline = NULL, continuous = 0, route_id = NULL WHERE id = ? AND continuous = 1', connectionId); return null; });
  },
  status(connectionId) {
    workspace(connectionId);
    const row = get('SELECT c.*, (SELECT spec_id FROM intakelet_routes WHERE connection_id = c.id) AS accepted_spec FROM intakelet_connections AS c WHERE id = ?', connectionId);
    return { revision: row?.revision ?? 0, cursor: row ? parseJSON(row.cursor) : null, specId: row?.spec_id ?? null, acceptedSpecId: row?.accepted_spec ?? null };
  },
  async claim(input, { continuous = false } = {}) {
    const spec = validateMigrationSpec(input); requireValue(spec.workspaceId === options.workspaceId && typeof continuous === 'boolean', 'workspace', 'Migration belongs to another workspace.');
    const specId = await migrationSpecId(spec);
    return transaction(() => {
      const current = bindConnection(spec, specId), route = get('SELECT * FROM intakelet_routes WHERE connection_id = ?', spec.connectionId), time = now();
      requireValue(!continuous || route?.spec_id === specId, 'route_required', 'Continuous sync requires an accepted complete route.');
      requireValue(!current.lease_token || current.lease_deadline <= time, 'lease_busy', 'Another worker owns this connection.');
      requireValue(current.lease_fence < Number.MAX_SAFE_INTEGER, 'revision', 'Worker fence exhausted.');
      const fence = current.lease_fence + 1, lease = { connectionId: spec.connectionId, specId, token: fence + ':' + randomUUID(), continuous, routeId: continuous ? route.route_id : null };
      run('UPDATE intakelet_connections SET lease_token = ?, lease_fence = ?, lease_deadline = ?, continuous = ?, route_id = ? WHERE id = ?', lease.token, fence, time + settings.leaseMs, continuous ? 1 : 0, lease.routeId, spec.connectionId);
      return lease;
    });
  },
  renew(lease) { return transaction(() => { checkLease(lease, true); run('UPDATE intakelet_connections SET lease_deadline = ? WHERE id = ?', now() + settings.leaseMs, lease.connectionId); return null; }); },
  release(lease) {
    exact(lease, ['connectionId', 'specId', 'token', 'continuous', 'routeId']);
    return transaction(() => {
      const current = connection(lease.connectionId); if (!current || current.lease_token !== lease.token || current.spec_id !== lease.specId) return false;
      run('UPDATE intakelet_connections SET lease_token = NULL, lease_deadline = NULL, continuous = 0, route_id = NULL WHERE id = ?', lease.connectionId); return true;
    });
  },
  readRecords({ connectionId, ids, sourceKeys }) {
    workspace(connectionId);
    requireValue(Array.isArray(ids) && ids.length <= 500 && Array.isArray(sourceKeys) && sourceKeys.length <= 500, 'read', 'Request at most500 target/source identities.');
    ids.forEach(id => label(id, 300)); sourceKeys.forEach(key => label(key, 300));
    return transaction(() => {
      const selected = new Set(ids), result = []; let bytes = 2;
      for (const key of sourceKeys) { const row = get('SELECT id FROM intakelet_records WHERE connection_id = ? AND source_key = ?', connectionId, key); if (row) selected.add(row.id); }
      for (const id of selected) {
        const value = record(get('SELECT * FROM intakelet_records WHERE id = ?', id));
        if (value) { bytes += byteLength(canonical(value)) + 1; requireValue(bytes <= 3145728, 'read', 'Destination observations exceed3MiB; request a smaller page.'); result.push(value); }
      }
      return result;
    }, false);
  },
  async commitBatch(input, { lease } = {}) {
    const plan = await verifyMigrationBatch(input);
    requireValue(plan.spec.workspaceId === options.workspaceId && plan.spec.connectionId === lease?.connectionId && plan.specId === lease.specId, 'workspace', 'Batch/lease belongs to another connection.');
    return transaction(() => {
      const replay = get('SELECT batch, receipt FROM intakelet_receipts WHERE batch_id = ?', plan.batchId);
      if (replay) { const receipt = receiptFor(plan); requireValue(replay.batch === canonical(plan) && replay.receipt === canonical(receipt), 'sqlite_integrity', 'Stored batch/receipt differs from its committed identity.'); return receipt; }
      const current = checkLease(lease);
      requireValue(plan.ready, 'review_required', 'Unresolved rows cannot be committed.');
      requireValue(current.revision === plan.baseline.revision && current.cursor === canonical(plan.baseline.cursor), 'conflict', 'Accepted checkpoint changed; reread and review.');
      const journal = get('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM intakelet_receipts');
      requireValue(journal.count < settings.maxReceipts && current.revision < Number.MAX_SAFE_INTEGER, 'host_quota', 'Receipt/revision budget exhausted.');
      for (const row of plan.rows) {
        const target = row.id === null ? null : record(get('SELECT * FROM intakelet_records WHERE id = ?', row.id));
        const managed = get('SELECT id FROM intakelet_records WHERE connection_id = ? AND source_key = ?', plan.spec.connectionId, row.sourceKey);
        requireValue(!managed || managed.id === row.id, 'record_conflict', 'Source identity already owns another target.');
        requireValue(row.expected === null ? !target : target && target.revision === row.expected.revision && target.dataHash === row.expected.dataHash, 'record_conflict', 'Destination changed after review.');
        if (target) requireValue(target.connectionId === plan.spec.connectionId && target.sourceKey === row.sourceKey && target.dataHash === target.importedHash, 'record_conflict', 'Destination ownership or local data changed.');
        if (row.action === 'create' || row.action === 'update') {
          const revision = (target?.revision ?? 0) + 1; requireValue(Number.isSafeInteger(revision), 'revision', 'Record revision exhausted.');
          run('INSERT INTO intakelet_records VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, data_hash = excluded.data_hash, imported_hash = excluded.imported_hash, revision = excluded.revision', row.id, plan.spec.connectionId, row.sourceKey, canonical(row.data), row.dataHash, row.dataHash, revision);
        } else if (row.action === 'delete') run('DELETE FROM intakelet_records WHERE id = ?', row.id);
      }
      requireValue(get('SELECT COUNT(*) AS count FROM intakelet_records').count <= settings.maxRecords, 'host_quota', 'Record budget exhausted; this batch was not committed.');
      const receipt = receiptFor(plan), revision = receipt.revision, checkpoint = receipt.checkpoint;
      const batchJSON = canonical(plan), receiptJSON = canonical(receipt), bytes = byteLength(batchJSON) + byteLength(receiptJSON);
      requireValue(journal.bytes + bytes <= settings.maxJournalBytes, 'host_quota', 'Durable receipt byte budget exhausted.');
      run('UPDATE intakelet_connections SET revision = ?, cursor = ? WHERE id = ?', revision, canonical(checkpoint), plan.spec.connectionId);
      run('INSERT INTO intakelet_receipts VALUES (?, ?, ?, ?, ?)', plan.batchId, plan.spec.connectionId, receiptJSON, batchJSON, bytes);
      return receipt;
    });
  },
  inspectRecord(id) { label(id, 300); return record(get('SELECT * FROM intakelet_records WHERE id = ?', id)); },
  async inspectBatch(id) {
    label(id, 100); const row = get('SELECT batch, receipt FROM intakelet_receipts WHERE batch_id = ?', id); if (!row) return null;
    const batch = await verifyMigrationBatch(parseJSON(row.batch)), receipt = receiptFor(batch);
    requireValue(batch.batchId === id && batch.spec.workspaceId === options.workspaceId && row.batch === canonical(batch) && row.receipt === canonical(receipt), 'sqlite_integrity', 'Stored receipt failed its derivation check.');
    return { batch, receipt };
  },
  editLocal(id, data, { expectedRevision } = {}) {
    label(id, 300); const text = canonical(data); requireValue(byteLength(text) <= 524288, 'output_size', 'Local destination record exceeds512KiB.');
    return transaction(() => { const current = get('SELECT revision FROM intakelet_records WHERE id = ?', id); requireValue(current && current.revision === expectedRevision && current.revision < Number.MAX_SAFE_INTEGER, 'record_conflict', 'Local destination changed.'); run('UPDATE intakelet_records SET data = ?, data_hash = ?, revision = revision + 1 WHERE id = ?', text, sha(text), id); return null; });
  },
  close() { db.close(); db = null; return null; },
};
function errorValue(error) {
  return error instanceof IntakeletError ? { code: error.code, message: error.message, details: error.details }
    : { code: 'sqlite_storage', message: 'SQLite storage could not complete the operation.', details: { sqliteCode: Number.isInteger(error.errcode) ? error.errcode : null } };
}
try {
  await start();
  let queue = Promise.resolve();
  parentPort.on('message', message => {
    queue = queue.then(async () => {
      try {
        requireValue(Number.isSafeInteger(message.id) && Object.hasOwn(methods, message.operation) && Array.isArray(message.args), 'sqlite_request', 'Unsupported SQLite operation.');
        const result = await methods[message.operation](...message.args);
        requireValue(byteLength(canonical(result)) <= 4194304, 'sqlite_response', 'SQLite response exceeds4MiB.');
        parentPort.postMessage({ id: message.id, result });
        if (message.operation === 'close') parentPort.close();
      } catch (error) { parentPort.postMessage({ id: message.id, error: errorValue(error) }); }
    }).catch(() => { try { db?.close(); } finally { parentPort.close(); } });
  });
  parentPort.postMessage({ ready: true });
} catch (error) {
  try { db?.close(); } finally { parentPort.postMessage({ ready: false, error: errorValue(error) }); parentPort.close(); }
}
