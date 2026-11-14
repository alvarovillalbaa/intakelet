import { emptyState, validateState, validateSnapshot, applyVerifiedPlan } from './host.mjs';
import { verifyPlan } from './plan.mjs';
import { workspace, label, canonical, clone, requireValue, IntakeletError } from './values.mjs';

function storageError(error) { return new IntakeletError(error?.name === 'QuotaExceededError' ? 'storage_quota' : 'storage', error?.name === 'QuotaExceededError' ? 'This device could not store the import. Existing data is unchanged; keep or export your review.' : 'Device storage is unavailable or invalid. Existing data was not reset.'); }
export function createIndexedDBHost({ workspaceId, databaseName = 'intakelet-v1' } = {}) {
  workspace(workspaceId); label(databaseName, 100); requireValue(databaseName.startsWith('intakelet-'), 'database', 'Use an Intakelet-owned database name');
  let connection, pending, closed = false;
  async function open() {
    requireValue(!closed, 'host_closed', 'This storage connection is closed');
    if (connection) return connection; if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new IntakeletError('storage', 'IndexedDB is unavailable')); return; }
      let request, finished = false;
      try { request = indexedDB.open(databaseName, 1); } catch (error) { reject(storageError(error)); return; }
      request.onupgradeneeded = event => { if (event.oldVersion === 0) request.result.createObjectStore('workspaces', { keyPath: 'workspaceId' }); else request.transaction.abort(); };
      request.onerror = () => { if (!finished) { finished = true; reject(storageError(request.error)); } };
      request.onblocked = () => { if (!finished) { finished = true; reject(new IntakeletError('storage_blocked', 'Close another version of this workspace before opening storage')); } };
      request.onsuccess = () => {
        const db = request.result;
        if (finished || closed || !db.objectStoreNames.contains('workspaces')) { db.close(); if (!finished) reject(new IntakeletError('storage', 'Storage schema is unavailable')); return; }
        finished = true; connection = db; db.onversionchange = () => { db.close(); connection = null; }; resolve(db);
      };
    });
    try { return await pending; } finally { pending = null; }
  }
  async function raw() {
    const db = await open();
    return new Promise((resolve, reject) => { let value, tx; try { tx = db.transaction('workspaces', 'readonly'); const request = tx.objectStore('workspaces').get(workspaceId); request.onsuccess = () => { value = request.result; }; } catch (error) { reject(storageError(error)); return; } tx.oncomplete = () => resolve(value === undefined ? emptyState(workspaceId) : value); tx.onabort = () => reject(storageError(tx.error)); tx.onerror = () => {}; });
  }
  return {
    async snapshot() { return validateSnapshot(await raw(), workspaceId); },
    async commit(input, { expectedRevision } = {}) {
      const plan = await verifyPlan(input), baseline = await validateSnapshot(await raw(), workspaceId), db = await open();
      requireValue(plan.workspaceId === workspaceId, 'workspace', 'Plan belongs to another workspace');
      return new Promise((resolve, reject) => {
        let tx, result, failure;
        try {
          tx = db.transaction('workspaces', 'readwrite'); const store = tx.objectStore('workspaces'), request = store.get(workspaceId);
          request.onsuccess = () => {
            try {
              const current = request.result ?? emptyState(workspaceId); validateState(current, workspaceId);
              requireValue(canonical(current) === canonical(baseline), 'conflict', 'Another tab changed the workspace; reload before importing');
              result = applyVerifiedPlan(current, plan, expectedRevision, workspaceId); if (!result.replayed) store.put(result.state);
            } catch (error) { failure = error; tx.abort(); }
          };
        } catch (error) { reject(storageError(error)); return; }
        tx.oncomplete = () => resolve(clone(result.receipt));
        tx.onabort = () => reject(failure || storageError(tx.error)); tx.onerror = () => {};
      });
    },
    async exportRaw() { return clone(await raw()); },
    close() { closed = true; connection?.close(); connection = null; }
  };
}
