import { validateMigrationSpec, migrationSpecId, verifyMigrationBatch, migrationCursor } from './migration.mjs';
import { exact, workspace, label, clone, canonical, sha256, requireValue, byteLength } from './values.mjs';

// An executable reference for the host transaction contract. Production hosts
// bind authenticated context and implement these operations in their own store.
export class MemoryMigrationHost {
  #workspace; #connections = new Map(); #records = new Map(); #sources = new Map(); #receipts = new Map(); #accepted = new Map(); #now; #leaseMs; #maxRecords; #maxReceipts;
  constructor({ workspaceId, leaseMs = 60000, maxRecords = 10000, maxReceipts = 10000, now = Date.now } = {}) {
    this.#workspace = workspace(workspaceId);
    requireValue(Number.isSafeInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 600000 && Number.isSafeInteger(maxRecords) && maxRecords > 0 && Number.isSafeInteger(maxReceipts) && maxReceipts > 0 && typeof now === 'function', 'host', 'Invalid reference-host budgets');
    this.#leaseMs = leaseMs; this.#maxRecords = maxRecords; this.#maxReceipts = maxReceipts; this.#now = now;
  }
  #time() { const now = this.#now(); requireValue(Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(now + this.#leaseMs), 'clock', 'The host needs a valid lease clock'); return now; }
  #sourceKey(connectionId, sourceKey) { return canonical([connectionId, sourceKey]); }
  async acceptRoute(input, { acceptedBy } = {}) {
    const spec = validateMigrationSpec(input); requireValue(spec.workspaceId === this.#workspace, 'workspace', 'Route belongs to another workspace'); workspace(acceptedBy);
    const specId = await migrationSpecId(spec), previous = this.#connections.get(spec.connectionId);
    requireValue(!previous || previous.specId === specId, 'spec_changed', 'Use a new connection for a changed source/output contract');
    const route = { schema: 'intakelet.accepted-route', version: 1, workspaceId: this.#workspace, connectionId: spec.connectionId, spec: clone(spec), specId, acceptedBy };
    route.routeId = 'sha256:' + await sha256(canonical(route));
    const current = this.#connections.get(spec.connectionId); requireValue(!current || current.specId === specId, 'spec_changed', 'Connection changed before route acceptance');
    this.#accepted.set(spec.connectionId, route); return clone(route);
  }
  revokeRoute(connectionId) { workspace(connectionId); this.#accepted.delete(connectionId); const connection = this.#connections.get(connectionId); if (connection?.lease?.continuous) connection.lease = null; }
  async status(connectionId) {
    workspace(connectionId); const connection = this.#connections.get(connectionId);
    return { revision: connection?.revision ?? 0, cursor: clone(connection?.cursor ?? null), specId: connection?.specId ?? null, acceptedSpecId: this.#accepted.get(connectionId)?.specId ?? null };
  }
  async claim(input, { continuous = false } = {}) {
    const spec = validateMigrationSpec(input); requireValue(spec.workspaceId === this.#workspace && typeof continuous === 'boolean', 'workspace', 'Migration belongs to another workspace');
    const specId = await migrationSpecId(spec), route = this.#accepted.get(spec.connectionId), now = this.#time();
    requireValue(!continuous || route?.specId === specId, 'route_required', 'Continuous sync requires an explicitly accepted complete source/output route');
    const connection = this.#connections.get(spec.connectionId) ?? { revision: 0, cursor: null, specId, lease: null };
    requireValue(connection.specId === specId, 'spec_changed', 'Connection source/output contract changed');
    requireValue(!connection.lease || connection.lease.expiresAt <= now, 'lease_busy', 'Another worker owns this connection');
    const lease = { connectionId: spec.connectionId, specId, token: crypto.randomUUID(), continuous, routeId: continuous ? route.routeId : null };
    connection.lease = { ...lease, expiresAt: now + this.#leaseMs }; this.#connections.set(spec.connectionId, connection); return clone(lease);
  }
  #checkLease(lease, { expired = false } = {}) {
    exact(lease, ['connectionId', 'specId', 'token', 'continuous', 'routeId']); const connection = this.#connections.get(lease.connectionId), owner = connection?.lease;
    requireValue(owner && owner.token === lease.token && owner.specId === lease.specId && owner.continuous === lease.continuous && owner.routeId === lease.routeId, 'lease_lost', 'This worker no longer owns the connection');
    requireValue(expired || owner.expiresAt > this.#time(), 'lease_expired', 'Renew the connection claim before writing');
    requireValue(!lease.continuous || this.#accepted.get(lease.connectionId)?.routeId === lease.routeId, 'route_required', 'The accepted sync route was revoked or replaced'); return connection;
  }
  async renew(lease) { const connection = this.#checkLease(lease, { expired: true }); connection.lease.expiresAt = this.#time() + this.#leaseMs; }
  async release(lease) { const connection = this.#connections.get(lease.connectionId); if (connection?.lease?.token !== lease.token) return false; connection.lease = null; return true; }
  async readRecords({ connectionId, ids, sourceKeys }) {
    workspace(connectionId); requireValue(Array.isArray(ids) && ids.length <= 500 && Array.isArray(sourceKeys) && sourceKeys.length <= 500, 'read', 'Request at most 500 target/source identities');
    const selected = new Set(ids); for (const key of sourceKeys) { label(key, 300); const id = this.#sources.get(this.#sourceKey(connectionId, key)); if (id) selected.add(id); }
    return [...selected].flatMap(id => this.#records.has(id) ? [clone(this.#records.get(id))] : []);
  }
  async commitBatch(input, { lease } = {}) {
    const plan = await verifyMigrationBatch(input);
    requireValue(plan.spec.workspaceId === this.#workspace && plan.spec.connectionId === lease?.connectionId && plan.specId === lease.specId, 'workspace', 'Batch/lease belongs to another connection');
    const replay = this.#receipts.get(plan.batchId); if (replay) return clone(replay.receipt);
    const connection = this.#checkLease(lease);
    requireValue(plan.ready, 'review_required', 'Unresolved rows cannot be committed');
    requireValue(connection.revision === plan.baseline.revision && canonical(connection.cursor) === canonical(plan.baseline.cursor), 'conflict', 'The accepted checkpoint changed; reread and review before retrying');
    requireValue(this.#receipts.size < this.#maxReceipts && connection.revision < Number.MAX_SAFE_INTEGER, 'host_quota', 'Reference-host receipt/revision budget exhausted');
    // No await below this point: validate every precondition, build a new state,
    // then swap records and checkpoint together as the transaction boundary.
    const records = new Map(this.#records), sources = new Map(this.#sources), counts = { created: 0, updated: 0, deleted: 0, unchanged: 0, excluded: plan.review.excludedIds.length };
    for (const row of plan.rows) {
      const current = row.id === null ? null : records.get(row.id), managedId = sources.get(this.#sourceKey(plan.spec.connectionId, row.sourceKey));
      requireValue(!managedId || managedId === row.id, 'record_conflict', 'Source identity already owns another target');
      requireValue(row.expected === null ? !current : current && current.revision === row.expected.revision && current.dataHash === row.expected.dataHash, 'record_conflict', 'Destination changed after review; no part of this batch was written');
      if (current) requireValue(current.connectionId === plan.spec.connectionId && current.sourceKey === row.sourceKey && current.dataHash === current.importedHash, 'record_conflict', 'Destination ownership or local data changed');
      if (row.action === 'create' || row.action === 'update') {
        const revision = (current?.revision ?? 0) + 1; requireValue(Number.isSafeInteger(revision), 'revision', 'Record revision exhausted');
        records.set(row.id, { id: row.id, connectionId: plan.spec.connectionId, sourceKey: row.sourceKey, data: clone(row.data), dataHash: row.dataHash, importedHash: row.dataHash, revision });
        sources.set(this.#sourceKey(plan.spec.connectionId, row.sourceKey), row.id); counts[row.action === 'create' ? 'created' : 'updated']++;
      } else if (row.action === 'delete') { records.delete(row.id); sources.delete(this.#sourceKey(plan.spec.connectionId, row.sourceKey)); counts.deleted++; }
      else counts.unchanged++;
    }
    requireValue(records.size <= this.#maxRecords, 'host_quota', 'Reference-host record budget exhausted; current batch was not written');
    const revision = connection.revision + 1, checkpoint = migrationCursor(plan.page.cursorAfter);
    const receipt = { schema: 'intakelet.migration-receipt', version: 1, workspaceId: this.#workspace, connectionId: plan.spec.connectionId, specId: plan.specId, batchId: plan.batchId, revision, checkpoint, sourceDone: plan.page.done, counts, excludedIds: clone(plan.review.excludedIds) };
    this.#records = records; this.#sources = sources; connection.revision = revision; connection.cursor = checkpoint;
    this.#receipts.set(plan.batchId, { receipt: clone(receipt), batch: plan }); return clone(receipt);
  }
  async inspectRecord(id) { return this.#records.has(id) ? clone(this.#records.get(id)) : null; }
  async inspectBatch(id) { return this.#receipts.has(id) ? clone(this.#receipts.get(id)) : null; }
  async editLocal(id, data, { expectedRevision } = {}) {
    requireValue(byteLength(canonical(data)) <= 524288, 'output_size', 'Local reference record exceeds 512KiB'); const dataHash = 'sha256:' + await sha256(canonical(data)), current = this.#records.get(id);
    requireValue(current && current.revision === expectedRevision && current.revision < Number.MAX_SAFE_INTEGER, 'record_conflict', 'Local destination record changed');
    this.#records.set(id, { ...current, data: clone(data), dataHash, revision: current.revision + 1 });
  }
}
