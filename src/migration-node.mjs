import { mkdir, realpath, open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { requireValue, aborted } from './values.mjs';
export { createFileMigrationSource, fileAttachmentsOutput, fileMigration } from './file-migration.mjs';

function nextChunk(iterator, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    let finished = false;
    const end = (error, value) => { if (finished) return; finished = true; signal?.removeEventListener('abort', cancel); if (error) reject(error); else resolve(value); };
    const cancel = () => { try { aborted(signal); } catch (error) { end(error); } };
    signal?.addEventListener('abort', cancel, { once: true }); Promise.resolve().then(() => { aborted(signal); return iterator.next(); }).then(value => end(null, value), error => end(error));
  });
}

// Explicit application-owned storage. Assets are staged before batch review;
// a failed/cancelled migration does not remove content-addressed shared assets.
export class DirectoryAssetStore {
  #directory; #root; #maximum;
  constructor({ directory, maxAssetBytes = 33554432 } = {}) {
    requireValue(typeof directory === 'string' && isAbsolute(directory) && Number.isSafeInteger(maxAssetBytes) && maxAssetBytes >= 0, 'asset_store', 'Provide an absolute owned directory and per-asset byte budget'); this.#directory = directory; this.#maximum = maxAssetBytes;
  }
  async #path() { if (!this.#root) this.#root = (async () => { await mkdir(this.#directory, { recursive: true, mode: 0o700 }); return realpath(this.#directory); })(); return this.#root; }
  async #existing(path, digest, expectedBytes, signal) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash('sha256'); let size = 0;
    try {
      const stat = await handle.stat(); requireValue(stat.isFile() && stat.size === expectedBytes, 'asset_integrity', 'An existing content-addressed asset has different bytes');
      for await (const chunk of handle.createReadStream({ autoClose: false })) { aborted(signal); size += chunk.byteLength; requireValue(size <= expectedBytes, 'asset_integrity', 'Stored asset grew during verification'); hash.update(chunk); }
      requireValue(size === expectedBytes && hash.digest('hex') === digest, 'asset_integrity', 'Existing asset digest does not match its address');
    } finally { await handle.close(); }
  }
  async put(file, { signal } = {}) {
    requireValue(file && typeof file.stream === 'function' && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= this.#maximum, 'asset_budget', 'File exceeds the application asset budget'); aborted(signal);
    const root = await this.#path(), temporary = join(root, '.intakelet-' + randomUUID()), hash = createHash('sha256'); let handle, iterator, ended = false, bytes = 0;
    try {
      aborted(signal); handle = await open(temporary, 'wx', 0o600);
      const stream = file.stream(); iterator = stream[Symbol.asyncIterator]?.() ?? stream[Symbol.iterator]?.(); requireValue(iterator && typeof iterator.next === 'function', 'asset_stream', 'File stream must yield byte chunks');
      while (true) {
        const result = await nextChunk(iterator, signal); if (result.done) { ended = true; break; } const chunk = result.value;
        aborted(signal); requireValue(chunk instanceof Uint8Array && bytes + chunk.byteLength <= this.#maximum && bytes + chunk.byteLength <= file.size, 'asset_budget', 'File stream exceeds its declared size or application budget');
        const buffer = Buffer.from(chunk); hash.update(buffer); bytes += buffer.byteLength;
        for (let offset = 0; offset < buffer.byteLength;) { aborted(signal); const { bytesWritten } = await handle.write(buffer, offset, buffer.byteLength - offset); requireValue(bytesWritten > 0, 'asset_write', 'Asset write made no progress'); offset += bytesWritten; }
      }
      aborted(signal); requireValue(bytes === file.size, 'asset_size', 'File stream ended before its declared size'); await handle.sync(); await handle.close(); handle = null; aborted(signal);
      const digest = hash.digest('hex'), destination = join(root, digest);
      try { await link(temporary, destination); }
      catch (error) { if (error.code !== 'EEXIST') throw error; await this.#existing(destination, digest, bytes, signal); }
      return { assetId: 'sha256:' + digest, sha256: 'sha256:' + digest, bytes };
    } finally {
      // A custom iterator may ignore cancellation or never settle return(). Its
      // late chunks cannot reach the closed file or advance a migration cursor.
      if (!ended && iterator?.return) Promise.resolve().then(() => iterator.return()).catch(() => {});
      try { if (handle) await handle.close(); } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
  }
  async *read(assetId, { signal } = {}) {
    requireValue(typeof assetId === 'string' && /^sha256:[a-f0-9]{64}$/.test(assetId), 'asset_id', 'Use an acknowledged content-addressed asset'); aborted(signal);
    const handle = await open(join(await this.#path(), assetId.slice(7)), constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash('sha256'); let bytes = 0;
    try {
      requireValue((await handle.stat()).isFile(), 'asset_integrity', 'Asset is not a regular file');
      for await (const chunk of handle.createReadStream({ autoClose: false })) { aborted(signal); bytes += chunk.byteLength; requireValue(bytes <= this.#maximum, 'asset_budget', 'Stored asset exceeds its read budget'); hash.update(chunk); yield new Uint8Array(chunk); }
      requireValue('sha256:' + hash.digest('hex') === assetId, 'asset_integrity', 'Stored asset failed its digest check');
    } finally { await handle.close(); }
  }
}
