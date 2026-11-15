# Qualification v2 — onboarding and migration package

Last updated: 2026-11-15

This is a new 0.2.0 candidate, not a replacement for the immutable 0.1.0
archive/evidence. The current owner delegation in AGENTS.md covers personal
publication and these T2 authored checks. This iteration has a cumulative
20-minute CI ceiling, including failures and retirement; each job also has a
17-minute internal deadline. No local install/build/browser is allowed by the
Storage Guard (8.1GiB free,34GiB required).

Use an owned, nonce/inode-marked runner scratch directory. Copy only current
source, fixtures, specs and references; never copy earlier result trees, Git
history, dependencies or caches. Preserve complete command streams, installed
locks, archive membership/modes/hashes, source vectors and teardown outcomes.
Before installing, require 30GiB reserve plus4GiB estimated working space on
the runner. Tracked source stays unchanged. Only scratch package-lock.json
may change, and only the root package's two version fields to0.2.0; dependency
identities must remain byte-equivalent as JSON values.

Pack the actual candidate and compare every regular allowlisted archive member
to its current source bytes and executable mode. Install that exact archive in
a fresh consumer, warm its owned runtime cache, then install it in a second
consumer offline. This proves cached-dependency offline installation, not an
air-gapped first install. Exercise the installed Node asset store and reviewed
file migration with a custom nested output. Compile the installed new exports
with strict React18/19 consumers and a Node-only consumer, and SSR all four
new wrappers without a browser global. Keep exact existing fixture versions
and record every resolved package identity; no source-import substitution.

Native Chromium cases use the built current playground and installed archive
consumers. Cover user/company setup, real acknowledgement/checklist state,
modeless tour targets/Escape/focus/missing target/disconnect, thirteen files
across four reviewed batches with exclusions and custom output, installed
React18/19 lifecycle callbacks, and320/390px touch/keyboard fit. All input is
authored; assets and host records are session-only. Original screenshots,
requests, actual batch plans/receipts, normal browser/server closure and the
absence of browser page errors are evidence, not assumptions.

Only after archive/native acceptance may the same source be published and
deployed. A distinct anonymous hosted check must compare every static body
with its retained build hash and run the public setup/tour/migration flow.
Do not claim provider READY or source exports prove those HTTP/browser steps.
The temporary workflow and owned branch must be retired and read back.

The remaining GEN-3659 requirements stay open: OAuth/one-click app connection,
other app adapters, a production durable authenticated host/scheduler and
semantic extraction of PDF/Office/image formats. Byte preservation is not
extraction; the reference accepted sync protocol is not a deployed service.
