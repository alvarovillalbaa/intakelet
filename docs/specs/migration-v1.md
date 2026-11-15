# Migration protocol v1 — unreleased source

Last updated: 2026-11-15

This is an additive migration protocol, separate from the frozen
[SDK v1 file/research contract](sdk-v1.md). It is not present in the published
0.1.0 archive. The existing onboarding element and CLI retain their v1 limits.

## Definition and output

A complete definition binds workspace, connection, versioned source identity
and non-secret configuration, versioned output recipe, and explicit create,
update and delete policy. Changing any part changes its fingerprint. A bound
connection rejects another definition; use a deliberately reviewed new
connection instead of silently reinterpreting its accepted cursor.

Outputs use a strict supported subset of JSON Schema: closed nested objects,
required properties, typed arrays, scalar/nullable types, enums, numeric bounds,
string and array lengths. Assertions for email-shaped text, calendar date and
credential-free HTTPS URLs are explicit. Unknown keywords are rejected. No
remote references, executable expressions, regex evaluation or claim of full
JSON Schema compliance. Schema depth is 8, nodes 256 and mappings 200.

Mappings use arrays of field names. Each target chooses a source path or a
constant, with an optional explicit default, missing-field exclusion and up to
four named transforms. Arrays can be copied as typed values; mappings do not
descend through array items. No implicit conversion or missing/null equivalence.
Numeric/boolean conversion is explicit; integers must be safe. Target paths
cannot overlap. One to eight output scalar paths define identity; missing,
null and blank-text identity values fail validation. Output namespace plus
identity determine the target ID. Two source identities cannot silently merge.

## Review, writes and checkpoints

A source returns ordered pages with exact before/after cursors and a terminal
flag. Continuing pages must advance. One page admits 500 source events/2MiB;
cursors admit 16KiB, source configuration 32KiB, source/output rows 512KiB and
the complete review body 3MiB. Observation/provenance bytes count toward that
review budget. Request smaller pages if needed; do not truncate rows or proof.
These are per-page budgets, with no fixed total-file cap in the new file source.

The proposal includes original source data, destination observations, recipe,
derived changes and all errors. Mapping failures, duplicate target identities,
foreign ownership, changed source keys, local destination edits and denied
operations block the whole page. Exclusions name explicit source IDs and are
visible in the final receipt. A revised proposal needs review again. Manual
approval matches the exact final ready batch ID. A content hash is integrity,
not a signature, identity, workspace permission or user-review attestation.

A production host binds authenticated workspace/owner context independently of
client fields. It rederives the entire batch, checks source/target ownership,
unmodified imported hashes, row revisions, connection revision, accepted cursor
and fenced worker claim, then writes every row and its checkpoint atomically.
It retains the exact receipt and derivation for idempotent response-loss retry.
The runner checks that a returned receipt matches the submitted workspace,
connection, definition, batch, next revision, exact checkpoint, terminal flag,
operation counts and exclusions before reporting acknowledgement. A malformed
response is an unconfirmed transaction, not proof that no write occurred;
inspect the host's durable receipt before retrying.
No write may survive a failed current-page transaction. Earlier acknowledged
pages remain committed if a later page fails or the caller cancels.

`MemoryMigrationHost` is an executable reference with a trusted constructor
workspace, 10,000-record/10,000-receipt defaults and configurable budgets. Its
single-process validation/state swap has no await inside the transaction. It
is volatile, not a durable database, cross-process lock or authentication layer.
Its methods belong behind the application's trusted service boundary. Real
hosts supply durable transactions, fencing and authorization themselves.

## Accepted background work

Continuous sync requires a separately accepted complete route and an owner
record, plus an atomic worker claim. Source presence, inbox/ACTIVE state and a
fingerprint never grant mutation permission. Revocation/replacement fences
outstanding workers. An expired claim can renew only while no successor owns
it; an old worker cannot release or write through its successor's token.

`runMigration` performs one bounded run. `syncMigration` is an abortable owned
process loop, default 60 seconds between runs and 100 batches per run. Each run
reclaims the accepted route and resumes only the accepted checkpoint. Source
reads default to 30-second deadlines; interactive reviews to 30 minutes. Late
read/review completion cannot write. Host calls and receipt handlers need their
own production deadlines. An acknowledged commit remains reported if a later
handler, read, poll or cancellation fails. This is not a deployed scheduler.

