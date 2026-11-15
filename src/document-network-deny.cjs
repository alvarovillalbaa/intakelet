// CommonJS preload is inherited by parser-owned Node worker threads.
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const { syncBuiltinESMExports } = require('node:module');
const denied = () => { throw new Error('document_network_denied'); };
globalThis.fetch = denied;
http.request = http.get = https.request = https.get = denied;
net.connect = net.createConnection = tls.connect = dgram.createSocket = denied;
net.Socket.prototype.connect = denied;
syncBuiltinESMExports();
