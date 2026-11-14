// Original shared utility from alvarovillalbaa/hr-bench de832bca (MIT).
export function parseJSON(text, maxBytes = 4 * 1024 * 1024) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) throw new Error('JSON exceeds its byte budget');
  let cursor = 0;
  const space = () => { while (/[\t\r\n ]/.test(text[cursor] || '\0')) cursor += 1; };
  const fail = message => { throw new Error(`${message} at character ${cursor}`); };
  function string() {
    const start = cursor++;
    while (cursor < text.length) {
      const c = text[cursor++];
      if (c === '\\') { cursor += 1; continue; }
      if (c === '"') {
        const value = JSON.parse(text.slice(start, cursor));
        if ([...value].some(x => { const n = x.codePointAt(0); return n >= 0xd800 && n <= 0xdfff; })) fail('Unpaired Unicode surrogate');
        return value;
      }
    }
    fail('Unterminated string');
  }
  function value(depth = 0) {
    if (depth > 40) fail('JSON nesting exceeds limit');
    space(); const c = text[cursor];
    if (c === '"') return string();
    if (c === '{') {
      cursor += 1; space(); const output = {}, seen = new Set();
      if (text[cursor] === '}') { cursor += 1; return output; }
      while (cursor < text.length) {
        space(); if (text[cursor] !== '"') fail('Object key must be a string');
        const key = string();
        if (seen.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('Duplicate or unsafe key');
        seen.add(key); space(); if (text[cursor++] !== ':') fail('Missing colon');
        output[key] = value(depth + 1); space();
        const next = text[cursor++]; if (next === '}') return output; if (next !== ',') fail('Missing object separator');
      }
      fail('Unterminated object');
    }
    if (c === '[') {
      cursor += 1; space(); const output = [];
      if (text[cursor] === ']') { cursor += 1; return output; }
      while (cursor < text.length) {
        output.push(value(depth + 1)); space(); const next = text[cursor++];
        if (next === ']') return output; if (next !== ',') fail('Missing array separator');
      }
      fail('Unterminated array');
    }
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(word, cursor)) { cursor += word.length; return literal; }
    const number = text.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) { cursor += number[0].length; const n = Number(number[0]); if (!Number.isFinite(n)) fail('Non-finite number'); return n; }
    fail('Invalid JSON value');
  }
  const output = value(); space(); if (cursor !== text.length) fail('Trailing JSON content'); return output;
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    const result = JSON.stringify(value); if (typeof value === 'string') parseJSON(result); return result;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(value))) return '{' + Object.keys(value).sort().map(key => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe key'); return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
  throw new Error('Only finite JSON data is supported');
}
export const clone = value => parseJSON(canonical(value));
