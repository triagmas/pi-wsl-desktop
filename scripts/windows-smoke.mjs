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
 * Cleanup is OWNERSHIP-based (review P1 #2): only the PID we spawned
 * (path-verified against PID reuse) and its descendant tree running our
 * exact electron.exe are ever terminated — never every new electron.exe
 * by name. A foreign electron.exe decoy is launched mid-run and must
 * SURVIVE cleanup; our own app must be fully stopped. When in doubt: do not
 * kill. Cleanup also runs on interrupt/error paths via finish().
 *
 * Run from WSL: `node scripts/windows-smoke.mjs`
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markerPids, planCleanup } from './lib/winProc.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronExe = path.join(root, 'artifacts', 'win-electron', 'electron.exe');
const mainBundle = path.join(root, 'dist', 'main', 'index.cjs');
const reportWsl = path.join(root, 'artifacts', 'windows-smoke-report.jsonl');
const stderrLog = path.join(root, 'artifacts', 'windows-smoke-stderr.log');
const TIMEOUT_MS = 120_000;
const TASKKILL = '/mnt/c/Windows/System32/taskkill.exe';
const TASKLIST = '/mnt/c/Windows/System32/tasklist.exe';
const CMD = '/mnt/c/Windows/System32/cmd.exe';
const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

/** State of this run (Windows-side identity — WSL spawn pids are NOT Windows pids). */
const smoke = { decoyMarker: null };

