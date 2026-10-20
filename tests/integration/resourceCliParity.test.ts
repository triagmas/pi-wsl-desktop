/**
 * T3 CLI parity (Issue #7): the inventory must agree with the INSTALLED Pi's
 * own `pi list` on the SAME isolated HOME (read-only CLI, no model calls).
 * Skips honestly when the pi CLI is unavailable (e.g. stock CI runners).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadAgentConfig } from '../../src/bridge/resources/agentConfig';
import { discoverPackages } from '../../src/bridge/resources/packages';

const HAS_PI = (() => {
  try {
    execFileSync('pi', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const homes: string[] = [];
const makeHome = (): string => {
  const h = mkdtempSync(path.join(os.tmpdir(), 'piwsd-parity-'));
  homes.push(h);
  mkdirSync(path.join(h, '.pi', 'agent'), { recursive: true });
  return h;
};
afterAll(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

const piList = (home: string): string => execFileSync('pi', ['list'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });

describe.skipIf(!HAS_PI)('pi list ↔ discoverPackages parity on an isolated HOME', () => {
  it('both report zero packages on an empty settings.json', async () => {
    const home = makeHome();
    writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), '{}');
    const out = piList(home);
    expect(out.trim().split('\n').filter((l) => l.startsWith('  '))).toHaveLength(0);

    const fs = await import('../../src/bridge/sessions').then((m) => m.nodeFs);
    const cfg = await loadAgentConfig({ fs, home, cwd: home });
    const r = await discoverPackages({ fs, cfg });
    expect(r.packages).toHaveLength(0);
  });

  it('both list the same local package after a settings entry', async () => {
    const home = makeHome();
    const pkgDir = path.join(home, '.pi', 'agent', 'fixture-pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'pi-fixture-pkg', keywords: ['pi-package'] }));
    writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ packages: ['./fixture-pkg'] }));

    const out = piList(home);
    expect(out).toContain('./fixture-pkg');
    expect(out).toContain(path.join(pkgDir));

    const fs = await import('../../src/bridge/sessions').then((m) => m.nodeFs);
    const cfg = await loadAgentConfig({ fs, home, cwd: home });
    const r = await discoverPackages({ fs, cfg });
    const p = r.packages.find((x) => x.source === './fixture-pkg');
    expect(p).toMatchObject({ kind: 'local', scope: 'user', present: true, path: pkgDir });
  });
});
