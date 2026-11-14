import { crawlWebsite, siteURL } from './research.mjs';
import { requireValue, exact } from './values.mjs';
export async function researchSameOrigin(url, options = {}) {
  exact(options, [], ['maxPages', 'timeoutMs', 'signal']); requireValue(typeof location !== 'undefined', 'browser', 'Same-origin research needs a browser');
  const root = siteURL(url); requireValue(root.origin === location.origin, 'same_origin', 'The static demo researches only its own authored sample; connect your application server for other websites');
  return crawlWebsite(root, async (target, { signal, maxBytes }) => {
    requireValue(target.origin === location.origin, 'same_origin', 'Browser research cannot leave this origin');
    const response = await fetch(target, { method: 'GET', credentials: 'omit', redirect: 'error', signal, headers: { Accept: 'text/html,text/plain,application/xml' } });
    const reader = response.body?.getReader(), buffers = []; let length = 0;
    requireValue(reader, 'browser_read', 'Website response has no readable body');
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; requireValue(length <= maxBytes, 'network_budget', 'Website body exceeds its declared budget'); buffers.push(value); } }
    catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of buffers) { bytes.set(chunk, offset); offset += chunk.length; }
    return { status: response.status, headers: Object.fromEntries(['content-type', 'location'].map(k => [k, response.headers.get(k)]).filter(([, v]) => v !== null)), text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), security: { transport: 'browser_same_origin', credentials: 'omit', redirects: 'error' } };
  }, options);
}
