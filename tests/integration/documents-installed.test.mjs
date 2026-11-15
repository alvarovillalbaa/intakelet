// T2 authored files; real installed parsers/OCR, no external document/network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pdf, docx, zip, images } from '../fixtures/document-files.mjs';
const require = createRequire(join(process.env.INTAKELET_DOCUMENT_CONSUMER, 'package.json'));
const { createNodeDocumentDecoder } = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/documents/node')));
const { createFileMigrationSource, fileMigration, MemoryMigrationHost, runMigration } = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration')));
const { DirectoryAssetStore } = await import(pathToFileURL(require.resolve('@alvarovillalbaa/intakelet/migration/node')));
const output = process.env.INTAKELET_DOCUMENT_OUTPUT;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const make = (bytes, name) => ({ file: new File([bytes], name), asset: { bytes: bytes.length, sha256: 'sha256:' + hash(bytes), assetId: 'authored:' + hash(bytes) } });
const languageFile = process.env.INTAKELET_OCR_FILE, language = await readFile(languageFile);
const ocr = { language: 'eng', dataFile: languageFile, sha256: hash(language) };
const document = pdf(['Fictional handbook 42', 'Authored second page']);
const word = docx(['Fictional onboarding 42', '<script>literal source</script>']);
const image = await images(require);
const ExcelJS = require('exceljs'), book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Fictional team');
sheet.getCell('A1').value = 'Authored budget'; sheet.getCell('B2').value = 42; sheet.getCell('C3').value = { formula: 'SUM(B2,8)', result: 50 };
const spreadsheet = Buffer.from(await book.xlsx.writeBuffer());
const artifacts = [];
async function retain(name, input, result) { await writeFile(join(output, name), input, { flag: 'wx' }); await writeFile(join(output, name + '.result.json'), JSON.stringify(result, null, 2), { flag: 'wx' }); artifacts.push({ name, bytes: input.length, sha256: hash(input), status: result.status, engine: result.engine }); }

