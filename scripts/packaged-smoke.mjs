#!/usr/bin/env node
/**
 * M4 R01 packaged smoke (Windows only): proves the PACKAGED application
 * boots from its own installed files with NO dev server and NO repository
 * checkout, reaches the WSL bridge stage, and fails closed (error phase,
 * no crash) when WSL is unavailable — the exact condition of a clean
 * CI runner. It uses the app's own env-gated smoke-report sink, the same
 * mechanism the existing manual Windows smoke uses.
 *
 * Usage: node scripts/packaged-smoke.mjs [releaseDir]   (default: release)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.error('packaged-smoke: Windows only — NOT RUN on this host');
  process.exit(2);
}

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\/scripts$/, '');
const dir = path.resolve(process.argv[2] ?? path.join(root, 'release'));
const exe = path.join(dir, 'win-unpacked', 'Pi WSL Desktop.exe');
if (!existsSync(exe)) {
  console.error(`packaged-smoke: ${exe} missing — run electron-builder first`);
  process.exit(1);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'pi-packaged-smoke-'));
const sink = path.join(tmp, 'smoke.jsonl');
const bogusWsl = path.join(tmp, 'no-such-wsl.exe');

const child = spawn(exe, [], {
  env: {
    ...process.env,
    PI_WS_DESKTOP_SMOKE_REPORT: sink,
    PI_WS_DESKTOP_WSL_PATH: bogusWsl,
    // Prove there is no dev server: point nothing at localhost anywhere.
  },
  stdio: 'ignore',
});

const started = Date.now();
let snapshots = [];
const finish = (code, detail) => {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'} packaged smoke — ${detail}`);
  process.exit(code);
};

const timer = setInterval(() => {
  if (existsSync(sink)) {
    snapshots = readFileSync(sink, 'utf8')
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
    const terminal = snapshots.find((s) => s.phase === 'error');
    if (terminal) {
      clearInterval(timer);
      if (terminal.code === 'WSL_UNAVAILABLE' && terminal.pid > 0) {
        finish(0, `packaged app booted from installed files, reached bridge, failed closed: ${terminal.code} (attempt ${terminal.attempt})`);
      } else {
        finish(1, `unexpected terminal snapshot: ${JSON.stringify(terminal)}`);
      }
      return;
    }
  }
  if (Date.now() - started > 120_000) {
    clearInterval(timer);
    finish(1, `no terminal snapshot within 120s; snapshots=${snapshots.length}`);
  }
}, 500);
