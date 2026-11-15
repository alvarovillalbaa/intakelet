import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IntakeletError, requireValue, filename, canonical, aborted } from './values.mjs';

const engines = Object.freeze({ pdf: ['pdfjs-dist', '6.5.438'], docx: ['mammoth', '1.12.2'], xlsx: ['exceljs', '4.4.0'], image: ['tesseract.js', '7.0.0'] });
const defaults = { timeoutMs: 30000, maxInputBytes: 8388608, maxTextBytes: 65536, maxSegments: 1000, maxPages: 100, maxSheets: 32, maxCells: 5000 };
const ceilings = { timeoutMs: 120000, maxInputBytes: 33554432, maxTextBytes: 131072, maxSegments: 1000, maxPages: 100, maxSheets: 32, maxCells: 5000 };
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (code, message) => new IntakeletError(code, message);
function until(promise, signal, deadline) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => finish(reject, failure('aborted', 'Document extraction cancelled'));
    const timer = setTimeout(() => finish(reject, failure('document_timeout', 'Document extraction deadline reached')), Math.max(1, deadline - Date.now()));
    function finish(callback, value) { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); callback(value); }
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
async function bytesOf(file, signal, deadline) {
  const stream = file.stream(), reader = typeof stream?.getReader === 'function' ? stream.getReader() : null;
  const iterator = reader ? { next: () => reader.read(), return: () => reader.cancel() } : stream?.[Symbol.asyncIterator]?.() || stream?.[Symbol.iterator]?.();
  requireValue(iterator && typeof iterator.next === 'function', 'file', 'Supply a byte stream');
  const chunks = []; let total = 0;
  try {
    while (true) {
      const part = await until(Promise.resolve().then(() => iterator.next()), signal, deadline);
      if (part.done) break;
      requireValue(part.value instanceof Uint8Array, 'file', 'Upload chunks must be bytes'); total += part.value.byteLength;
      requireValue(total <= file.size, 'asset_integrity', 'Upload exceeds its staged byte size'); chunks.push(Buffer.from(part.value));
    }
    requireValue(total === file.size, 'asset_integrity', 'Upload differs from its staged byte size');
    return Buffer.concat(chunks, total);
  } finally {
    // A hostile iterator may never settle return(); it owns no decoder file.
    try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Already closed. */ }
  }
}
function zipFormat(bytes) {
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) if (bytes.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  requireValue(end >= 0, 'document_invalid', 'Invalid ZIP directory');
  const count = bytes.readUInt16LE(end + 10), length = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
  requireValue(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && count === bytes.readUInt16LE(end + 8) && count <= 512 && offset + length <= end, 'document_limit', 'Unsupported ZIP layout or entry budget');
  let at = offset, expanded = 0; const names = new Set();
  for (let index = 0; index < count; index++) {
    requireValue(at + 46 <= offset + length && bytes.readUInt32LE(at) === 0x02014b50, 'document_invalid', 'Invalid ZIP entry');
    const flags = bytes.readUInt16LE(at + 8), size = bytes.readUInt32LE(at + 24), nameBytes = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    requireValue(!(flags & 1), 'document_encrypted', 'Encrypted Office files are not decoded'); expanded += size;
    requireValue(size !== 0xffffffff && expanded <= 67108864 && at + 46 + nameBytes + extra + comment <= offset + length, 'document_limit', 'ZIP expansion budget reached');
    const name = bytes.subarray(at + 46, at + 46 + nameBytes).toString('utf8');
    requireValue(!names.has(name) && !name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), 'document_invalid', 'Unsafe or duplicate ZIP member'); names.add(name); at += 46 + nameBytes + extra + comment;
  }
  requireValue(at === offset + length, 'document_invalid', 'ZIP directory length differs');
  const word = names.has('word/document.xml'), excel = names.has('xl/workbook.xml');
  requireValue(!(word && excel), 'document_invalid', 'Ambiguous Office container');
  return word ? 'docx' : excel ? 'xlsx' : 'unsupported';
}
function formatOf(bytes, name) {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    requireValue(bytes.length >= 24 && bytes.readUInt32LE(12) === 0x52444849, 'document_invalid', 'Missing PNG dimensions');
    requireValue(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) <= 16777216, 'document_limit', 'Image pixel budget reached'); return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let at = 2, dimensions = false;
    while (at + 4 <= bytes.length) {
      requireValue(bytes[at] === 255, 'document_invalid', 'Invalid JPEG marker');
      while (bytes[at] === 255) at++;
      const marker = bytes[at++]; if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = bytes.readUInt16BE(at); requireValue(length >= 2 && at + length <= bytes.length, 'document_invalid', 'Invalid JPEG segment');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { requireValue(length >= 8, 'document_invalid', 'Missing JPEG dimensions'); const height = bytes.readUInt16BE(at + 3), width = bytes.readUInt16BE(at + 5); requireValue(width > 0 && height > 0 && width * height <= 16777216, 'document_limit', 'Image pixel budget reached'); dimensions = true; break; }
      at += length;
    }
    requireValue(dimensions, 'document_invalid', 'Missing JPEG dimensions'); return 'jpeg';
  }
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) return zipFormat(bytes);
  return /\.(?:txt|md|markdown|csv|tsv|json|jsonl)$/i.test(name) ? 'utf8' : 'unsupported';
}
function response(asset, format, status, reason = null) {
  return { schema: 'intakelet.document-extraction', version: 1, status, format, method: null, text: null, sourceSha256: asset.sha256, segments: [], engine: null, reason, complete: false };
}
async function parseInProcess(directory, configuration, signal, deadline) {
  const guard = fileURLToPath(new URL('./document-network-deny.mjs', import.meta.url));
  const worker = fileURLToPath(new URL('./document-worker.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--max-old-space-size=256', '--import', guard, worker], { cwd: directory, detached: process.platform !== 'win32', env: { TMPDIR: directory, TEMP: directory, TMP: directory }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = [], size = 0, diagnosticBytes = 0, closed = false, overflow = false;
  const completion = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, childSignal) => { closed = true; resolve({ code, signal: childSignal }); }); });
  // Observe cancellation/overflow through the same owned process teardown.
  child.stdout.on('data', chunk => { size += chunk.length; if (size <= 524288) output.push(chunk); else { overflow = true; stop('SIGTERM'); } });
  child.stderr.on('data', chunk => { diagnosticBytes += chunk.length; if (diagnosticBytes > 65536) { overflow = true; stop('SIGTERM'); } });
  child.stdin.on('error', () => {});
  function stop(childSignal) { if (child.pid && !closed) { try { process.platform === 'win32' ? child.kill(childSignal) : process.kill(-child.pid, childSignal); } catch (error) { if (error.code !== 'ESRCH') throw error; } } }
  child.stdin.end(JSON.stringify(configuration));
  try {
    const exit = await until(completion, signal, deadline);
    requireValue(!overflow && exit.code === 0 && exit.signal === null, 'document_worker', 'Document parser did not finish normally');
    const result = JSON.parse(Buffer.concat(output).toString('utf8'));
    requireValue(result && ['extracted', 'empty', 'failed', 'limit'].includes(result.status) && Array.isArray(result.segments) && (result.text === null || typeof result.text === 'string'), 'document_worker', 'Invalid document parser result');
    return result;
  } finally {
    if (!closed) {
      stop('SIGTERM');
      try { await until(completion, null, Date.now() + 1000); } catch { stop('SIGKILL'); await until(completion, null, Date.now() + 2000); }
    }
    requireValue(closed, 'document_cleanup', 'Document parser closure was not observed');
    output = [];
  }
}

