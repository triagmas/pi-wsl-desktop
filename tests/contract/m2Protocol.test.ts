/**
 * RED gate T1 — M2 Pi Resource Manager contract (Issue #7).
 * Zod schemas for skills/packages/MCP inventory and the two-phase
 * write-op protocol. RED first: `src/shared/m2Protocol.ts` does not exist.
 */
import { describe, expect, it } from 'vitest';
import { ALL_METHODS, M2_METHODS } from '../../src/shared/codes';
import {
  ApplyResourceOpParamsSchema,
  ListMcpServersResultSchema,
  ListPackagesResultSchema,
  ListSkillsResultSchema,
  PreviewResourceOpParamsSchema,
  ResourceOpPlanSchema,
  RollbackResourceOpParamsSchema,
} from '../../src/shared/m2Protocol';

const skill = {
  name: 'code-review',
  dir: '/home/u/.agents/skills/code-review',
  source: 'user-agents',
  package: null,
  description: 'Review diffs',
  status: 'ok',
  disableModelInvocation: false,
  diagnostics: [],
};

const pkg = {
  source: 'npm:pi-subagents',
  kind: 'npm',
  scope: 'user',
  path: '/home/u/.pi/agent/npm/node_modules/pi-subagents',
  present: true,
  declaredRef: null,
  diagnostics: [],
};

const builtin = { name: 'mcp', enabled: true };
const mcpServer = {
  name: 'context7',
  scope: 'user',
  transport: 'http',
  command: null,
  args: ['https://mcp.context7.com/mcp'],
  envKeys: [],
  hasProjectOverride: false,
  oauthConfigured: false,
  enabled: true,
  diagnostics: [],
};

describe('m2Protocol — inventory contracts', () => {
  it('accepts a skills inventory result', () => {
    const r = ListSkillsResultSchema.parse({ skills: [skill], diagnostics: [] });
    expect(r.skills[0]?.name).toBe('code-review');
  });

  it('rejects junk skills (missing name / bad source / bad status)', () => {
    expect(ListSkillsResultSchema.safeParse({ skills: [{ ...skill, name: '' }], diagnostics: [] }).success).toBe(false);
    expect(ListSkillsResultSchema.safeParse({ skills: [{ ...skill, source: 'elsewhere' }], diagnostics: [] }).success).toBe(false);
    expect(ListSkillsResultSchema.safeParse({ skills: [{ ...skill, status: 'mystery' }], diagnostics: [] }).success).toBe(false);
  });

  it('accepts packages + builtins and rejects junk', () => {
    expect(
      ListPackagesResultSchema.safeParse({
        packages: [pkg],
        builtins: [builtin],
        settingsExtensions: ['/x/ext.ts'],
        diagnostics: [],
      }).success,
    ).toBe(true);
    expect(
      ListPackagesResultSchema.safeParse({ packages: [{ ...pkg, kind: 'wheel' }], builtins: [], settingsExtensions: [], diagnostics: [] })
        .success,
    ).toBe(false);
  });

  it('accepts MCP inventory with env KEYS only and rejects junk transports', () => {
    expect(
      ListMcpServersResultSchema.safeParse({
        servers: [mcpServer],
        builtinEnabled: true,
        logDiagnostics: ['context7 ERROR 1'],
        diagnostics: [],
      }).success,
    ).toBe(true);
    expect(
      ListMcpServersResultSchema.safeParse({
        servers: [{ ...mcpServer, transport: 'carrier-pigeon' }],
        builtinEnabled: true,
        logDiagnostics: [],
        diagnostics: [],
      }).success,
    ).toBe(false);
  });
});

describe('m2Protocol — two-phase write ops', () => {
  it('previews a package install plan (CLI argv, files, expiry)', () => {
    const p = PreviewResourceOpParamsSchema.parse({ kind: 'package-install', source: 'npm:pi-x' });
    expect(p.kind).toBe('package-install');
    const plan = ResourceOpPlanSchema.parse({
      planId: 'op-1',
      kind: 'package-install',
      description: 'pi install npm:pi-x',
      command: ['pi', 'install', 'npm:pi-x'],
      commandRedacted: false,
      filesTouched: ['/home/u/.pi/agent/settings.json'],
      backupId: 'b-1',
      expiresAt: Date.now() + 60_000,
    });
    expect(plan.command[0]).toBe('pi');
  });

  it('plan schema carries no place for raw secret values (env keys travel only on request)', () => {
    expect(Object.keys(ResourceOpPlanSchema.shape)).not.toContain('env');
    expect(Object.keys(ResourceOpPlanSchema.shape)).not.toContain('envKeys');
  });

  it('apply/rollback REQUIRE confirm: true (literal, not truthy)', () => {
    expect(ApplyResourceOpParamsSchema.safeParse({ planId: 'op-1', confirm: true }).success).toBe(true);
    expect(ApplyResourceOpParamsSchema.safeParse({ planId: 'op-1', confirm: 'yes' }).success).toBe(false);
    expect(ApplyResourceOpParamsSchema.safeParse({ planId: 'op-1' }).success).toBe(false);
    expect(RollbackResourceOpParamsSchema.safeParse({ opId: 'op-1' }).success).toBe(false);
    expect(RollbackResourceOpParamsSchema.safeParse({ opId: 'op-1', confirm: true }).success).toBe(true);
  });

  it('rejects previews for unknown op kinds or empty source', () => {
    expect(PreviewResourceOpParamsSchema.safeParse({ kind: 'rm-rf', source: 'x' }).success).toBe(false);
    expect(PreviewResourceOpParamsSchema.safeParse({ kind: 'package-install', source: '' }).success).toBe(false);
  });
});

