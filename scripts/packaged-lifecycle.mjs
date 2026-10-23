#!/usr/bin/env node
/**
 * M4 R01 synthetic lifecycle test (Windows only): silent install → upgrade
 * (re-install) → uninstall against the REAL NSIS artifacts, with sentinel
 * files INSIDE the app's actual userData directory proving that neither step
 * touches user data outside the fixed per-user install directory.
 *
 * SAFETY: fail-closed — refuses to run unless PI_WS_DESKTOP_LIFECYCLE_ALLOW=1
 * (set only on the throwaway CI runner profile). It creates exactly two
 * sentinel files and removes exactly those; the userData directory itself is
 * never recursively deleted. Never run against a profile holding real data.
 *
 * Usage: PI_WS_DESKTOP_LIFECYCLE_ALLOW=1 node scripts/packaged-lifecycle.mjs [releaseDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRootFrom } from './lib/releasePaths.mjs';

if (process.platform !== 'win32') {
  console.error('packaged-lifecycle: Windows only — NOT RUN on this host');
  process.exit(2);
}
if (process.env.PI_WS_DESKTOP_LIFECYCLE_ALLOW !== '1') {
  console.error(
    'packaged-lifecycle: NOT RUN — set PI_WS_DESKTOP_LIFECYCLE_ALLOW=1 only on a throwaway CI profile (it writes into the real %APPDATA% userData of this profile)',
  );
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
// ownership marker written by the NSIS guard (build/nsis-guard.nsh) — the
// uninstaller must refuse recursive deletion when it is missing
const INSTALL_MARKER = '.pi-desktop-install-marker';
const markerFile = path.join(installDir, INSTALL_MARKER);
const findUninstaller = () =>
  readdirSync(installDir).find((f) => f.startsWith('Uninstall')) ?? null;

// Sentinels live INSIDE the app's actual userData directory (%APPDATA%\<name>
// — Electron derives it from package.json "name") because that is the path
// the product promises to preserve. Byte-for-byte comparison, exact-file
// cleanup: the directory is never recursively removed.
const userDataDir = path.join(process.env.APPDATA, pkg.name);
const sentinelFile = path.join(userDataDir, 'lifecycle-sentinel.json');
const sentinelNestedDir = path.join(userDataDir, 'lifecycle-sentinel-dir');
const sentinelNested = path.join(sentinelNestedDir, 'notes.txt');
const SENTINEL_BYTES = '{"sentinel":"user-data-must-survive-byte-identical"}';
const NESTED_BYTES = 'user project file — must survive install/update/uninstall';

const placeSentinels = () => {
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(sentinelNestedDir, { recursive: true });
  writeFileSync(sentinelFile, SENTINEL_BYTES, 'utf8');
  writeFileSync(sentinelNested, NESTED_BYTES, 'utf8');
};
const sentinelsIntact = () => {
  try {
    return (
      readFileSync(sentinelFile, 'utf8') === SENTINEL_BYTES &&
      readFileSync(sentinelNested, 'utf8') === NESTED_BYTES
    );
  } catch {
    return false;
  }
};
const cleanupSentinels = () => {
  // exact files only — never rmSync(userDataDir)
  try {
    if (existsSync(sentinelNested)) unlinkSync(sentinelNested);
    if (existsSync(sentinelNestedDir)) rmSync(sentinelNestedDir, { recursive: false });
    if (existsSync(sentinelFile)) unlinkSync(sentinelFile);
  } catch {
    // best-effort; CI profile is disposable
  }
};

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

// 1. Install (silent, per-user, no elevation, no auto-launch)
placeSentinels();
const install1 = await run(installer, ['/S']);
assert('silent install succeeds', install1.ok, install1.detail);
if (!existsSync(appExe)) {
  console.log(`diagnostic: Programs dir contains: ${listDir(path.dirname(installDir))}`);
  console.log(`diagnostic: installDir contains: ${listDir(installDir)}`);
}
assert('app exe installed in fixed per-user dir', existsSync(appExe), installDir);
assert('sentinels byte-identical after install', sentinelsIntact());

// 2. Upgrade: run the same installer again over the existing installation
const upgrade = await run(installer, ['/S']);
assert('re-install (upgrade path) succeeds', upgrade.ok, upgrade.detail);
assert('app exe still present after upgrade', existsSync(appExe));
assert('sentinels byte-identical after upgrade', sentinelsIntact());

// 3. Uninstall (silent). runAfterFinish:false (contract-tested) guarantees
// no instance of the app was auto-launched, so nothing pins the exe.
const uninstallerRel = findUninstaller();
assert('uninstaller present', uninstallerRel !== null, installDir);
const un = uninstallerRel
  ? await run(path.join(installDir, uninstallerRel), ['/S'])
  : { ok: false, detail: 'no uninstaller' };
assert('silent uninstall succeeds', un.ok, un.detail);
// THE dir-level assertion: the whole install dir must go (not just the exe);
// allow generous time on a loaded runner before declaring leftovers
const deadline = Date.now() + 90_000;
while (existsSync(installDir) && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
}
if (existsSync(installDir)) {
  console.log(`diagnostic: leftovers in installDir: ${listDir(installDir)}`);
}
assert('install dir removed', !existsSync(installDir), installDir);
assert('sentinels byte-identical after uninstall (user data preserved)', sentinelsIntact());

// 4. Tampered state: with the ownership marker removed the uninstaller
// must refuse to delete the install dir (fail-safe, no recursive delete).
if (existsSync(markerFile)) unlinkSync(markerFile);
const unTampered = await run(path.join(installDir, findUninstaller() ?? ''), ['/S']);
console.log(`info: tampered uninstall exit=${unTampered.detail}`);
await new Promise((r) => setTimeout(r, 3000));
assert('tampered uninstall (no marker) keeps install dir (fail-safe)', existsSync(installDir), installDir);
assert('tampered uninstall keeps app files', existsSync(appExe));
// restore the marker so the standard uninstall below proceeds
writeFileSync(markerFile, `${pkg.build.appId ?? pkg.name} ${version} (restored-by-test)`, 'utf8');
const unRestored = await run(path.join(installDir, findUninstaller() ?? ''), ['/S']);
assert('uninstall succeeds after marker restoration', unRestored.ok, unRestored.detail);
const deadline2 = Date.now() + 90_000;
while (existsSync(installDir) && Date.now() < deadline2) {
  await new Promise((r) => setTimeout(r, 1000));
}
assert('install dir removed after restored-marker uninstall', !existsSync(installDir), installDir);
assert('sentinels byte-identical after tamper scenario', sentinelsIntact());

// 5. Malicious /D= into an EXISTING foreign directory with foreign sentinels:
// the installer must REFUSE before touching anything there, and a previous
// good install must stay intact.
const goodInstall = await run(installer, ['/S']);
assert('baseline install for /D= scenario succeeds', goodInstall.ok && existsSync(appExe), goodInstall.detail);
const foreignDir = path.join(os.tmpdir(), `pi-lifecycle-foreign-${Date.now()}`);
mkdirSync(foreignDir, { recursive: true });
const foreignSentinel = path.join(foreignDir, 'important-project-file.txt');
writeFileSync(foreignSentinel, 'precious foreign content — must never be deleted', 'utf8');
// NSIS requires /D= as the LAST argument
const evil = await run(installer, ['/S', `/D=${foreignDir}`]);
assert('installer /D= into existing foreign dir is REFUSED (non-zero exit)', !evil.ok, evil.detail);
assert('foreign dir survives', existsSync(foreignDir), foreignDir);
assert('foreign sentinel byte-identical', readFileSync(foreignSentinel, 'utf8') === 'precious foreign content — must never be deleted');
assert('no app files landed in the foreign dir', !existsSync(path.join(foreignDir, `${pkg.build.productName}.exe`)));
assert('previous good install untouched by refused install', existsSync(appExe) && existsSync(markerFile), installDir);
rmSync(foreignDir, { recursive: true, force: true });
// cleanup: uninstall the good baseline install
const unFinal = await run(path.join(installDir, findUninstaller() ?? ''), ['/S']);
assert('final uninstall succeeds', unFinal.ok, unFinal.detail);
const deadline3 = Date.now() + 90_000;
while (existsSync(installDir) && Date.now() < deadline3) {
  await new Promise((r) => setTimeout(r, 1000));
}
assert('final install dir removed', !existsSync(installDir), installDir);

cleanupSentinels();
if (failed > 0) {
  console.error(`packaged-lifecycle: ${failed} FAILED`);
  process.exit(1);
}
console.log('packaged-lifecycle: install → upgrade → uninstall — real userData sentinels byte-identical throughout');
