# Reusable onboarding components

Started 2026-11-14; receipt 2026-11-15 Europe/Madrid. Base:
`77d6fc626c4b6386767a4bc19af69d85f7b0dff0`.
Owner: [GEN-3659](https://app.notion.com/p/418a1ee8bd0680c99343ea23eb42d0dd).
Local, uncommitted and unpublished. The previous goal turn made source progress;
this turn continues an independent, explicitly requested SDK requirement.

## Implemented scope and files

- `src/onboarding.mjs`: strict bounded definitions, user/company templates,
  content-bound requests, acknowledged/optional-step state, cancellation and
  late-write accounting, isolated snapshots and pure tour geometry.
- `src/onboarding-elements.mjs` and declarations: setup, independent quickstart
  actions and modeless targeted tours. Missing/replaced targets, retry, viewport
  changes, bounded prepare/selector waits and owned teardown are explicit.
- Root/element/onboarding package exports, `src/react.mjs` and declarations:
  public typed APIs and React wrappers. A changed React flow cannot call a new
  actor's handler with an old pending action before effect cleanup. Old-scope
  acknowledgements remain observable; stale guide completion is suppressed.
- `src/element.css`, `web/`: original reusable styles, real component examples,
  a session-only demo handler and website usage/publication guidance. The demo
  does not create accounts or upload setup fields. Quickstart conditions depend
  on actual demo setup/staged-plan/import acknowledgements.
- New pure/controlled-DOM/controlled-hook checks and typed-consumer fixture.
  [Integration/publication guide](../../../references/onboarding-components.md),
  [Clous source research](../../../references/clous-onboarding-inspiration.md),
  README and AGENTS record authority and publication limits.

No existing importer/host/research contract, dependency, backend, database,
credential, CI, external account or Clous checkout was changed. The existing
0.1.0 archive and hosted playground do not contain these new APIs.

## Source evidence

The actual Clous frontend wizard/quickstart/guide and backend organization-command
sources were inspected. Canonical GitHub file/blob identities and the differences
from dirty/untracked local work are recorded in the source research. The new
frontend feature path returned 404 remotely; the existing tracked component
paths were fetched instead. Local files were preserved. No Clous runtime or
production behaviour was inferred from those working files.

## Verification

- **24 focused cases passed** with Node **26.8.2**: 12 pure definition/state/
  request/geometry cases; nine controlled element/lifecycle cases; three
  controlled React-hook cases. They exercise actual new module functions with
  authored data, not native browser/React rendering.
- The actual package self-exports resolve from Node without browser globals;
  calling element registration still requires a browser. This is source export
  resolution, not tarball installation proof.
- A targeted typed consumer passed with **TypeScript 5.9.3**, zero diagnostics,
  including expected-error checks for missing scope/handler. An existing compiler
  and React declarations were read from another existing SIDE checkout; no
  dependencies were installed or modified.
- `npm run check` passed; all declared public module/declaration targets exist.
- Static playground HTML has balanced nesting, **15 unique IDs** and **seven
  literal lookup targets resolved**. This does not execute layout or the demo.
- `git diff --check` passed.

Actual focused commands:

```
node --test tests/unit/onboarding.test.mjs tests/unit/onboarding-elements.test.mjs tests/unit/onboarding-react.test.mjs
npm run check
git diff --check
```

## Retained failures and correction

The initial element run passed 5/6: E04's fake ResizeObserver delivered a change
for an unobserved overlay child and reported `1 !== 0` queued frames. The harness
now tracks actually observed targets; the assertion preventing a self-triggered
positioning loop remains intact. Target and card resize handling remain tested.

Review also found that a final optional Skip did not emit guide completion.
Completion now includes intentional skips exactly once, without fabricating a
saved step; E09 verifies it. An intermediate element run passed 7/9 because E01
and E02 asserted before the actual asynchronous hash/acknowledgement completed.
Those checks now await their exact observable condition with a bounded deadline;
their no-call, original-scope, no-advance and retained-input assertions remain.
The final focused group passes all 24 cases. Historical release evidence is not
rewritten or replayed as proof of this iteration.

## Still open

Native desktop/390/320 px, actual keyboard/focus/screen-reader/zoom/dialog
behaviour, browser teardown, installed React 18/19 consumers, fresh tarball,
exact-source build and hosted publication are unverified. No build, browser,
server, install, commit, branch, PR or deployment ran. Existing storage/user
constraints remain; no new claim of current free-space capacity is made.

The full Intakelet request is not complete. Arbitrary-format/bulk ingestion,
third-party app migration and continuous sync, and user-defined output schemas
remain required. The current v1 importer still admits CSV/JSON/Markdown/text,
at most 10 files / 2 MiB per analysis. These UI additions do not satisfy or
relabel those separate migration requirements. Account authority and durable
setup/progress storage remain the integrating application's responsibility.
