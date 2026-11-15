export type JSONValue = null | string | number | boolean | JSONValue[] | { [key: string]: JSONValue };
export type Scalar = null | string | number | boolean;
export type Awaitable<T> = T | Promise<T>;
export type FieldPath = string[];
type Kind<T extends string> = T | [T] | [T, 'null'] | ['null', T];
type SchemaMetadata = { enum?: JSONValue[]; title?: string; description?: string };
export type OutputSchema = SchemaMetadata & (
  { type: Kind<'object'>; properties: Record<string, OutputSchema>; additionalProperties: false; required?: string[] } |
  { type: Kind<'array'>; items: OutputSchema; minItems?: number; maxItems?: number } |
  { type: Kind<'string'>; minLength?: number; maxLength?: number; format?: 'email' | 'date' | 'https-url' } |
  { type: Kind<'number'> | Kind<'integer'>; minimum?: number; maximum?: number } |
  { type: Kind<'boolean'> | 'null' | ['null'] }
);
export type OutputTransform = 'trim' | 'lowercase' | 'uppercase' | 'number' | 'integer' | 'boolean' | 'string';
export type OutputField = { to: FieldPath; default?: JSONValue; optional?: boolean; transforms?: OutputTransform[] } & ({ from: FieldPath; constant?: never } | { constant: JSONValue; from?: never });
export interface OutputRecipe { id: string; version: string; schema: OutputSchema; fields: OutputField[]; key: FieldPath[] }
export interface MappedOutput { data: Record<string, JSONValue>; identity: Scalar[] }
export declare const OUTPUT_LIMITS: Readonly<{ depth: 8; schemaNodes: 256; fields: 200; rowBytes: 524288 }>;
export declare function readField(value: JSONValue, parts: FieldPath): { found: false } | { found: true; value: JSONValue };
export declare function validateOutputSchema(input: unknown): OutputSchema;
export declare function validateOutput(schema: OutputSchema, value: unknown): JSONValue;
export declare function validateOutputRecipe(input: unknown): OutputRecipe;
export declare function compileOutputRecipe(recipe: OutputRecipe): (input: JSONValue) => MappedOutput;
export declare function mapOutput(input: JSONValue, recipe: OutputRecipe): MappedOutput;

export interface MigrationIdentity { id: string; version: string; configuration: JSONValue }
export interface MigrationSpec { workspaceId: string; connectionId: string; source: MigrationIdentity; output: OutputRecipe; policy: { create: boolean; update: boolean; delete: boolean } }
export type MigrationItem = { id: string; revision?: string } & ({ operation: 'upsert'; data: JSONValue } | { operation: 'delete'; data?: never });
export interface MigrationPage { items: MigrationItem[]; cursorBefore: JSONValue; cursorAfter: JSONValue; done: boolean }
export interface MigrationSource { readonly identity: MigrationIdentity; readPage(options: { cursor?: JSONValue; limit?: number; signal?: AbortSignal }): Awaitable<MigrationPage> }
export interface MigrationBaseline { revision: number; cursor: JSONValue; specId: string | null }
export interface MigrationRecord { id: string; connectionId: string; sourceKey: string; data: Record<string, JSONValue>; dataHash: string; importedHash: string; revision: number }
export interface MigrationIssue { sourceKey: string; code: string; message: string; details: JSONValue; excluded: boolean }
export interface MigrationRow { sourceKey: string; id: string | null; action: 'create' | 'update' | 'delete' | 'unchanged'; data: Record<string, JSONValue> | null; dataHash: string | null; expected: { revision: number; dataHash: string } | null }
export interface MigrationBatch { schema: 'intakelet.migration-batch'; version: 1; spec: MigrationSpec; specId: string; page: MigrationPage; baseline: MigrationBaseline; observed: MigrationRecord[]; review: { excludedIds: string[] }; rows: MigrationRow[]; issues: MigrationIssue[]; ready: boolean; batchId: string }
export interface MigrationReceipt { schema: 'intakelet.migration-receipt'; version: 1; workspaceId: string; connectionId: string; specId: string; batchId: string; revision: number; checkpoint: JSONValue; sourceDone: boolean; counts: { created: number; updated: number; deleted: number; unchanged: number; excluded: number }; excludedIds: string[] }
export interface MigrationLease { connectionId: string; specId: string; token: string; continuous: boolean; routeId: string | null }
export interface MigrationStatus extends MigrationBaseline { acceptedSpecId?: string | null }
export interface AcceptedMigrationRoute { schema: 'intakelet.accepted-route'; version: 1; workspaceId: string; connectionId: string; spec: MigrationSpec; specId: string; acceptedBy: string; routeId: string }
export interface MigrationHost {
  status(connectionId: string): Awaitable<MigrationStatus>;
  claim(spec: MigrationSpec, options?: { continuous?: boolean }): Awaitable<MigrationLease>;
  renew(lease: MigrationLease): Awaitable<void>;
  release(lease: MigrationLease): Awaitable<boolean | void>;
  readRecords(query: { connectionId: string; ids: string[]; sourceKeys: string[] }): Awaitable<MigrationRecord[]>;
  commitBatch(batch: MigrationBatch, options: { lease: MigrationLease }): Awaitable<MigrationReceipt>;
}
export type MigrationDecision = { decision: 'approve'; batchId: string } | { decision: 'revise'; excludedIds: string[] } | { decision: 'stop' };
export interface MigrationOptions { spec: MigrationSpec; source: MigrationSource; host: MigrationHost; review?: (batch: MigrationBatch, options: { signal: AbortSignal }) => Awaitable<MigrationDecision>; continuous?: boolean; signal?: AbortSignal; maxBatches?: number; onReceipt?: (receipt: MigrationReceipt) => Awaitable<void>; readTimeoutMs?: number; reviewTimeoutMs?: number }
export interface MigrationResult { status: 'complete' | 'paused'; batches: number; items: number; lastReceipt: MigrationReceipt | null; checkpoint: JSONValue }
export type MigrationSyncOptions = Omit<MigrationOptions, 'continuous' | 'review'> & { intervalMs?: number; maxPolls?: number };
export declare const MIGRATION_LIMITS: Readonly<{ items: 500; pageBytes: 2097152; batchBytes: 3145728; cursorBytes: 16384; reviewRounds: 10 }>;
export declare function migrationCursor(value: unknown): JSONValue;
export declare function validateMigrationSpec(input: unknown): MigrationSpec;
export declare function migrationSpecId(spec: MigrationSpec): Promise<string>;
export declare function validateSourcePage(input: unknown): MigrationPage;
export declare function prepareMigrationBatch(spec: MigrationSpec, page: MigrationPage, baseline: MigrationBaseline, observed: MigrationRecord[], review?: { excludedIds: string[] }): Promise<MigrationBatch>;
export declare function verifyMigrationBatch(input: unknown): Promise<MigrationBatch>;
export declare function inspectMigrationPage(spec: MigrationSpec, page: MigrationPage, host: MigrationHost): Promise<MigrationBatch>;
export declare function runMigration(options: MigrationOptions): Promise<MigrationResult>;
export declare function syncMigration(options: MigrationSyncOptions): Promise<Omit<MigrationResult, 'status'> & { status: 'paused'; polls: number }>;
export declare class MemoryMigrationHost implements MigrationHost {
  constructor(options: { workspaceId: string; leaseMs?: number; maxRecords?: number; maxReceipts?: number; now?: () => number });
  acceptRoute(spec: MigrationSpec, options: { acceptedBy: string }): Promise<AcceptedMigrationRoute>;
  revokeRoute(connectionId: string): void;
  status(connectionId: string): Promise<MigrationStatus>;
  claim(spec: MigrationSpec, options?: { continuous?: boolean }): Promise<MigrationLease>;
  renew(lease: MigrationLease): Promise<void>;
  release(lease: MigrationLease): Promise<boolean>;
  readRecords(query: { connectionId: string; ids: string[]; sourceKeys: string[] }): Promise<MigrationRecord[]>;
  commitBatch(batch: MigrationBatch, options: { lease: MigrationLease }): Promise<MigrationReceipt>;
  inspectRecord(id: string): Promise<MigrationRecord | null>;
  inspectBatch(id: string): Promise<{ receipt: MigrationReceipt; batch: MigrationBatch } | null>;
  editLocal(id: string, data: JSONValue, options: { expectedRevision: number }): Promise<void>;
}