export function createNodeDocumentDecoder(options = {}) {
  requireValue(options && typeof options === 'object' && Object.keys(options).every(key => Object.hasOwn(defaults, key) || key === 'ocr'), 'document_options', 'Unknown decoder option');
  const limits = { ...defaults };
  for (const key of Object.keys(defaults)) if (Object.hasOwn(options, key)) { const value = options[key]; requireValue(Number.isSafeInteger(value) && value >= (key === 'timeoutMs' ? 100 : 1) && value <= ceilings[key], 'document_options', 'Invalid decoder budget'); limits[key] = value; }
  const ocr = options.ocr ? { ...options.ocr } : null;
  if (ocr) requireValue(Object.keys(ocr).every(key => ['language', 'dataFile', 'sha256', 'gzip'].includes(key)) && ocr.language === 'eng' && isAbsolute(ocr.dataFile) && /^[a-f0-9]{64}$/.test(ocr.sha256) && (ocr.gzip === undefined || typeof ocr.gzip === 'boolean'), 'document_options', 'OCR requires an explicit local English traineddata path and SHA256');
  const version = 'documents-v1:' + hash(canonical({ engines, limits, ocr: ocr ? { language: ocr.language, sha256: ocr.sha256, gzip: ocr.gzip ?? true } : null }));
  return Object.freeze({ version, async decode({ file, asset, signal } = {}) {
    const deadline = Date.now() + limits.timeoutMs; aborted(signal); filename(file?.name);
    requireValue(file && typeof file.stream === 'function' && Number.isSafeInteger(file.size) && file.size >= 0 && asset && asset.bytes === file.size && /^sha256:[a-f0-9]{64}$/.test(asset.sha256), 'asset_integrity', 'Use the exact staged file and asset digest');
    if (file.size > limits.maxInputBytes) return response(asset, 'unknown', 'limit', 'input_bytes');
    let directory = null, keepScratch = false;
    try {
      const bytes = await bytesOf(file, signal, deadline);
      requireValue('sha256:' + hash(bytes) === asset.sha256, 'asset_integrity', 'Decoder input differs from the stored asset');
      const format = formatOf(bytes, file.name), base = response(asset, format, 'unsupported', 'unsupported_format');
      if (format === 'unsupported') return base;
      if (['png', 'jpeg'].includes(format) && !ocr) return { ...base, reason: 'ocr_data_required' };
      directory = await mkdtemp(join(tmpdir(), 'intakelet-document-')); await writeFile(join(directory, 'input'), bytes, { flag: 'wx', mode: 0o600 });
      if (['png', 'jpeg'].includes(format)) {
        const stat = await lstat(ocr.dataFile); requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 33554432, 'document_language', 'Use a regular bounded local OCR data file');
        const data = await until(readFile(ocr.dataFile), signal, deadline); requireValue(hash(data) === ocr.sha256, 'document_language', 'OCR language data digest differs');
        await writeFile(join(directory, 'eng.traineddata' + ((ocr.gzip ?? true) ? '.gz' : '')), data, { flag: 'wx', mode: 0o600 });
      }
      const result = await parseInProcess(directory, { format, limits, engines, ocr: ocr ? { language: 'eng', sha256: ocr.sha256, gzip: ocr.gzip ?? true } : null }, signal, deadline); aborted(signal);
      requireValue(Buffer.byteLength(result.text || '') <= limits.maxTextBytes && result.segments.length <= limits.maxSegments, 'document_worker', 'Parser output exceeded the declared budget');
      return { ...base, ...result, sourceSha256: asset.sha256 };
    } catch (error) {
      if (error.code === 'document_cleanup') keepScratch = true;
      if (['aborted', 'asset_integrity', 'document_language', 'document_cleanup'].includes(error.code)) throw error;
      return response(asset, 'unknown', error.code === 'document_timeout' || error.code === 'document_limit' ? 'limit' : 'failed', error.code || 'document_invalid');
    } finally { if (directory && !keepScratch) await rm(directory, { recursive: true, force: false }); }
  } });
}
