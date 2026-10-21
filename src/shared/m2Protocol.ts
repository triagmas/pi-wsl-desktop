/**
 * Node-free M2 Pi Resource Manager contract (shared/m2Protocol.ts).
 *
 * Authority: installed Pi 1.3.0 (`pi list/install/remove/update/mcp --help`
 * and its packaged docs packages.md/mcp.md/skills.md/settings.md). Method
 * names are OUR bridge names; argv arrays mirror the documented CLI.
 *
 * Security invariants encoded in the schemas:
 * - Inventory never carries secret VALUES: MCP env travels as KEYS only and
 *   OAuth credentials (`mcp-auth.json`) are never read. `headers` are never
 *   transported at all.
 * - The op PLAN has no field that could hold raw secret material; secrets
 *   accepted on the request (mcp add --env) are redacted in every response.
 * - Apply/rollback require `confirm: z.literal(true)` — a truthy string or a
 *   missing flag is rejected at the wire level.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

export const SkillSourceSchema = z.enum([
  'user-agents', // ~/.agents/skills
  'project-agents', // .agents/skills (cwd..repo root ancestors)
  'user-settings', // settings.skills (agent dir)
  'project-settings', // .pi/settings.skills
  'package', // conventional skills/ of an installed package
]);
export type SkillSourceT = z.infer<typeof SkillSourceSchema>;

/** Static loadability per skills.md: malformed SKILL.md or a skill without a
 * description is NOT loaded; excluded via a `-path` entry is not loaded. */
export const SkillStatusSchema = z.enum(['ok', 'missing', 'invalid', 'excluded']);

export const SkillInfoSchema = z.object({
  name: z.string().min(1),
  dir: z.string().min(1),
  source: SkillSourceSchema,
  /** Owning package source when `source === 'package'`. */
  package: z.string().nullable(),
  description: z.string().nullable(),
  status: SkillStatusSchema,
  /** `disable-model-invocation: true` → available only as /skill:name. */
  disableModelInvocation: z.boolean(),
  diagnostics: z.array(z.string()).max(50),
});
export type SkillInfoT = z.infer<typeof SkillInfoSchema>;

export const ListSkillsParamsSchema = z.object({});
export const ListSkillsResultSchema = z.object({
  skills: z.array(SkillInfoSchema).max(2_000),
  diagnostics: z.array(z.string()).max(50),
});

/* ------------------------------------------------------------------ */
/* Packages / extensions                                               */
/* ------------------------------------------------------------------ */

export const PackageKindSchema = z.enum(['npm', 'git', 'url', 'local']);
export type PackageKindT = z.infer<typeof PackageKindSchema>;
export const PackageScopeSchema = z.enum(['user', 'project']);

export const PackageInfoSchema = z.object({
  /** Exact declaration, e.g. `npm:pi-subagents@1.0.0`, `git:github.com/...@v1`. */
  source: z.string().min(1),
  kind: PackageKindSchema,
  scope: PackageScopeSchema,
  /** Resolved install path for npm/git packages; local sources keep their path. */
  path: z.string().nullable(),
  present: z.boolean(),
  /** Declared version/ref as configured (npm pin or git ref), best-effort. */
  declaredRef: z.string().nullable(),
  diagnostics: z.array(z.string()).max(20),
});
export type PackageInfoT = z.infer<typeof PackageInfoSchema>;

export const BuiltinInfoSchema = z.object({
  /** e.g. `mcp`, `codemode` (from `builtin:<name>` entries). */
  name: z.string().min(1),
  enabled: z.boolean(),
});
export type BuiltinInfoT = z.infer<typeof BuiltinInfoSchema>;

export const ListPackagesResultSchema = z.object({
  packages: z.array(PackageInfoSchema).max(500),
  builtins: z.array(BuiltinInfoSchema).max(50),
  /** Raw `extensions` resource entries (paths / +/-globs), not secrets. */
  settingsExtensions: z.array(z.string()).max(200),
  diagnostics: z.array(z.string()).max(50),
});

/* ------------------------------------------------------------------ */
/* MCP (config-only: NO connection probes)                             */
/* ------------------------------------------------------------------ */

export const McpTransportSchema = z.enum(['stdio', 'http']);

export const McpServerInfoSchema = z.object({
  name: z.string().min(1),
  scope: PackageScopeSchema,
  transport: McpTransportSchema,
  /** stdio executable or http URL. NEVER env values, headers or tokens. */
  command: z.string().nullable(),
  args: z.array(z.string()).max(64),
  /** Env var NAMES only — values are never transported. */
  envKeys: z.array(z.string()).max(64),
  /** A project mcp.json entry shadows the user entry with the same name. */
  hasProjectOverride: z.boolean(),
  /** OAuth fields present in config; stored credentials are never read. */
  oauthConfigured: z.boolean(),
  /** Effective `enabled` state after the project overlay merge (mcp.md). */
  enabled: z.boolean(),
  diagnostics: z.array(z.string()).max(20),
});
export type McpServerInfoT = z.infer<typeof McpServerInfoSchema>;

