import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { pagedSource } from './sqlite-contract.mjs';
const require = createRequire(pathToFileURL(process.env.INTAKELET_SQLITE_CONSUMER + '/package.json'));
const { SQLiteMigrationHost } = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration/node')));
const { runMigration } = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration')));
globalThis.fetch = () => { throw new Error('Network is forbidden in authored SQLite acceptance.'); };
let host;
try {
  host = await SQLiteMigrationHost.open({ directory: process.env.INTAKELET_SQLITE_DIRECTORY, workspaceId: 'authored-workspace' });
  process.send({ ready: true });
} catch (error) { process.send({ ready: false, code: error.code || 'child' }); process.disconnect(); }
let queue = Promise.resolve();
process.on('message', message => {
  queue = queue.then(async () => {
    try {
      if (message.operation === 'run') {
        const calls = [], { spec, pages, maxBatches = 100 } = message.args[0];
        const result = await runMigration({ spec, source: pagedSource(spec, pages, calls), host,
          maxBatches, review: batch => ({ decision: 'approve', batchId: batch.batchId }) });
        process.send({ id: message.id, result: { ...result, reads: calls } });
      } else if (message.operation === 'commitWithoutReply') {
        const receipt = await host.commitBatch(...message.args);
        // Observer notification is not the withheld caller's receipt.
        process.send({ observedCommit: true, id: message.id, batchId: receipt.batchId });
      } else {
        const allowed = ['status', 'claim', 'release', 'acceptRoute', 'revokeRoute', 'commitBatch', 'inspectBatch', 'inspectRecord', 'close'];
        if (!allowed.includes(message.operation)) throw new Error('Unknown authored child operation.');
        const result = await host[message.operation](...message.args);
        process.send({ id: message.id, result: result ?? null });
        if (message.operation === 'close') process.disconnect();
      }
    } catch (error) { process.send({ id: message.id, error: { code: error.code || 'child', message: 'Authored child operation failed.' } }); }
  }).catch(async () => { try { await host?.close(); } finally { process.exitCode = 1; process.disconnect(); } });
});
process.on('disconnect', () => { if (host) void host.close().catch(() => { process.exitCode = 1; }); });
