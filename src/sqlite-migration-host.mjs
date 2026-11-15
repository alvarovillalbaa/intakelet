import { Worker } from 'node:worker_threads';
import { isAbsolute } from 'node:path';
import { IntakeletError, requireValue, workspace, canonical, byteLength } from './values.mjs';

const construct = Symbol('SQLiteMigrationHost');
const decodeError = value => new IntakeletError(value?.code || 'sqlite_worker', value?.message || 'SQLite worker failed.', value?.details ?? null);

/** Application-owned server storage. This class authenticates no caller. */
export class SQLiteMigrationHost {
  #worker; #ready; #exited; #pending = new Map(); #sequence = 0; #timeout; #closing = false; #closed = false;
  constructor(options, token) {
    requireValue(token === construct, 'sqlite_open', 'Use SQLiteMigrationHost.initialize or open.');
    const allowed = ['directory', 'workspaceId', 'leaseMs', 'maxRecords', 'maxReceipts', 'maxJournalBytes', 'maxDatabaseBytes', 'busyTimeoutMs', 'operationTimeoutMs', 'readOnly'];
    requireValue(options && Object.keys(options).every(key => allowed.includes(key)) && typeof options.directory === 'string' && isAbsolute(options.directory), 'sqlite_open', 'Provide an explicit absolute private store directory.');
    workspace(options.workspaceId);
    this.#timeout = options.operationTimeoutMs ?? 15000;
    requireValue(Number.isSafeInteger(this.#timeout) && this.#timeout >= 1000 && this.#timeout <= 60000, 'sqlite_open', 'Use a bounded SQLite operation deadline.');
    let ready, rejectReady, exit;
    this.#ready = new Promise((yes, no) => { ready = yes; rejectReady = no; });
    this.#exited = new Promise(yes => { exit = yes; });
    this.#worker = new Worker(new URL('./sqlite-migration-worker.mjs', import.meta.url), {
      workerData: { options: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)), initialize: options[construct] === true },
    });
    const timer = setTimeout(() => this.#fail(new IntakeletError('sqlite_timeout', 'SQLite initialization exceeded its deadline.'), rejectReady), this.#timeout);
    this.#worker.on('message', message => {
      if (Object.hasOwn(message, 'ready')) {
        clearTimeout(timer);
        if (message.ready) ready(); else rejectReady(decodeError(message.error));
        return;
      }
      const pending = this.#pending.get(message.id); if (!pending) return;
      this.#pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(decodeError(message.error)); else pending.resolve(message.result);
    });
    this.#worker.on('error', () => this.#fail(new IntakeletError('sqlite_worker', 'SQLite worker failed; a pending write is unconfirmed.'), rejectReady));
    this.#worker.on('exit', code => {
      clearTimeout(timer); this.#closed = true; exit(code);
      if (!this.#closing || this.#pending.size) this.#fail(new IntakeletError('sqlite_worker', 'SQLite worker exited before closing its pending operation.', { exitCode: code }), rejectReady, false);
    });
  }
  static async #start(options, initialize) {
    const host = new SQLiteMigrationHost({ ...options, [construct]: initialize }, construct);
    try { await host.#ready; return host; }
    catch (error) { await host.#finishExit(); throw error; }
  }
  static initialize(options) { return this.#start(options, true); }
  static open(options) { return this.#start(options, false); }
  #fail(error, rejectReady, terminate = true) {
    this.#closed = true; rejectReady?.(error);
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
    if (terminate) void this.#worker.terminate().catch(() => {});
  }
  async #finishExit() {
    let timer;
    try { return await Promise.race([this.#exited, new Promise((_, reject) => { timer = setTimeout(async () => { await this.#worker.terminate(); reject(new IntakeletError('sqlite_close', 'SQLite worker did not exit normally.')); }, this.#timeout); })]); }
    finally { clearTimeout(timer); }
  }
  async #call(operation, args, closing = false) {
    await this.#ready;
    requireValue(!this.#closed && (!this.#closing || closing), 'sqlite_closed', 'SQLite host is closing or closed.');
    requireValue(byteLength(canonical(args)) <= 4194304, 'sqlite_request', 'SQLite request exceeds 4MiB.');
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(new IntakeletError('sqlite_timeout', 'SQLite operation exceeded its deadline; its write is unconfirmed.', { operation })), this.#timeout);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#worker.postMessage({ id, operation, args }); }
      catch { this.#pending.delete(id); clearTimeout(timer); reject(new IntakeletError('sqlite_request', 'SQLite request could not be transferred.')); }
    });
  }
  acceptRoute(spec, options = {}) { return this.#call('acceptRoute', [spec, options]); }
  revokeRoute(connectionId) { return this.#call('revokeRoute', [connectionId]); }
  status(connectionId) { return this.#call('status', [connectionId]); }
  claim(spec, options = {}) { return this.#call('claim', [spec, options]); }
  renew(lease) { return this.#call('renew', [lease]); }
  release(lease) { return this.#call('release', [lease]); }
  readRecords(query) { return this.#call('readRecords', [query]); }
  commitBatch(batch, options = {}) { return this.#call('commitBatch', [batch, options]); }
  inspectRecord(id) { return this.#call('inspectRecord', [id]); }
  inspectBatch(id) { return this.#call('inspectBatch', [id]); }
  editLocal(id, data, options = {}) { return this.#call('editLocal', [id, data, options]); }
  async close() {
    if (!this.#closing && !this.#closed) { this.#closing = true; await this.#call('close', [], true); }
    const code = await this.#finishExit();
    requireValue(code === 0, 'sqlite_close', 'SQLite worker did not close normally.', { exitCode: code });
  }
}
