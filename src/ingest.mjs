import { parseCSV } from './csv.mjs';
import { exact, filename, workspace, label, byteLength, LIMITS, parseJSON, canonical, clone, sha256, seal, requireValue, aborted } from './values.mjs';
const formats = { csv: 'csv', json: 'json', md: 'markdown', markdown: 'markdown', txt: 'text' };
const aliases = { email: ['email', 'emailaddress', 'mail', 'correo', 'correoelectronico'], name: ['name', 'fullname', 'nombre', 'contactname'], company: ['company', 'organization', 'organisation', 'empresa', 'org'] };
const cleanHeader = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function tableJSON(text) {
  const value = parseJSON(text, LIMITS.fileBytes);
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= LIMITS.rows, 'json_records', 'JSON must be a nonempty array of at most2000 flat records');
  const columns = [...new Set(value.flatMap(row => { requireValue(row && typeof row === 'object' && !Array.isArray(row), 'json_record', 'Each JSON row must be an object'); return Object.keys(row); }))];
  requireValue(columns.length > 0 && columns.length <= 80, 'columns', 'A table needs1–80 columns'); columns.forEach(v => label(v, 100));
  const rows = value.map((row, index) => {
    for (const cell of Object.values(row)) requireValue(cell === null || ['string', 'number', 'boolean'].includes(typeof cell), 'json_cell', 'JSON table cells must be strings, finite numbers, booleans or null');
    return { index, values: Object.fromEntries(columns.map(key => [key, row[key] ?? null])), span: { start: 0, end: text.length, jsonRow: index } };
  });
  return { columns, rows };
}
export function suggestMapping(columns) {
  const mapping = {};
  for (const [field, candidates] of Object.entries(aliases)) { const matches = columns.filter(c => candidates.includes(cleanHeader(c))); if (matches.length === 1) mapping[field] = matches[0]; }
  return { kind: mapping.email ? 'contact' : 'record', mapping: mapping.email ? mapping : {}, reason: mapping.email ? `Contact fields suggested from the “${mapping.email}” column. Review before importing.` : 'No unambiguous email column; preserve these values as generic records.' };
}
export async function analyzeFiles(files, { workspaceId, signal } = {}) {
  workspace(workspaceId); requireValue(Array.isArray(files) && files.length > 0 && files.length <= LIMITS.files, 'files', 'Choose1–10 supported files');
  let bytes = 0, rowCount = 0; const sources = [], tables = [], documents = [], duplicates = []; const identities = new Map();
  for (const file of files) {
    aborted(signal); exact(file, ['name', 'text'], ['format', 'url']); filename(file.name);
    requireValue(typeof file.text === 'string' && file.text.trim(), 'empty', 'A source must contain text'); canonical(file.text);
    const size = byteLength(file.text); bytes += size; requireValue(size <= LIMITS.fileBytes && bytes <= LIMITS.totalBytes, 'size', 'Source exceeds512KiB/file or2MiB total');
    const format = file.format ?? formats[file.name.split('.').at(-1).toLowerCase()]; requireValue(['csv', 'json', 'markdown', 'text'].includes(format), 'format', 'Supported files are CSV, JSON records, Markdown and UTF-8 text');
    const hash = await sha256(file.text), id = 'src-' + await sha256(canonical({ format, hash }));
    if (file.url !== undefined) { const url = new URL(file.url); requireValue(url.protocol === 'https:' && !url.username && !url.password && file.url.length < 2048, 'source_url', 'A source annotation must be a bounded HTTPS URL'); }
    if (identities.has(id)) { duplicates.push({ name: file.name, sameAs: identities.get(id), ...(file.url ? { url: file.url } : {}) }); continue; }
    const source = { id, name: file.name, format, bytes: size, sha256: hash, text: file.text, ...(file.url ? { url: file.url } : {}) }; identities.set(id, id); sources.push(source);
    if (['csv', 'json'].includes(format)) {
      const table = format === 'csv' ? parseCSV(file.text) : tableJSON(file.text); rowCount += table.rows.length; requireValue(rowCount <= LIMITS.rows, 'rows', 'Combined input exceeds2000 rows');
      tables.push({ sourceId: id, ...table, suggestion: suggestMapping(table.columns) });
    } else documents.push({ sourceId: id, title: file.text.match(/^#{1,3}\s+(.+)$/mu)?.[1]?.trim().slice(0, 200) || file.name.split('/').at(-1), format });
  }
  return seal({ schema: 'intakelet.draft', version: 1, workspaceId, sources, tables, documents, duplicates, totals: { files: sources.length, rows: rowCount, bytes, duplicateFiles: duplicates.length } }, 'draftId');
}
export async function verifyDraft(input) {
  exact(input, ['schema', 'version', 'workspaceId', 'sources', 'tables', 'documents', 'duplicates', 'totals', 'draftId']);
  requireValue(input.schema === 'intakelet.draft' && input.version === 1, 'draft_version', 'Unsupported draft version');
  // Duplicate source names are informational. Reconstruct their original byte
  // contribution too, so the admitted total remains the exact supplied input.
  const files = input.sources.map(s => ({ name: s.name, text: s.text, format: s.format, ...(s.url ? { url: s.url } : {}) }));
  for (const duplicate of input.duplicates) { exact(duplicate, ['name', 'sameAs'], ['url']); const source = input.sources.find(s => s.id === duplicate.sameAs); requireValue(source, 'draft', 'Unknown duplicate source'); files.push({ name: duplicate.name, text: source.text, format: source.format, ...(duplicate.url ? { url: duplicate.url } : {}) }); }
  const reconstructed = await analyzeFiles(files, { workspaceId: input.workspaceId });
  requireValue(canonical(reconstructed) === canonical(input), 'draft_integrity', 'Draft does not match its original bounded sources'); return clone(reconstructed);
}