## Reusable review UI

`defineMigration` lazily registers `intakelet-migration`; importing the API is
safe without a DOM. Configure the complete spec/source/host separately from
registration. The component reads a page, shows its complete derivation and
issues, requires exact approval, and rebuilds/reviews explicit exclusions. It
never accepts a background route or starts automatically. Default run admission
is 100 pages, then the user can resume from the accepted cursor.

Configuration changes/disconnection cancel pending work. Detached controls
cannot act on a later batch. Acknowledgements from an old or cancelled view
remain observable with their original workspace/connection and an
`appliedToView:false` marker; they cannot advance the new view. Current-view
receipts remain visible after cancellation. UI states remain separate from
host authentication and transaction ownership.

`IntakeletMigration` supplies a React wrapper with the same properties. A
rendered change of definition/source/host blocks old reads/writes even before
effect cleanup; releasing the old claim remains allowed. Receipt callbacks use
the latest handler and preserve old receipt scope. Cleanup cancels the element.

`buildFileOutput` builds typed nested closed-object recipes from a selected
file field catalog and destination paths. It rejects ambiguous/unsafe paths,
unknown source fields and undeclared keys. Nullable extracted text defaults to
null when unavailable. The core recipe API remains available for other custom
schemas, arrays, transforms and more than the playground's 20 editor fields.

## Supplied sources

`createFileMigrationSource` works on one immutable explicit File/Blob-compatible
selection. Its ID must never be reused for different bytes. Ordered metadata
binds the selection fingerprint; the asset store hashes actual bytes as it
stages each file. File handles/metadata remain in memory; entire file contents
are not accumulated across the collection. Duplicate filenames remain distinct.
There is no extension allowlist or fixed total count. Default output is an
attachment record with name, MIME, size, content digest and asset locator.
This preserves arbitrary bytes; it does not extract meaning from PDF, Office,
images or archives. Versioned custom decoders can produce schema-mapped JSON.

The Node `DirectoryAssetStore` streams and hashes bytes into an explicitly
owned private directory, using exclusive temporary files and content-addressed
hard links without replacement. Default per-asset admission is 32MiB,
configurable by the host. Existing addresses are checked before reuse; symlink
targets are refused. Cancellation/failure closes owned handles and removes
owned temporary files even when a custom iterator stalls. Durable assets may
already be staged before review and remain after cancellation or exclusion.
The application owns quotas, retention and collection of unreferenced assets;
do not delete shared assets as a pretend rollback. `read()` verifies the digest
at stream completion, so consumers must fully consume it to observe that check.
No imported content is executed or rendered as trusted HTML.

GitHub Issues uses a fixed read-only API origin and pinned API version. It reads
all states, excludes pull requests, uses actual paginated responses and keeps
any application-owned token outside persisted source identity. Redirects and
unexpected pagination are refused; permission/rate errors stop without retry.
Every completed scan starts a new full scan on the next poll. Stable issue IDs
deduplicate unchanged rows and detect updates. Absence never implies deletion.
This API supplies no snapshot guarantee: concurrent repository changes may
affect pages, with later scans revisiting them. `done` means that scan reached
the endpoint's end, not a consistent repository snapshot. Comments, attachments,
transfers, deletion events, OAuth installation and other apps are not supplied.

## Primary references

- [JSON Schema object vocabulary](https://json-schema.org/understanding-json-schema/reference/object)
  and [types](https://json-schema.org/understanding-json-schema/reference/type)
  informed the supported subset; unsupported vocabulary fails explicitly.
- [GitHub repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)
  documents the endpoint, PR discrimination, states, read permission and public
  access. [Pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
  documents Link continuations. Inspected 2026-11-15; API header 2026-03-10.
- [Node filesystem](https://nodejs.org/api/fs.html#fspromiseslinkexistingpath-newpath)
  and [streaming hashes](https://nodejs.org/api/crypto.html#class-hash)
  informed the explicit local asset store. Current docs and installed Node
  versions differ; local execution evidence is recorded separately.
