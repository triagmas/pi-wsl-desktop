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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  calls: Array<{ argv: string[]; cwd?: string }>;
  setSpawn: (fn: (argv: string[], opts?: { cwd?: string }) => SpawnResult | Promise<SpawnResult>) => void;
}

function harness(setup?: (home: string) => void, extraDeps: Record<string, unknown> = {}): Harness {
  const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-ops-'));
  homes.push(home);
  mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ packages: [] }));
  setup?.(home);
  const calls: Array<{ argv: string[]; cwd?: string }> = [];
  let behavior: (argv: string[], opts?: { cwd?: string }) => SpawnResult | Promise<SpawnResult> = (argv) => {
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
    spawnFn: async (argv, opts) => {
      calls.push({ argv, cwd: opts?.cwd });
      return behavior(argv, opts);
    },
    ...extraDeps,
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
      command: ['/usr/bin/box'],
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
      command: ['/usr/bin/box'],
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

describe('ResourceOps — skill-set (documented settings edit, no CLI exists)', () => {
  it('disables a skill via the -path exclusion, verifies, and rolls back byte-for-byte', async () => {
    const h = harness((home) => {
      writeFileSync(
        path.join(home, '.pi', 'agent', 'settings.json'),
        JSON.stringify({ skills: ['extra-skill'] }, null, 2),
      );
    });
    const settingsPath = path.join(h.ops.agentDir, 'settings.json');
    const before = sha(settingsPath);
    const skillDir = '/home/u/.agents/skills/code-review';

    const { plan } = await h.ops.preview({ kind: 'skill-set', source: skillDir, disable: true });
    expect(plan.filesTouched).toEqual([settingsPath]);
    expect(plan.backupId).toBeTruthy();
    expect(h.calls).toHaveLength(0); // NO CLI spawned for settings edits
    expect(sha(settingsPath)).toBe(before); // preview side-effect free

    const applied = await h.ops.apply(plan.planId, true);
    expect(applied).toMatchObject({ ok: true, verified: true });
    expect(h.calls).toHaveLength(0);
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as { skills: string[] };
    expect(after.skills).toContain(`-${skillDir}`);

    const rolled = await h.ops.rollback(applied.opId, true);
    expect(rolled.ok).toBe(true);
    expect(sha(settingsPath)).toBe(before);
  });

  it('re-enables by removing only the exclusion entry', async () => {
    const h = harness((home) => {
      writeFileSync(
        path.join(home, '.pi', 'agent', 'settings.json'),
        JSON.stringify({ skills: ['keep-me', '-/gone/skill'], other: 1 }, null, 2),
      );
    });
    const settingsPath = path.join(h.ops.agentDir, 'settings.json');
    const { plan } = await h.ops.preview({ kind: 'skill-set', source: '/gone/skill', disable: false });
    const applied = await h.ops.apply(plan.planId, true);
    expect(applied.verified).toBe(true);
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as { skills: string[]; other: number };
    expect(after.skills).toEqual(['keep-me']); // exclusion gone, others intact
    expect(after.other).toBe(1); // unrelated keys untouched
  });

  it('project-local writes fail closed when the project is untrusted', async () => {
    const h = harness(); // no projectPiDir configured (untrusted)
    await expect(h.ops.preview({ kind: 'package-install', source: 'npm:x', local: true })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(h.ops.preview({ kind: 'skill-set', source: '/x/s', local: true })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe('ResourceOps — review round 1 fixes (BLOCKER #1, IMPORTANT #2/#3/#5, MINOR a/b)', () => {
  it('[BLOCKER#1] stdio+env puts every --env BEFORE the `--` separator', async () => {
    const h = harness();
    const { plan } = await h.ops.preview({
      kind: 'mcp-add',
      source: 'stdio-box',
      command: ['/usr/bin/box', '--serve'],
      env: { BOX_TOKEN: 'env-value-secret' },
    });
    await h.ops.apply(plan.planId, true);
    expect(h.calls[0]?.argv).toEqual(['mcp', 'add', 'stdio-box', '--env', 'BOX_TOKEN=env-value-secret', '--', '/usr/bin/box', '--serve']);
    // and the display plan masks it
    expect(plan.command.join(' ')).toMatch(/BOX_TOKEN=\*\*\*/);
    expect(JSON.stringify(plan)).not.toContain('env-value-secret');
  });

  it('[BLOCKER#1] env with a URL endpoint is rejected (env is stdio-only)', async () => {
    const h = harness();
    await expect(
      h.ops.preview({ kind: 'mcp-add', source: 'httpbox', url: 'https://x.invalid/mcp', env: { K: 'v' } }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('[IMPORTANT#5] package-update NEVER appends -l (not a documented update option)', async () => {
    const projectPi = path.join(mkdtempSync(path.join(os.tmpdir(), 'piwsd-projpi-')), '.pi');
    const h = harness(undefined, { projectPiDir: projectPi });
    const { plan } = await h.ops.preview({ kind: 'package-update', source: 'git:github.com/o/r@v1', local: true });
    await h.ops.apply(plan.planId, true);
    expect(h.calls[0]?.argv).toEqual(['update', 'git:github.com/o/r@v1']);
    expect(plan.command).not.toContain('-l');
  });

  it('[IMPORTANT#2] project-local sources resolve from the project .pi directory (docs/inventory parity)', async () => {
    const projectPi = path.join(mkdtempSync(path.join(os.tmpdir(), 'piwsd-projpi-')), '.pi');
    const h = harness(undefined, { projectPiDir: projectPi });
    const { plan } = await h.ops.preview({ kind: 'package-install', source: './local-tool', local: true });
    await h.ops.apply(plan.planId, true);
    expect(plan.command.join(' ')).toContain(path.join(projectPi, 'local-tool'));
    expect(plan.filesTouched).toEqual([path.join(projectPi, 'settings.json')]);
  });

  it('[IMPORTANT#3] a file created between preview and apply survives rollback (no data loss)', async () => {
    const h = harness();
    const mcpPath = path.join(h.ops.agentDir, 'mcp.json');
    const { plan } = await h.ops.preview({ kind: 'mcp-add', source: 'late', url: 'https://late.invalid/mcp' });
    expect(plan.backupId).toBeNull(); // file did not exist at preview time
    // the user runs `pi mcp add` themselves in a terminal during the TTL
    const userBytes = JSON.stringify({ mcpServers: { userbox: { type: 'http', url: 'https://user.invalid/mcp' } } }, null, 2);
    writeFileSync(mcpPath, userBytes);
    const applied = await h.ops.apply(plan.planId, true);
    expect(applied.ok).toBe(true);
    const rolled = await h.ops.rollback(applied.opId, true);
    expect(rolled.ok).toBe(true);
    // the user's own file must be RESTORED, not deleted
    expect(readFileSync(mcpPath, 'utf8')).toBe(userBytes);
  });

  it('[MINOR a] env values of ANY length are masked in display argv and output', async () => {
    const h = harness();
    h.setSpawn(() => ({ code: 0, stdout: 'leak q1 here', stderr: '' }));
    const p = await h.ops.preview({ kind: 'mcp-add', source: 's2', command: ['/bin/true'], env: { SHORT: 'q1' } });
    expect(p.plan.command.join(' ')).toMatch(/SHORT=\*\*\*/);
    expect(JSON.stringify(p.plan)).not.toContain('q1');
    const r = await h.ops.apply(p.plan.planId, true);
    expect(r.output).not.toContain('q1');
  });

  it('[MINOR b] two previews in the same millisecond never overwrite each other\'s backup', async () => {
    const h = harness(undefined, { now: () => 1_700_000_000_000 }); // identical stamps force the collision
    const a = await h.ops.preview({ kind: 'package-remove', source: 'npm:x' });
    const b = await h.ops.preview({ kind: 'package-remove', source: 'npm:x' });
    expect(a.plan.backupId).not.toBeNull();
    expect(a.plan.backupId).not.toBe(b.plan.backupId);
  });
});

describe('ResourceOps — round 2 (N2 cwd, N3 branches, N5 sweep/cap, N6 unlink snapshot, N8 pseudo-argv)', () => {
  it('[N2] local ops spawn the CLI with cwd = project root (backup/verify/rollback agree with the real write)', async () => {
    const projDir = mkdtempSync(path.join(os.tmpdir(), 'piwsd-cwd-'));
    const projectPi = path.join(projDir, '.pi');
    const calls2: Array<{ argv: string[]; cwd?: string }> = [];
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-cwdhome-'));
    homes.push(home);
    mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ packages: [] }));
    const ops = new ResourceOps({
      home,
      agentDir: path.join(home, '.pi', 'agent'),
      projectPiDir: projectPi,
      now: () => Date.now(),
      spawnFn: async (argv, opts) => {
        calls2.push({ argv, cwd: opts?.cwd });
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const { plan } = await ops.preview({ kind: 'package-install', source: './tool', local: true });
    expect(plan.filesTouched).toEqual([path.join(projectPi, 'settings.json')]);
    await ops.apply(plan.planId, true);
    expect(calls2[0]?.cwd).toBe(projDir); // process-cwd pinned to the project root
    // user-scope ops stay cwd-independent
    const { plan: p2 } = await ops.preview({ kind: 'package-install', source: 'npm:x' });
    await ops.apply(p2.planId, true);
    expect(calls2[1]?.cwd).toBeUndefined();
  });

  it('[N3a] a file deleted after preview keeps its preview-era backup restorable', async () => {
    const h = harness();
    const mcpPath = path.join(h.ops.agentDir, 'mcp.json');
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }));
    const beforeSha = sha(mcpPath);
    const { plan } = await h.ops.preview({ kind: 'mcp-add', source: 'keepme', url: 'https://k.invalid/mcp' });
    expect(plan.backupId).toBeTruthy();
    rmSync(mcpPath); // file vanishes before apply
    const applied = await h.ops.apply(plan.planId, true);
    expect(applied.ok).toBe(true); // CLI recreates it (harness behavior writes mcp.json)
    await h.ops.rollback(applied.opId, true);
    expect(sha(mcpPath)).toBe(beforeSha); // restored from the kept preview backup
  });

  it('[N3b] a failing backup refresh never nulls an existing preview-era backup', async () => {
    const h = harness();
    const mcpPath = path.join(h.ops.agentDir, 'mcp.json');
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }));
    const beforeSha = sha(mcpPath);
    const { plan } = await h.ops.preview({ kind: 'mcp-add', source: 'eac', url: 'https://e.invalid/mcp' });
    expect(plan.backupId).toBeTruthy();
    // make the REFRESH copy fail transiently: the backup destination dir is
    // removed (POSIX-only: directory rename), source file intact
    const backupsDir = path.join(h.ops.agentDir, 'pi-ws-desktop-backups');
    const moved = `${backupsDir}-moved`;
    renameSync(backupsDir, moved);
    const applied = await h.ops.apply(plan.planId, true);
    renameSync(moved, backupsDir); // restore layout before rollback
    expect(applied.ok).toBe(true);
    const rolled = await h.ops.rollback(applied.opId, true);
    expect(rolled.ok).toBe(true);
    expect(sha(mcpPath)).toBe(beforeSha); // the preview-era backup survived the transient failure
  });

  it('[N5] expired plans are swept and the applied ledger is bounded', async () => {
    let clock = 1_700_000_000_000;
    const h = harness(undefined, { now: () => clock, appliedCap: 2 });
    await h.ops.preview({ kind: 'package-install', source: 'npm:a' });
    expect(h.ops.stats().plans).toBe(1);
    clock += 6 * 60_000; // past TTL
    await h.ops.preview({ kind: 'package-install', source: 'npm:b' });
    expect(h.ops.stats().plans).toBe(1); // expired plan swept (secrets released)
    // applied ledger cap: third apply drops the oldest record
    const { plan: p1 } = await h.ops.preview({ kind: 'package-install', source: 'npm:c' });
    const a1 = await h.ops.apply(p1.planId, true);
    const { plan: p2 } = await h.ops.preview({ kind: 'package-install', source: 'npm:d' });
    await h.ops.apply(p2.planId, true);
    const { plan: p3 } = await h.ops.preview({ kind: 'package-install', source: 'npm:e' });
    await h.ops.apply(p3.planId, true);
    expect(h.ops.stats().applied).toBe(2);
    await expect(h.ops.rollback(a1.opId, true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('[N6] rollback unlink first PRESERVES concurrent bytes as a pre-unlink snapshot', async () => {
    const h = harness();
    const mcpPath = path.join(h.ops.agentDir, 'mcp.json');
    const { plan } = await h.ops.preview({ kind: 'mcp-add', source: 'race', url: 'https://r.invalid/mcp' });
    expect(plan.backupId).toBeNull(); // absent at preview
    const concurrent = JSON.stringify({ mcpServers: { userbox: { type: 'http', url: 'https://u.invalid/mcp' } } }, null, 2);
    h.setSpawn((argv) => {
      // a rival CLI creates the file DURING our apply (after the refresh check)
      if (argv[0] === 'mcp') writeFileSync(mcpPath, concurrent);
      return { code: 0, stdout: '', stderr: '' };
    });
    const applied = await h.ops.apply(plan.planId, true);
    expect(applied.ok).toBe(true);
    await h.ops.rollback(applied.opId, true);
    expect(existsSync(mcpPath)).toBe(false); // op-created file removed…
    const backups = readdirSync(path.join(h.ops.agentDir, 'pi-ws-desktop-backups'));
    const kept = backups.find((b) => b.includes('preunlink'));
    expect(kept).toBeTruthy(); // …but the concurrent bytes are preserved losslessly
    expect(readFileSync(path.join(h.ops.agentDir, 'pi-ws-desktop-backups', kept as string), 'utf8')).toBe(concurrent);
  });

  it('[N8] the skill-set plan command honestly states that no process is spawned', async () => {
    const h = harness();
    const { plan } = await h.ops.preview({ kind: 'skill-set', source: '/x/s', disable: true });
    expect(plan.command[0]).toBe('(file edit — no process spawned)');
    expect(plan.command.join(' ')).not.toMatch(/^pi /);
  });
});

describe('ResourceOps — round 3 (NEW-2 sweep, NEW-3 fail-closed unlink, skill-set enable matching)', () => {
  it('[NEW-2] expired plans with secrets are swept by stats() even with no further previews', async () => {
    let clock = 1_700_000_000_000;
    const h = harness(undefined, { now: () => clock });
    await h.ops.preview({ kind: 'mcp-add', source: 'lazy', command: ['/bin/true'], env: { S: 'lingering-secret' } });
    expect(h.ops.stats().plans).toBe(1);
    clock += 6 * 60_000; // TTL passes; the bridge stays IDLE (no new preview)
    const after = h.ops.stats();
    expect(after.plans).toBe(0); // secrets released without another preview call
  });

  it('[NEW-3] rollback refuses to unlink when the preunlink snapshot cannot be taken', async () => {
    const h = harness();
    const mcpPath = path.join(h.ops.agentDir, 'mcp.json');
    const { plan } = await h.ops.preview({ kind: 'mcp-add', source: 'keepconcurrent', url: 'https://k.invalid/mcp' });
    expect(plan.backupId).toBeNull();
    const concurrent = JSON.stringify({ mcpServers: { rival: { type: 'http', url: 'https://r.invalid/mcp' } } }, null, 2);
    h.setSpawn((argv) => {
      if (argv[0] === 'mcp') writeFileSync(mcpPath, concurrent); // rival writes during our apply
      return { code: 0, stdout: '', stderr: '' };
    });
    const applied = await h.ops.apply(plan.planId, true);
    // BLOCK the backup area with a plain file so mkdir/copyFile must fail
    // (deleting it would let mkdir(recursive) resurrect it — not a real failure)
    const backupsPath = path.join(h.ops.agentDir, 'pi-ws-desktop-backups');
    rmSync(backupsPath, { recursive: true, force: true });
    writeFileSync(backupsPath, 'blocked');
    const rolled = await h.ops.rollback(applied.opId, true);
    // fail-closed: bytes exist but could not be preserved → DO NOT delete
    expect(existsSync(mcpPath)).toBe(true);
    expect(readFileSync(mcpPath, 'utf8')).toBe(concurrent);
    expect(rolled.ok).toBe(false); // honest signal: nothing was restored
  });

  it('[skill-set] enable matches exclusion entries in ANY spelling (-~, relative)', async () => {
    const home2 = mkdtempSync(path.join(os.tmpdir(), 'piwsd-skallen-'));
    homes.push(home2);
    const agent = path.join(home2, '.pi', 'agent');
    mkdirSync(agent, { recursive: true });
    const skillDir = path.join(home2, '.agents', 'skills', 'code-review');
    writeFileSync(
      path.join(agent, 'settings.json'),
      JSON.stringify({ skills: [`-~/.agents/skills/code-review`, 'keep'] }, null, 2),
    );
    const ops = new ResourceOps({ home: home2, agentDir: agent, now: () => Date.now(), spawnFn: async () => ({ code: 0, stdout: '', stderr: '' }) });
    const { plan } = await ops.preview({ kind: 'skill-set', source: skillDir, disable: false });
    const applied = await ops.apply(plan.planId, true);
    expect(applied).toMatchObject({ ok: true, verified: true });
    const after = JSON.parse(readFileSync(path.join(agent, 'settings.json'), 'utf8')) as { skills: string[] };
    expect(after.skills).toEqual(['keep']); // the -~ spelling is REMOVED, not just -<abs>
  });
});
