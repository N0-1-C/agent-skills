#!/usr/bin/env node
/**
 * local-proxy - give AI-issued commands a proxy without touching system config.
 *
 * Design contract (do not break):
 *   - The proxy core always listens on 127.0.0.1 only (allow-lan: false).
 *   - TUN mode is never used: no virtual adapter, no route table edit, no DNS hijack.
 *   - The system proxy (registry ProxyEnable) is never written.
 *   - Only the child process launched by `run` receives HTTP_PROXY/HTTPS_PROXY env vars.
 *
 * All console output is ASCII on purpose: Windows consoles are frequently cp936
 * and would mangle non-ASCII, which makes the output unreadable to the agent.
 */

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(HERE);
const BIN = path.join(SKILL_DIR, 'bin', 'mihomo.exe');
const GEO_SRC = path.join(SKILL_DIR, 'bin', 'Country.mmdb');

const DATA_DIR = path.join(os.homedir(), '.workbuddy', 'local-proxy');
const RUN_DIR = path.join(DATA_DIR, 'run');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SUB_FILE = path.join(DATA_DIR, 'subscription.txt');
const SUB_INFO_FILE = path.join(DATA_DIR, 'sub-info.json');
const LOG_FILE = path.join(DATA_DIR, 'mihomo.log');
const PID_FILE = path.join(DATA_DIR, 'mihomo.pid');
const CONFIG_FILE = path.join(RUN_DIR, 'config.yaml');

const UA = 'clash-verge/v1.7.7';
const DEFAULTS = { proxyPort: 7891, controllerPort: 9091, probeUrls: ['http://www.gstatic.com/generate_204', 'http://cp.cloudflare.com/generate_204'] };
const GB = 1024 * 1024 * 1024;

const out = (m = '') => process.stdout.write(String(m) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(m, code = 1) { process.stderr.write(String(m) + '\n'); process.exit(code); }

function ensureDirs() {
  for (const d of [DATA_DIR, RUN_DIR]) fs.mkdirSync(d, { recursive: true });
}

function loadSettings() {
  ensureDirs();
  let s = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { s = {}; }
  }
  return { ...DEFAULTS, ...s };
}

function getSubUrl() {
  if (fs.existsSync(SUB_FILE)) {
    const v = fs.readFileSync(SUB_FILE, 'utf8').trim();
    if (v) return v;
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * HTTP / HTTPS helpers (no third-party deps; undici fetch ignores proxy env)
 * ------------------------------------------------------------------ */

function proxyConnect(proxyPort, host, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: proxyPort, method: 'CONNECT',
      path: host + ':' + port, timeout: 20000,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error('proxy CONNECT ' + res.statusCode)); return; }
      resolve(socket);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('proxy CONNECT timeout')));
    req.end();
  });
}

class HttpsOverProxy extends https.Agent {
  constructor(proxyPort) { super({ keepAlive: false }); this.proxyPort = proxyPort; }
  createConnection(options, cb) {
    proxyConnect(this.proxyPort, options.host, options.port || 443).then((s) => cb(null, s), (e) => cb(e));
  }
}

function httpsGet(url, opts = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
      timeout: opts.timeout || 30000,
      rejectUnauthorized: opts.insecure ? false : true,
      agent: opts.proxyPort ? new HttpsOverProxy(opts.proxyPort) : undefined,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.end();
  });
}

function httpGetViaProxy(port, absoluteUrl, opts = {}) {
  const u = new URL(absoluteUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'GET', path: absoluteUrl,
      headers: { Host: u.host, 'User-Agent': UA }, timeout: opts.timeout || 12000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function localApiGet(ctlPort, apiPath, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: ctlPort, method: 'GET', path: apiPath,
      headers: { Accept: 'application/json' }, timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('controller timeout')));
    req.end();
  });
}

function localApiPut(ctlPort, apiPath, payload, timeout = 6000) {
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: ctlPort, method: 'PUT', path: apiPath,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }, timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('controller timeout')));
    req.end(data);
  });
}

/* ------------------------------------------------------------------ *
 * Subscription handling
 * ------------------------------------------------------------------ */

function parseUserInfo(header) {
  if (!header) return null;
  const info = {};
  for (const part of String(header).split(';')) {
    const [k, v] = part.split('=').map((x) => (x || '').trim());
    if (k) info[k] = Number(v);
  }
  return info;
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?';
  return (n / GB).toFixed(2) + ' GB';
}

