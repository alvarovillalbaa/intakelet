# SQLite migration host V1

15 November 2026. Approved by the owner's explicit “Autorizo todo” reply after
the pending proposal questions. The additive schema and isolated implementation
are now in progress within the existing limits; no live/customer database or
provider Auth service is included. The earlier inactive gate remains in history.

## Required behavior and existing boundary

GEN-3659 requires third-party continuous syncing and reviewed custom outputs
that applications can store durably. The published0.4.0 supplies real bounded
GitHub reads and the migration protocol, but `MemoryMigrationHost` stores its
connections, records, accepted routes and receipts in process-local Maps.
`DirectoryAssetStore` persists attachment bytes, not output/checkpoint state.
Neither establishes restartable background sync. This proposal supplies the
missing durable transaction adapter; OAuth/private access and an authenticated
application scheduler remain separate required work.

Published main is `6725fa70310d4b96b5f7143d261dc7e12ffc6b72`. Preserve that
release, all earlier archives/evidence and the dirty local checkout at
`77d6fc626c4b6386767a4bc19af69d85f7b0dff0`. No local installation, build,
database or native browser is permitted below Storage Guard's reserve.

## Concrete implementation requested

Add `SQLiteMigrationHost` only to `/migration/node`, retaining the existing
`MigrationHost` page/receipt contract and browser/Memory exports. Its async
methods use a dedicated worker owning Node24.22.2's built-in `node:sqlite`;
no new package dependency or general-purpose SQL endpoint is introduced.
The pinned Node24 source labels this module release candidate, stability1.2;
keep that constraint visible instead of claiming a stable cross-version API.

Use an explicit initializer for a new application-owned private directory and
database, with a generated, versioned, additive schema artifact and its digest.
Opening an existing store verifies schema identity/version and the trusted
workspace binding; never silently migrate an unknown database. This request
allows only owned disposable databases during isolated acceptance, not an
existing application/customer/production database.

The schema contains:

- store metadata binding schema version/digest and trusted workspace;
- connection state binding the complete spec fingerprint, revision, cursor,
  current worker token/fence, lease deadline and accepted route identity;
- full accepted route payloads and accepting server-side actor attribution;
- destination records with canonical custom-output JSON, source ownership,
  imported/current hashes and record revision, plus unique source-to-target keys;
- exact batch derivations and receipts for idempotent response-loss recovery.

Validate/derive the complete submitted batch before its write transaction.
Within one short `BEGIN IMMEDIATE` transaction, recheck route/lease/fence,
checkpoint CAS, destination ownership/revisions and quotas, then commit all
output rows, source identities, revision/cursor and exact receipt together.
Roll back on any failed precondition, SQLite busy/full/I/O failure or exception;
do not report an acknowledgement before successful COMMIT. No external request,
approval wait or asynchronous hashing may hold that transaction open. Bounded
lock waits fail visibly; no automatic retry of uncertain mutations.

Claims, renewals, releases and route revocation use the same transactional
store across independent processes. A new worker may reclaim only an expired
lease, increasing its fence so an older process cannot write or release it.
New processes load existing accepted routes/checkpoints/receipts instead of
automatically accepting a source or resetting a cursor. Schema initialization
is explicit, never a side effect of importing the browser SDK.

The application still supplies authenticated and authorized workspace/owner
context; persisted actor fields and hashes are not authentication. No HTTP
Auth service, JWT/provider policy, user catalogue, credential store or OAuth
app is created. Do not expose a raw SQL/extension/ATTACH interface. Do not copy
provider tokens into spec/state/evidence. Make row/page/journal byte budgets
explicit, preserve incomplete work on quota errors and document retention;
do not delete required receipts or shared attachment assets as cleanup.

## Isolated acceptance packet

Freeze exact source/DDL/archive identities and these distinct cases before
execution. Use authored data only, no external provider/model or real user.

| ID | Required observed result |
| --- | --- |
| D01 | Explicit fresh initialization; close/open in a separate process verifies schema/workspace and refuses unknown/version-mismatched stores. |
| D02 | A real reviewed multi-page migration writes custom outputs and checkpoints, closes normally, then resumes from the persisted checkpoint in a fresh process without duplicating earlier rows. |
| D03 | Exact committed batch/receipt survives restart; an intentionally withheld reply is recovered by replay without applying its writes twice. |
| D04 | Real independent workers contend for one claim; expiry/reclaim increments the fence and rejects the old worker's write and release. |
| D05 | Route acceptance survives restart; a fresh poll after persisted revocation, or for an unaccepted/replaced route, refuses work before its source read or write. In-flight external reads are not rollback. |
| D06 | An actual SQLite constraint/trigger failure during the SDK batch transaction rolls back every new row/source identity/checkpoint/receipt; existing committed pages remain. This is an injected database failure, not a power-loss claim. |
| D07 | A child process killed after acquiring a claim cannot advance its cursor; a fresh worker reclaims only after expiry and resumes normally. |
| D08 | Local destination edits, source collisions and stale connection revisions refuse the complete page after reread/review. |
| D09 | Two bounded accepted polling cycles across separate worker lifetimes observe the persisted cursor; cancellation/revocation/error stop further reads and retain acknowledged work. |
| D10 | Real database busy/full/read-only refusals produce no false receipt; all connections/process groups and owned disposable files close/remove normally. |
| D11 | The exact packed Node archive installs in a fresh consumer; Node-only declarations/worker/schema assets resolve without DOM or undeclared dependencies. |

These establish bounded local-database/software behavior. They do not prove
hardware power-loss durability, network-filesystem safety, database encryption,
multi-host HA, enterprise throughput, real mutable GitHub updates, private OAuth
or an operated production scheduler. Keep each missing boundary open.

## Budget, publication and retirement

The existing Intakelet cap remains1200seconds total;582seconds are already
used, leaving618seconds (10m18s). This request does not reset or extend it.
Reserve time for artifact/provenance checks and retirement before launching
each short bounded job; stop with retained evidence if the reserve is too low.
No unchanged failed retry or rerun of closed document/OCR/UI/API journeys.

Use a newly named owned temporary Git/CI branch, with Vercel Git deployment
disabled in its unreferenced tree before publishing its ref. Runner Storage
Guard must leave30GiB after its estimate; no Mac storage exception. Keep full
separate streams, exact source/lock hashes, process/worker teardown and owned
nonce/inode scratch cleanup. No copied dependency/cache/history trees.

Only after actual acceptance may a new SDK edition carry this API/schema.
Retain all existing releases; verify the exact archive, declarations, schema
and worker members. Main/website publication remains governed by the existing
owner delegation and exact-source checks. Retire the temporary workflow/ref
and verify readback; no real Supabase/project/Auth/deployment configuration
or customer database changes are part of this approval.

## Primary contracts inspected

- [Pinned Node24.22.2 SQLite source documentation](https://github.com/nodejs/node/blob/v24.22.2/doc/api/sqlite.md), including built-in availability, `DatabaseSync` and stability1.2. Current Node26 docs differ, so do not substitute their renamed API for the pinned runtime.
- [SQLite transaction semantics](https://sqlite.org/lang_transaction.html): one simultaneous writer, immediate transaction contention and explicit rollback handling.

Current SDK contracts:
[migration protocol](../specs/migration-v1.md),
[integration guide](../references/migration-integration.md),
[actual0.4.0 acceptance](../results/2026/11-15/github-public-live/result.md).
