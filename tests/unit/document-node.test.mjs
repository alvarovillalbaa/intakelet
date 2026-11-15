// T2 authored byte streams. Existing Node only; no parser install or OCR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createNodeDocumentDecoder } from '../../src/document-node.mjs';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const input = (bytes, name = 'authored.txt') => ({ file: new File([bytes], name), asset: { bytes: Buffer.byteLength(bytes), sha256: digest(bytes), assetId: 'authored-asset' } });

test('D01 actual UTF8 subprocess returns literal lines and the staged digest', async () => {
  const source = input('Fictional source 42\n<script>inert()</script>'), decoder = createNodeDocumentDecoder();
  const result = await decoder.decode(source);
  assert.equal(result.status, 'extracted'); assert.equal(result.complete, true); assert.equal(result.sourceSha256, source.asset.sha256);
  assert.deepEqual(result.segments.map(item => item.location.line), [1, 2]); assert.equal(result.text, 'Fictional source 42\n<script>inert()</script>');
});
test('D02 malformed UTF8, empty text and unsupported bytes remain explicit', async () => {
  const decoder = createNodeDocumentDecoder();
  assert.equal((await decoder.decode(input(Buffer.from([255, 254])))).status, 'failed');
  assert.equal((await decoder.decode(input(''))).status, 'empty');
  const result = await decoder.decode(input(Buffer.from([0, 1, 255]), 'authored.unknown'));
  assert.equal(result.status, 'unsupported'); assert.equal(result.text, null); assert.equal(result.complete, false);
});
test('D03 changed/truncated/extra staged bytes reject before a parser result', async () => {
  const decoder = createNodeDocumentDecoder(), source = input('authored'); source.asset.sha256 = digest('different');
  await assert.rejects(decoder.decode(source), error => error.code === 'asset_integrity');
  for (const body of [Buffer.from('a'), Buffer.from('abc')]) await assert.rejects(decoder.decode({ file: { name: 'a.txt', size: 2, stream: () => [body] }, asset: { bytes: 2, sha256: digest('ab') } }), error => error.code === 'asset_integrity');
});
test('D04 input/text/segment ceilings expose limits without a complete prefix', async () => {
  assert.equal((await createNodeDocumentDecoder({ maxInputBytes: 1 }).decode(input('abc'))).status, 'limit');
  for (const options of [{ maxTextBytes: 2 }, { maxSegments: 1 }]) {
    const result = await createNodeDocumentDecoder(options).decode(input('one\ntwo'));
    assert.equal(result.status, 'limit'); assert.equal(result.text, null); assert.deepEqual(result.segments, []); assert.equal(result.complete, false);
  }
});
test('D05 budgets, parser identities and OCR digests bind decoder identity, never a private path', () => {
  const base = createNodeDocumentDecoder(); assert.equal(base.version, createNodeDocumentDecoder().version);
  assert.notEqual(base.version, createNodeDocumentDecoder({ maxPages: 3 }).version);
  const ocr = { language: 'eng', dataFile: '/authored/one', sha256: 'a'.repeat(64) };
  assert.equal(createNodeDocumentDecoder({ ocr }).version, createNodeDocumentDecoder({ ocr: { ...ocr, dataFile: '/authored/two' } }).version);
  for (const options of [{ maxInputBytes: Infinity }, { timeoutMs: 0 }, { unknown: true }, { ocr: { ...ocr, dataFile: 'https://example.test/eng' } }]) assert.throws(() => createNodeDocumentDecoder(options));
});
test('D06 abort interrupts stalled input and leaves a late iterator unaccepted', async () => {
  const controller = new AbortController(); let started, finish;
  const ready = new Promise(resolve => { started = resolve; });
  const source = { file: { name: 'a.txt', size: 1, stream: () => ({ [Symbol.asyncIterator]() { return this; }, next() { started(); return new Promise(resolve => { finish = resolve; }); }, return() { return new Promise(() => {}); } }) }, asset: { bytes: 1, sha256: digest('a') }, signal: controller.signal };
  const pending = createNodeDocumentDecoder().decode(source); await ready; controller.abort(); await assert.rejects(pending, error => error.code === 'aborted'); finish({ value: Buffer.from('a'), done: false });
});
test('D07 stalled input has a deadline and malformed ZIP/encryption markers cannot appear extracted', async () => {
  const result = await createNodeDocumentDecoder({ timeoutMs: 100 }).decode({ file: { name: 'a.txt', size: 1, stream: () => ({ [Symbol.asyncIterator]() { return this; }, next: () => new Promise(() => {}), return: () => ({ done: true }) }) }, asset: { bytes: 1, sha256: digest('a') } });
  assert.equal(result.status, 'limit'); assert.equal(result.reason, 'document_timeout');
  const zip = await createNodeDocumentDecoder().decode(input(Buffer.from([80, 75, 3, 4]), 'authored.docx')); assert.equal(zip.status, 'failed'); assert.equal(zip.text, null);
});