async function fetchSubscription(url) {
  const attempts = [];
  const tryOne = async (opts, label) => {
    try {
      const r = await httpsGet(url, opts);
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) {
      attempts.push(label + ' -> ' + e.message);
      return null;
    }
  };
  let r = await tryOne({}, 'direct');
  if (!r) r = await tryOne({ insecure: true }, 'direct(no-verify)');
  if (!r) {
    for (const p of [loadSettings().proxyPort, 7890, 7897, 10809]) {
      r = await tryOne({ proxyPort: p }, 'via 127.0.0.1:' + p);
      if (r) break;
    }
  }
  if (!r) throw new Error('could not download the subscription.\n  ' + attempts.join('\n  '));
  return r;
}

function splitSections(text) {
  const sections = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(raw);
    if (m) { cur = m[1]; sections[cur] = [raw]; }
    else if (cur) sections[cur].push(raw);
  }
  return sections;
}

/**
 * Rebuild a minimal config from the subscription.
 * Everything outside proxies / proxy-groups / rules is discarded and replaced with
 * hardened defaults, so the upstream subscription can never smuggle in TUN mode,
 * LAN exposure, or its own control endpoint.
 */
function buildConfig(subText, st) {
  const sec = splitSections(subText);
  for (const need of ['proxies', 'proxy-groups', 'rules']) {
    if (!sec[need] || sec[need].length < 2) {
      throw new Error('subscription is missing a usable "' + need + '" section - unsupported format');
    }
  }
  const header = [
    '# ------------------------------------------------------------------',
    '# GENERATED by the local-proxy skill. Do not edit by hand.',
    '# Regenerate: node scripts/proxy.mjs refresh',
    '# Hardened: loopback-only listener, no TUN, no system proxy, minimal DNS.',
    '# ------------------------------------------------------------------',
    'mixed-port: ' + st.proxyPort,
    'allow-lan: false',
    'bind-address: 127.0.0.1',
    'mode: rule',
    'log-level: warning',
    'ipv6: false',
    'unified-delay: true',
    'tcp-concurrent: true',
    'geodata-mode: false',
    'geo-auto-update: false',
    'external-controller: 127.0.0.1:' + st.controllerPort,
    'dns:',
    '  enable: true',
    '  ipv6: false',
    '  enhanced-mode: redir-host',
    '  default-nameserver:',
    '    - 223.5.5.5',
    '    - 119.29.29.29',
    '  nameserver:',
    '    - 223.5.5.5',
    '    - 119.29.29.29',
  ].join('\n');
  const body = ['proxies', 'proxy-groups', 'rules']
    .map((k) => sec[k].join('\n').replace(/\s+$/, ''))
    .join('\n');
  return header + '\n' + body + '\n';
}

async function writeFreshConfig(st, { quiet = false } = {}) {
  const url = getSubUrl();
  if (!url) {
    throw new Error('no subscription configured. Write the subscription URL into:\n  ' + SUB_FILE);
  }
  if (!quiet) out('fetching subscription ...');
  const r = await fetchSubscription(url);
  const cfg = buildConfig(r.body, st);
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, cfg, 'utf8');
  const info = parseUserInfo(r.headers['subscription-userinfo']);
  const meta = {
    fetchedAt: new Date().toISOString(),
    bytes: r.body.length,
    userinfo: info,
    updateIntervalHours: Number(r.headers['profile-update-interval']) || null,
  };
  fs.writeFileSync(SUB_INFO_FILE, JSON.stringify(meta, null, 2), 'utf8');
  if (!quiet) {
    out('config written: ' + CONFIG_FILE + ' (' + cfg.length + ' bytes)');
    if (info) {
      const used = (info.upload || 0) + (info.download || 0);
      out('quota: used ' + fmtBytes(used) + ' / ' + fmtBytes(info.total));
      if (info.expire) out('expires: ' + new Date(info.expire * 1000).toISOString().slice(0, 10));
    }
  }
  return meta;
}

function readSubInfo() {
  try { return JSON.parse(fs.readFileSync(SUB_INFO_FILE, 'utf8')); } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Core process lifecycle
 * ------------------------------------------------------------------ */

function readPid() {
  try {
    const p = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    return Number.isFinite(p) ? p : 0;
  } catch { return 0; }
}

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function portOpen(port, timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.once('timeout', () => done(false));
  });
}

