import { exact, clone, parseJSON, requireValue, label, aborted, IntakeletError } from './values.mjs';
import { MIGRATION_LIMITS, validateSourcePage, validateMigrationSpec } from './migration.mjs';

const API_VERSION = '2026-03-10';
function repositoryPart(value) { requireValue(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value) && !['.', '..'].includes(value), 'github_repository', 'Provide an explicit GitHub owner/repository'); return value; }
function opaqueAfter(value, code) { requireValue(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/u.test(value), code, 'Invalid opaque GitHub continuation'); return value; }
function cursorValue(cursor) {
  if (cursor === null) return { cycle: 0, page: 1, after: null };
  exact(cursor, ['kind', 'cycle', 'page', 'after']); requireValue(cursor.kind === 'github-issues-v2' && Number.isSafeInteger(cursor.cycle) && cursor.cycle >= 0 && Number.isSafeInteger(cursor.page) && cursor.page > 0 && (cursor.after === null || cursor.page > 1), 'github_cursor', 'Invalid GitHub scan checkpoint');
  if (cursor.after !== null) opaqueAfter(cursor.after, 'github_cursor'); return cursor;
}
async function bodyJSON(response, signal) {
  requireValue(response.body && /^(?:application\/json|application\/[^;\s]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'github_response', 'GitHub must return JSON');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) { aborted(signal); const { value, done } = await reader.read(); aborted(signal); if (done) break; size += value.byteLength; requireValue(size <= MIGRATION_LIMITS.pageBytes, 'github_budget', 'GitHub response exceeds 2MiB; use a smaller page size'); chunks.push(value); }
  } finally { signal?.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return parseJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes), MIGRATION_LIMITS.pageBytes);
}
function nextPage(header, current, endpoint, perPage) {
  if (!header) return { more: false, after: null };
  requireValue(header.length <= 16384, 'github_pagination', 'GitHub pagination header exceeds its budget');
  const next = header.split(',').filter(part => /;\s*rel="next"\s*(?:;|$)/.test(part)); requireValue(next.length <= 1, 'github_pagination', 'Multiple next-page links');
  if (!next.length) { requireValue(!/rel="[^"\n]*\bnext\b/.test(header), 'github_pagination', 'Unrecognized next-page link'); return { more: false, after: null }; }
  const match = next[0].match(/^\s*<([^>]+)>;/); let url; try { url = new URL(match?.[1]); } catch {}
  // Validate the link; construct the next request ourselves. Never forward a
  // token to a Link target, redirect, arbitrary origin or unexpected resource.
  const hasAfter = url?.searchParams.has('after');
  requireValue(url && url.origin === 'https://api.github.com' && !url.username && !url.password && !url.hash && (url.pathname === endpoint || /^\/repositories\/[1-9]\d*\/issues$/.test(url.pathname)) && url.searchParams.get('page') === String(current + 1) && url.searchParams.get('per_page') === String(perPage) && url.searchParams.get('state') === 'all' && url.searchParams.get('sort') === 'created' && url.searchParams.get('direction') === 'asc' && [...url.searchParams.keys()].length === (hasAfter ? 6 : 5), 'github_pagination', 'Unexpected GitHub continuation; no checkpoint was advanced');
  return { more: true, after: hasAfter ? opaqueAfter(url.searchParams.get('after'), 'github_pagination') : null };
}
function normalizedIssue(issue) {
  requireValue(issue && typeof issue === 'object' && Number.isSafeInteger(issue.id) && issue.id > 0 && Number.isSafeInteger(issue.number) && issue.number > 0 && ['open', 'closed'].includes(issue.state) && typeof issue.title === 'string' && (issue.body === null || typeof issue.body === 'string') && Array.isArray(issue.labels), 'github_issue', 'GitHub issue shape is not supported');
  label(issue.updated_at, 80); label(issue.created_at, 80); const url = new URL(issue.html_url); requireValue(url.origin === 'https://github.com' && !url.username && !url.password, 'github_issue', 'Issue URL must belong to GitHub');
  const labels = issue.labels.map(value => { const name = typeof value === 'string' ? value : value?.name; label(name, 100); return name; });
  const author = issue.user === null ? null : issue.user?.login; requireValue(author === null || typeof author === 'string', 'github_issue', 'Invalid issue author');
  return { id: String(issue.id), operation: 'upsert', revision: issue.updated_at, data: { id: String(issue.id), number: issue.number, title: issue.title, body: issue.body, state: issue.state, url: url.href, labels, author, createdAt: issue.created_at, updatedAt: issue.updated_at } };
}

