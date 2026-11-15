import type { AssetFile, MigrationAsset } from './migration-api.mjs';
export { createFileMigrationSource, fileAttachmentsOutput, fileMigration } from './migration-api.mjs';
export declare class DirectoryAssetStore {
  constructor(options: { directory: string; maxAssetBytes?: number });
  put(file: AssetFile, options?: { signal?: AbortSignal }): Promise<MigrationAsset>;
  /** Fully consume the stream to observe its final digest check. */
  read(assetId: string, options?: { signal?: AbortSignal }): AsyncGenerator<Uint8Array>;
}