async function isUp(st) {
  return portOpen(st.proxyPort, 500);
}

async function probeEgress(st) {
  for (const url of st.probeUrls) {
    try {
      const r = await httpGetViaProxy(st.proxyPort, url, { timeout: 12000 });
      if (r.status === 204 || r.status === 200) return { ok: true, url, status: r.status };
    } catch { /* try next */ }
  }
  return { ok: false };
}

async function startCore(st) {
  if (!fs.existsSync(BIN)) throw new Error('core binary missing: ' + BIN);
  if (!fs.existsSync(CONFIG_FILE)) throw new Error('config missing - run: proxy.mjs refresh');
  ensureDirs();
  fs.copyFileSync(GEO_SRC, path.join(RUN_DIR, 'Country.mmdb'));

  const fd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(BIN, ['-d', RUN_DIR, '-f', CONFIG_FILE], {
    detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
  });
  fs.writeFileSync(PID_FILE, String(child.pid));
  child.unref();
  try { fs.closeSync(fd); } catch { /* already closed */ }

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await portOpen(st.proxyPort, 400)) return child.pid;
    await sleep(250);
  }
  throw new Error('core did not open 127.0.0.1:' + st.proxyPort + ' within 25s. Check ' + LOG_FILE);
}

function stopCore() {
  const pid = readPid();
  if (pid && processAlive(pid)) {
    try { process.kill(pid); } catch { /* ignore */ }
    return pid;
  }
  return 0;
}

async function ensureUp(st, { autoRefresh = true } = {}) {
  if (await isUp(st)) return { started: false };
  if (!fs.existsSync(CONFIG_FILE) && autoRefresh) await writeFreshConfig(st);
  await startCore(st);
  return { started: true };
}

/* ------------------------------------------------------------------ *
 * Env injection
 * ------------------------------------------------------------------ */

function proxyEnv(st) {
  const p = 'http://127.0.0.1:' + st.proxyPort;
  const no = 'localhost,127.0.0.1,::1';
  return {
    HTTP_PROXY: p, HTTPS_PROXY: p, ALL_PROXY: p,
    http_proxy: p, https_proxy: p, all_proxy: p,
    NO_PROXY: no, no_proxy: no,
    // Node >= 24 reads NODE_USE_ENV_PROXY to make its built-in fetch honour the
    // *_PROXY variables. Without it undici connects directly and times out.
    // Older Node versions ignore an unknown env var, so this is always safe.
    NODE_USE_ENV_PROXY: '1',
  };
}

/**
 * SSH remotes do not honour HTTP_PROXY, so git ssh:// remotes need a ProxyCommand.
 * script/tunnel.mjs provides one that speaks HTTP CONNECT to the local core.
 *
 * Two Windows-specific traps are handled here:
 *   - An inline `-o ProxyCommand="..."` passed through GIT_SSH_COMMAND gets its
 *     nested quotes eaten by cmd.exe, so a dedicated ssh_config is generated and
 *     handed to ssh with -F instead.
 *   - Git for Windows' connect.exe is closed immediately when OpenSSH execs it
 *     directly (it only survives when cmd.exe starts it), so tunnel.mjs is used.
 */
const SSH_CONFIG = path.join(DATA_DIR, 'ssh_config');
const TUNNEL_JS = path.join(HERE, 'tunnel.mjs');

