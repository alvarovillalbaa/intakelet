// T2 authored, minimal document fixtures. No private/user records.
import { createRequire } from 'node:module';
const escapeXML = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function crc(bytes) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
export function zip(entries) {
  let offset = 0; const locals = [], directory = [];
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name), bytes = Buffer.from(content), checksum = crc(bytes), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); directory.push(central, filename); offset += local.length + filename.length + bytes.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
export function docx(paragraphs) {
  return zip({ '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs.map(text => '<w:p><w:r><w:t>' + escapeXML(text) + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>' });
}
export function pdf(pages) {
  const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, index) => (4 + index * 2) + ' 0 R').join(' ') + '] >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let index = 0; index < pages.length; index++) {
    const stream = 'BT /F1 18 Tf 40 700 Td (' + pages[index].replace(/[\\()]/g, '\\$&') + ') Tj ET';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + index * 2) + ' 0 R >>', '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream');
  }
  let body = '%PDF-1.4\n', offsets = [0];
  for (let index = 1; index < objects.length; index++) { offsets.push(Buffer.byteLength(body)); body += index + ' 0 obj\n' + objects[index] + '\nendobj\n'; }
  const xref = Buffer.byteLength(body); body += 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n' + offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'; return Buffer.from(body);
}
export async function images(requireFromConsumer) {
  const pdfRequire = createRequire(requireFromConsumer.resolve('pdfjs-dist/package.json'));
  const { createCanvas } = pdfRequire('@napi-rs/canvas'), canvas = createCanvas(900, 170), context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 900, 170); context.fillStyle = 'black'; context.font = 'bold 64px sans-serif'; context.fillText('MIGRATION 42', 35, 110);
  return { png: canvas.toBuffer('image/png'), jpeg: canvas.toBuffer('image/jpeg') };
}