export function createGitHubIssuesSource({ owner, repo, perPage = 10, token, fetch: request = globalThis.fetch } = {}) {
  repositoryPart(owner); repositoryPart(repo); requireValue(Number.isSafeInteger(perPage) && perPage >= 1 && perPage <= 100 && typeof request === 'function', 'github_source', 'Provide a fetch transport and page size 1–100');
  requireValue(token === undefined || typeof token === 'string' && token.length > 0 && token.length <= 4096 && !/\s/.test(token), 'github_token', 'Invalid application-supplied token');
  const identity = { id: 'github-issues', version: '2', configuration: { owner, repo, perPage, apiVersion: API_VERSION, scan: 'created-ascending-all-states-opaque-after' } }, endpoint = `/repos/${owner}/${repo}/issues`;
  return {
    get identity() { return clone(identity); },
    async readPage({ cursor = null, limit = 500, signal } = {}) {
      const position = cursorValue(cursor); requireValue(Number.isSafeInteger(limit) && limit >= perPage, 'github_source', 'The runner item budget is below this source page size'); aborted(signal);
      const url = new URL('https://api.github.com' + endpoint); for (const [key, value] of Object.entries({ state: 'all', sort: 'created', direction: 'asc', per_page: perPage, page: position.page })) url.searchParams.set(key, String(value));
      if (position.after !== null) url.searchParams.set('after', position.after);
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'Intakelet-GitHub-Migration' }; if (token) headers.Authorization = 'Bearer ' + token;
      const response = await request(url.href, { method: 'GET', headers, signal, credentials: 'omit', redirect: 'error', cache: 'no-store' }); aborted(signal);
      if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw new IntakeletError('github_http', 'GitHub request did not succeed; the checkpoint is unchanged', { status: response.status, retryAfter: response.headers.get('retry-after') }); }
      try {
        const continuation = nextPage(response.headers.get('link'), position.page, endpoint, perPage), values = await bodyJSON(response, signal); requireValue(Array.isArray(values) && values.length <= perPage, 'github_response', 'Expected a bounded GitHub issue array');
        const items = values.filter(value => !Object.hasOwn(value, 'pull_request')).map(normalizedIssue);
        const after = { kind: 'github-issues-v2', cycle: position.cycle + (continuation.more ? 0 : 1), page: continuation.more ? position.page + 1 : 1, after: continuation.after }; requireValue(Number.isSafeInteger(after.cycle) && Number.isSafeInteger(after.page), 'github_cursor', 'GitHub checkpoint counter exhausted');
        return validateSourcePage({ items, cursorBefore: clone(cursor), cursorAfter: after, done: !continuation.more });
      } finally { void response.body?.cancel().catch(() => {}); }
    }
  };
}

export function githubIssuesOutput({ id = 'github-tasks', version = '1' } = {}) {
  const properties = { externalId: { type: 'string' }, number: { type: 'integer' }, title: { type: 'string' }, description: { type: ['string', 'null'] }, state: { type: 'string', enum: ['open', 'closed'] }, url: { type: 'string', format: 'https-url' }, labels: { type: 'array', items: { type: 'string' } }, author: { type: ['string', 'null'] }, createdAt: { type: 'string' }, updatedAt: { type: 'string' } };
  const fields = Object.keys(properties).map(to => ({ to: [to], from: [{ externalId: 'id', description: 'body' }[to] ?? to] }));
  return { id, version, schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, fields, key: [['externalId']] };
}
export function githubIssuesMigration({ workspaceId, connectionId, source, output = githubIssuesOutput() } = {}) {
  return validateMigrationSpec({ workspaceId, connectionId, source: source?.identity, output, policy: { create: true, update: true, delete: false } });
}