function sshEnv(st) {
  const flat = (p) => p.replace(/\\/g, '/');
  const userCfg = path.join(os.homedir(), '.ssh', 'config');
  const pc = '"' + flat(process.execPath) + '" "' + flat(TUNNEL_JS) + '" 127.0.0.1:' + st.proxyPort + ' %h %p';
  const lines = [
    '# generated by the local-proxy skill - do not edit by hand',
    '# github.com:22 is not carried end to end by this proxy (the tunnel opens but no',
    '# SSH banner ever arrives), so github/gist are redirected to ssh.github.com:443,',
    '# the official SSH-over-443 endpoint GitHub publishes for firewalled networks.',
    'Host github.com gist.github.com',
    '  HostName ssh.github.com',
    '  Port 443',
    'Host *',
    '  ProxyCommand ' + pc,
    '  StrictHostKeyChecking accept-new',
  ];
  if (fs.existsSync(userCfg)) lines.push('Include ' + flat(userCfg));
  fs.writeFileSync(SSH_CONFIG, lines.join('\n') + '\n', 'utf8');
  return { GIT_SSH_COMMAND: 'ssh -F ' + flat(SSH_CONFIG) };
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

async function cmdUp(st, argv) {
  const refresh = argv.includes('--refresh');
  const r = await ensureUp(st, { autoRefresh: refresh || !fs.existsSync(CONFIG_FILE) });
  if (refresh) await writeFreshConfig(st);
  const probe = await probeEgress(st);
  out((r.started ? 'started' : 'already running') + ' | proxy http://127.0.0.1:' + st.proxyPort);
  out('egress: ' + (probe.ok ? 'OK (' + probe.url + ' -> ' + probe.status + ')' : 'FAILED (core up but no usable exit - try: proxy.mjs pick auto)'));
  out('system untouched: allow-lan=false, bind 127.0.0.1, no TUN, no system proxy');
  return probe.ok ? 0 : 2;
}

async function cmdDown(st) {
  const pid = stopCore();
  await sleep(300);
  out(pid ? 'stopped pid ' + pid : 'nothing to stop');
  return 0;
}

async function cmdStatus(st) {
  const up = await isUp(st);
  const pid = readPid();
  out('proxy      : ' + (up ? 'UP' : 'DOWN') + (up ? '  http://127.0.0.1:' + st.proxyPort : ''));
  out('core pid   : ' + (pid || '-') + (pid ? (processAlive(pid) ? ' (alive)' : ' (stale)') : ''));
  out('config     : ' + (fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : 'missing (run: proxy.mjs refresh)'));
  const info = readSubInfo();
  if (info) {
    out('sub fetched: ' + info.fetchedAt);
    const u = info.userinfo;
    if (u) out('quota      : ' + fmtBytes((u.upload || 0) + (u.download || 0)) + ' / ' + fmtBytes(u.total) + (u.expire ? '  expires ' + new Date(u.expire * 1000).toISOString().slice(0, 10) : ''));
  } else {
    out('sub fetched: never');
  }
  if (up) {
    const probe = await probeEgress(st);
    out('egress     : ' + (probe.ok ? 'OK (' + probe.status + ')' : 'FAILED'));
    try {
      const api = await localApiGet(st.controllerPort, '/proxies');
      const proxies = JSON.parse(api.body).proxies || {};
      const sel = Object.values(proxies).filter((p) => p.type === 'Selector');
      for (const g of sel) out('selector   : ' + g.name + ' -> ' + g.now);
    } catch { /* controller may be off */ }
    try {
      const ip = await httpsGet('https://api.ipify.org/?format=json', { proxyPort: st.proxyPort, timeout: 12000 });
      const parsed = JSON.parse(ip.body);
      out('exit ip    : ' + parsed.ip);
    } catch { out('exit ip    : (lookup failed)'); }
  }
  return 0;
}

function cmdEnv(st) {
  const p = 'http://127.0.0.1:' + st.proxyPort;
  out('# bash / sh / git-bash');
  out('export HTTP_PROXY=' + p + ' HTTPS_PROXY=' + p + ' ALL_PROXY=' + p);
  out('export http_proxy=' + p + ' https_proxy=' + p + ' all_proxy=' + p);
  out('export NO_PROXY=localhost,127.0.0.1,::1');
  out('# PowerShell');
  out('$env:HTTP_PROXY="' + p + '"; $env:HTTPS_PROXY="' + p + '"; $env:ALL_PROXY="' + p + '"');
  out('# note: each tool call is a fresh process, so prefer: proxy.mjs run "<command>"');
  return 0;
}

async function cmdRun(st, argv) {
  const keep = argv.includes('--keep');
  const noStart = argv.includes('--no-start');
  const wantSsh = argv.includes('--ssh');
  const flags = ['--keep', '--no-start', '--ssh'];
  const cmdStr = argv.filter((a) => !flags.includes(a)).join(' ').trim();
  if (!cmdStr) die('usage: proxy.mjs run [--keep] [--no-start] [--ssh] "<command>"');

  let started = false;
  if (!noStart) {
    const r = await ensureUp(st);
    started = r.started;
    out('[local-proxy] proxy ready on 127.0.0.1:' + st.proxyPort + ' (' + (started ? 'started' : 'reused') + ')');
  }

  const env = { ...process.env, ...proxyEnv(st) };
  if (wantSsh) {
    Object.assign(env, sshEnv(st));
    out('[local-proxy] ssh tunnelling enabled (github/gist -> ssh.github.com:443)');
    out('[local-proxy] note: this only affects this child process; it may add a host key to ~/.ssh/known_hosts');
  }
  const code = await new Promise((resolve) => {
    const child = spawn(cmdStr, {
      shell: true, stdio: 'inherit', env, windowsHide: true,
    });
    child.on('exit', (c, sig) => resolve(c === null ? (sig ? 1 : 0) : c));
    child.on('error', (e) => { out('spawn error: ' + e.message); resolve(127); });
  });

  let hint = '';
  if (code !== 0) {
    const probe = await probeEgress(st);
    if (!probe.ok) {
      hint = '[local-proxy] hint: proxy exit check FAILED, so the node is probably unreachable.\n'
        + '            inspect with: proxy.mjs nodes   then: proxy.mjs pick auto';
    }
  }

  if (started && !keep) {
    stopCore();
    out('[local-proxy] stopped (was started by this run; use --keep to leave it up)');
  } else if (keep) {
    out('[local-proxy] left running on 127.0.0.1:' + st.proxyPort + ' (stop with: proxy.mjs down)');
  }
  if (hint) out(hint);
  process.exit(code);
}

async function cmdRefresh(st) {
  const wasUp = await isUp(st);
  await writeFreshConfig(st);
  if (wasUp) {
    stopCore();
    await sleep(400);
    await startCore(st);
    out('core restarted with the new config');
  }
  return 0;
}

async function cmdNodes(st) {
  const r = await ensureUp(st);
  if (!r.started) { /* already up */ }
  let data;
  try {
    const api = await localApiGet(st.controllerPort, '/proxies');
    data = JSON.parse(api.body).proxies || {};
  } catch (e) {
    die('cannot reach the local controller on 127.0.0.1:' + st.controllerPort + ' - ' + e.message);
  }
  const groups = Object.values(data).filter((p) => ['Selector', 'URLTest', 'Fallback', 'LoadBalance'].includes(p.type) && p.name !== 'GLOBAL');
  for (const g of groups) {
    out('[' + g.type + '] ' + g.name + '  (now: ' + g.now + ')');
    for (const m of g.all || []) out('   ' + (m === g.now ? '* ' : '  ') + m);
  }
  return 0;
}

async function cmdPick(st, argv) {
  const target = argv.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!target) die('usage: proxy.mjs pick <node name>|auto');
  await ensureUp(st);
  let data;
  try {
    const api = await localApiGet(st.controllerPort, '/proxies');
    data = JSON.parse(api.body).proxies || {};
  } catch (e) {
    die('cannot reach the local controller - ' + e.message);
  }
  const selectors = Object.values(data).filter((p) => p.type === 'Selector' && p.name !== 'GLOBAL');
  if (!selectors.length) die('no Selector group found in this subscription');
  const group = selectors[0];
  const members = group.all || [];

  const resolve = (raw) => {
    if (members.includes(raw)) return { name: raw };
    const lower = raw.toLowerCase();
    const hits = members.filter((m) => m.toLowerCase().includes(lower));
    if (hits.length === 1) return { name: hits[0] };
    if (hits.length > 1) return { candidates: hits };
    return { missing: true };
  };

  let want = '';
  if (target === 'auto') {
    const pick = members
      .map((m) => data[m])
      .find((p) => p && (p.type === 'URLTest' || p.type === 'Fallback'));
    if (!pick) die('this subscription has no url-test/fallback group to hand over to');
    want = pick.name;
  } else {
    const r = resolve(target);
    if (r.name) want = r.name;
    else if (r.candidates) {
      out('"' + target + '" matches several nodes, be more specific:');
      for (const c of r.candidates) out('   ' + c);
      return 3;
    } else {
      out('no node in "' + group.name + '" matches "' + target + '". Available:');
      for (const m of members) out('   ' + m);
      return 3;
    }
  }

  const res = await localApiPut(st.controllerPort, '/proxies/' + encodeURIComponent(group.name), { name: want });
  if (res.status === 204 || res.status === 200) { out('switched ' + group.name + ' -> ' + want); return 0; }
  out('switch failed: HTTP ' + res.status + ' ' + res.body);
  return 1;
}

