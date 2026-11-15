# Extract documents before migration review

Last updated: 2026-11-15

Version0.3.0 adds `/documents/node`: PDF text layers, DOCX paragraphs, XLSX
cells, strict UTF-8 text and locally configured PNG/JPEG OCR. Results retain
source locations, the staged content digest and actual parser/data identity.
This is literal extraction and OCR, not LLM or semantic understanding.

```js
import { createNodeDocumentDecoder } from '@alvarovillalbaa/intakelet/documents/node';
import { createFileMigrationSource, fileMigration, runMigration }
  from '@alvarovillalbaa/intakelet/migration';
import { DirectoryAssetStore } from '@alvarovillalbaa/intakelet/migration/node';

const decoder = createNodeDocumentDecoder({ maxPages: 50 });
const source = await createFileMigrationSource({
  collectionId: immutableUploadId, files: selectedUploads, filesPerPage: 2,
  assetStore: new DirectoryAssetStore({ directory: ownedAssetDirectory }),
  decode: decoder.decode, decoderVersion: decoder.version
});
const spec = fileMigration({ workspaceId: trustedWorkspaceId,
  connectionId: 'documents-' + immutableUploadId, source,
  output: reviewedDestinationRecipe });
await runMigration({ spec, source, host: applicationHost, review: showReview });
```

The application supplies trusted workspace authority, a durable host and review
UI. `buildFileOutput` maps nullable `text`. Core output recipes can also map
`extracted.status`, `complete`, `segments` and engine provenance. The default
attachment recipe retains the asset, not extracted knowledge. A changed decoder
configuration changes its version; create a new collection/accepted route.

Each segment identifies a page, paragraph, sheet/cell, line or image. A changed
file after staging is rejected. Formula cells retain their formula rather than
recalculating it. Markup stays literal; macros/scripts/external references do
not run. The subprocess and inherited Node workers deny network transport and
receive no inherited credentials. No document is sent to a provider.

## Local OCR data

Provision a deliberate English traineddata file in the application's owned
environment, for example from the public `@tesseract.js-data/eng` package.
Record the actual file's SHA256; it differs from npm tarball integrity.

```js
const decoder = createNodeDocumentDecoder({
  timeoutMs: 60000,
  ocr: { language: 'eng', dataFile: absoluteOwnedLanguageFile,
    sha256: expectedLanguageFileSha256, gzip: true }
});
```

Language data is never downloaded automatically. Without this configuration,
images return `unsupported`/`ocr_data_required`; their original assets remain
stored. A wrong configured digest rejects extraction. Keep model data outside
Git/evidence. OCR can be wrong and needs review. Scanned PDF pages are not
PNG/JPEG inputs; pages without text are reported, not claimed as OCR successes.

## Status and limits

`extracted` can have `complete:false` when a PDF has pages without text.
`empty`, `unsupported`, `failed` and `limit` never claim a complete prefix.
Show those states and allow explicit exclusion/re-review. Cancellation does not
delete durable staged assets. Unsupported/legacy formats remain attachments.

Defaults:8MiB input,64KiB text,1000 segments,100 PDF pages,32 sheets,5000 cells,
16,777,216 image pixels,512 ZIP entries and64MiB declared ZIP expansion. Finite
per-file budgets coexist with resumable pages and no fixed total-file count.
Reduce files per page when full review proofs approach migration page limits.
The30-second deadline can rise to120seconds; AbortSignal cancels reads/parsing.
Process closure precedes scratch removal. The256MiB JavaScript heap setting
does not replace host OS memory/CPU quotas or an untrusted-file sandbox.

Connect this Node decoder to your authorized upload endpoint. The static
browser playground preserves binary attachments and has no extraction proxy.
OAuth app connection, other app adapters and durable background sync remain
open requirements. [Contract](../specs/document-extraction-v1.md).

## Primary references

- [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [Mammoth raw text and security](https://github.com/mwilliamson/mammoth.js)
- [ExcelJS XLSX/cell values](https://github.com/exceljs/exceljs)
- [Tesseract API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)
  and [local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
