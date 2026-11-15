# Bulk migrations and custom outputs

Last updated: 2026-11-15

The0.2.0 migration APIs are separate from the preserved0.1.0 archive, import
element and CLI contracts. See the
[protocol and limits](../specs/migration-v1.md) and
[actual checks](../results/2026/11-15/migration-core.md).

The subsequent [review UI checks](../results/2026/11-15/migration-ui.md) cover
the new element, React wrapper and website flow. The
[0.2.0 qualification receipt](../results/2026/11-15/qualification-v2/result.md)
records installed/native checks and exact publication identities separately.

## Embed the review component

```js
import { defineMigration } from '@alvarovillalbaa/intakelet/migration';
defineMigration();
const element = document.querySelector('intakelet-migration');
element.configure({ spec, source, host });
element.addEventListener('intakelet-migration-acknowledged', ({ detail }) => {
  // Retain the original receipt scope even when appliedToView is false.
  recordAcknowledgement(detail.receipt, detail.appliedToView);
});
```

Include `<intakelet-migration></intakelet-migration>` and import the SDK's
`/styles.css`. The component provides a user-started review action, full source/
output/recipe inspection, explicit exclusions with re-review, commit, stop,
cancel, errors and the last acknowledged receipt. Changing config/disconnecting
cancels pending reads/review. An already acknowledged write remains committed.
Background route acceptance stays in your application's authorized handler.

React applications use `IntakeletMigration` from `/react` with `spec`, `source`,
`host` and optional `onAcknowledged`. Keep source/host references stable. An
equivalent output definition does not restart the effect. A change of scope,
source or host blocks older transport calls before effect cleanup; releasing
the old claim remains possible. After unmount, use your durable host's receipt
history as the source of truth rather than relying on a mounted callback.

## Let users name their destination fields

```js
import { buildFileOutput } from '@alvarovillalbaa/intakelet/migration';
const output = buildFileOutput({
  id: 'customer-files', key: 'externalId',
  fields: [
    { source: 'fileId', target: 'externalId' },
    { source: 'name', target: 'file.title' },
    { source: 'assetId', target: 'file.asset' },
    { source: 'bytes', target: 'file.size' }
  ]
});
```

This produces a typed closed JSON schema and exact mappings with nested objects.
Users can rename fields, choose supported source values and choose a declared
identity field. Duplicate identity values block the batch. `fileOutputFields()`
returns the source catalog; the full recipe API below supports other schemas.

The local website includes an actual file picker, visual field editor and this
review component. Its [standalone integration example](../../examples/migration-playground.mjs)
keeps data only in this tab, admits 2MiB/file and 8MiB of distinct assets, has no
fixed total-file cap, shows recent acknowledged batches and cancels when input
changes or the page hides. Its optional strict UTF-8 text decoder handles
text/Markdown/CSV/JSON content up to 256KiB, retaining literal text; other types
remain attachments with nullable extracted text. It does not execute content,
connect accounts, provide durable storage or run background sync. The editor
shows up to 20 fields; the core recipe limit remains 200.

## Review a third-party migration

Version0.4.0 uses [GitHub source V2](../specs/github-source-v2.md), which retains
GitHub's opaque `after` continuation in its checkpoint. Source identity/cursor
are version2; use a new reviewed connection rather than resuming a V1 cursor.
Review destination ownership and duplicate handling before moving an existing
integration. The old0.3.0 archive is preserved, including its live pagination
failure. Public read acceptance does not provide OAuth/private authorization.

```js
import {
  createGitHubIssuesSource, githubIssuesMigration,
  MemoryMigrationHost, runMigration
} from '@alvarovillalbaa/intakelet/migration';

const source = createGitHubIssuesSource({ owner: 'your-owner', repo: 'your-repo' });
const host = new MemoryMigrationHost({ workspaceId: trustedWorkspaceId });
const spec = githubIssuesMigration({
  workspaceId: trustedWorkspaceId, connectionId: 'github-issues', source
});
const result = await runMigration({
  spec, source, host,
  review: async (batch, { signal }) => {
    // Your UI shows source data, changes, issues and exclusions. Resolve only
    // after the user's action; abort the view when this signal is cancelled.
    return showMigrationReview(batch, signal);
  }
});
```

