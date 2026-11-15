# Document extraction V1

Last updated: 2026-11-15

GEN-3659 requires bulk migrations from arbitrary files. Version0.3.0 extends
the existing byte-preserving source with an actual Node document decoder. This
contract does not turn unsupported attachments into extracted knowledge.

`createNodeDocumentDecoder()` returns a versioned decoder for
`createFileMigrationSource`. It verifies the bytes against the staged asset
before parsing. PDF text pages, DOCX paragraphs, XLSX cells, strict UTF-8 text
and PNG/JPEG OCR produce literal text and source locations. OCR requires an
explicit local English traineddata file and expected SHA256; it never downloads
language data. The output records actual parser/data versions and digests.

Every result has a status, nullable text, format/method, source digest,
segments and limits. Unsupported, empty, failed and over-budget files remain
explicit. No prefix is labelled a complete extraction. Passwords, macros,
formulas, external references, imported scripts and document actions are never
executed. Formula cells retain their formula rather than recalculating it.
PDF pages without a text layer are not silently represented as successful OCR.
OCR is recognition with possible errors, not semantic or LLM understanding.

Defaults:8MiB input,64KiB extracted UTF-8,1000 segments,100 PDF pages,32 sheets,
5000 nonempty cells,16,777,216 image pixels,512 ZIP entries and64MiB declared
ZIP expansion. Each call
has a30-second whole-call deadline, configurable up to120seconds, and supports
cancellation during reads and parsing. Parsing uses an owned subprocess with a
256MiB JavaScript heap setting, bounded output and no inherited credentials;
this is not an operating-system memory/security sandbox. A preload denies
network operations in that process and inherited Node workers. OCR model data
is copied into owned scratch only after its hash is checked. Process closure
precedes scratch removal. Hosts still own outer OS quotas and asset retention.

The decoder is explicit and Node-only. Browser uploads use the application's
trusted upload/decoder endpoint; the public static playground does not acquire
an unauthenticated extraction proxy. Existing review, output schema, page CAS,
checkpoint and route-acceptance contracts stay in force. Original assets remain
durable after review cancellation; only decoder scratch is removed.

Qualify actual installed parser dependencies and real authored PDF/DOCX/XLSX/
PNG/JPEG fixtures, source locations, wrong hashes, malformed/encrypted or
unsupported files, budget exits, cancellation and review/schema integration.
Test data is T2 authored fictional content. Preserve failures, exact archives,
dependency locks and cleanup evidence. Heavy work runs only in owned remote
CI under the existing20-minute task cap; no local install/build/model/browser.

One-click OAuth, additional application adapters, durable authenticated hosts,
background scheduling, legacy Office and other formats remain separate open
requirements. This document must not be used to declare the portfolio complete.
