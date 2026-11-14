import { canonical, clone, parseJSON } from './strict-json.mjs';
export { canonical, clone, parseJSON };
export const LIMITS = Object.freeze({ files: 10, fileBytes: 524288, totalBytes: 2097152, rows: 2000, chunks: 1000, records: 10000, storedBytes: 12582912 });
export class IntakeletError extends Error { constructor(code, message, details = null) { super(message); this.name = 'IntakeletError'; this.code = code; this.details = details; } }
export function requireValue(test, code, message, details) { if (!test) throw new IntakeletError(code, message, details); }
export function exact(value, fields, optional = []) { requireValue(value && typeof value === 'object' && !Array.isArray(value) && fields.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => [...fields, ...optional].includes(k)), 'shape', 'Unexpected or missing fields'); }
export function label(value, max = 200) { requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), 'text', 'Expected bounded text'); canonical(value); return value; }
export function workspace(value) { requireValue(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value), 'workspace', 'Expected an application workspace ID'); return value; }
export function byteLength(text) { return new TextEncoder().encode(text).length; }
export async function sha256(value) { const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value; const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function seal(body, field) { return { ...clone(body), [field]: 'sha256:' + await sha256(canonical(body)) }; }
export function filename(value) { label(value, 160); requireValue(!value.startsWith('/') && !value.includes('\\') && !value.split('/').some(p => !p || p === '.' || p === '..') && !/^[a-z]:/i.test(value), 'filename', 'Use a relative source name without parent or absolute paths'); return value; }
export function normalizeEmail(value) { requireValue(typeof value === 'string', 'email', 'Email must be text'); const email = value.trim().toLowerCase(); requireValue(email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email), 'email', 'A contact needs a valid email'); return email; }
export function aborted(signal) { if (signal?.aborted) throw new IntakeletError('aborted', 'Operation cancelled'); }
