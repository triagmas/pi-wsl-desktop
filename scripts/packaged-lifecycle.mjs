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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRootFrom } from './lib/releasePaths.mjs';

if (process.platform !== 'win32') {
  console.error('packaged-lifecycle: Windows only — NOT RUN on this host');
  process.exit(2);
}

const root = repoRootFrom(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const dir = path.resolve(process.argv[2] ?? path.join(root, 'release'));
const installer = path.join(dir, `PiWSLDesktop-${version}-setup.exe`);
if (!existsSync(installer)) {
  console.error(`packaged-lifecycle: ${installer} missing — run electron-builder first`);
  process.exit(1);
}

// electron-builder's one-click NSIS target installs into
// %LOCALAPPDATA%\Programs\<package name> with <productName>.exe — both are
// taken from package.json so the test cannot drift from the config.
const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', pkg.name);
const appExe = path.join(installDir, `${pkg.build.productName}.exe`);
const findUninstaller = () =>
  readdirSync(installDir).find((f) => f.startsWith('Uninstall')) ?? null;

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
    p.on('error', (err) => {
      clearTimeout(t);
      resolve({ ok: false, detail: `spawn error: ${err.message}` });
    });
    const t = setTimeout(() => {
      p.kill();
      resolve({ ok: false, detail: 'timeout after 180s' });
    }, 180_000);
    p.on('exit', (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, detail: `exit ${code}` });
    });
  });

const listDir = (d) => {
  try {
    return readdirSync(d).join(', ');
  } catch (e) {
    return `<unreadable: ${e.code}>`;
  }
};

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
if (!existsSync(appExe)) {
  // diagnostics: where did the installer actually put the app?
  console.log(`diagnostic: LOCALAPPDATA=${process.env.LOCALAPPDATA}`);
  console.log(`diagnostic: Programs dir contains: ${listDir(path.dirname(installDir))}`);
  console.log(`diagnostic: installDir contains: ${listDir(installDir)}`);
}
assert('app exe installed in fixed per-user dir', existsSync(appExe), installDir);
assert('sentinels survive install', sentinelsIntact());

// 2. Upgrade: run the same installer again over the existing installation
const upgrade = await run(installer, ['/S']);
assert('re-install (upgrade path) succeeds', upgrade.ok, upgrade.detail);
assert('app exe still present after upgrade', existsSync(appExe));
assert('sentinels survive upgrade', sentinelsIntact());

// 3. Uninstall (silent)
const uninstallerRel = findUninstaller();
assert('uninstaller present', uninstallerRel !== null, installDir);
const un = uninstallerRel ? await run(path.join(installDir, uninstallerRel), ['/S']) : { ok: false, detail: 'no uninstaller' };
assert('silent uninstall succeeds', un.ok, un.detail);
// the NSIS uninstaller removes $INSTDIR asynchronously right before exit;
// allow generous time on a loaded runner before declaring leftovers
const deadline = Date.now() + 90_000;
while (existsSync(appExe) && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
}
if (existsSync(appExe)) {
  console.log(`diagnostic: leftovers in installDir: ${listDir(installDir)}`);
}
assert('install dir removed', !existsSync(appExe), installDir);
assert('sentinels survive uninstall (user data preserved)', sentinelsIntact());

rmSync(sentinelRoot, { recursive: true, force: true });
if (failed > 0) {
  console.error(`packaged-lifecycle: ${failed} FAILED`);
  process.exit(1);
}
console.log('packaged-lifecycle: install → upgrade → uninstall — user data preserved throughout');
