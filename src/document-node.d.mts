import type { UploadFile, MigrationAsset, JSONValue } from './migration-api.mjs';
export type DocumentSegment = { text: string; location: Record<string, JSONValue> };
export type DocumentExtraction = {
  schema: 'intakelet.document-extraction'; version: 1;
  status: 'extracted' | 'unsupported' | 'empty' | 'failed' | 'limit';
  format: string; method: string | null; text: string | null;
  sourceSha256: string; segments: DocumentSegment[];
  engine: { name: string; version: string; languageSha256?: string } | null;
  reason: string | null; complete: boolean; warnings?: string[];
};
export interface DocumentDecoderOptions {
  timeoutMs?: number; maxInputBytes?: number; maxTextBytes?: number;
  maxSegments?: number; maxPages?: number; maxSheets?: number; maxCells?: number;
  ocr?: { language: 'eng'; dataFile: string; sha256: string; gzip?: boolean };
}
export interface NodeDocumentDecoder {
  readonly version: string;
  decode(input: { file: UploadFile; asset: MigrationAsset; signal?: AbortSignal }): Promise<DocumentExtraction>;
}
/** Node only. Uses local pinned parsers; OCR requires explicit local language data. */
export declare function createNodeDocumentDecoder(options?: DocumentDecoderOptions): NodeDocumentDecoder;
