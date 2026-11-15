import { createNodeDocumentDecoder, type DocumentExtraction } from '@alvarovillalbaa/intakelet/documents/node';
import { createFileMigrationSource } from '@alvarovillalbaa/intakelet/migration';
declare const input: Parameters<ReturnType<typeof createNodeDocumentDecoder>['decode']>[0];
const decoder = createNodeDocumentDecoder({ maxPages: 10 });
const result: DocumentExtraction = await decoder.decode(input);
result.segments.forEach(segment => { const text: string = segment.text; void text; });
const source = await createFileMigrationSource({ collectionId: 'typed', files: [input.file], assetStore: { put: () => input.asset }, decode: decoder.decode, decoderVersion: decoder.version });
void source;
