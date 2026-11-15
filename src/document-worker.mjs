// Internal subprocess entry. Input paths are fixed inside the owned cwd.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), warnings = [];
for (const name of ['log', 'warn', 'error']) console[name] = (...values) => { if (warnings.length < 20) warnings.push(values.map(String).join(' ').slice(0, 256)); };
let configuration = '', count = 0;
for await (const chunk of process.stdin) { count += chunk.length; if (count > 8192) throw new Error('Invalid worker configuration'); configuration += chunk; }
const { format, limits, engines, ocr } = JSON.parse(configuration);
const bytes = await readFile('input');
let method = null, engine = null, parts = [], textBytes = 0, reason = null;
const exceeded = () => { const error = new Error('Document output budget'); error.code = 'document_limit'; throw error; };
function add(text, location) {
  if (!text) return;
  textBytes += Buffer.byteLength(text) + (parts.length ? 1 : 0);
  if (textBytes > limits.maxTextBytes || parts.length >= limits.maxSegments) exceeded();
  parts.push({ text, location });
}
function identify(kind) {
  const [name, version] = engines[kind], actual = require(name + '/package.json').version;
  if (actual !== version) throw new Error('document_engine_version');
  engine = { name, version };
}
let status;
try {
  if (format === 'utf8') {
    method = 'literal-text'; engine = { name: 'node:TextDecoder', version: process.versions.node };
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('document_binary_text');
    text.split(/\r?\n/u).forEach((line, index) => add(line, { kind: 'line', line: index + 1 }));
  } else if (format === 'pdf') {
    identify('pdf'); method = 'pdf-text';
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWasm: false, enableXfa: false, verbosity: 0, stopAtErrors: true });
    let document;
    try {
      document = await task.promise;
      if (document.numPages > limits.maxPages) exceeded();
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        try {
          const content = await page.getTextContent({ disableNormalization: true });
          const text = content.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : '')).join('');
          if (!text.trim()) reason = 'pages_without_text'; else add(text, { kind: 'page', page: pageNumber });
        } finally { page.cleanup(); }
      }
    } finally { await task.destroy(); }
  } else if (format === 'docx') {
    identify('docx'); method = 'docx-text';
    const mammoth = require('mammoth'), extracted = await mammoth.extractRawText({ buffer: bytes });
    for (const item of extracted.messages) if (warnings.length < 20) warnings.push(String(item.message).slice(0, 256));
    extracted.value.split(/\n\n/u).forEach((paragraph, index) => add(paragraph, { kind: 'paragraph', paragraph: index + 1 }));
  } else if (format === 'xlsx') {
    identify('xlsx'); method = 'xlsx-cells';
    const ExcelJS = require('exceljs'), book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
    if (book.worksheets.length > limits.maxSheets) exceeded();
    let cells = 0;
    for (const sheet of book.worksheets) sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      if (++cells > limits.maxCells) exceeded();
      const value = cell.value;
      let text;
      if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) text = '=' + String(value.formula ?? value.sharedFormula);
      else if (value instanceof Date) text = value.toISOString();
      else text = cell.text;
      add(text, { kind: 'cell', sheet: sheet.name, cell: cell.address, formula: Boolean(value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) });
    }));
  } else if (format === 'png' || format === 'jpeg') {
    identify('image'); method = 'ocr'; engine.languageSha256 = ocr.sha256;
    const { createWorker } = require('tesseract.js');
    let worker;
    try {
      worker = await createWorker('eng', 1, { langPath: process.cwd(), gzip: ocr.gzip, cacheMethod: 'none', logger: () => {} });
      const result = await worker.recognize(bytes, {}, { text: true, blocks: false });
      add(result.data.text, { kind: 'image', confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : null });
    } finally { if (worker) await worker.terminate(); }
  } else throw new Error('document_format');
  status = parts.length ? 'extracted' : 'empty';
} catch (error) {
  status = error.code === 'document_limit' ? 'limit' : 'failed'; reason = error.code || (error.name === 'PasswordException' ? 'document_encrypted' : 'document_invalid'); parts = [];
}
const text = status === 'extracted' ? parts.map(part => part.text).join('\n') : null;
process.stdout.write(JSON.stringify({ status, method, text, segments: parts, engine, reason, complete: status === 'extracted' && reason === null, warnings }) + '\n');