function winPath(p) {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(p);
  if (!m) throw new Error(`path is not under /mnt/<drive>: ${p}`);
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

/** Windows-form executable path — what Win32_Process reports. */
const electronExeWin = winPath(electronExe);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function finish(result, detail) {
  // All exit paths funnel through the ownership-gated cleanup so no
  // interrupt/error can leave our processes behind — and a violated gate
  // (foreign decoy killed / own app still alive) downgrades PASS to FAIL.
  let gates;
  try {
    gates = runCleanup();
  } catch (err) {
    gates = { summary: `cleanup error: ${err.message}`, decoy: '?', ownStopped: false, ok: false };
  }
  if (result === 'PASS' && !gates.ok) result = 'FAIL';
  const gateDetail = `ownership: ${gates.summary}; foreign electron.exe decoy: ${gates.decoy}; own app stopped: ${gates.ownStopped}`;
  console.log(`WINDOWS GUI SMOKE: ${result} — ${detail ? `${detail}; ` : ''}${gateDetail}`);
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

function processTable() {
  // Full identity table for electron.exe: PID, parent PID, executable path.
  // Returns null when PowerShell is unavailable (→ conservative fallback).
  const res = spawnSync(
    POWERSHELL,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json",
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (res.status !== 0 || !(res.stdout ?? '').trim()) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
    return rows
      .filter((r) => r.ProcessId != null)
      .map((r) => ({
        pid: Number(r.ProcessId),
        ppid: Number(r.ParentProcessId ?? 0),
        exe: r.ExecutablePath ?? null,
        cmd: r.CommandLine ?? null,
      }));
  } catch {
    return null;
  }
}

function pidImage(pid) {
  // Image name for a Windows PID (same PID space as tasklist), or null when
  // no process holds the pid.
  if (!pid) return null;
  const res = spawnSync(TASKLIST, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const m = /^"([^"]+)","\d+"/.exec((res.stdout ?? '').trim());
  return m ? m[1] : null;
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

function reportPid() {
  // The app self-reports its native Windows PID in every smoke snapshot.
  const entries = readReport();
  const last = entries[entries.length - 1];
  const pid = Number(last?.pid);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function cleanupOwned() {
  // Ownership contract (review P1#2 + R2 P1): terminate ONLY the PIDs planned
  // by planCleanup — which is fail-closed: identity table unavailable, PID
  // reuse or ambiguity → `inconclusive` → 0 taskkill and a diagnostic FAIL
  // (PASS is downgraded). There is NO path that kills an unverified pid.
  const table = processTable();
  const plan = planCleanup({
    table,
    reportPid: reportPid(),
    exePath: electronExeWin,
    arg: winPath(root),
  });
  if (plan.action !== 'kill') {
    return {
      killed: 0,
      owned: [],
      note: plan.reason,
      inconclusive: plan.action === 'inconclusive',
    };
  }
  let killed = 0;
  for (const pid of [...plan.pids].reverse()) {
    // helpers first, root last; every PID was path-verified by planCleanup
    const res = spawnSync(TASKKILL, ['/PID', String(pid), '/F'], { encoding: 'utf8', timeout: 10_000 });
    if (res.status === 0) killed += 1;
  }
  return { killed, owned: plan.pids, note: `${plan.reason} via ${plan.source}`, inconclusive: false };
}

let cleanedUp = false;
function runCleanup() {
  if (cleanedUp) return { summary: 'already cleaned', decoy: 'n/a', ownStopped: true, ok: true };
  cleanedUp = true;
  const out = { summary: '', decoy: 'n/a', ownStopped: true, ok: true };

  const c = cleanupOwned();
  out.summary = c.inconclusive
    ? `INCONCLUSIVE: ${c.note} → killed nothing`
    : `${c.killed}/${c.owned.length} owned pid(s) terminated (${c.note})`;
  if (c.inconclusive) out.ok = false; // diagnostic FAIL, verdict downgrade
  sleepSync(700); // let taskkill settle before the liveness probe

  // Own app must actually be gone (Windows pid, same space as tasklist).
  // A pid recycled by a NON-electron process proves our app exited; a pid
  // recycled by another electron.exe counts as NOT stopped (fail toward FAIL).
  const rootPid = reportPid();
  const img = pidImage(rootPid);
  out.ownStopped = rootPid ? img === null || img.toLowerCase() !== 'electron.exe' : false;
  if (!out.ownStopped) out.ok = false;

  // Foreign decoy gate: liveness by UNIQUE marker on a POST-cleanup table.
  if (smoke.decoyMarker) {
    const post = processTable();
    const hits = post ? markerPids(post, smoke.decoyMarker) : [];
    if (hits.length === 1) {
      out.decoy = 'survived';
      // it is our own child (unique marker) → safe to stop afterwards
      spawnSync(TASKKILL, ['/PID', String(hits[0]), '/F'], { encoding: 'utf8', timeout: 10_000 });
    } else if (hits.length === 0) {
      out.decoy = 'missing (spawn failed or died early)';
      out.ok = false;
    } else {
      out.decoy = `ambiguous (${hits.length} matches)`;
      out.ok = false;
    }
  } else {
    out.decoy = 'spawn failed';
    out.ok = false;
  }
  return out;
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

  // Foreign decoy (review P1 #2 TDD gate): an independent electron.exe with a
  // UNIQUE command-line marker, started AFTER the smoke begins — it must
  // survive our cleanup untouched. Identity for liveness/stop comes from the
  // marker in the Windows process table (WSL spawn pids are NOT Windows pids).
  const decoyMarker = `piwsd-smoke-decoy-${Date.now().toString(36)}`;
  try {
    const decoy = spawn(electronExe, ['-e', `var m='${decoyMarker}'; setInterval(function(){}, 1000)`], {
      env: { ...winEnv, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      stdio: 'ignore',
    });
    if (decoy.pid) smoke.decoyMarker = decoyMarker;
    decoy.on('error', () => {
      smoke.decoyMarker = null;
    });
  } catch {
    smoke.decoyMarker = null;
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

  writeFileSync(stderrLog, stderrText, 'utf8');

  if (!last) {
    const tail = stderrText.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 500);
    finish('FAIL', `no connection snapshot in ${TIMEOUT_MS / 1000}s; stderr tail: [${tail}]`);
  }
  if (last.phase === 'error') {
    finish('FAIL', `connection ended in error ${last.code}: ${JSON.stringify(last)}`);
  }
  finish(
    'PASS',
    `native Windows Electron reached ready; real Pi ${last.runtime?.pi?.version ?? 'unknown'} ` +
      `(RPC advertised by help), node ${last.runtime?.node?.version ?? 'unknown'}, ` +
      `distro ${JSON.stringify(last.runtime?.distro ?? null)}`,
  );
}

process.on('SIGINT', () => finish('FAIL', 'interrupted (SIGINT)'));
process.on('SIGTERM', () => finish('FAIL', 'terminated (SIGTERM)'));
process.on('uncaughtException', (err) => finish('FAIL', `uncaught exception: ${err.message}`));
process.on('unhandledRejection', (reason) => finish('FAIL', `unhandled rejection: ${String(reason)}`));

await main();
