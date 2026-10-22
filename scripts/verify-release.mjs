#!/usr/bin/env node
/**
 * M4 R01 release-contents verification: asserts the packaged output has the
 * exact shape the product contract promises — app.asar with the bundled
 * main/renderer, the bridge as a REAL file in resources (WSL reads it
 * outside asar), a launchable exe, and a versioned installer artifact.
 *
 * Usage: node scripts/verify-release.mjs [releaseDir]   (default: release)
 */
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\/scripts$/, '');
const dir = path.resolve(process.argv[2] ?? path.join(root, 'release'));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const exe = path.join(dir, 'win-unpacked', 'Pi WSL Desktop.exe');
const bridge = path.join(dir, 'win-unpacked', 'resources', 'bridge', 'index.cjs');
const asar = path.join(dir, 'win-unpacked', 'resources', 'app.asar');
const installer = path.join(dir, `PiWSLDesktop-${version}-setup.exe`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

check('win-unpacked exe exists', existsSync(exe), exe);
check(
  'bridge shipped as a REAL file in resources (not asar)',
  existsSync(bridge) && statSync(bridge).size > 1024,
  bridge,
);
check('app.asar exists', existsSync(asar) && statSync(asar).size > 1024 * 1024, asar);

if (existsSync(asar)) {
  // @electron/asar ships with electron-builder's dependency tree (build-time only).
  const require = createRequire(path.join(root, 'package.json'));
  try {
    const { listPackage } = require('@electron/asar');
    const files = listPackage(asar);
    check('asar bundles dist/main/index.cjs', files.includes('/dist/main/index.cjs'));
    check('asar bundles dist/preload/index.cjs', files.includes('/dist/preload/index.cjs'));
    check('asar bundles dist/renderer/index.html', files.includes('/dist/renderer/index.html'));
    check('asar ships LICENSE (MIT redistribution)', files.includes('/LICENSE'));
    check('asar ships THIRD_PARTY_NOTICES.md', files.includes('/THIRD_PARTY_NOTICES.md'));
    check(
      'asar contains NO raw node_modules',
      !files.some((f) => f.startsWith('/node_modules/')),
    );
    check('asar contains NO sources/tests/fixtures', !files.some((f) => /^\/(src|tests|e2e|scripts)\//.test(f)));
  } catch (err) {
    check('asar listing', false, String(err));
  }
}

if (existsSync(installer)) {
  check(
    'installer is a real NSIS artifact',
    statSync(installer).size > 40 * 1024 * 1024,
    `${statSync(installer).size} bytes`,
  );
  const head = readFileSync(installer).subarray(0, 2);
  check('installer starts with MZ (PE)', head[0] === 0x4d && head[1] === 0x5a);
} else {
  console.log(`note: installer not present at ${installer} — expected on non-Windows hosts without wine; CI Windows job builds and verifies it.`);
}

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.error(`verify-release: ${failed.length} FAILED`);
  process.exit(1);
}
console.log(`verify-release: ${checks.length} checks passed (installer ${existsSync(installer) ? 'verified' : 'deferred to Windows CI'})`);
