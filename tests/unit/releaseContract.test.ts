/**
 * M4 R01 release contract: the packaged Windows app must be built from an
 * explicit, auditable electron-builder configuration whose lifecycle
 * invariants protect the user's data and the existing Pi installation.
 * These tests pin the installer's behavior BEFORE any artifact is built.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
  main: string;
  license: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  build?: Record<string, unknown>;
};

const build = (pkg.build ?? {}) as {
  appId?: string;
  productName?: string;
  asar?: boolean;
  directories?: { output?: string };
  files?: string[];
  extraResources?: Array<{ from: string; to: string }>;
  win?: { target?: Array<{ target?: string; arch?: string[] }> };
  nsis?: Record<string, unknown>;
  publish?: unknown;
  npmRebuild?: boolean;
};

describe('M4 R01 — release versioning', () => {
  it('declares a prerelease version: 1.0.0 is NOT released before final M4 acceptance', () => {
    expect(pkg.version).toBe('1.0.0-rc.1');
    expect(pkg.main).toBe('dist/main/index.cjs');
  });

  it('pins electron-builder as an exact devDependency (reproducible packaging)', () => {
    expect(pkg.devDependencies['electron-builder']).toBe('26.15.3');
  });
});

describe('M4 R01 — electron-builder configuration contract', () => {
  it('has an explicit auditable config with a stable appId/productName', () => {
    expect(pkg.build).toBeDefined();
    expect(build.appId).toBe('io.pi-desktop.wsl');
    expect(build.productName).toBe('Pi WSL Desktop');
    expect(build.directories?.output).toBe('release');
    expect(build.asar).toBe(true);
  });

  it('ships license texts with the app (MIT redistribution requires them)', () => {
    expect(build.files).toContain('LICENSE');
    expect(build.files).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('packages only the built dist (no node_modules, no sources, no fixtures)', () => {
    expect(build.files).toContain('dist/**/*');
    expect(build.files).toContain('package.json');
    // the app is fully bundled by esbuild/Vite — production node_modules
    // (react, zod) are already inlined; shipping them would only add bulk
    expect(build.files).toContain('!node_modules/**');
  });

  it('ships the bridge as a REAL file in resources (WSL cannot read asar)', () => {
    expect(build.extraResources).toEqual([
      { from: 'dist/bridge/index.cjs', to: 'bridge/index.cjs' },
    ]);
  });

  it('targets 64-bit NSIS and rebuilds nothing (no native modules)', () => {
    expect(build.win?.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(build.npmRebuild).toBe(false);
  });

  it('never auto-updates: no publish target and no differential packages', () => {
    expect(build.publish ?? null).toBeNull();
    expect(build.nsis?.differentialPackage).toBe(false);
  });

  it('install/update/uninstall must preserve user data and the machine', () => {
    // oneClick=true + perMachine=false is the only combination that is
    // ALWAYS per-user with NO elevation and NO install-mode page (the
    // assisted installer would offer a per-machine mode). Standard UI
    // installs are directory-fixed; the explicit NSIS /D= CLI override
    // remains a disclosed platform residual — see
    // docs/release/m4-r01-packaging.md (Lifecycle & data guarantees) and
    // Issue #16
    expect(build.nsis?.oneClick).toBe(true);
    expect(build.nsis?.perMachine).toBe(false);
    expect(build.nsis?.allowToChangeInstallationDirectory).toBeUndefined();
    // no auto-launch after install: a running app would pin files in the
    // install dir (breaking uninstall) and surprise the user
    expect(build.nsis?.runAfterFinish).toBe(false);
    // Standard-scenario data guarantee (CI sentinel test): uninstalling
    // never deletes the user profile; the /D= CLI residual is disclosed,
    // not covered by this contract
    expect(build.nsis?.deleteAppDataOnUninstall).toBe(false);
    // Exactly ONE sanctioned NSIS extension: the security guard include
    // (owner variant B), contract-pinned in nsisGuardContract.test.ts.
    // Full script replacement and auto-loaded installer.nsi|nsh stay banned.
    expect(build.nsis?.script).toBeUndefined();
    expect(build.nsis?.include).toBe('nsis-guard.nsh');
    expect(existsSync(path.join(root, 'build', 'installer.nsi'))).toBe(false);
    expect(existsSync(path.join(root, 'build', 'installer.nsh'))).toBe(false);
  });

  it('produces a versioned, predictably named installer artifact', () => {
    expect(build.nsis?.artifactName).toBe('PiWSLDesktop-${version}-setup.${ext}');
  });

  it('carries the MIT license and third-party notices for the installer/docs', () => {
    expect(pkg.license).toBe('MIT');
    expect(existsSync(path.join(root, 'LICENSE'))).toBe(true);
    expect(existsSync(path.join(root, 'THIRD_PARTY_NOTICES.md'))).toBe(true);
  });
});