test('E01 installed PDF parser extracts both actual pages with exact source identity', async () => {
  const source = make(document, 'untrusted-name.exe'), result = await createNodeDocumentDecoder().decode(source);
  assert.equal(result.status, 'extracted'); assert.equal(result.complete, true); assert.equal(result.sourceSha256, source.asset.sha256); assert.equal(result.engine.version, '6.5.438');
  assert.deepEqual(result.segments.map(item => item.location.page), [1, 2]); assert.match(result.text, /Fictional handbook 42/); assert.match(result.text, /Authored second page/); await retain('authored.pdf', document, result);
});
test('E02 installed DOCX parser extracts paragraphs and retains markup as literal text', async () => {
  const result = await createNodeDocumentDecoder().decode(make(word, 'authored.docx'));
  assert.equal(result.status, 'extracted'); assert.match(result.text, /Fictional onboarding 42/); assert.match(result.text, /<script>literal source<\/script>/); assert.equal(result.segments[1].location.paragraph, 2); assert.equal(result.engine.version, '1.12.2'); await retain('authored.docx', word, result);
});
test('E03 installed XLSX parser records sheet/cell locations and does not calculate formulas', async () => {
  const result = await createNodeDocumentDecoder().decode(make(spreadsheet, 'authored.xlsx'));
  assert.equal(result.status, 'extracted'); assert.equal(result.engine.version, '4.4.0');
  assert.deepEqual(result.segments.map(item => item.location.cell), ['A1', 'B2', 'C3']); assert.equal(result.segments[2].text, '=SUM(B2,8)'); assert.equal(result.segments[2].location.formula, true); assert.equal(result.segments[0].location.sheet, 'Fictional team'); await retain('authored.xlsx', spreadsheet, result);
});
test('E04 actual local English OCR recognizes authored PNG and JPEG with model digest', async () => {
  for (const [format, bytes] of Object.entries(image)) {
    const result = await createNodeDocumentDecoder({ ocr, timeoutMs: 60000 }).decode(make(bytes, 'authored.' + format));
    assert.equal(result.status, 'extracted'); assert.equal(result.complete, true); assert.match(result.text, /MIGRATION\s+42/); assert.equal(result.engine.version, '7.0.0'); assert.equal(result.engine.languageSha256, ocr.sha256); assert.equal(result.segments[0].location.kind, 'image'); await retain('authored.' + format, bytes, result);
  }
});
test('E05 real decoded mixed-file migration exceeds ten files, reviews outputs and resumes exact pages', async () => {
  const decoder = createNodeDocumentDecoder({ ocr, timeoutMs: 60000 });
  const files = [...Array.from({ length: 8 }, (_, index) => new File(['Authored note ' + index], 'same.txt')), new File([document], 'authored.pdf'), new File([word], 'authored.docx'), new File([spreadsheet], 'authored.xlsx'), new File([image.png], 'authored.png'), new File([new Uint8Array([0, 1, 255])], 'unknown.bin')];
  const source = await createFileMigrationSource({ collectionId: 'authored-documents', files, assetStore: new DirectoryAssetStore({ directory: join(output, 'assets') }), filesPerPage: 2, decode: decoder.decode, decoderVersion: decoder.version });
  const properties = { id: { type: 'string' }, title: { type: 'string' }, text: { type: ['string', 'null'] }, status: { type: 'string' } };
  const recipe = { id: 'documents', version: '1', schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, fields: [{ from: ['fileId'], to: ['id'] }, { from: ['name'], to: ['title'] }, { from: ['extracted', 'text'], to: ['text'] }, { from: ['extracted', 'status'], to: ['status'] }], key: [['id']] };
  const host = new MemoryMigrationHost({ workspaceId: 'authored' }), spec = fileMigration({ workspaceId: 'authored', connectionId: 'documents', source, output: recipe });
  const receipts = [], review = batch => { assert.ok(batch.ready); for (const row of batch.rows) assert.ok(Object.hasOwn(row.data, 'status')); return { decision: 'approve', batchId: batch.batchId }; };
  const first = await runMigration({ spec, source, host, review, maxBatches: 2, onReceipt: receipt => receipts.push(receipt) }); assert.equal(first.items, 4); assert.equal(first.status, 'paused');
  const last = await runMigration({ spec, source, host, review, onReceipt: receipt => receipts.push(receipt) }); assert.equal(last.items, 9); assert.equal(last.status, 'complete'); assert.deepEqual(last.checkpoint, { kind: 'file-collection-v1', next: 13 });
  const final = await host.inspectBatch(last.lastReceipt.batchId); assert.equal(final.batch.rows[0].data.status, 'unsupported'); assert.equal(final.batch.rows[0].data.text, null); assert.equal(receipts.reduce((total, receipt) => total + receipt.counts.created, 0), 13);
  await writeFile(join(output, 'mixed-receipts.json'), JSON.stringify(receipts, null, 2), { flag: 'wx' });
});
test('E06 missing OCR configuration and wrong language hashes never become extracted text', async () => {
  const source = make(image.png, 'authored.png'), absent = await createNodeDocumentDecoder().decode(source);
  assert.equal(absent.status, 'unsupported'); assert.equal(absent.reason, 'ocr_data_required');
  await assert.rejects(createNodeDocumentDecoder({ ocr: { ...ocr, sha256: '0'.repeat(64) } }).decode(source), error => error.code === 'document_language');
});
test('E07 page/cell/ZIP expansion limits discard complete-prefix claims', async () => {
  for (const [options, bytes, name] of [[{ maxPages: 1 }, document, 'a.pdf'], [{ maxCells: 1 }, spreadsheet, 'a.xlsx']]) {
    const result = await createNodeDocumentDecoder(options).decode(make(bytes, name)); assert.equal(result.status, 'limit'); assert.equal(result.text, null); assert.deepEqual(result.segments, []); assert.equal(result.complete, false);
  }
  const bomb = zip({ 'word/document.xml': 'authored' }), end = bomb.length - 22, central = bomb.readUInt32LE(end + 16); bomb.writeUInt32LE(67108865, central + 24);
  const result = await createNodeDocumentDecoder().decode(make(bomb, 'bomb.docx')); assert.equal(result.status, 'limit'); assert.equal(result.text, null);
});
test('E08 cancellation during real parser startup closes its process and owned scratch', async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith('intakelet-document-')).sort(), controller = new AbortController();
  const pending = createNodeDocumentDecoder().decode({ ...make(document, 'a.pdf'), signal: controller.signal }); const timer = setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, error => error.code === 'aborted'); clearTimeout(timer);
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('intakelet-document-')).sort(), before);
});
test('E09 network preload denies main-process and inherited-worker requests before transport', async () => {
  const entry = require.resolve('@alvarovillalbaa/intakelet/documents/node'), guard = new URL('./document-network-deny.mjs', pathToFileURL(entry));
  const code = 'const { Worker }=require("node:worker_threads");(async()=>{try{await fetch("https://example.invalid/")}catch(e){if(e.message!=="document_network_denied")throw e;}const w=new Worker(`const {parentPort}=require("node:worker_threads");try{require("node:https").get("https://example.invalid/")}catch(e){parentPort.postMessage(e.message)}`,{eval:true});w.once("message",m=>{if(m!=="document_network_denied")process.exitCode=1;});})();';
  const child = spawn(process.execPath, ['--import', guard.href, '--input-type=commonjs', '-e', code], { env: {}, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))); assert.deepEqual(exit, { code: 0, signal: null }, stderr);
});
test('E10 all decoder scratch is gone and actual fixture/provenance records are retained', async () => {
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('intakelet-document-')), []);
  await writeFile(join(output, 'provenance.json'), JSON.stringify({ node: process.version, fixtures: artifacts, language: { bytes: language.length, sha256: ocr.sha256 }, scope: 'T2 authored actual installed parsing/OCR; not general accuracy or production-host proof' }, null, 2), { flag: 'wx' });
});
