/**
 * RED gate T5 — M2 two-phase resource operations (Issue #7 write boundary).
 * RED first: `src/bridge/resources/ops.ts` does not exist.
 *
 * Invariants under test: preview is side-effect free; apply REQUIRES a live
 * plan (literal confirm is contract-pinned); secrets accepted on the request
 * are used verbatim by the CLI but never appear in any response; every write
 * is preceded by a backup that rollback restores byte-for-byte; nothing runs
 * unbounded (spawn timeout) — and no plan/apply happens without both phases.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/shared/errors';
import { ResourceOps, type SpawnResult } from '../../src/bridge/resources/ops';

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

interface Harness {
  ops: ResourceOps;
  calls: Array<{ argv: string[] }>;
  setSpawn: (fn: (argv: string[]) => SpawnResult | Promise<SpawnResult>) => void;
}

function harness(setup?: (home: string) => void): Harness {
  const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-ops-'));
  homes.push(home);
  mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ packages: [] }));
  setup?.(home);
  const calls: Array<{ argv: string[] }> = [];
  let behavior: (argv: string[]) => SpawnResult | Promise<SpawnResult> = (argv) => {
    // emulate `pi install`: append the source to settings.packages
    if (argv[0] === 'install') {
      const f = path.join(home, '.pi', 'agent', 'settings.json');
      const s = JSON.parse(readFileSync(f, 'utf8')) as { packages: string[] };
      s.packages.push(argv[1] ?? '');
      writeFileSync(f, JSON.stringify(s));
    }
    if (argv[0] === 'mcp' && argv[1] === 'add') {
      const f = path.join(home, '.pi', 'agent', 'mcp.json');
      const cur = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>) : {};
      const servers = (cur.mcpServers ?? {}) as Record<string, unknown>;
      servers[argv[2] ?? ''] = { url: 'https://placeholder' };
      writeFileSync(f, JSON.stringify({ mcpServers: servers }));
    }
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const ops = new ResourceOps({
    home,
    agentDir: path.join(home, '.pi', 'agent'),
    now: () => Date.now(),
    spawnFn: async (argv) => {
      calls.push({ argv });
      return behavior(argv);
    },
  });
  return { ops, calls, setSpawn: (fn) => (behavior = fn) };
}

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('ResourceOps — preview (side-effect free, redacted, backed up)', () => {
  it('previews a package install: argv, touched files, backup of settings, expiry', async () => {
    const h = harness();
    const settingsPath = path.join(h.ops.agentDir, 'settings.json');
    const before = sha(settingsPath);
    const { plan } = await h.ops.preview({ kind: 'package-install', source: 'npm:demo-pkg' });
    expect(plan.command.slice(0, 2)).toEqual(['pi', 'install']);
    expect(plan.command).toContain('npm:demo-pkg');
    expect(plan.filesTouched).toEqual([settingsPath]);
    expect(plan.backupId).toBeTruthy();
    expect(plan.expiresAt).toBeGreaterThan(Date.now());
    expect(h.calls).toHaveLength(0); // preview never spawns
    expect(sha(settingsPath)).toBe(before); // preview never writes
    expect(existsSync(path.join(h.ops.agentDir, 'pi-ws-desktop-backups'))).toBe(true); // backup materialized for rollback id
  });

  it('mcp-add plan MASKS secret env values in every response field', async () => {
    const h = harness();
    const { plan } = await h.ops.preview({
      kind: 'mcp-add',
      source: 'secretbox',
      url: 'https://example.invalid/mcp',
      env: { BOX_TOKEN: 'super-secret-value-42' },
    });
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain('super-secret-value-42');
    expect(plan.commandRedacted).toBe(true);
    expect(plan.command).toContain('--env');
    expect(plan.command.join(' ')).toMatch(/BOX_TOKEN=\*\*\*/);
    expect(h.calls).toHaveLength(0);
  });
});

describe('ResourceOps — apply (live plan required, backup, redacted output, verify)', () => {
  it('applies a plan: spawns the real argv, keeps secrets only in argv, verifies', async () => {
    const h = harness();
    const settingsPath = path.join(h.ops.agentDir, 'settings.json');
    const before = sha(settingsPath);
    const { plan } = await h.ops.preview({ kind: 'package-install', source: 'npm:demo-pkg' });
    const result = await h.ops.apply(plan.planId, true);
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(h.calls[0]?.argv).toEqual(['install', 'npm:demo-pkg']); // REAL argv for the CLI
    expect(sha(settingsPath)).not.toBe(before);
    expect(result.backupId).toBeTruthy();
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { packages: string[] };
    expect(settings.packages).toContain('npm:demo-pkg');
  });

  it('rejects unknown or expired plans fail-closed', async () => {
    const h = harness();
    await expect(h.ops.apply('no-such-plan', true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const { plan } = await h.ops.preview({ kind: 'package-remove', source: 'npm:demo-pkg' });
    await expect(h.ops.apply(plan.planId, false as unknown as true)).rejects.toBeInstanceOf(BridgeError); // belt & braces
    await h.ops.expire(plan.planId); // test hook: force TTL
    await expect(h.ops.apply(plan.planId, true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('failed CLI run: ok=false, output redacted, settings untouched, backup usable', async () => {
    const h = harness();
    const settingsPath = path.join(h.ops.agentDir, 'settings.json');
    const before = sha(settingsPath);
    h.setSpawn(() => ({ code: 1, stdout: '', stderr: 'boom token=leaky-secret-99' }));
    const { plan } = await h.ops.preview({ kind: 'package-install', source: 'npm:demo-pkg' });
    const result = await h.ops.apply(plan.planId, true);
    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(JSON.stringify(result)).not.toContain('leaky-secret-99');
    expect(sha(settingsPath)).toBe(before);
    expect(result.backupId).toBeTruthy();
  });

  it('redacts known env VALUES from CLI output even when they leak into stdout', async () => {
    const h = harness();
    h.setSpawn(() => ({ code: 0, stdout: 'echoing BOX_TOKEN=super-secret-value-42 done', stderr: '' }));
    const { plan } = await h.ops.preview({
      kind: 'mcp-add',
      source: 'box',
      url: 'https://example.invalid/mcp',
      env: { BOX_TOKEN: 'super-secret-value-42' },
    });
    const result = await h.ops.apply(plan.planId, true);
    expect(result.output).not.toContain('super-secret-value-42');
    expect(result.output).toContain('***');
  });
});

describe('ResourceOps — rollback restores bytes', () => {
  it('restores the pre-op settings.json exactly', async () => {
    const h = harness();
    const settingsPath = path.join(h.ops.agentDir, 'settings.json');
    const before = sha(settingsPath);
    const { plan } = await h.ops.preview({ kind: 'package-install', source: 'npm:demo-pkg' });
    const applied = await h.ops.apply(plan.planId, true);
    expect(sha(settingsPath)).not.toBe(before);
    const rolled = await h.ops.rollback(applied.opId, true);
    expect(rolled.ok).toBe(true);
    expect(rolled.restored).toEqual([settingsPath]);
    expect(sha(settingsPath)).toBe(before);
    await expect(h.ops.rollback('ghost', true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
