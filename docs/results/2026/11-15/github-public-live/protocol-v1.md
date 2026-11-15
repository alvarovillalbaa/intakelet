# GitHub public source acceptance V1

Last updated: 2026-11-15

GEN-3659 app migration/sync continuation. The0.3.0 published SDK has only
authored HTTP source coverage; its earlier real read failed local DNS. Execute
the actual installed archive against GitHub's public API without credentials.
This is separate from OAuth/private access and a durable production host.

Authority is unauthenticated HTTPS GET to explicit public issue endpoints only:
alvarovillalbaa/intakelet, alvarovillalbaa/afs and a bounded nodejs/node sample,
plus one explicitly nonexistent personal repository for404 refusal. No GitHub
content, comment, issue, state or user data is written. This opt-in standalone
acceptance is excluded from default suites and PR gates. No database is used;
it is not a claim of a production database's read-only-role qualification.
Reference-host writes are T2 disposable in-memory test state. Public response
text stays only in that process; retained evidence contains hashes, numeric
identifiers, versions, statuses and counts, not issue text/author profiles.

Freeze the published97,205-byte archive and SHA256
76cd7c273fad245bf508241c69827f2b5232b925e87dd235aa90d1bffc7bba84.
Download it anonymously, verify bytes, install it, then use its actual migration
exports. An observing wrapper delegates unchanged URLs/headers/GET semantics to
native Node fetch and supplies a finite abort deadline. It does not substitute
responses, rewrite payloads or create a fake API. At most12 API requests,
2MiB/response,15seconds/read and80seconds for the whole acceptance process.
Permission/rate errors stop without retry or checkpoint advancement.

Observe actual empty completion, PR exclusion, a nonempty paginated sample,
reviewed destination records derived from those response bytes and checkpoints,
refusal of continuous work before explicit reference-route acceptance, two
accepted sample-page polls and revocation. A small empty personal repository
can complete foreground and two subsequent full scan cycles. The nodejs/node
sample is deliberately bounded to three five-item pages: it is not a complete
repository migration, snapshot or evidence of live update/deletion handling.

Use existing bounded free CI authority, a new unique temporary QA ref with Git
deployments disabled before publication and exact-source/owned-scratch guards.
No new SDK release, dependency change, browser/model/DB, OAuth application,
credential or production configuration is needed. Previous Intakelet work used
477/1200seconds; count every new job against the remaining723seconds, with a
three-minute hard job cap and normal retirement. Keep all failures. Publish
owning evidence without changing any of the qualified59 package members or53
source/build inputs. Preserve dirty local HEAD/index/refs.

Primary contract references: [repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)
and [API versioning](https://docs.github.com/en/rest/about-the-rest-api/api-versions).
The adapter requests2026-03-10, filters pull_request entries, follows only
validated continuations and never treats absence as deletion.