export const ListMcpServersResultSchema = z.object({
  servers: z.array(McpServerInfoSchema).max(200),
  /** Built-in MCP session support (settings `extensions` `-builtin:mcp`). */
  builtinEnabled: z.boolean(),
  /** Derived from mcp.log: only `"<server> <LEVEL> <count>"` aggregates —
   * never raw log lines (they may embed private server output). */
  logDiagnostics: z.array(z.string()).max(10),
  diagnostics: z.array(z.string()).max(50),
});

/* ------------------------------------------------------------------ */
/* Two-phase resource operations (the M2 write boundary)               */
/* ------------------------------------------------------------------ */

export const ResourceOpKindSchema = z.enum([
  'package-install',
  'package-remove',
  'package-update',
  'mcp-add',
  'mcp-remove',
  /** Toggle `-path` exclusion of a skill in settings.skills (no CLI exists
   * for per-skill enable/disable on 1.3.0 — a documented settings edit). */
  'skill-set',
]);
export type ResourceOpKindT = z.infer<typeof ResourceOpKindSchema>;

export const PreviewResourceOpParamsSchema = z
  .object({
    kind: ResourceOpKindSchema,
    /** package source or mcp server name — never a raw path outside scope. */
    source: z.string().min(1),
    /** mcp-add stdio command argv (first element = executable). */
    command: z.array(z.string().max(4096)).max(32).optional(),
    /** mcp-add http endpoint (min(1): an EMPTY url would silently take the
     * url-branch in argvFor and drop `command` — round 3, NEW-1). */
    url: z.string().min(1).max(2048).optional(),
    /** mcp-add env: VALUES travel here once, are used verbatim by the CLI and
     * are NEVER echoed back in plan/results (redaction enforced in ops). */
    env: z.record(z.string().max(256), z.string().max(8192)).optional(),
    scope: PackageScopeSchema.optional(),
    /** `-l` project-local write for install/remove/mcp. */
    local: z.boolean().optional(),
    /** skill-set only: true → add the `-path` exclusion (disable),
     * false/absent → remove it (enable). */
    disable: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Round 2 (N4): never allow a shape that degrades into a garbage argv or
    // a silently-dropped option.
    const hasUrl = typeof v.url === 'string' && v.url.length > 0;
    const hasCmd = Array.isArray(v.command) && v.command.length > 0;
    if (v.kind === 'mcp-add') {
      if (hasUrl === hasCmd) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mcp-add requires exactly one of command (stdio) or url (http)' });
      }
      if (hasUrl && v.env !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'env is stdio-only — drop it for url' });
      }
    } else if (hasUrl || hasCmd || v.env !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'command/url/env are only valid for mcp-add' });
    }
    if (v.kind !== 'skill-set' && v.disable !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'disable is only valid for skill-set' });
    }
  });
export type PreviewResourceOpParamsT = z.infer<typeof PreviewResourceOpParamsSchema>;

export const ResourceOpPlanSchema = z.object({
  planId: z.string().min(1),
  kind: ResourceOpKindSchema,
  description: z.string().min(1),
  /** Exact argv the bridge will run under WSL (`pi …`); secrets redacted. */
  command: z.array(z.string()).max(64),
  /** True when argv display dropped/masked secret values. */
  commandRedacted: z.boolean(),
  /** Files this op will rewrite (settings.json / mcp.json). */
  filesTouched: z.array(z.string()).max(8),
  /** Backup id taken BEFORE the write, for rollbackResourceOp. */
  backupId: z.string().nullable(),
  /** Plans expire (ms epoch); apply after expiry must fail closed. */
  expiresAt: z.number().int(),
});
export type ResourceOpPlanT = z.infer<typeof ResourceOpPlanSchema>;

export const PreviewResourceOpResultSchema = z.object({ plan: ResourceOpPlanSchema });

export const ApplyResourceOpParamsSchema = z
  .object({
    planId: z.string().min(1),
    confirm: z.literal(true),
  })
  .strict();

export const ApplyResourceOpResultSchema = z.object({
  ok: z.boolean(),
  opId: z.string().min(1),
  /** CLI output with secret patterns masked, bounded. */
  output: z.string().max(4_000),
  backupId: z.string().nullable(),
  filesTouched: z.array(z.string()).max(8),
  /** Post-write verification summary (e.g. `pi list` still parses). */
  verified: z.boolean(),
});

export const RollbackResourceOpParamsSchema = z
  .object({
    opId: z.string().min(1),
    confirm: z.literal(true),
  })
  .strict();

export const RollbackResourceOpResultSchema = z.object({
  ok: z.boolean(),
  restored: z.array(z.string()).max(8),
  /** [round 7, P1] files kept untouched because another process changed them
   * after apply — the rollback refuses to destroy those bytes. */
  conflicts: z.array(z.string()).max(8).optional(),
});
