// T2: own pure guards/virtual resolver; no private endpoint is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, networkURL } from '../../src/transport.mjs';
import { researchWebsite } from '../../src/node.mjs';
test('N01 private, loopback, link-local, documentation and special IPv4 are denied', () => { for (const ip of ['0.0.0.0', '127.0.0.1', '10.1.1.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255']) assert.equal(publicAddress(ip), false, ip); });
test('N02 private/mapped/transition/documentation IPv6 are denied', () => { for (const ip of ['::', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '2002:7f00:1::', 'ff02::1']) assert.equal(publicAddress(ip), false, ip); });
test('N03 ordinary global addresses are distinguishable from malformed/special inputs', () => { for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicAddress(ip), true, ip); for (const ip of ['not-an-ip', 'fe80::1%lo0', '999.1.1.1']) assert.equal(publicAddress(ip), false); });
test('N04 IP literal aliases, local/reserved names and custom ports never reach DNS', async () => { for (const url of ['https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]', 'https://service.local', 'https://fixture.example.test', 'https://example.com:444']) { assert.throws(() => networkURL(url)); await assert.rejects(researchWebsite(url)); } });
test('N05 public API refuses caller-supplied transports/resolvers/unsafe flags', async () => { for (const options of [{ transport: async () => null }, { allowPrivate: true }, { resolve: async () => [] }]) await assert.rejects(researchWebsite('https://example.com', options), e => e.code === 'shape'); });