async function cmdDoctor(st) {
  const checks = [];
  const add = (name, ok, note = '', optional = false) => checks.push({ name, ok, note, optional });

  const major = Number(process.versions.node.split('.')[0]);
  const tool = (cmd, args) => {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 20000 });
      if (r.error || r.status !== 0) return '';
      return (((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/)[0] || '').trim();
    } catch { return ''; }
  };
  const gitV = tool('git', ['--version']);
  const curlV = tool('curl.exe', ['--version']);
  const pyV = tool('python', ['--version']);
  const sshV = tool('ssh', ['-V']);

  out('--- host -----------------------------------------------------------');
  add('node.js >= 18 (REQUIRED)', major >= 18, 'running v' + process.versions.node);
  add('node >= 24 for proxy-aware fetch', major >= 24, major >= 24 ? 'ok' : 'optional - run such scripts with C:/Program Files/nodejs/node.exe', true);
  add('git', !!gitV, gitV || 'not found - only needed for git operations', true);
  add('curl', !!curlV, curlV ? curlV.slice(0, 46) : 'not found - optional', true);
  add('python', !!pyV, pyV || 'not found - optional', true);
  add('ssh client', !!sshV, sshV ? sshV.slice(0, 46) : 'not found - only needed for "run --ssh"', true);

  out('--- skill ----------------------------------------------------------');
  add('core binary', fs.existsSync(BIN), BIN);
  add('geoip database', fs.existsSync(GEO_SRC), GEO_SRC);
  add('subscription url', !!getSubUrl(), getSubUrl() ? 'configured (not printed)' : 'write it into ' + SUB_FILE);
  add('generated config', fs.existsSync(CONFIG_FILE), CONFIG_FILE);
  add('proxy port free/ours', true, '127.0.0.1:' + st.proxyPort);
  add('port ' + st.proxyPort + ' busy by other', !(await portOpen(st.proxyPort, 300)) || processAlive(readPid()), 'if the core is not ours, change proxyPort in ' + SETTINGS_FILE);
  try {
    const r = await httpsGet(getSubUrl(), { timeout: 15000 });
    add('subscription reachable', r.status === 200, 'HTTP ' + r.status);
  } catch (e) {
    add('subscription reachable', false, e.message);
  }
  const sec = fs.existsSync(CONFIG_FILE) ? splitSections(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
  add('no tun section in config', !sec.tun, sec.tun ? 'FOUND - hardened builder was bypassed' : 'ok');
  const cfgText = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf8') : '';
  add('allow-lan disabled', /allow-lan:\s*false/.test(cfgText), '');
  out('--- results --------------------------------------------------------');
  for (const c of checks) {
    const mark = c.ok ? '[ok]  ' : (c.optional ? '[--]  ' : '[!!]  ');
    out(mark + c.name + (c.note ? '  - ' + c.note : ''));
  }
  out('');
  out('[ok] required check passed   [!!] required check FAILED   [--] optional, absence is fine');
  return checks.every((c) => c.ok || c.optional) ? 0 : 1;
}

