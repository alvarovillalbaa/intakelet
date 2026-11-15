// Loaded before parsers and inherited by their Node worker threads.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const denied = () => { throw new Error('document_network_denied'); };
globalThis.fetch = denied;
http.request = http.get = https.request = https.get = denied;
net.connect = net.createConnection = tls.connect = dgram.createSocket = denied;
net.Socket.prototype.connect = denied;
syncBuiltinESMExports();
