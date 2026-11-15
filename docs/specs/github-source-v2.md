# GitHub Issues source V2

Last updated: 2026-11-15

Version0.4.0 corrects the real pagination failure observed in0.3.0. The public
API2026-03-10 returns a `next` link with both `page` and opaque `after`. The
previous source rejected the extra field. That archive/failure remain intact.

Source identity is now `github-issues`, version`2`, with the same explicit
owner/repository/page size/API version and a new opaque-after scan identity.
Its checkpoint is `{kind:'github-issues-v2',cycle,page,after}`. Initial/rescan
requests have page1/after:null. A validated continuation increments the page
and retains the exact opaque after string when present. A final page increments
the cycle and clears after to null. Numeric-only links still work. V1 cursors
are refused: create a new reviewed connection/output route rather than silently
resetting or relabelling an old checkpoint. Hosts must review destination
ownership/duplicates when moving to a fresh connection; no backfill is automatic.

Validate the entire continuation: HTTPS api.github.com, no credentials/fragment,
the selected endpoint or GitHub's numeric repository-issues path, the next
integer page, exact state/sort/direction/page-size query, and optionally one
nonempty opaque after value bounded to4096 characters without whitespace or
controls. Reject duplicate/unrecognized query fields and multiple next links.
Construct each request on the original selected endpoint and URL-encode after
as data; never forward a credential to the supplied Link URL. An after value
is a public pagination position, not an OAuth/access token or authorization.

Read only actual issue rows; exclude PR entries. Record/upsert identities,
private credential handling, body budgets, error/cancel behavior, atomic host
checkpoints and separately accepted sync routes retain their existing contracts.
An empty completed scan remains a real scan boundary. Absence never deletes
records; completion is not a consistent repository snapshot.

Focused T2 controls cover opaque roundtrip, terminal clearing, original-endpoint
binding, numeric links and malformed/duplicate/legacy checkpoint refusal.
Actual native-fetch acceptance separately exercises bounded public pages and
reference-host polling. Neither proves OAuth/private access, full large-repo
coverage, external mutable updates or durable production scheduling.

Primary references: [GitHub pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
and [repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues).
