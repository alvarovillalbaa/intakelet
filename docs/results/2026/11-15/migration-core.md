# Migration core, output recipes and source adapters

Date: 2026-11-15, Europe/Madrid. Uncommitted/unpublished local source on base
`77d6fc626c4b6386767a4bc19af69d85f7b0dff0`.

GEN-3659 remains open. Pliego's explicit pending choice is independent. This
scope advances Intakelet's bulk migration, custom outputs and sync foundation
without changing the frozen v1 importer, CLI, old archive or qualification.

## Implemented locally

- Closed nested output schemas, explicit field recipes/transforms/defaults,
  output validation and collision-safe scalar identities.
- Exact reviewed page proposals, visible errors/exclusions, full derivation
  checks, policy/ownership/local-edit checks, atomic row/checkpoint reference
  commits, CAS, receipt replay, bounded deadlines and cancellation handling.
- Accepted complete sync routes, fenced claims, revocation and an owned
  abortable polling process. Diagnostic reads never advance an accepted cursor.
- Real-REST GitHub Issues adapter with fixed endpoint/API version, bounded JSON,
  actual Link pages, PR filtering, all states, repeated update scans and no
  inferred deletions. Application-supplied tokens stay out of persisted specs.
- File collections with no fixed total-file cap, distinct duplicate names,
  resumable pages, byte-preserved arbitrary attachments and explicit versioned
  custom decoders. Node assets stream into owned content-addressed storage;
  cancellation removes owned temporary files, not shared durable assets.
- Root, `/migration` and `/migration/node` source exports, declarations,
  integration guidance and the new migration-v1 protocol document.

## Checks and retained failures

Only existing Node 26.8.2 and tiny T2 authored fixtures were used. No dependency,
browser, build, database or large worktree was installed/provisioned. New check
files cover output schemas, migration transactions/workers, GitHub-shaped HTTP
and tiny actual filesystem assets. They are not production/API/browser proof.

1. First core run: 26/26 schema/migration cases passed.
2. First GitHub-inclusive run: 34/37 passed. G02/G09 rejected valid pagination;
   G04 admitted a link with an extra parameter. The implementation counted six
   query parameters although its contract defines five. The guard was fixed
   to exactly five; assertions were retained. The loop test's fixture was also
   corrected to change `&page`, rather than matching `per_page` accidentally.
   Focused GitHub rerun: 9/9 passed.
3. File source/store: 8/8 passed, including a 53-file migration split/resumed
   after 14 accepted files, exact arbitrary binary/empty bytes, duplicate
   filenames, custom decoded output, atomic failure, existing corruption and
   symlink refusal. A subsequent stalled-iterator cancellation case passed;
   its owned temporary file was removed before late chunks arrived (9/9).
4. Combined source cases: 46/46 passed. Subsequent source review added a stalled
   HTTP-body cancellation case and a partially committed poll checkpoint case;
   changed GitHub/migration files then passed 31/31. Output/file files were
   unchanged after their accepted combined run.
5. `npm run check`: passed across source/CLI/scripts/web modules. This checks
   syntax; separate source self-imports resolved root, `/migration` and
   `/migration/node` without a document/browser global.
6. Targeted `tests/fixtures/migration-types.mts` compilation with the existing
   read-only TypeScript 5.9.3 installation in Kickoff: zero diagnostics, with
   expected errors for ambiguous mappings, unknown transforms and approval
   without a batch ID. Strict NodeNext + ES2023/DOM; no broad application check
   or install. Directory construction in this fixture is compile-only.
7. Final `git diff --check`: passed. All 13 local links in the changed README
   and new migration guides/protocol/receipt resolve. No unchanged old suites
   were replayed as new proof.

Actual unauthenticated production-adapter read attempted:
`octocat/Hello-World`, one issue/page, eight-second AbortSignal deadline. It
failed before reading an API page with:

```json
{"status":"not_verified","code":null,"name":"TypeError","message":"fetch failed","causeCode":"ENOTFOUND"}
```

No permission bypass, credential copy or automatic retry was attempted. Primary
GitHub documentation was read in the web tool; that is not execution of this
adapter. No live API or private-repository acceptance is claimed.

## Remaining boundaries at this checkpoint

Subsequent local component/editor work is recorded in
[migration UI evidence](migration-ui.md). This section retains the original
core-only checkpoint; it is not a claim that the later UI work is absent.

There is no new hosted file/schema/review interface or embeddable migration
review component, one-click OAuth app connection, other-app connector, durable
production migration host or deployed scheduler. Binary attachment preservation
does not mean semantic extraction of arbitrary formats. The memory reference
has explicit record/receipt quotas; file metadata/handles use memory. Node's
per-asset default is 32MiB and full reviewed pages are bounded. Staged assets
can remain after unapproved/excluded work and need application retention/GC.

Native browser/rendering, actual package/archive installation, Node 24,
production database/RBAC/transactions, actual GitHub reads and publication are
unverified. No commit, branch, push, PR, release or deployment was made. The
existing old package/website are not evidence for these source additions.
