#!/usr/bin/env node
/**
 * Real Windows+WSL GUI smoke for M0.
 *
 * Launches the built app as a NATIVE Windows Electron process (win32 binary,
 * extracted under artifacts/ — never committed) with the AUTHENTIC Windows
 * environment (cmd /c set), running against the REAL Windows wsl.exe → real
 * Ubuntu → real bridge → real Pi. The app's env-gated smoke-report sink
 * writes connection snapshots to a JSONL file; this script polls it for a
 * terminal state and prints PASS / FAIL / NOT RUN with the exact reason.
 *
 * Cleanup is pid-diffed: only electron.exe PIDs that appeared after launch
 * are terminated, so unrelated processes are never touched.
 *
 * Run from WSL: `node scripts/windows-smoke.mjs`
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronExe = path.join(root, 'artifacts', 'win-electron', 'electron.exe');
const mainBundle = path.join(root, 'dist', 'main', 'index.cjs');
const reportWsl = path.join(root, 'artifacts', 'windows-smoke-report.jsonl');
const stderrLog = path.join(root, 'artifacts', 'windows-smoke-stderr.log');
const TIMEOUT_MS = 120_000;
const TASKKILL = '/mnt/c/Windows/System32/taskkill.exe';
const TASKLIST = '/mnt/c/Windows/System32/tasklist.exe';
const CMD = '/mnt/c/Windows/System32/cmd.exe';

function winPath(p) {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(p);
  if (!m) throw new Error(`path is not under /mnt/<drive>: ${p}`);
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

function finish(result, detail) {
  console.log(`WINDOWS GUI SMOKE: ${result}${detail ? ` — ${detail}` : ''}`);
  process.exit(result === 'PASS' ? 0 : result === 'FAIL' ? 1 : 2);
}

function windowsEnv() {
  const res = spawnSync(CMD, ['/c', 'set'], { encoding: 'utf8', timeout: 15_000 });
  if (res.status !== 0) {
    finish('NOT RUN', `cannot read Windows environment via cmd.exe (exit ${res.status})`);
  }
  const env = {};
  for (const line of (res.stdout ?? '').split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  if (!env.APPDATA || !env.USERPROFILE) {
    finish('NOT RUN', 'Windows environment lacks APPDATA/USERPROFILE');
  }
  return env;
}

function electronPids() {
  const res = spawnSync(TASKLIST, ['/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const pids = new Set();
  for (const line of (res.stdout ?? '').split(/\r?\n/)) {
    const m = /^"electron\.exe","(\d+)"/.exec(line.trim());
    if (m) pids.add(Number(m[1]));
  }
  return pids;
}

function readReport() {
  try {
    return readFileSync(reportWsl, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function cleanup(before) {
  const now = electronPids();
  const fresh = [...now].filter((pid) => !before.has(pid));
  let killed = 0;
  for (const pid of fresh) {
    const res = spawnSync(TASKKILL, ['/PID', String(pid), '/F'], { encoding: 'utf8', timeout: 10_000 });
    if (res.status === 0) killed += 1;
  }
  return `${killed}/${fresh.length} new electron.exe pid(s) terminated`;
}

async function main() {
  if (!existsSync(electronExe)) {
    finish('NOT RUN', `win32 electron binary missing at ${path.relative(root, electronExe)}`);
  }
  if (!existsSync(mainBundle)) {
    finish('NOT RUN', 'dist/main/index.cjs missing — run npm run build first');
  }

  mkdirSync(path.dirname(reportWsl), { recursive: true });
  rmSync(reportWsl, { force: true });
  rmSync(stderrLog, { force: true });

  const winEnv = windowsEnv();
  const before = electronPids();

  const env = {
    // Full authentic Windows environment from `cmd /c set` (APPDATA, USERPROFILE,
    // SystemRoot, TEMP… are all provided there — no hard-coded local paths).
    ...winEnv,
    PI_WS_DESKTOP_SMOKE_REPORT: winPath(reportWsl),
    WSLENV: `${winEnv.WSLENV ? `${winEnv.WSLENV}:` : ''}PI_WS_DESKTOP_SMOKE_REPORT`,
  };

  let child;
  try {
    child = spawn(electronExe, [winPath(root)], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    finish('NOT RUN', `cannot spawn electron.exe: ${err.message}`);
  }

  let stderrText = '';
  child.stderr.on('data', (c) => {
    stderrText += c.toString('utf8');
  });
  child.once('error', (err) => {
    finish('NOT RUN', `electron.exe launch failed: ${err.message}`);
  });

  const started = Date.now();
  let last = null;
  while (Date.now() - started < TIMEOUT_MS) {
    const entries = readReport();
    if (entries.length > 0) last = entries[entries.length - 1];
    if (last && (last.phase === 'ready' || last.phase === 'error')) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const killed = cleanup(before);
  writeFileSync(stderrLog, stderrText, 'utf8');

  if (!last) {
    const tail = stderrText.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 500);
    finish('FAIL', `no connection snapshot in ${TIMEOUT_MS / 1000}s; stderr tail: [${tail}] (${killed})`);
  }
  if (last.phase === 'error') {
    finish('FAIL', `connection ended in error ${last.code}: ${JSON.stringify(last)} (${killed})`);
  }
  finish(
    'PASS',
    `native Windows Electron reached ready; real Pi ${last.runtime?.pi?.version ?? 'unknown'}, ` +
      `node ${last.runtime?.node?.version ?? 'unknown'}, distro ${JSON.stringify(last.runtime?.distro ?? null)} (${killed})`,
  );
}

await main();
