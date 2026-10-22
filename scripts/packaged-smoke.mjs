#!/usr/bin/env node
/**
 * M4 R01 packaged smoke (Windows only): proves the PACKAGED application
 * boots from its own installed files with NO dev server and NO repository
 * checkout, reaches the WSL bridge stage, and fails closed (error phase,
 * no crash) when WSL is unavailable — the exact condition of a clean
 * CI runner. It uses the app's own env-gated smoke-report sink, the same
 * mechanism the existing manual Windows smoke uses.
 *
 * A snapshot only counts if it was written by THIS process (pid match)
 * while the process was alive; a crash or early exit between polls fails
 * the smoke instead of being mistaken for success.
 *
 * Usage: node scripts/packaged-smoke.mjs [winUnpackedDir]   (default: release/win-unpacked)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRootFrom } from './lib/releasePaths.mjs';

if (process.platform !== 'win32') {
  console.error('packaged-smoke: Windows only — NOT RUN on this host');
  process.exit(2);
}

const root = repoRootFrom(import.meta.url);
const dir = path.resolve(process.argv[2] ?? path.join(root, 'release', 'win-unpacked'));
const exe = path.join(dir, 'Pi WSL Desktop.exe');
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
  },
  stdio: 'ignore',
});

const started = Date.now();
let exited = null;
let snapshots = [];
child.on('exit', (code, signal) => {
  exited = { code, signal };
});

const cleanup = async () => {
  if (exited === null) {
    child.kill();
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 10_000);
      child.once('close', () => {
        clearTimeout(t);
        resolve(undefined);
      });
    });
  }
  rmSync(tmp, { recursive: true, force: true });
};

const finish = async (code, detail) => {
  await cleanup();
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'} packaged smoke — ${detail}`);
  process.exit(code);
};

const timer = setInterval(() => {
  // a crash before the terminal snapshot is a FAILURE, not a pass
  if (exited !== null) {
    clearInterval(timer);
    void finish(1, `app exited early (code=${exited.code} signal=${exited.signal}) before a terminal snapshot`);
    return;
  }
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
    // snapshots must come from THIS process and be observed while alive
    const terminal = snapshots.find((s) => s.phase === 'error' && s.pid === child.pid);
    if (terminal) {
      clearInterval(timer);
      if (terminal.code === 'WSL_UNAVAILABLE') {
        void finish(0, `packaged app booted from installed files, reached bridge, failed closed: ${terminal.code} (attempt ${terminal.attempt})`);
      } else {
        void finish(1, `unexpected terminal snapshot: ${JSON.stringify(terminal)}`);
      }
      return;
    }
  }
  if (Date.now() - started > 120_000) {
    clearInterval(timer);
    void finish(1, `no terminal snapshot within 120s; snapshots=${snapshots.length}`);
  }
}, 500);
