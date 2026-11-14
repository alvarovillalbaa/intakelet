# SDK v1 contract

Last updated: 2026-11-14

The owner asks for an SDK developers install in their onboarding flows: dropped
information is classified/imported and generates insights/knowledge, and a URL
receives research. This release must implement both paths in a real installable
package, web component/React integration, Node research and CLI. A static
playground alone is insufficient. No claim of arbitrary format support, LLM
understanding or a measured reduction from weeks to minutes.

File ingestion accepts at most10 UTF-8 CSV/JSON/Markdown/text sources,512KiB per
source,2MiB total,2000 table rows and1000 knowledge chunks. Reject duplicate
JSON keys, unsafe object names, malformed CSV/Unicode, unsupported formats and
oversized sources without modifying previous state. CSV quoted newlines and
escaped quotes remain data. Original text and UTF-16 source locations bind the
extracted records/chunks. PDFs/binary files are explicitly unsupported here.

Classification uses structural/field rules, shows its reason, suggests contact
column mapping, and retains unknown columns as generic records. The user can
change mappings/exclude rows. Invalid or conflicting rows block plan creation
unless explicitly excluded; no silent first-wins merge. Exact duplicates can
merge provenance. Contacts have stable normalized-email IDs; existing changed
records conflict instead of silently overwriting. Articles contain exact-source
chunks and citations. Computed counts/duplicates/field coverage and extracted
headings are labelled by method, never fabricated enrichment.

A draft and explicit review produce a deterministic content-addressed plan.
The host validates its full derivation from bounded inputs. Commit atomically
adds records, articles and sources, with expected revision and plan idempotency.
Lost response retry returns the original receipt; stale or other-workspace
plans write nothing. Hosts bind trusted workspace context separately from
client payloads. Reference memory and IndexedDB implementations expose actual
state/revision/receipt behavior; IndexedDB resolves only after transaction
completion. They do not replace application authentication or production RBAC.
The SDK never treats a content digest as a signature or tenant authority.

The embeddable element shows choose/analyze/review/commit/knowledge states,
real errors, source evidence, invalid/excluded counts and explicit host writes.
Changing input/context invalidates stale analysis/research/commit views. A
commit already acknowledged by the host remains recorded even if the UI moves;
never imply that cancellation rolled back an acknowledged write. Labels and
imported content use literal text rendering. React18/19 wrappers attach typed
properties/callbacks and tolerate server rendering without a browser global.

Website research performs bounded breadth-first public HTTPS443 reads: robots,
up to one same-site sitemap and at most8 content pages,512KiB/page,2MiB total,
60second total deadline. Respect robots/crawl delays, retain all attempted,
denied, failed and budget-skipped URLs, source MIME/hash/URL/text and coverage.
Do not claim that a bounded crawl is the whole Internet or all site content.
No scripts, credentials, cookies, login, forms, paid search or model service.
Only root-host/www-variant redirects; subsequent content stays on that site.
Revalidate DNS and redirects at each request and pin the selected public address
in TLS lookup; reject IP literals, local/special/mixed DNS, non443 ports,
credentials and other protocols. TLS certificate verification remains on.
No public unsafe-network override. Browser transport is same-origin-only and
exists for authored static demo content; real integrations call the Node SDK
from their authenticated server. The host owns rate limits and tenant isolation.

Delivery: dedicated personal GitHub repo, real tarball with checksum and
offline-installed browser/Node/CLI/React consumers, typed declarations, public
Vercel playground and integration docs. Use existing free services; no Supabase
capacity/account or npm-registry credential is assumed. Retain raw failures,
complete streams, source vectors and exact artifact identities. Focused local
pure checks use existing Node; all heavy execution is owned bounded remote CI.
