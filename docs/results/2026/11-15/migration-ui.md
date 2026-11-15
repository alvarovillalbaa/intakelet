# Migration review UI and visual outputs

Date: 2026-11-15, Europe/Madrid. Local, uncommitted/unpublished source on base
`77d6fc626c4b6386767a4bc19af69d85f7b0dff0`. Continues
[migration/source evidence](migration-core.md) for GEN-3659; the full portfolio
and remaining Intakelet delivery gates stay open. Pliego stays pending by the
owner's explicit choice.

## Changes

- `src/migration-elements.mjs`: reusable lazy-registered
  `<intakelet-migration>` with manual start, complete source/output/recipe
  inspection, visible issues, explicit exclusions/re-review, exact-batch
  approval, stop/cancel, error and receipt states. Stale controls cannot act
  on the next batch; changed config/disconnection cancels pending work.
- `src/react.mjs` and declarations: `IntakeletMigration`, guarded transports
  for changed definition/source/host before effect cleanup, release of old
  claims, latest callbacks and correctly scoped late acknowledgements.
- `src/file-output.mjs`: visual-editor recipe builder for typed nested
  destination paths, with declared identity and no ambiguous/unsafe paths.
  Source/root/element exports and public declarations are updated.
- `web/index.html`, `web/app.mjs`, styles and
  `examples/migration-playground.mjs`: actual file selection, visual source/
  destination editor, identity selection, generated recipe preview, optional
  bounded UTF-8 text extraction and the real review component. Session-only
  raw assets/records, explicit 2MiB/file and 8MiB distinct-asset budgets, no
  fixed file-count cap, no uploads/accounts. Twenty editor fields; core 200.
  The example lives outside web static assets so the existing bundler includes
  it without publishing a standalone module with unresolved source imports.
- `src/migration.mjs`: validate exact host receipt scope, fingerprint, revision,
  checkpoint, terminal flag, counts and exclusions before acknowledgement.
  Bad/missing receipts are unconfirmed writes: the transaction may have been
  stored, so inspect the host rather than assuming rollback or auto-retrying.
- Updated protocol, usage/publication guide, README and agent handoff.

## Verification

Existing Node 26.8.2; authored T2 files, controlled DOM/events/hooks and actual
in-memory host transitions. No browser, installed React, production database,
API, build or archive acceptance is inferred from these cases.

- Initial new view/demo cases: 13/13 passed.
- After detached-control and receipt validation changes:
  `node --test tests/unit/migration-elements.test.mjs tests/unit/migration-demo.test.mjs tests/unit/migration.test.mjs`
  passed 36/36 (nine view, five then-current demo and 22 migration cases).
- React wrapper cases: 3/3 passed. File/GitHub adapter rerun after changing the
  runner's acknowledgement contract: 19/19 passed.
- Combined new view/demo/React cases after listener ownership changes: 17/17.
  A final demo case added input-change cancellation, duplicate filename keys
  blocking commit and disposal of owned handlers; final demo rerun 6/6 passed.
  Thus 18 new UI/demo/hook cases and one new receipt-validation case were added;
  59 distinct relevant cases passed across these scoped runs. Unchanged old
  onboarding/schema suites were not replayed as new proof.
- The website case selected 13 authored files, prepared the actual recipe and
  acknowledged four real reference-host batches. Another case changed output
  configuration during review, confirmed cancellation and blocked duplicate
  filename identities without importing them. No synthetic acknowledgement.
- Late-response cases committed to the old reference host before delaying its
  response, then changed/cancelled the view. Receipts retained original scope,
  used `appliedToView:false`, and did not advance a replacement workspace.
- The malformed receipt case actually committed, then altered/removed the
  response in four ways. The runner reported an unconfirmed batch, delivered
  no success callback and retained evidence that host revision was already 1.
- `npm run check` passed. The example is also imported/executed by focused
  cases; the syntax script itself walks source/bin/scripts/web only.
- Strict targeted TypeScript 5.9.3 consumer: zero diagnostics for
  `tests/fixtures/migration-ui-types.mts`, using existing read-only compiler/
  React declarations in Kickoff. It covers element registration/configuration,
  React props, builder and expected errors; this is not an app-wide compile.
- Root and `/migration` source self-imports passed without a document global.
- Python standard-library HTML inventory: 29 unique IDs, 24 literal element
  lookups resolved, no duplicate IDs/attributes or missing local anchors.
  This is wiring evidence, not HTML5 conformance, browser layout or rendering.
- `git diff --check` passed. All 18 local links in the changed README and
  migration protocol/guide/receipts resolve. The Notion progress entry was
  updated without changing the original requirements or In progress status.

## Retained failed checks and limits

The attempted parse5 HTML parser probe failed with:

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'parse5' imported from intakelet/[eval1]
```

The complete `/element` source entrypoint import also failed because its
existing research module imports the same unavailable dependency:

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'parse5' imported from intakelet/src/research.mjs
```

No dependency install was attempted under the recorded storage restriction.
The standard-library HTML inventory and root/migration imports are narrower
checks, not replacements for this missing entrypoint/browser qualification.
Patch preflights also refused unmatched minified HTML/document contexts; those
calls applied no changes and were corrected against the actual file lines.

Native desktop/mobile rendering, focus/keyboard behavior in an actual browser,
installed React 18/19, full `/element` import, exact-source bundle/archive,
fresh consumer install, Node 24, actual app OAuth/API access, durable production
host and deployment remain unverified. The website flow is local source only;
the public 0.1.0 archive and hosted playground are unchanged. Other-app adapters
and semantic PDF/Office/image extraction are still required work. No commit,
branch, push, PR, CI/deployment/dependency/configuration mutation was performed.
