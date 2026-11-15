# Durable Node migrations with SQLite

Version0.5.0 adds `SQLiteMigrationHost` to `/migration/node`. This is application-
owned server storage; it does not authenticate a caller, connect an OAuth app,
upload files, deploy a worker or operate a scheduler. Bind the workspace and
actor from your own authenticated server context. Never use client input as a
store directory or as proof of workspace authority.

```js
import { SQLiteMigrationHost } from '@alvarovillalbaa/intakelet/migration/node';
import { runMigration, syncMigration } from '@alvarovillalbaa/intakelet/migration';

// Explicit first installation only: creates a NEW private directory/database.
const host = await SQLiteMigrationHost.initialize({
  directory: applicationOwnedNewDirectory,
  workspaceId: authenticatedWorkspaceId
});
try {
  await runMigration({ spec, source, host, review: showExactBatchReview });
  // A separate authorized owner action after reviewing the complete route:
  await host.acceptRoute(spec, { acceptedBy: authenticatedOwnerId });
} finally {
  await host.close();
}

// On a later application-owned worker lifetime; no automatic route approval.
const reopened = await SQLiteMigrationHost.open({
  directory: applicationOwnedExistingDirectory,
  workspaceId: authenticatedWorkspaceId
});
try {
  await syncMigration({ spec, source, host: reopened,
    signal: applicationShutdownSignal, maxPolls: 2 });
} finally {
  await reopened.close();
}
```

Use a private local filesystem on a supported Unix host, owned by the current
application user. The directory has no group/other permissions; the fixed
`intakelet.sqlite` file is private and regular. Symlink store roots/files are
refused. Parent-directory security remains the application's responsibility.
Initialization is explicit and exclusive; a failed initialization may leave
its private directory for owner inspection. Opening verifies the exact V1
schema/version/digest, trusted workspace and persisted budgets. Unknown stores
are not migrated or reset. The generated packaged `src/sqlite-host-v1.sql`
comes from immutable `src/sqlite-schema-v1.mjs`.

Node24.22.2's built-in SQLite is release candidate/stability1.2. A dedicated
worker owns synchronous database operations so they do not block the caller's
event loop. This does not establish cross-version/Windows/network-filesystem
support. SQLite uses rollback journaling, foreign keys and FULL synchronous
mode. No SQL, extension loading or database attachment interface is exposed.

Each batch is rederived before entering a short immediate write transaction.
Within it the host checks the current claim, complete accepted route, checkpoint
revision/cursor, destination ownership/hash/revision and quotas. All rows,
source identities, checkpoint and exact batch/receipt journal commit together.
Uncertain I/O/worker failures are errors, not acknowledgements. Reopen and
replay the same exact batch to recover its retained receipt; do not silently
retry an altered proposal. `inspectBatch` checks the stored derivation.

Claims persist across processes. Expired claims may be reclaimed with a higher
fence; the old claimant cannot write or release the new claim. A fresh poll
after route revocation is refused before reading its source. Revoke in the
authorized handler and abort existing workers to stop their reads/waits;
already in-flight external reads or earlier committed pages are not rollback.

Defaults:60s leases,100ms lock wait,15s operation deadline,10,000 records,
10,000 receipts,32MiB receipt journal and64MiB database. Options expose bounded
`leaseMs`, `busyTimeoutMs`, `operationTimeoutMs`, `maxRecords`, `maxReceipts`,
`maxJournalBytes` and `maxDatabaseBytes`. Store budgets persist and cannot
silently change on reopen. `open({ ...context, readOnly: true })` permits
inspection while SQLite refuses mutations. Full/busy/quota errors stop the
page; there is no automatic receipt eviction, deletion of shared attachments,
retention policy or unbounded background retry. Hosts own capacity/backups.

Hardware power-loss durability, encryption, multi-host HA, enterprise scale,
production authentication, real private-provider access and operated scheduling
need separate acceptance. The existing [migration guide](migration-integration.md)
defines review, custom outputs and API limits; GitHub V2 checkpoint transition
and the earlier0.4.0 public-read evidence remain unchanged.
