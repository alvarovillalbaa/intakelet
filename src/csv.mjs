import { requireValue, LIMITS, label } from './values.mjs';

// RFC4180-style UTF-8 CSV; row spans refer to the original UTF-16 text.
export function parseCSV(text) {
  const rows = []; let fields = [], value = '', quoted = false, closed = false, rowStart = 0, fieldStart = true;
  const field = () => { fields.push(value); value = ''; fieldStart = true; closed = false; };
  const row = end => { field(); if (fields.some(v => v.length)) rows.push({ cells: fields, span: { start: rowStart, end } }); fields = []; rowStart = end; requireValue(rows.length <= LIMITS.rows + 1, 'rows', 'CSV exceeds2000 data rows'); };
  let i = text.startsWith('\ufeff') ? 1 : 0; rowStart = i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } } else value += c; continue; }
    if (c === ',') { field(); continue; }
    if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; row(i + 1); continue; }
    requireValue(!closed, 'csv', 'Unexpected text after a closing CSV quote');
    if (c === '"') { requireValue(fieldStart, 'csv', 'A CSV quote must begin its field'); quoted = true; fieldStart = false; }
    else { value += c; fieldStart = false; }
  }
  requireValue(!quoted, 'csv', 'Unterminated CSV quote');
  if (fields.length || value.length || closed) row(text.length);
  requireValue(rows.length >= 2, 'csv', 'CSV needs a header and at least one data row');
  const header = rows.shift().cells.map(v => v.trim());
  requireValue(header.length <= 80 && header.every(v => v && v.length <= 100) && new Set(header.map(v => v.toLowerCase())).size === header.length, 'csv_header', 'CSV headers must be unique, nonempty and bounded');
  header.forEach(v => label(v, 100));
  return { columns: header, rows: rows.map((r, index) => { requireValue(r.cells.length === header.length, 'csv_width', `CSV row${index + 2} has${r.cells.length} fields; expected${header.length}`); requireValue(r.cells.every(v => v.length <= 65536), 'cell', 'CSV cell exceeds64K characters'); return { index, values: Object.fromEntries(header.map((h, i) => [h, r.cells[i]])), span: r.span }; }) };
}
