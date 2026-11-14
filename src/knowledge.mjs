import { requireValue, LIMITS, sha256, canonical, clone } from './values.mjs';

export function chunkText(text, maximum = 1000) {
  const spans = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maximum, text.length);
    if (end < text.length) { const boundary = text.lastIndexOf('\n', end); if (boundary > start + maximum / 2) end = boundary + 1; if (/[\ud800-\udbff]/u.test(text[end - 1])) end--; }
    if (text.slice(start, end).trim()) spans.push({ start, end }); start = end;
  }
  return spans;
}
export async function buildKnowledge(sources, records) {
  const articles = [];
  for (const source of sources) {
    if (!['markdown', 'text'].includes(source.format)) continue;
    const title = source.text.match(/^#{1,3}\s+(.+)$/mu)?.[1]?.trim().slice(0, 200) || source.name;
    for (const [part, span] of chunkText(source.text).entries()) { requireValue(articles.length < LIMITS.chunks, 'chunks', 'Knowledge exceeds1000 chunks'); const text = source.text.slice(span.start, span.end); articles.push({ id: 'kb-' + await sha256(canonical({ sourceId: source.id, span })), sourceId: source.id, title, part, text, span, ...(source.url ? { url: source.url } : {}), method: 'exact_source' }); }
  }
  for (let offset = 0; offset < records.length; offset += 20) {
    const group = records.slice(offset, offset + 20);
    requireValue(articles.length < LIMITS.chunks, 'chunks', 'Knowledge exceeds1000 chunks');
    articles.push({ id: 'kb-' + await sha256(canonical(group.map(r => r.id))), sourceId: group[0].provenance[0].sourceId, title: 'Imported records', part: offset / 20, text: canonical(group.map(r => r.data)), recordIds: group.map(r => r.id), provenance: clone(group.flatMap(r => r.provenance)), method: 'structured_records' });
  }
  return articles;
}
export function searchKnowledge(articles, query, { limit = 8 } = {}) {
  requireValue(typeof query === 'string' && query.length <= 300 && Number.isInteger(limit) && limit >= 1 && limit <= 50, 'search', 'Use a bounded search query/limit');
  const terms = [...new Set(query.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]{2,}/gu) || [])]; if (!terms.length) return [];
  return articles.map(article => { const body = (article.title + '\n' + article.text).normalize('NFKC').toLocaleLowerCase('en'); const matches = terms.filter(term => body.includes(term)); return { article, matchedTerms: matches, score: matches.length }; }).filter(row => row.score).sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id, 'en')).slice(0, limit).map(row => ({ ...clone(row), method: 'literal_term_match' }));
}
