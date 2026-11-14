import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { IntakeletError, requireValue, aborted } from './values.mjs';
import { siteURL } from './research.mjs';

export function publicAddress(address) {
  try { const parsed = ipaddr.parse(address); return parsed.range() === 'unicast' && !address.includes('%'); } catch { return false; }
}
export function networkURL(value) {
  const url = siteURL(value);
  requireValue(!isIP(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example)$/i.test(url.hostname), 'network_denied', 'Research needs a public domain, not an IP literal/local/reserved hostname');
  return url;
}
export async function resolvePublic(hostname, signal) {
  aborted(signal); const resolver = new Resolver({ timeout: 2000, tries: 1 }); const cancel = () => resolver.cancel(); signal.addEventListener('abort', cancel, { once: true });
  let outcomes;
  try { outcomes = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]); }
  finally { signal.removeEventListener('abort', cancel); }
  aborted(signal);
  const addresses = outcomes.flatMap((outcome, index) => outcome.status === 'fulfilled' ? outcome.value.map(address => ({ address, family: index === 0 ? 4 : 6 })) : []);
  requireValue(addresses.length > 0 && addresses.length <= 32 && addresses.every(row => publicAddress(row.address)), 'network_denied', 'DNS failed or returned a private/special/mixed address set');
  return addresses;
}
export async function secureRead(value, { signal: parentSignal, maxBytes = 524288 } = {}) {
  const url = networkURL(value), signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 524288, 'network_budget', 'Invalid read byte budget');
  const addresses = await resolvePublic(url.hostname, signal), selected = addresses[0]; aborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false, tlsAuthorized = false, pinnedPeer = false;
    const finish = (error, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
    const req = request(url, { method: 'GET', agent: false, family: selected.family, servername: url.hostname, rejectUnauthorized: true, maxHeaderSize: 16384,
      lookup: (_host, opts, callback) => opts.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      headers: { 'User-Agent': 'Intakelet/0.1 (public onboarding research)', Accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/xml,text/xml', 'Accept-Encoding': 'identity' } }, response => {
      const length = response.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes) || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { req.destroy(new IntakeletError('network_budget', 'Response length/encoding exceeds the declared read policy')); return; }
      const buffers = []; let bytes = 0;
      response.on('data', buffer => { bytes += buffer.length; if (bytes > maxBytes) req.destroy(new IntakeletError('network_budget', 'Response exceeded its byte budget')); else buffers.push(buffer); });
      response.on('aborted', () => finish(new IntakeletError('network_read', 'Response stream ended before completion')));
      response.on('error', error => finish(error));
      response.on('end', () => {
        try {
          requireValue(response.complete && tlsAuthorized && pinnedPeer, 'network_read', 'Response stream or verified TLS peer is incomplete');
          const body = Buffer.concat(buffers), text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
          finish(null, { status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([key, value]) => ['content-type', 'location'].includes(key) && typeof value === 'string')), text,
            security: { transport: 'pinned_public_tls', resolvedAddressCount: addresses.length, family: selected.family, tlsAuthorized, pinnedPeer, bodyBytes: bytes, bodySha256: createHash('sha256').update(body).digest('hex') } });
        } catch (error) { finish(new IntakeletError(error.code || 'encoding', 'Website response is not supported complete UTF-8 text')); }
      });
    });
    const cancel = () => req.destroy(new IntakeletError('aborted', 'Website read cancelled or timed out'));
    signal.addEventListener('abort', cancel, { once: true });
    req.on('socket', socket => socket.once('secureConnect', () => {
      tlsAuthorized = socket.authorized === true;
      try { pinnedPeer = ipaddr.process(socket.remoteAddress).toNormalizedString() === ipaddr.process(selected.address).toNormalizedString(); } catch { pinnedPeer = false; }
      if (!tlsAuthorized || !pinnedPeer) req.destroy(new IntakeletError('tls', 'Website TLS certificate/peer did not match the admitted public address'));
    }));
    req.on('error', error => finish(new IntakeletError(error.code === 'aborted' ? 'aborted' : error.code === 'network_budget' ? 'network_budget' : 'network_read', error.message)));
    req.on('close', () => { if (!settled) finish(new IntakeletError('network_read', 'Website request closed without a complete response')); });
    if (signal.aborted) cancel(); else req.end();
  });
}
