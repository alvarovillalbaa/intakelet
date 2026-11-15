import type { AssetFile, MigrationAsset } from './migration-api.mjs';
import type { MigrationHost, MigrationSpec, AcceptedMigrationRoute, MigrationStatus, MigrationLease, MigrationRecord, MigrationBatch, MigrationReceipt, JSONValue } from './migration-api.mjs';
export { createFileMigrationSource, fileAttachmentsOutput, fileMigration } from './migration-api.mjs';
export declare class DirectoryAssetStore {
  constructor(options: { directory: string; maxAssetBytes?: number });
  put(file: AssetFile, options?: { signal?: AbortSignal }): Promise<MigrationAsset>;
  /** Fully consume the stream to observe its final digest check. */
  read(assetId: string, options?: { signal?: AbortSignal }): AsyncGenerator<Uint8Array>;
}
export interface SQLiteMigrationHostOptions {
  /** Explicit application-owned private local directory; never client input. */
  directory: string;
  workspaceId: string;
  leaseMs?: number;
  maxRecords?: number;
  maxReceipts?: number;
  maxJournalBytes?: number;
  maxDatabaseBytes?: number;
  busyTimeoutMs?: number;
  operationTimeoutMs?: number;
  readOnly?: boolean;
}
export declare class SQLiteMigrationHost implements MigrationHost {
  private constructor();
  /** Create a new private directory/database and apply only the supported V1 schema. */
  static initialize(options: SQLiteMigrationHostOptions): Promise<SQLiteMigrationHost>;
  /** Open an existing supported store without silently changing schema or budgets. */
  static open(options: SQLiteMigrationHostOptions): Promise<SQLiteMigrationHost>;
  acceptRoute(spec: MigrationSpec, options: { acceptedBy: string }): Promise<AcceptedMigrationRoute>;
  revokeRoute(connectionId: string): Promise<void>;
  status(connectionId: string): Promise<MigrationStatus>;
  claim(spec: MigrationSpec, options?: { continuous?: boolean }): Promise<MigrationLease>;
  renew(lease: MigrationLease): Promise<void>;
  release(lease: MigrationLease): Promise<boolean>;
  readRecords(query: { connectionId: string; ids: string[]; sourceKeys: string[] }): Promise<MigrationRecord[]>;
  commitBatch(batch: MigrationBatch, options: { lease: MigrationLease }): Promise<MigrationReceipt>;
  inspectRecord(id: string): Promise<MigrationRecord | null>;
  inspectBatch(id: string): Promise<{ receipt: MigrationReceipt; batch: MigrationBatch } | null>;
  editLocal(id: string, data: JSONValue, options: { expectedRevision: number }): Promise<void>;
  close(): Promise<void>;
}
