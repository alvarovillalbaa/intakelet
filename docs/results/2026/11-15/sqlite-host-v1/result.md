# Intakelet0.5.0 durable SQLite acceptance

15 November 2026. The owner approved the pending technical scopes with
“Autorizo todo”; [authorization](../technical-authorization.md) preserves the
named limits and earlier deferrals. The current0.5.0 candidate has actual
installed SQLite/process/Node-type acceptance. Publication/hosted verification
and owned temporary retirement are next. This does not complete OAuth/private
app connections, production authentication or operated background scheduling.

## Implementation and exact artifact

`SQLiteMigrationHost` is an optional Node-only host in `/migration/node`.
It uses a dedicated worker and built-in Node24.22.2 SQLite (release candidate,
stability1.2). Explicit private-store initialization applies generated schema
V1; opening verifies schema/version/digest, trusted workspace and persisted
budgets without silently migrating an unknown database. The application still
owns authentication, directory access, provider credentials and scheduling.

One short immediate transaction checks the claim/route/fence, checkpoint CAS,
target ownership/revisions/hashes and quotas, then commits custom-output rows,
source keys, checkpoint and exact batch/receipt journal together. Restarts
recover persisted routes/claims and exact replay receipts. Expired claims get
higher fences; old workers cannot write or release a replacement claim.
Uncertain commit/worker/I/O failures remain unconfirmed; no automatic mutated
retry, receipt eviction or shared attachment deletion is introduced.

[Run43747746882](https://github.com/alvarovillalbaa/intakelet/actions/runs/43747746882)
at84c1ffbf860f2793236266b581eda59033ad93a2 passed in25seconds.
The exact archive has65 regular members/108,782bytes, SHA256
fa92aa9478c9027e1cec302580165a45f3631c0f808b9d8989defd676047e38a.
Every member byte/executable mode matches source. A new actual consumer
installed it; its real worker and packaged generated SQL were used. Node-only
strict declarations passed with ES2022/Node types and no DOM library.

Generated V1 SQL is1,673bytes, SHA256
c4df28fca7cdc33d60f17e9da37c8608dbc76e6c35519f0271aa819029349863.
The [generator](../../../../../scripts/generate-sqlite-schema.mjs) checks exact
equality with immutable schema source. The package adds four Node/schema files
and a guide, changing only README/package version and Node entry/declarations;
56 previous members stay byte-identical. See
[archive comparison](archive-comparison.json) and
[SQLite usage/limits](../../../../references/durable-sqlite.md).

## Eleven actual installed identities

All11 pass; these use authored T2 records with real filesystem databases,
installed SDK, SQLite engine, worker threads and independent child processes.
They are not mocked SQL transactions or real provider/identity evidence.

| ID | Actual accepted observation |
| --- | --- |
| D01 | Explicit new-store initialization; separate-process reopen; duplicate initialization, wrong workspace and changed schema version refused. |
| D02 | Reviewed two-page custom-output migration pauses after page1, resumes in a fresh process at its real persisted cursor and retains exactly two distinct records. |
| D03 | Caller receipt deliberately withheld; observer sees committed batch only. A fresh process replays the exact batch/old lease and receives revision1's persisted receipt without a second write. |
| D04 | Two independent workers contend; real expiry permits a higher persisted fence. The older write and release fail; the current claim commits once. |
| D05 | Accepted route survives process restart; persisted revocation fences its lease. Fresh revoked/unaccepted polls make no source read. |
| D06 | A test-owned real SQLite trigger aborts the second row after the first insert. All new rows/source keys/checkpoint/receipt roll back; the earlier committed page/receipt stays intact. |
| D07 | A real child claimant is deliberately killed with SIGKILL. It advances no cursor; immediate reclaim refuses, and a fresh process resumes only after actual lease expiry. |
| D08 | Real local edits, foreign source ownership and stale checkpoint CAS refuse complete pages without writing their new rows. |
| D09 | Accepted polls across separate host worker lifetimes create/update one record from persisted cursors. Cancellation and source failure retain the last acknowledged cycle3. |
| D10 | Native SQLITE_BUSY5, SQLITE_FULL13 and SQLITE_READONLY8 return errors with no false receipt/checkpoint/row. |
| D11 | Installed Node entry/schema/worker resolve and preserve an actual streamed attachment roundtrip; separate strict installed Node-only types pass. |

Seven child processes close with exit0/no signal; the one D07 claimant has
the explicitly expected SIGKILL. All11 owned case databases/contexts close and
their directories are removed. The enclosing Node process exits0, its complete
process group is absent, exact source stays equal and nonce/inode-owned runner
scratch is removed. [Actual receipt](qualified/receipt.json),
[process observations](qualified/installed/process-cleanup.json), original
streams, installed lock and package manifest are preserved. No DB file,
dependency/cache tree, model or credentials are copied into evidence.

## Original preparation and failure

Lock-only [run43747406201](https://github.com/alvarovillalbaa/intakelet/actions/runs/43747406201)
atc59aefc1ba85e89a5cddc2039016cad8c6f2c607 passed in8seconds. Only the
two root package-version fields changed; all265 dependency entries are equal.
[Generated lock/streams](lock/receipt.json) and
[comparison](lock-comparison.json) retain that exact boundary.

First [run43747620180](https://github.com/alvarovillalbaa/intakelet/actions/runs/43747620180)
at2e8c3e9671be02464aa19d316d63af3851cfedd0 failed in17seconds before
packing or SQLite: `scripts/check.mjs` requires web inputs missing from the
isolated source whitelist. The changed supervisor includes web; no application
assertion was weakened. [Original streams/receipt](attempt-1/receipt.json)
retain its source/process/scratch guards and explicit failed outcome.

CI through current acceptance:50seconds new plus previous582 =632/1200seconds.
[Cumulative ledger](ci-ledger.json) includes every failure/lock/qualification job;
568seconds remain for publication/verification/retirement. No local install,
database, app build/browser or dirty HEAD/index/ref movement was used.

Hardware power-loss behavior, database encryption, network filesystems,
multi-host HA, enterprise throughput, real private apps/OAuth/JWT and an
operated authenticated scheduler remain unproven. Local custom-output SQLite
durability advances the required host boundary; it does not replace those
remaining product requirements or imply a hosted SDK backend.