describe('m2Protocol — whitelist integration', () => {
  it('exposes exactly the six M2 methods and ALL_METHODS includes them', () => {
    expect(M2_METHODS).toHaveLength(6);
    for (const m of M2_METHODS) expect(ALL_METHODS as readonly string[]).toContain(m);
  });
});

describe('m2Protocol — skill disable/enable op (DoD: отключение скиллов)', () => {
  it('accepts the skill-set kind with an explicit disable flag', async () => {
    const m2 = await import('../../src/shared/m2Protocol');
    expect(m2.ResourceOpKindSchema.safeParse('skill-set').success).toBe(true);
    const p = m2.PreviewResourceOpParamsSchema.safeParse({
      kind: 'skill-set',
      source: '/home/u/.agents/skills/code-review',
      disable: true,
    });
    expect(p.success).toBe(true);
    // no flag → default enable-restore path still previews
    expect(m2.PreviewResourceOpParamsSchema.safeParse({ kind: 'skill-set', source: '/x/s' }).success).toBe(true);
    // unknown flags stay rejected (strict schema)
    expect(m2.PreviewResourceOpParamsSchema.safeParse({ kind: 'skill-set', source: '/x/s', extra: 1 }).success).toBe(false);
  });

  it('keeps apply/rollback literal-confirm semantics for skill-set', async () => {
    const m2 = await import('../../src/shared/m2Protocol');
    expect(m2.ApplyResourceOpParamsSchema.safeParse({ planId: 'p', confirm: true }).success).toBe(true);
    expect(m2.ApplyResourceOpParamsSchema.safeParse({ planId: 'p', confirm: 0 }).success).toBe(false);
  });
});

describe('m2Protocol — mcp-add shape validation (round 2, N4)', () => {
  const mcpAdd = (extra: Record<string, unknown>): boolean =>
    PreviewResourceOpParamsSchema.safeParse({ kind: 'mcp-add', source: 's', ...extra }).success;

  it('requires exactly one of --command or --url', () => {
    expect(mcpAdd({ command: ['/bin/true'] })).toBe(true);
    expect(mcpAdd({ url: 'https://x.invalid/mcp' })).toBe(true);
    expect(mcpAdd({})).toBe(false); // neither → would spawn `pi mcp add s --`
    expect(mcpAdd({ command: ['/bin/true'], url: 'https://x.invalid/mcp' })).toBe(false); // both → silent drop
    expect(mcpAdd({ url: 'https://x.invalid/mcp', env: { K: 'v' } })).toBe(false); // env is stdio-only
    expect(mcpAdd({ command: ['/bin/true'], env: { K: 'v' } })).toBe(true);
  });
});

describe('m2Protocol — round 3 shape holes (NEW-1/NEW-4)', () => {
  const prev = (extra: Record<string, unknown>): boolean =>
    PreviewResourceOpParamsSchema.safeParse({ kind: 'mcp-add', source: 's', ...extra }).success;

  it('rejects an EMPTY url (it would silently drop command in argvFor)', () => {
    expect(prev({ url: '' })).toBe(false);
    expect(prev({ url: '', command: ['/bin/true'] })).toBe(false);
  });

  it('rejects command/url/env for the non-mcp-add kinds (the refine branch)', () => {
    expect(PreviewResourceOpParamsSchema.safeParse({ kind: 'package-remove', source: 'npm:x', command: ['/bin/true'] }).success).toBe(false);
    expect(PreviewResourceOpParamsSchema.safeParse({ kind: 'package-install', source: 'npm:x', url: 'https://x.invalid/mcp' }).success).toBe(false);
    expect(PreviewResourceOpParamsSchema.safeParse({ kind: 'mcp-remove', source: 's', env: { K: 'v' } }).success).toBe(false);
    expect(PreviewResourceOpParamsSchema.safeParse({ kind: 'skill-set', source: '/x/s', disable: true, command: ['/bin/true'] }).success).toBe(false);
    expect(PreviewResourceOpParamsSchema.safeParse({ kind: 'package-update', source: 'npm:x' }).success).toBe(true);
  });
});
