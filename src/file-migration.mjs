import { filename, label, workspace, canonical, sha256, clone, requireValue, byteLength, aborted } from './values.mjs';
import { MIGRATION_LIMITS, validateSourcePage, validateMigrationSpec } from './migration.mjs';

function descriptor(file) {
  requireValue(file && typeof file.stream === 'function' && Number.isSafeInteger(file.size) && file.size >= 0, 'file', 'Supply immutable File/Blob-compatible uploads'); filename(file.name);
  const mediaType = file.type || 'application/octet-stream'; label(mediaType, 200);
  return { name: file.name, mediaType, bytes: file.size, lastModified: Number.isSafeInteger(file.lastModified) ? file.lastModified : null };
}
// The collection ID names one immutable selection. Metadata binds ordering;
// the asset store hashes actual bytes. Never reuse the ID for different bytes.
export async function createFileMigrationSource({ collectionId, files, assetStore, filesPerPage = 20, decode, decoderVersion = 'attachments-v1' } = {}) {
  workspace(collectionId); label(decoderVersion, 80);
  requireValue(files && typeof files[Symbol.iterator] === 'function' && assetStore && typeof assetStore.put === 'function' && Number.isSafeInteger(filesPerPage) && filesPerPage > 0 && filesPerPage <= MIGRATION_LIMITS.items && (decode === undefined || typeof decode === 'function') && (!decode || decoderVersion !== 'attachments-v1'), 'files', 'Provide explicit files, an asset store and a version for custom decoding');
  const selected = Array.from(files), manifest = selected.map(descriptor), manifestHash = 'sha256:' + await sha256(canonical(manifest));
  const identity = { id: 'file-collection', version: '1', configuration: { collectionId, manifestHash, fileCount: selected.length, filesPerPage, decoderVersion } };
  return {
    get identity() { return clone(identity); },
    async readPage({ cursor = null, limit = MIGRATION_LIMITS.items, signal } = {}) {
      let next = 0;
      if (cursor !== null) { requireValue(cursor && Object.keys(cursor).length === 2 && cursor.kind === 'file-collection-v1' && Number.isSafeInteger(cursor.next) && cursor.next >= 0 && cursor.next <= selected.length, 'file_cursor', 'Invalid upload checkpoint'); next = cursor.next; }
      requireValue(Number.isSafeInteger(limit) && limit > 0, 'files', 'Use a positive page item budget'); const items = [], maximum = Math.min(filesPerPage, limit);
      while (next < selected.length && items.length < maximum) {
        aborted(signal); const file = selected[next], metadata = descriptor(file); requireValue(canonical(metadata) === canonical(manifest[next]), 'file_changed', 'Upload metadata changed; create a new immutable collection');
        const asset = await assetStore.put(file, { signal }); aborted(signal);
        requireValue(asset && typeof asset.assetId === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.sha256) && asset.bytes === metadata.bytes, 'asset', 'The asset store must acknowledge exact file bytes and a content digest'); label(asset.assetId, 300);
        const extracted = decode ? await decode({ file, asset: clone(asset), signal }) : null; aborted(signal);
        const data = { fileId: collectionId + ':' + next, name: metadata.name, mediaType: metadata.mediaType, bytes: asset.bytes, sha256: asset.sha256, assetId: asset.assetId, extracted };
        requireValue(byteLength(canonical(data)) <= 524288, 'file_output', 'Decoded file metadata exceeds 512KiB; emit smaller records through a custom source');
        const item = { id: 'file-' + next, operation: 'upsert', revision: asset.sha256, data };
        const candidate = { items: [...items, item], cursorBefore: cursor, cursorAfter: { kind: 'file-collection-v1', next: next + 1 }, done: next + 1 === selected.length };
        if (byteLength(canonical(candidate)) > MIGRATION_LIMITS.pageBytes) { requireValue(items.length > 0, 'file_page', 'A single file record exceeds the page budget'); break; }
        items.push(item); next++;
      }
      return validateSourcePage({ items, cursorBefore: clone(cursor), cursorAfter: { kind: 'file-collection-v1', next }, done: next === selected.length });
    }
  };
}
export function fileAttachmentsOutput({ id = 'files', version = '1' } = {}) {
  const properties = { fileId: { type: 'string' }, name: { type: 'string' }, mediaType: { type: 'string' }, bytes: { type: 'integer', minimum: 0 }, sha256: { type: 'string' }, assetId: { type: 'string' } };
  return { id, version, schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, fields: Object.keys(properties).map(key => ({ from: [key], to: [key] })), key: [['fileId']] };
}
export function fileMigration({ workspaceId, connectionId, source, output = fileAttachmentsOutput() } = {}) {
  return validateMigrationSpec({ workspaceId, connectionId, source: source?.identity, output, policy: { create: true, update: false, delete: false } });
}
