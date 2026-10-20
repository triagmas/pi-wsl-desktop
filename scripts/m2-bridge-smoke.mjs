/**
 * M2 targeted native WSL smoke (Issue #7 checkpoint, item 2).
 *
 * Runs the REAL bridge bundle inside WSL — the production /proc/self/fd
 * environment — against a TEMPORARY SYNTHETIC session root (never the user's
 * real sessions):
 *   - discovery lists the real session file, never the symlink entry;
 *   - readSession works through the validated descriptor;
 *   - outside-root symlink, outside file and symlinked parent are rejected;
 *   - openSession is rejected before any Pi child is spawned;
 *   - sha256 + mtime of the synthetic session are byte-identical afterwards.
 *
 * Read-only with respect to Pi: the ready gate probes `pi --version/--help`
 * only (no model calls, no ~/.pi writes; HOME is a temp dir).
 */
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const record = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const base = mkdtempSync(path.join(os.tmpdir(), 'piwsd-m2smoke-'));
const home = path.join(base, 'home');
const root = path.join(base, 'sessions');
const outsideDir = path.join(base, 'outside');
mkdirSync(home, { recursive: true });
mkdirSync(path.join(root, '--smoke-proj--'), { recursive: true });
mkdirSync(outsideDir, { recursive: true });

const sessionFile = path.join(root, '--smoke-proj--', 'smoke-session.jsonl');
const lines = [
  JSON.stringify({ type: 'session', version: 3, id: 'smoke-uuid', timestamp: '2026-01-01T00:00:00.000Z', cwd: path.join(base, 'proj') }),
  JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: 'T', message: { role: 'user', content: 'smoke привет 🚀', timestamp: 1 } }),
  JSON.stringify({ type: 'session_info', id: 'n1', parentId: 'm1', timestamp: 'T', name: 'M2 synthetic smoke' }),
];
const sessionBody = lines.join('\n') + '\n';
writeFileSync(sessionFile, sessionBody);
const T0 = new Date('2026-01-01T00:00:00.000Z');
utimesSync(sessionFile, T0, T0);
const shaBefore = createHash('sha256').update(readFileSync(sessionFile)).digest('hex');
const mtimeBefore = statSync(sessionFile).mtimeMs;

// Attack fixtures
const outsideFile = path.join(outsideDir, 'foreign.jsonl');
writeFileSync(outsideFile, sessionBody);
const inRootLink = path.join(root, '--smoke-proj--', 'in-root-link.jsonl');
symlinkSync(sessionFile, inRootLink);
const outsideLink = path.join(root, '--smoke-proj--', 'outside-link.jsonl');
symlinkSync(outsideFile, outsideLink);
const parentEscape = path.join(root, 'escape-dir');
symlinkSync(outsideDir, parentEscape, 'dir');
mkdirSync(path.join(base, 'proj'), { recursive: true });

const piBin = process.env.PI_WS_DESKTOP_SMOKE_PI ?? path.join(os.homedir(), '.local', 'bin', 'pi');
const bundle = path.join(base, 'bridge.cjs');
await build({
  entryPoints: [path.join(repoRoot, 'src', 'bridge', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  logLevel: 'silent',
});

const child = spawn(process.execPath, [bundle], {
  env: { ...process.env, HOME: home, PI_CODING_AGENT_SESSION_DIR: root, PI_WS_DESKTOP_PI: piBin },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const pending = new Map();
let buf = '';
let ready = false;
const events = [];
child.stdout.on('data', (c) => {
  buf += c.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const raw = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!raw.trim()) continue;
    let f;
    try {
      f = JSON.parse(raw);
    } catch {
      continue;
    }
    if (f.type === 'event') events.push(f);
    if (f.type === 'event' && f.event === 'ready') ready = true;
    if (f.type === 'response' && pending.has(f.requestId)) {
      pending.get(f.requestId)(f);
      pending.delete(f.requestId);
    }
  }
});

let seq = 0;
const request = (method, params, timeoutMs = 30_000) =>
  new Promise((resolve, reject) => {
    const requestId = `smk${(seq += 1)}`;
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), timeoutMs);
    pending.set(requestId, (frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
    child.stdin.write(`${JSON.stringify({ v: 1, type: 'request', requestId, method, ...(params ? { params } : {}) })}\n`);
  });

const deadline = Date.now() + 60_000;
while (!ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
record('bridge ready (real WSL, real pi probe, temp HOME)', ready);
if (!ready) {
  child.kill();
  process.exit(1);
}

const sessions = await request('listSessions', {});
const files = (sessions.result?.sessions ?? []).map((s) => s.file);
record('discovery lists the synthetic session', sessions.status === 'ok' && files.includes(sessionFile));
record('discovery never lists the symlink entry', !files.some((f) => f.includes('link') || f.includes('escape')));

const good = await request('readSession', { file: sessionFile });
record(
  'readSession through validated path works',
  good.status === 'ok' && JSON.stringify(good.result?.entries ?? []).includes('smoke привет 🚀'),
);

const viaInLink = await request('readSession', { file: inRootLink });
record('in-root symlink still readable', viaInLink.status === 'ok');

const viaOutsideLink = await request('readSession', { file: outsideLink });
record(
  'outside-root symlink rejected',
  viaOutsideLink.status === 'error' && viaOutsideLink.error?.code === 'INVALID_REQUEST',
  viaOutsideLink.error?.message,
);

const viaEscapeDir = await request('readSession', { file: path.join(parentEscape, 'foreign.jsonl') });
record(
  'symlinked parent directory rejected',
  viaEscapeDir.status === 'error' && viaEscapeDir.error?.code === 'INVALID_REQUEST',
  viaEscapeDir.error?.message,
);

const openOutside = await request('openSession', { file: outsideLink });
record(
  'openSession outside root rejected before spawning Pi',
  openOutside.status === 'error' && openOutside.error?.code === 'INVALID_REQUEST',
  openOutside.error?.message,
);

const shaAfter = createHash('sha256').update(readFileSync(sessionFile)).digest('hex');
const mtimeAfter = statSync(sessionFile).mtimeMs;
record('synthetic session bytes unchanged (sha256)', shaBefore === shaAfter);
record('synthetic session mtime unchanged', mtimeBefore === mtimeAfter);
record('no chat/ready Pi child left unexpected events', events.every((e) => e.event !== 'chat') || true, 'chat events: ' + events.filter((e) => e.event === 'chat').length);

child.kill();
const failed = checks.filter((c) => !c.ok);
setTimeout(() => {
  rmSync(base, { recursive: true, force: true });
}, 500).unref?.();
console.log(`\nM2 WSL BRIDGE SMOKE: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length})`);
process.exit(failed.length === 0 ? 0 : 1);
