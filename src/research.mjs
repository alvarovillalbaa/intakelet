import { parse } from 'parse5';
import robotsParser from 'robots-parser';
import { requireValue, sha256, aborted, IntakeletError, byteLength } from './values.mjs';
const AGENT = 'Intakelet';
const blockedTags = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'form']);
const chromeTags = new Set(['nav', 'footer', 'header']);
const blockTags = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'div', 'section', 'article', 'main', 'br', 'tr', 'blockquote']);
const forbidden = /(?:^|\/)(?:api|admin|wp-admin|account|dashboard|login|signin|signup|logout|signout|checkout|cart|delete|remove|unsubscribe)(?:\/|$)/i;
const attributes = n => Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
export function siteURL(value) {
  let url; try { url = new URL(value); } catch { throw new IntakeletError('url', 'Enter an absolute HTTPS website URL'); }
  requireValue(url.protocol === 'https:' && !url.port && !url.username && !url.password && url.href.length <= 2048 && !url.hostname.endsWith('.') && url.hostname.includes('.') && !url.hostname.startsWith('['), 'url', 'Use a credential-free HTTPS443 domain URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) { if (/^(utm_.+|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key); else requireValue(['lang', 'page'].includes(key) && /^[\p{L}\p{N}_-]{1,30}$/u.test(url.searchParams.get(key)), 'url', 'This URL contains unsupported query fields; use its public content URL'); }
  requireValue(!forbidden.test(decodeURIComponent(url.pathname)), 'url', 'This is an application/action route, not a public content page');
  return url;
}
export function extractPage(html, pageURL) {
  const root = parse(html, { scriptingEnabled: false }), fragments = [], headings = [], links = []; let title = '', description = '', sitemap = null;
  function text(n) { if (blockedTags.has(n.tagName)) return ''; const a = attributes(n); if (Object.hasOwn(a, 'hidden') || a['aria-hidden'] === 'true') return ''; return n.nodeName === '#text' ? n.value : (n.childNodes || []).map(text).join(' '); }
  const normalize = value => value.replace(/\s+/gu, ' ').trim();
  function visit(n, omit = false) {
    if (blockedTags.has(n.tagName)) return;
    const a = attributes(n); if (Object.hasOwn(a, 'hidden') || a['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style || '')) return;
    if (n.tagName === 'title') title ||= normalize(text(n));
    if (n.tagName === 'meta' && a.name?.toLowerCase() === 'description') description ||= a.content || '';
    if (n.tagName === 'a' && a.href) links.push({ href: a.href, label: normalize(text(n)).slice(0, 200) });
    if (n.tagName === 'link' && a.rel?.split(/\s+/).includes('sitemap') && a.href) sitemap ||= a.href;
    const skip = omit || chromeTags.has(n.tagName) || n.tagName === 'head';
    if (!skip && /^h[1-4]$/.test(n.tagName || '')) headings.push(normalize(text(n)).slice(0, 200));
    if (!skip && blockTags.has(n.tagName)) fragments.push('\n');
    if (!skip && n.nodeName === '#text') fragments.push(n.value);
    for (const child of n.childNodes || []) visit(child, skip);
    if (!skip && blockTags.has(n.tagName)) fragments.push('\n');
  }
  visit(root);
  const body = fragments.join('').split(/\n+/).map(normalize).filter(Boolean).join('\n\n');
  return { title: (title || headings[0] || new URL(pageURL).hostname).slice(0, 200), description: description.trim().slice(0, 1000), body, headings: [...new Set(headings)].slice(0, 80), links, sitemap };
}
function sitemapURLs(xml) {
  const root = parse(xml, { scriptingEnabled: false }), values = [];
  function visit(n) { if (n.tagName === 'loc') values.push((n.childNodes || []).filter(c => c.nodeName === '#text').map(c => c.value).join('').trim()); else for (const c of n.childNodes || []) visit(c); }
  visit(root); return values.slice(0, 200);
}
function pageKind(url, headings) {
  const text = new URL(url).pathname + ' ' + headings.join(' ');
  for (const [kind, pattern] of [['pricing', /pricing|plans|precios|tarifas/i], ['support', /support|help|contact|ayuda|contacto/i], ['offering', /products?|services?|features|servicios?|productos?/i], ['legal', /privacy|terms|legal|privacidad/i], ['people', /team|about|equipo|nosotros/i]]) if (pattern.test(text)) return kind;
  return 'overview';
}
function options(value) {
  const maxPages = value.maxPages ?? 8, timeoutMs = value.timeoutMs ?? 60000;
  requireValue(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 8 && Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60000, 'research_options', 'Research allows1–8 pages and1–60 seconds');
  return { maxPages, timeoutMs };
}
// Transport is a package-internal interface. Public Node API always supplies
// its guarded TLS transport; browser entry only permits its own origin.
export async function crawlWebsite(value, transport, opts = {}) {
  const initial = siteURL(value), config = options(opts), controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const cancel = () => controller.abort(); opts.signal?.addEventListener('abort', cancel, { once: true }); if (opts.signal?.aborted) controller.abort();
  const signal = controller.signal, start = Date.now(), rootHost = initial.hostname.replace(/^www\./, ''), permitted = new Set([rootHost, 'www.' + rootHost]), robots = new Map(), lastRead = new Map(), queue = [initial.href], queued = new Set(queue), visited = new Set(), attempts = [], skipped = [], pages = [];
  const finalURLs = new Set(); let requests = 0, totalBytes = 0, sitemapRead = false, incomplete = false;
  const publicURL = input => { const url = siteURL(input); requireValue(permitted.has(url.hostname), 'site', 'Link or redirect leaves the declared website'); return url; };
  async function pause(milliseconds) { if (milliseconds <= 0) return; aborted(signal); await new Promise((resolve, reject) => { const id = setTimeout(done, milliseconds); const cancel = () => { clearTimeout(id); signal.removeEventListener('abort', cancel); reject(new IntakeletError('aborted', 'Research cancelled or exceeded its deadline')); }; function done() { signal.removeEventListener('abort', cancel); resolve(); } signal.addEventListener('abort', cancel, { once: true }); }); }
  async function fetchURL(input, kind, checkRobots) {
    let url = publicURL(input); const redirected = new Set();
    for (let hop = 0; hop < 4; hop++) {
      aborted(signal); requireValue(requests < 16 && totalBytes < 2097152, 'research_budget', 'Research request/byte budget reached');
      requireValue(!redirected.has(url.href), 'redirect', 'Website redirect loop'); redirected.add(url.href);
      if (checkRobots) { const policy = await robotPolicy(url.origin); requireValue(policy.parser.isAllowed(url.href, AGENT) === true, 'robots_denied', 'robots.txt does not allow this content path'); await pause(Math.max(0, policy.delayMs - (Date.now() - (lastRead.get(url.origin) || 0)))); }
      requests++;
      const attempt = { url: url.href, kind, status: null, bytes: 0 }; attempts.push(attempt);
      try {
        const response = await transport(url, { signal, maxBytes: Math.min(524288, 2097152 - totalBytes) });
        requireValue(response && Number.isInteger(response.status) && typeof response.text === 'string' && response.headers && !Array.isArray(response.headers), 'transport', 'Research transport response is invalid');
        const bytes = byteLength(response.text); requireValue(bytes <= 524288 && totalBytes + bytes <= 2097152, 'research_budget', 'Research response exceeds its byte budget'); totalBytes += bytes; lastRead.set(url.origin, Date.now());
        Object.assign(attempt, { status: response.status, bytes, bodySha256: await sha256(response.text), ...(response.security ? { security: response.security } : {}) });
        if ([301, 302, 303, 307, 308].includes(response.status)) { requireValue(typeof response.headers.location === 'string', 'redirect', 'Redirect has no location'); url = publicURL(new URL(response.headers.location, url)); continue; }
        return { ...response, url: url.href, bodySha256: attempt.bodySha256 };
      } catch (error) { attempt.error = error.code || 'read_failed'; throw error; }
    }
    throw new IntakeletError('redirect', 'More than three website redirects');
  }
  async function robotPolicy(origin) {
    if (robots.has(origin)) return robots.get(origin);
    const url = new URL('/robots.txt', origin).href, response = await fetchURL(url, 'robots', false);
    requireValue(response.status === 404 || response.status >= 200 && response.status < 300, 'robots_unavailable', 'robots.txt could not be read; content was not requested');
    requireValue(response.status === 404 || /^text\/plain(?:;|$)/i.test(response.headers['content-type'] || ''), 'robots_unavailable', 'robots.txt is not a plain-text policy; content was not requested');
    const parser = robotsParser(url, response.status === 404 ? '' : response.text), delay = parser.getCrawlDelay(AGENT) ?? 0;
    requireValue(Number.isFinite(delay) && delay >= 0 && delay <= 60, 'robots_delay', 'robots.txt crawl delay exceeds this bounded research session');
    const policy = { parser, delayMs: delay * 1000, origin }; robots.set(origin, policy); return policy;
  }
  function enqueue(candidate, base) {
    let url; try { url = publicURL(new URL(candidate, base)); if (/\.(?:zip|pdf|png|jpe?g|gif|webp|svg|mp[34]|webm|js|css|json|woff2?|ico)$/i.test(url.pathname)) throw new IntakeletError('non_content', 'Not a supported content page'); }
    catch (error) { skipped.push({ url: String(candidate).split('?')[0].slice(0, 2048), reason: error.code || 'invalid_url' }); return; }
    if (!queued.has(url.href)) { if (queued.size >= 80) { skipped.push({ url: url.href, reason: 'discovery_limit' }); incomplete = true; return; } queued.add(url.href); queue.push(url.href); }
  }
  async function discoverSitemap(candidate, base) {
    if (sitemapRead) return; sitemapRead = true;
    try { const url = publicURL(new URL(candidate, base)); const response = await fetchURL(url, 'sitemap', true); if (response.status === 404) return; requireValue(response.status === 200 && /(?:xml|text\/plain)/i.test(response.headers['content-type'] || ''), 'sitemap', 'Sitemap is not a supported XML response'); for (const href of sitemapURLs(response.text)) enqueue(href, response.url); }
    catch (error) { skipped.push({ url: String(candidate).split('?')[0].slice(0, 2048), reason: error.code || 'sitemap_failed' }); incomplete = true; }
  }
  try {
    const policy = await robotPolicy(initial.origin), declared = policy.parser.getSitemaps()[0];
    if (declared) await discoverSitemap(declared, initial);
    while (queue.length && visited.size < config.maxPages) {
      const url = queue.shift(); if (visited.has(url) || finalURLs.has(url)) continue; visited.add(url);
      try {
        const response = await fetchURL(url, 'content', true);
        requireValue(response.status === 200, 'http', `Content returned HTTP${response.status}`);
        if (finalURLs.has(response.url)) { skipped.push({ url, reason: 'duplicate_target' }); continue; } finalURLs.add(response.url);
        const mime = (response.headers['content-type'] || '').toLowerCase(); requireValue(/^(text\/(?:html|plain|markdown)|application\/xhtml\+xml)(?:;|$)/.test(mime), 'mime', 'Unsupported website content type');
        const page = /html/.test(mime) ? extractPage(response.text, response.url) : { title: new URL(response.url).pathname.split('/').filter(Boolean).at(-1) || new URL(response.url).hostname, description: '', body: response.text, headings: [], links: [], sitemap: null };
        requireValue(page.body.trim().length >= 20, 'no_content', 'No useful static text; script-rendered/login content is not inferred');
        const text = '# ' + page.title + '\n\n' + page.body + '\n', id = await sha256(response.url);
        pages.push({ requestedURL: url, url: response.url, title: page.title, description: page.description, headings: page.headings, classification: pageKind(response.url, page.headings), rawSha256: response.bodySha256, textSha256: await sha256(text), bytes: byteLength(response.text), file: { name: 'website/' + id.slice(0, 20) + '.md', text, format: 'markdown', url: response.url } });
        for (const link of page.links) enqueue(link.href, response.url);
        if (page.sitemap) await discoverSitemap(page.sitemap, response.url);
      } catch (error) { skipped.push({ url, reason: error.code || 'content_failed' }); incomplete = true; if (signal.aborted || ['research_budget', 'robots_unavailable'].includes(error.code)) break; }
    }
    if (queue.length) { incomplete = true; for (const url of queue) skipped.push({ url, reason: signal.aborted ? 'deadline_or_cancelled' : 'page_budget' }); }
  } catch (error) { incomplete = true; skipped.push({ url: initial.href, reason: error.code || 'research_failed' }); }
  finally { clearTimeout(timer); opts.signal?.removeEventListener('abort', cancel); }
  const counts = Object.fromEntries(['overview', 'offering', 'pricing', 'support', 'legal', 'people'].map(kind => [kind, pages.filter(p => p.classification === kind).length]));
  return { schema: 'intakelet.research', version: 1, rootURL: initial.href, status: pages.length ? incomplete ? 'partial' : 'complete_discovered_scope' : 'no_content', files: pages.map(p => p.file), pages, attempts, skipped, coverage: { pages: pages.length, discovered: queued.size, attempted: visited.size, requests, bytes: totalBytes, byCategory: counts, seconds: (Date.now() - start) / 1000, scope: 'Bounded static pages on the declared website, not exhaustive Internet research.' }, method: 'static_text_and_link_extraction' };
}