function usage() {
  out('local-proxy - run commands through a loopback-only proxy');
  out('');
  out('  up [--refresh]        start the core (auto-fetches the subscription on first use)');
  out('  down                  stop the core');
  out('  status                show state, quota, selector and exit ip');
  out('  run [--keep] [--ssh] "<cmd>"');
  out('                        run one command with proxy env vars injected');
  out('                        --ssh also tunnels git ssh:// remotes via connect.exe');
  out('  refresh               re-download the subscription and reload the core');
  out('  nodes                 list proxy groups and their members');
  out('  pick <name>|auto      switch the active node');
  out('  env                   print env vars for manual use');
  out('  doctor                self-check');
  return 0;
}

async function main() {
  const st = loadSettings();
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'help';
  switch (cmd) {
    case 'up': return cmdUp(st, argv.slice(1));
    case 'down': return cmdDown(st);
    case 'status': return cmdStatus(st);
    case 'env': return cmdEnv(st);
    case 'run': return cmdRun(st, argv.slice(1));
    case 'refresh': return cmdRefresh(st);
    case 'nodes': return cmdNodes(st);
    case 'pick': return cmdPick(st, argv.slice(1));
    case 'doctor': return cmdDoctor(st);
    case 'help': case '--help': case '-h': return usage();
    default:
      out('unknown command: ' + cmd);
      return usage();
  }
}

main()
  .then((code) => { if (typeof code === 'number' && code !== 0) process.exit(code); })
  .catch((e) => die('ERROR: ' + (e && e.message ? e.message : String(e))));