The UI returns `{ decision: 'approve', batchId: batch.batchId }` for that exact
ready proposal, `{ decision: 'revise', excludedIds: [...] }` to rebuild/review,
or `{ decision: 'stop' }`. Invalid rows cannot be approved. Show acknowledged
receipts even when a later page fails. The reference host is session-only;
implement the protocol in your database before using real customer data.
App-owned private-repository credentials can be supplied to the adapter on the
server; they are never source configuration. No OAuth app is provisioned here.

## Accept continuous sync separately

```js
import { syncMigration } from '@alvarovillalbaa/intakelet/migration';

// Inside your authenticated, authorized route-acceptance handler, after the
// complete source, output and operation policy have been reviewed:
await host.acceptRoute(spec, { acceptedBy: authenticatedOwnerId });

// A process owned by your application. Shutdown/revoke must remain available.
const controller = new AbortController();
await syncMigration({ spec, source, host, signal: controller.signal });
```

Production hosts implement route acceptance in their own trusted store. Do not
accept an actor ID from an untrusted client as authorization. Revoke the route
to fence future writes; abort the process to stop its reads/waits. Errors stop
polling. GitHub scans revisit issues and apply real updates; missing issues do
not delete database rows. No durable worker, scheduler or one-click OAuth flow
has been deployed by these examples.

## Preserve any file type in batches

```js
import {
  createFileMigrationSource, fileMigration, runMigration
} from '@alvarovillalbaa/intakelet/migration';
import { DirectoryAssetStore } from '@alvarovillalbaa/intakelet/migration/node';

// Server-side explicit upload selection, using immutable File-compatible
// handles; choose a new collection ID for each different selection.
const source = await createFileMigrationSource({
  collectionId: immutableUploadCollectionId,
  files: selectedUploads,
  filesPerPage: 20,
  assetStore: new DirectoryAssetStore({ directory: absoluteOwnedAssetDirectory })
});
const spec = fileMigration({ workspaceId: trustedWorkspaceId,
  connectionId: 'files-' + immutableUploadCollectionId, source });
await runMigration({ spec, source, host, review: showMigrationReview });
```

Every file becomes a byte-preserved attachment, including binary/unknown types
and repeated filenames. The new source has no ten-file cap; host quotas and
per-file/page budgets still apply. It retains selected file handles/metadata in
memory. Browser applications supply an authenticated upload/asset adapter;
`DirectoryAssetStore` is Node-only and never exposes its directory in records.
Raw assets may be staged before review. Retention/garbage collection belongs to
the host; cancel is not deletion of durable or shared assets.

## Define database-shaped output

```js
const output = {
  id: 'customer-notes', version: '1',
  schema: { type: 'object', additionalProperties: false,
    properties: { externalId: { type: 'string' },
      note: { type: 'object', additionalProperties: false,
        properties: { title: { type: 'string' }, text: { type: 'string' } },
        required: ['title', 'text'] } }, required: ['externalId', 'note'] },
  fields: [
    { from: ['fileId'], to: ['externalId'] },
    { from: ['name'], to: ['note', 'title'] },
    { from: ['extracted', 'text'], to: ['note', 'text'] }
  ], key: [['externalId']]
};
```

Supply that recipe to `fileMigration({ ...configuration, output })` and a
versioned `decode({ file, asset, signal })` callback to the file source. For
example, a declared UTF-8 text decoder can read text and return `{ text }`;
PDF/Office/image extraction needs an actual decoder with its own constraints.
No decoder or LLM is invented automatically. Use `validateOutputRecipe` and
`mapOutput` to preview authored data before starting a job. Mapping failures
stay visible for review. Smaller `filesPerPage` may be needed when extracted
data and output repeat large text in the complete review proof.

## Publish the matching release

Follow the [component release guide](onboarding-components.md), then include
`/migration` and `/migration/node` exports, declarations and protocol docs in
the new package. Install the exact archive in a separate Node/browser/typed
consumer and exercise real host transactions, reconnects and cancellation.
Qualify actual GitHub/public and authorized private access separately from
authored HTTP cases. Qualify the new file/schema/review UI in a real browser
and add the authorized app-connection flow before claiming hosted acceptance.
Publish the package and website from the same accepted source version. Keep
0.1.0's existing artifact and qualification evidence intact.
