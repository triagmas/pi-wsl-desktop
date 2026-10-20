/**
 * T6 — M2 resource manager over a REAL bridge subprocess (NDJSON):
 * inventory read paths, two-phase write boundary with the fixture CLI,
 * secret redaction on the wire, and no-mutation guarantees for inventory.
 * RED first: the M2 handlers did not exist (UNKNOWN / contract failures).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  type ResponseErrorFrameT,
  type ResponseOkFrameT,
} from '../../src/shared/protocol';
import { FrameReader } from '../helpers/frameReader';
import { removeBridgeBundle, spawnBridge } from '../helpers/bridgeFixture';

const FAKE_PI_RPC = path.join(__dirname, '..', 'fixtures', 'fake-pi-rpc');
const FAKE_CLI = path.join(__dirname, '..', 'fixtures', 'fake-resource-cli');
const T0 = new Date('2026-01-01T00:00:00.000Z');

function req(requestId: string, method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'request',
    requestId,
    method,
    ...(params ? { params } : {}),
  });
}

interface Fixture {
  home: string;
  proj: string;
  env: Record<string, string>;
  settingsSha: string;
  mcpSha: string;
}

function makeFixture(): Fixture {
  const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-m2home-'));
  const agent = path.join(home, '.pi', 'agent');
  const proj = mkdtempSync(path.join(os.tmpdir(), 'piwsd-m2proj-'));
  mkdirSync(path.join(agent, 'extra-skill'), { recursive: true });
  mkdirSync(path.join(agent, 'npm', 'node_modules'), { recursive: true });
  mkdirSync(path.join(proj, '.git'), { recursive: true });
  mkdirSync(path.join(proj, '.pi'), { recursive: true });
  mkdirSync(path.join(proj, '.agents', 'skills', 'projskill'), { recursive: true });
  mkdirSync(path.join(home, '.agents', 'skills', 'code-review'), { recursive: true });

  const skillMd = (name: string, desc: string): string => `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`;
  writeFileSync(path.join(home, '.agents', 'skills', 'code-review', 'SKILL.md'), skillMd('code-review', 'review diffs'));
  writeFileSync(path.join(agent, 'extra-skill', 'SKILL.md'), skillMd('extra', 'from settings'));
  writeFileSync(path.join(proj, '.agents', 'skills', 'projskill', 'SKILL.md'), skillMd('projskill', 'project scoped'));

  writeFileSync(path.join(agent, 'settings.json'), JSON.stringify({ packages: [], extensions: ['builtin:codemode'], skills: ['extra-skill'] }, null, 2));
  writeFileSync(path.join(agent, 'trust.json'), JSON.stringify({ [proj]: true }, null, 2));
  writeFileSync(
    path.join(agent, 'mcp.json'),
    JSON.stringify(
      {
        mcpServers: {
          alpha: { type: 'http', url: 'https://alpha.invalid/mcp' },
          boxed: { command: '/usr/bin/boxed', args: ['--serve'], env: { BOX_TOKEN: 'wire-secret-value-77' } },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(agent, 'mcp.log'), '2026-01-01T00:00:00Z [alpha] error alpha: connection refused\n');
  writeFileSync(path.join(proj, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(path.join(proj, '.pi', 'settings.json'), JSON.stringify({ packages: ['npm:projpkg'] }, null, 2));
  writeFileSync(path.join(proj, '.pi', 'mcp.json'), JSON.stringify({ mcpServers: { alpha: { type: 'http', url: 'https://project.invalid/mcp' } } }, null, 2));

  for (const f of [path.join(agent, 'settings.json'), path.join(agent, 'mcp.json')]) utimesSync(f, T0, T0);
  const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

  const env: Record<string, string> = {
    HOME: home,
    PI_WS_DESKTOP_AGENT_HOME: home,
    PI_WS_DESKTOP_AGENT_CWD: proj,
    PI_WS_DESKTOP_RESOURCE_CLI: FAKE_CLI,
    PI_WS_DESKTOP_PI: FAKE_PI_RPC,
  };
  return { home, proj, env, settingsSha: sha(path.join(agent, 'settings.json')), mcpSha: sha(path.join(agent, 'mcp.json')) };
}

const ok = (frame: ResponseOkFrameT): unknown => frame.result;
const errCode = (frame: ResponseErrorFrameT): string => frame.error.code;

afterAll(async () => {
  await removeBridgeBundle();
});

describe('bridge M2 resource manager (real subprocess)', () => {
  it('inventories skills/packages/mcp with provenance and wire-level secret redaction', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');

      child.stdin.write(req('s1', 'listSkills') + '\n');
      const skills = ok((await reader.waitForResponse('s1')).frame as ResponseOkFrameT) as {
        skills: Array<{ name: string; source: string; status: string }>;
      };
      const byName = new Map(skills.skills.map((s) => [s.name, s]));
      expect(byName.get('code-review')).toMatchObject({ source: 'user-agents', status: 'ok' });
      expect(byName.get('extra')).toMatchObject({ source: 'user-settings' });
      expect(byName.get('projskill')).toMatchObject({ source: 'project-agents' });

      child.stdin.write(req('p1', 'listPackages') + '\n');
      const pkgs = ok((await reader.waitForResponse('p1')).frame as ResponseOkFrameT) as {
        packages: Array<{ source: string; scope: string }>;
        builtins: Array<{ name: string; enabled: boolean }>;
        settingsExtensions: string[];
      };
      expect(pkgs.packages.find((p) => p.source === 'npm:projpkg')).toMatchObject({ scope: 'project' });
      expect(pkgs.builtins.find((b) => b.name === 'codemode')).toMatchObject({ enabled: true });
      expect(pkgs.settingsExtensions).toContain('builtin:codemode');

      child.stdin.write(req('m1', 'listMcpServers') + '\n');
      const mcpFrame = (await reader.waitForResponse('m1')).frame as ResponseOkFrameT;
      const wire = JSON.stringify(mcpFrame);
      expect(wire).not.toContain('wire-secret-value-77'); // env VALUES never cross the wire
      const mcp = ok(mcpFrame) as {
        servers: Array<{ name: string; scope: string; hasProjectOverride: boolean; envKeys: string[]; command: string | null }>;
        builtinEnabled: boolean;
        logDiagnostics: string[];
      };
      const alpha = mcp.servers.find((s) => s.name === 'alpha');
      expect(alpha).toMatchObject({ scope: 'project', hasProjectOverride: true });
      expect(mcp.servers.find((s) => s.name === 'boxed')).toMatchObject({ envKeys: ['BOX_TOKEN'] });
      expect(mcp.builtinEnabled).toBe(true);
      expect(mcp.logDiagnostics).toContain('alpha ERROR 1');

      // inventory is read-only: config bytes + mtimes untouched
      const agent = path.join(fx.home, '.pi', 'agent');
      expect(createHash('sha256').update(readFileSync(path.join(agent, 'settings.json'))).digest('hex')).toBe(fx.settingsSha);
      expect(createHash('sha256').update(readFileSync(path.join(agent, 'mcp.json'))).digest('hex')).toBe(fx.mcpSha);
    } finally {
      child.kill();
    }
  });

  it('two-phase write: preview (redacted, no side effects) → confirm → rollback', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');

      child.stdin.write(req('pv1', 'previewResourceOp', { kind: 'mcp-add', source: 'newbox', url: 'https://new.invalid/mcp', env: { NEW_TOKEN: 'op-secret-value-99' } }) + '\n');
      const pvFrame = (await reader.waitForResponse('pv1')).frame as ResponseOkFrameT;
      expect(JSON.stringify(pvFrame)).not.toContain('op-secret-value-99'); // redaction on the wire
      const pv = ok(pvFrame) as { plan: { planId: string; command: string[]; commandRedacted: boolean; filesTouched: string[]; backupId: string | null } };
      expect(pv.plan.commandRedacted).toBe(true);
      expect(pv.plan.command.join(' ')).toMatch(/NEW_TOKEN=\*\*\*/);
      expect(pv.plan.command[0]).toBe('pi');
      // preview never touched config
      const agent = path.join(fx.home, '.pi', 'agent');
      expect(createHash('sha256').update(readFileSync(path.join(agent, 'mcp.json'))).digest('hex')).toBe(fx.mcpSha);

      // apply WITHOUT literal confirm → contract rejection
      child.stdin.write(req('ap0', 'applyResourceOp', { planId: pv.plan.planId, confirm: false }) + '\n');
      expect(errCode((await reader.waitForResponse('ap0')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');

      child.stdin.write(req('ap1', 'applyResourceOp', { planId: pv.plan.planId, confirm: true }) + '\n');
      const applied = ok((await reader.waitForResponse('ap1')).frame as ResponseOkFrameT) as {
        ok: boolean;
        verified: boolean;
        backupId: string | null;
        output: string;
      };
      expect(applied).toMatchObject({ ok: true, verified: true });
      expect(applied.backupId).toBeTruthy();
      expect(JSON.stringify(applied)).not.toContain('op-secret-value-99'); // even CLI output stays redacted
      expect(createHash('sha256').update(readFileSync(path.join(agent, 'mcp.json'))).digest('hex')).not.toBe(fx.mcpSha);

      // single-use plan: replaying the same planId fails closed
      child.stdin.write(req('ap2', 'applyResourceOp', { planId: pv.plan.planId, confirm: true }) + '\n');
      expect(errCode((await reader.waitForResponse('ap2')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');

      child.stdin.write(req('rb1', 'rollbackResourceOp', { opId: pv.plan.planId, confirm: true }) + '\n');
      const rolled = ok((await reader.waitForResponse('rb1')).frame as ResponseOkFrameT) as { ok: boolean; restored: string[] };
      expect(rolled.ok).toBe(true);
      expect(rolled.restored).toHaveLength(1);
      expect(createHash('sha256').update(readFileSync(path.join(agent, 'mcp.json'))).digest('hex')).toBe(fx.mcpSha);
    } finally {
      child.kill();
    }
  });
});

afterAll(() => {
  for (const d of []) rmSync(d, { force: true });
});
