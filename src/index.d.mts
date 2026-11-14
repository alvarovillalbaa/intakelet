export type Format = 'csv' | 'json' | 'markdown' | 'text';
export type Primitive = string | number | boolean | null;
export interface SourceInput { name: string; text: string; format?: Format; url?: string }
export interface Source extends SourceInput { id: string; format: Format; bytes: number; sha256: string; aliases?: Array<{ name: string; url?: string }> }
export interface Span { start: number; end: number; jsonRow?: number }
export interface Provenance { sourceId: string; row: number; span: Span }
export interface Contact { email: string; name: string; company: string }
export interface ImportedRecord { id: string; kind: 'contact' | 'record'; data: Contact | Record<string, Primitive>; provenance: Provenance[] }
export interface Mapping { kind: 'contact' | 'record'; mapping: { email?: string; name?: string; company?: string } }
export interface Table { sourceId: string; columns: string[]; rows: Array<{ index: number; values: Record<string, Primitive>; span: Span }>; suggestion: Mapping & { reason: string } }
export interface Draft { schema: 'intakelet.draft'; version: 1; workspaceId: string; draftId: string; sources: Source[]; tables: Table[]; documents: Array<{ sourceId: string; title: string; format: Format }>; duplicates: Array<{ name: string; sameAs: string; url?: string }>; totals: { files: number; rows: number; bytes: number; duplicateFiles: number } }
export interface Review { mappings?: Record<string, Mapping>; excludedRows?: Array<{ sourceId: string; index: number }>; skipInvalid?: boolean }
export interface Issue { sourceId: string; row: number; code: string; message: string }
export interface Article { id: string; sourceId: string; title: string; part: number; text: string; method: 'exact_source' | 'structured_records'; url?: string; span?: Span; recordIds?: string[]; provenance?: Provenance[] }
export interface Insight { id: string; label: string; value: number; method: 'count' | 'field_coverage' | 'exact_comparison' | 'review_selection' | 'validated_exclusion' }
export interface Plan { schema: 'intakelet.plan'; version: 1; workspaceId: string; planId: string; draft: Draft; review: Required<Review>; records: ImportedRecord[]; articles: Article[]; insights: Insight[]; issues: Issue[] }
export interface Counts { sources: number; records: number; articles: number }
export interface Receipt { schema: 'intakelet.receipt'; version: 1; workspaceId: string; planId: string; revision: number; added: Counts; deduplicated: Counts }
export interface State { schema: 'intakelet.state'; version: 1; workspaceId: string; revision: number; sources: Source[]; records: ImportedRecord[]; articles: Article[]; receipts: Receipt[] }
export interface Host { snapshot(): Promise<State>; commit(plan: Plan, options: { expectedRevision: number }): Promise<Receipt> }
export interface SearchHit { article: Article; matchedTerms: string[]; score: number; method: 'literal_term_match' }
export interface ResearchOptions { signal?: AbortSignal; maxPages?: number; timeoutMs?: number }
export interface ResearchPage { requestedURL: string; url: string; title: string; description: string; headings: string[]; classification: string; rawSha256: string; textSha256: string; bytes: number; file: SourceInput }
export interface ResearchReport { schema: 'intakelet.research'; version: 1; rootURL: string; status: 'partial' | 'no_content' | 'complete_discovered_scope'; files: SourceInput[]; pages: ResearchPage[]; attempts: Array<{ url: string; kind: string; status: number | null; bytes: number; bodySha256?: string; error?: string; security?: Record<string, string | number | boolean> }>; skipped: Array<{ url: string; reason: string }>; coverage: { pages: number; discovered: number; attempted: number; requests: number; bytes: number; byCategory: Record<string, number>; seconds: number; scope: string }; method: 'static_text_and_link_extraction' }
export type ResearchAdapter = (url: string, options: ResearchOptions) => Promise<ResearchReport>;
export declare class IntakeletError extends Error { readonly code: string; readonly details: unknown; constructor(code: string, message: string, details?: unknown) }
export declare const LIMITS: Readonly<{ files: 10; fileBytes: 524288; totalBytes: 2097152; rows: 2000; chunks: 1000; records: 10000; storedBytes: 12582912 }>;
export declare function analyzeFiles(files: SourceInput[], options: { workspaceId: string; signal?: AbortSignal }): Promise<Draft>;
export declare function verifyDraft(input: unknown): Promise<Draft>;
export declare function suggestMapping(columns: string[]): Mapping & { reason: string };
export declare function createPlan(draft: Draft, review?: Review): Promise<Plan>;
export declare function verifyPlan(input: unknown): Promise<Plan>;
export declare function emptyState(workspaceId: string): State;
export declare function validateState(input: unknown, workspaceId: string): State;
export declare function validateSnapshot(input: unknown, workspaceId: string): Promise<State>;
export declare class MemoryHost implements Host { constructor(options: { workspaceId: string; state?: State }); snapshot(): Promise<State>; commit(plan: Plan, options: { expectedRevision: number }): Promise<Receipt> }
export declare function searchKnowledge(articles: Article[], query: string, options?: { limit?: number }): SearchHit[];
export declare function parseJSON(text: string, maxBytes?: number): unknown;
export declare function canonical(value: unknown): string;
export declare function sha256(value: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): Promise<string>;
