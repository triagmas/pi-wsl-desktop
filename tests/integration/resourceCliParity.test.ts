/**
 * T3 CLI parity (Issue #7): the inventory must agree with the INSTALLED Pi's
 * own `pi list` on the SAME isolated HOME (read-only CLI, no model calls).
 * Skips honestly when the pi CLI is unavailable (e.g. stock CI runners).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe.skipIf(!HAS_PI)('ResourceOps write parity — REAL `pi install/remove` on an isolated HOME', () => {
  it('preview → apply (real CLI) → verified → rollback restores bytes', async () => {
    const { ResourceOps } = await import('../../src/bridge/resources/ops');
    const { createHash } = await import('node:crypto');
    const home = makeHome();
    const agentDir = path.join(home, '.pi', 'agent');
    const pkgDir = path.join(agentDir, 'fixture-pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'pi-fixture-pkg', keywords: ['pi-package'] }));
    const settingsPath = path.join(agentDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ packages: [] }));
    const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
    const before = sha(settingsPath);

    const ops = new ResourceOps({ home, agentDir });
    const { plan } = await ops.preview({ kind: 'package-install', source: './fixture-pkg' });
    const applied = await ops.apply(plan.planId, true);
    expect(applied.ok).toBe(true);
    expect(applied.verified).toBe(true); // REAL pi wrote settings and listed the package
    expect(piList(home)).toContain('fixture-pkg'); // REAL pi stores the absolutized local source
    expect(sha(settingsPath)).not.toBe(before);

    const rolled = await ops.rollback(applied.opId, true);
    expect(rolled.ok).toBe(true);
    expect(sha(settingsPath)).toBe(before);
    expect(piList(home)).not.toContain('fixture-pkg');
  }, 90_000);
});

describe.skipIf(!HAS_PI)('mcp-add parity — REAL `pi mcp add` stores --env under env, never in args', () => {
  it('real CLI + our argv: env value lands in mcp.json.env, args stay clean, rollback restores', async () => {
    const { ResourceOps } = await import('../../src/bridge/resources/ops');
    const { createHash } = await import('node:crypto');
    const home = makeHome();
    const agentDir = path.join(home, '.pi', 'agent');
    const mcpPath = path.join(agentDir, 'mcp.json');
    const SECRET = 'real-cli-env-secret-918';
    const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }, null, 2));
    const before = sha(mcpPath);

    const ops = new ResourceOps({ home, agentDir });
    const { plan } = await ops.preview({
      kind: 'mcp-add',
      source: 'stdio-parity',
      command: ['/usr/bin/env', 'true'], // stdio-shaped; real pi only stores config here (NO connect)
      env: { PARITY_TOKEN: SECRET },
    });
    const applied = await ops.apply(plan.planId, true);
    expect(applied.ok).toBe(true);
    expect(applied.verified).toBe(true);

    const cfg = JSON.parse(readFileSync(mcpPath, 'utf8')) as { mcpServers: Record<string, { args?: string[]; env?: Record<string, string> }> };
    const server = cfg.mcpServers['stdio-parity'];
    expect(server).toBeTruthy();
    // [BLOCKER r1] the real CLI semantics we depend on: env under `env`,
    // `--env KEY=VALUE` never becomes part of `args`.
    expect(server?.env?.PARITY_TOKEN).toBe(SECRET);
    expect((server?.args ?? []).join(' ')).not.toContain('PARITY_TOKEN=');
    expect(JSON.stringify(server)).not.toContain('--env');

    const rolled = await ops.rollback(applied.opId, true);
    expect(rolled.ok).toBe(true);
    expect(sha(mcpPath)).toBe(before);
    expect(readFileSync(mcpPath, 'utf8')).not.toContain('stdio-parity');
  }, 90_000);
});
