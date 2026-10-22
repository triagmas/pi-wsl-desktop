#!/usr/bin/env node
/**
 * M4 R01 synthetic lifecycle test (Windows only): silent install → upgrade
 * (re-install) → uninstall against the REAL NSIS artifacts, with sentinel
 * files proving that neither step touches user data outside the fixed
 * per-user install directory. Runs on the CI runner's throwaway profile;
 * it never points at a real user's Pi home or WSL state.
 *
 * Usage: node scripts/packaged-lifecycle.mjs [releaseDir]   (default: release)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRootFrom } from './lib/releasePaths.mjs';

if (process.platform !== 'win32') {
  console.error('packaged-lifecycle: Windows only — NOT RUN on this host');
  process.exit(2);
}

const root = repoRootFrom(import.meta.url);
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const dir = path.resolve(process.argv[2] ?? path.join(root, 'release'));
const installer = path.join(dir, `PiWSLDesktop-${version}-setup.exe`);
if (!existsSync(installer)) {
  console.error(`packaged-lifecycle: ${installer} missing — run electron-builder first`);
  process.exit(1);
}

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Pi WSL Desktop');
const appExe = path.join(installDir, 'Pi WSL Desktop.exe');
const uninstaller = path.join(installDir, 'Uninstall Pi WSL Desktop.exe');

// Sentinels live OUTSIDE the install dir; neither upgrade nor uninstall
// may remove them. userData-equivalent and a fake "user project".
const sentinelRoot = path.join(process.env.APPDATA, 'pi-wsl-desktop-lifecycle-sentinel');
const sentinelUserData = path.join(sentinelRoot, 'module-state.json');
const sentinelProject = path.join(sentinelRoot, 'user-project', 'notes.txt');
const placeSentinels = () => {
  rmSync(sentinelRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(sentinelUserData), { recursive: true });
  mkdirSync(path.dirname(sentinelProject), { recursive: true });
  writeFileSync(sentinelUserData, '{"sentinel":"user-data-must-survive"}', 'utf8');
  writeFileSync(sentinelProject, 'user project file — must survive install/update/uninstall', 'utf8');
};
const sentinelsIntact = () =>
  existsSync(sentinelUserData) && existsSync(sentinelProject);

const run = (file, args) =>
  new Promise((resolve) => {
    const p = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => {
      p.kill();
      resolve({ ok: false, detail: 'timeout after 180s' });
    }, 180_000);
    p.on('exit', (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, detail: `exit ${code}` });
    });
  });

const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

let failed = 0;
const assert = (name, ok, detail) => {
  if (!check(name, ok, detail)) failed += 1;
};

// 1. Install (silent, per-user, no elevation)
placeSentinels();
const install1 = await run(installer, ['/S']);
assert('silent install succeeds', install1.ok, install1.detail);
assert('app exe installed in fixed per-user dir', existsSync(appExe), installDir);
assert('uninstaller present', existsSync(uninstaller));
assert('sentinels survive install', sentinelsIntact());

// 2. Upgrade: run the same installer again over the existing installation
const upgrade = await run(installer, ['/S']);
assert('re-install (upgrade path) succeeds', upgrade.ok, upgrade.detail);
assert('app exe still present after upgrade', existsSync(appExe));
assert('sentinels survive upgrade', sentinelsIntact());

// 3. Uninstall (silent)
const un = await run(uninstaller, ['/S']);
assert('silent uninstall succeeds', un.ok, un.detail);
// the uninstaller exits after deleting; give the filesystem a moment
const deadline = Date.now() + 30_000;
while (existsSync(appExe) && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
}
assert('install dir removed', !existsSync(appExe), installDir);
assert('sentinels survive uninstall (user data preserved)', sentinelsIntact());

rmSync(sentinelRoot, { recursive: true, force: true });
if (failed > 0) {
  console.error(`packaged-lifecycle: ${failed} FAILED`);
  process.exit(1);
}
console.log('packaged-lifecycle: install → upgrade → uninstall — user data preserved throughout');