export declare function createGitHubIssuesSource(options: { owner: string; repo: string; perPage?: number; token?: string; fetch?: typeof globalThis.fetch }): MigrationSource;
export declare function githubIssuesOutput(options?: { id?: string; version?: string }): OutputRecipe;
export declare function githubIssuesMigration(options: { workspaceId: string; connectionId: string; source: MigrationSource; output?: OutputRecipe }): MigrationSpec;
export interface AssetFile { size: number; stream(): ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | Iterable<Uint8Array> }
export interface UploadFile extends AssetFile { name: string; type?: string; lastModified?: number }
export interface MigrationAsset { assetId: string; sha256: string; bytes: number }
export interface MigrationAssetStore { put(file: UploadFile, options?: { signal?: AbortSignal }): Awaitable<MigrationAsset> }
export declare function createFileMigrationSource(options: { collectionId: string; files: Iterable<UploadFile>; assetStore: MigrationAssetStore; filesPerPage?: number; decode?: (input: { file: UploadFile; asset: MigrationAsset; signal?: AbortSignal }) => Awaitable<JSONValue>; decoderVersion?: string }): Promise<MigrationSource>;
export declare function fileAttachmentsOutput(options?: { id?: string; version?: string }): OutputRecipe;
export declare function fileMigration(options: { workspaceId: string; connectionId: string; source: MigrationSource; output?: OutputRecipe }): MigrationSpec;
export type MigrationElementConfiguration = Pick<MigrationOptions, 'spec' | 'source' | 'host' | 'maxBatches' | 'readTimeoutMs' | 'reviewTimeoutMs'>;
export interface MigrationElementProgress { phase: 'idle' | 'reading' | 'review' | 'writing' | 'complete' | 'paused' | 'error'; busy: boolean; connectionId: string | null; lastReceipt: MigrationReceipt | null; result: MigrationResult | null }
// Core/Node consumers need no DOM library; browser consumers retain HTMLElement.
type BrowserElement = typeof globalThis extends { HTMLElement: { prototype: infer T } } ? T : object;
type BrowserRegistry = typeof globalThis extends { customElements: infer T } ? T : never;
export type IntakeletMigrationElement = BrowserElement & { configure(config: MigrationElementConfiguration): void; start(): Promise<MigrationResult>; cancel(reason?: string): void; readonly progress: MigrationElementProgress; readonly reviewBatch: MigrationBatch | null };
export interface MigrationAcknowledged { receipt: MigrationReceipt; appliedToView: boolean }
export declare function defineMigration(registry?: BrowserRegistry): { new(): IntakeletMigrationElement };
export interface FileOutputField { source: 'fileId' | 'name' | 'mediaType' | 'bytes' | 'sha256' | 'assetId' | 'text'; label: string; path: FieldPath; schema: OutputSchema }
export declare function fileOutputFields(): FileOutputField[];
export declare function buildFileOutput(options: { id: string; version?: string; fields: Array<{ source: FileOutputField['source']; target: string }>; key: string }): OutputRecipe;
