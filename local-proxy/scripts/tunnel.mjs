#!/usr/bin/env node
/**
 * Minimal stdio <-> HTTP-CONNECT tunnel, designed to be used as an ssh ProxyCommand.
 *
 *   usage: tunnel.mjs <proxyHost:proxyPort> <targetHost> <targetPort>
 *
 * ssh gives a ProxyCommand its stdin/stdout as pipes, so anything this process
 * writes to stdout becomes the SSH transport stream. Never print diagnostics on
 * stdout - it would corrupt that stream. Errors go to stderr and exit codes only.
 *
 * This exists because Git for Windows' connect.exe works from cmd.exe but is
 * closed immediately when OpenSSH for Windows execs it directly.
 */

import net from 'node:net';
import http from 'node:http';

const argv = process.argv.slice(2);
const proxy = argv[0];
const targetHost = argv[1];
const targetPort = argv[2];

if (!proxy || !targetHost || !targetPort) {
  process.stderr.write('usage: tunnel.mjs <proxyHost:proxyPort> <targetHost> <targetPort>\n');
  process.exit(2);
}

const idx = proxy.lastIndexOf(':');
const proxyHost = idx > 0 ? proxy.slice(0, idx) : '127.0.0.1';
const proxyPort = Number(idx > 0 ? proxy.slice(idx + 1) : proxy);

const req = http.request({
  host: proxyHost,
  port: proxyPort,
  method: 'CONNECT',
  path: targetHost + ':' + targetPort,
  timeout: 20000,
});

req.on('connect', (res, socket) => {
  if (res.statusCode !== 200) {
    process.stderr.write('tunnel: proxy refused CONNECT with ' + res.statusCode + '\n');
    socket.destroy();
    process.exit(3);
  }
  socket.setNoDelay(true);
  if (process.stdin.isPaused()) process.stdin.resume();
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on('end', () => { try { process.stdout.end(); } catch { /* ignore */ } process.exit(0); });
  socket.on('close', () => process.exit(0));
  socket.on('error', (e) => { process.stderr.write('tunnel: ' + e.message + '\n'); process.exit(4); });
});

req.on('error', (e) => { process.stderr.write('tunnel: ' + e.message + '\n'); process.exit(5); });
req.on('timeout', () => { req.destroy(); process.stderr.write('tunnel: connect timeout\n'); process.exit(6); });
req.end();
