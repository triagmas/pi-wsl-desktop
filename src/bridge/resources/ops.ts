/**
 * M2 two-phase resource operations (Issue #7 write boundary).
 *
 * Phase 1 `preview`: builds the exact CLI argv, materializes a BACKUP of
 * every file the op will rewrite (side-effect free with respect to user
 * config — only our own backup dir is written) and returns a redacted plan.
 * Phase 2 `apply(planId, confirm: true)`: reuses the previewed plan within
 * its TTL, refreshes the backup immediately before the write, runs the
 * documented Pi CLI (bounded timeout, bounded output), redacts known secret
 * VALUES from every response and verifies the post-state. `rollback` restores
 * the backed-up bytes.
 *
 * Secrets: request-supplied env values exist ONLY in the in-memory plan
 * record and the CLI argv; responses carry masks. Backups live under
 * `<agentDir>/pi-ws-desktop-backups` so isolated-HOME tests stay isolated.
 */
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { BridgeError } from '../../shared/errors';
import type { PreviewResourceOpParamsT, ResourceOpPlanT } from '../../shared/m2Protocol';

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ResourceOpsDeps {
  home: string;
  agentDir: string;
  /** Trusted project `.pi` directory for `-l` writes (optional). */
  projectPiDir?: string;
  now?: () => number;
  spawnFn?: (argv: string[]) => SpawnResult | Promise<SpawnResult>;
  /** CLI executable (resolved by the bridge: env override → real pi). */
  cliPath?: string;
  /** Bounded CLI runtime (ms). Never unbounded (AGENTS §3.7). */
  timeoutMs?: number;
}

interface PlanRecord {
  params: PreviewResourceOpParamsT;
  plan: ResourceOpPlanT;
  backups: Array<{ file: string; backupPath: string | null }>;
}

interface AppliedRecord {
  backups: Array<{ file: string; backupPath: string | null }>;
}

const PLAN_TTL_MS = 5 * 60_000;
const OUTPUT_CAP = 4_000;
const MASK = '***';
const SECRET_KEY_RE = /(token|secret|password|api[_-]?key|bearer)/i;

function maskOutput(text: string, secretValues: string[]): string {
  let out = text;
  for (const value of secretValues) {
    if (value.length >= 4) out = out.split(value).join(MASK);
  }
  out = out.replace(/([A-Za-z0-9_-]*(?:token|secret|password|api[_-]?key)[A-Za-z0-9_-]*[=:])\S+/gi, `$1${MASK}`);
  return out.length > OUTPUT_CAP ? `${out.slice(0, OUTPUT_CAP)}…` : out;
}

function maskArgvForDisplay(argv: string[], secretValues: string[]): { display: string[]; redacted: boolean } {
  let redacted = false;
  const display = argv.map((part) => {
    // `--env KEY=VALUE` and `KEY=VALUE`-looking tokens: mask after '='.
    const eq = part.indexOf('=');
    if (eq > 0) {
      const key = part.slice(0, eq);
      const value = part.slice(eq + 1);
      if (value.length > 0 && (SECRET_KEY_RE.test(key) || secretValues.includes(value))) {
        redacted = true;
        return `${key}=${MASK}`;
      }
    }
    if (secretValues.includes(part)) {
      redacted = true;
      return MASK;
    }
    return part;
  });
  return { display, redacted };
}

export class ResourceOps {
  readonly agentDir: string;
  private readonly home: string;
  private readonly cliPath: string;
  private readonly projectPiDir: string | undefined;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly spawnFnImpl: (argv: string[]) => SpawnResult | Promise<SpawnResult>;
  private readonly plans = new Map<string, PlanRecord>();
  private readonly applied = new Map<string, AppliedRecord>();

  constructor(deps: ResourceOpsDeps) {
    this.home = deps.home;
    this.cliPath = deps.cliPath ?? 'pi';
    this.agentDir = deps.agentDir;
    this.projectPiDir = deps.projectPiDir;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 60_000;
    this.spawnFnImpl =
      deps.spawnFn ??
      (async (argv) =>
        new Promise<SpawnResult>((resolve) => {
          // Like the M0 probe: real `pi` and fixture CLIs are `#!/usr/bin/env
          // node` scripts — guarantee the node directory is on PATH.
          const child = spawn(this.cliPath, argv, {
            env: { ...process.env, HOME: this.home, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}` },
          });
          let stdout = '';
          let stderr = '';
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGKILL');
            resolve({ code: 124, stdout, stderr: `${stderr}\npi ${argv[0] ?? ''} timed out`.trim() });
          }, this.timeoutMs);
          child.stdout.on('data', (c: Buffer) => {
            if (stdout.length < 65_536) stdout += c.toString('utf8');
          });
          child.stderr.on('data', (c: Buffer) => {
            if (stderr.length < 65_536) stderr += c.toString('utf8');
          });
          child.once('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: 127, stdout, stderr: error.message });
          });
          child.once('exit', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: code ?? 1, stdout, stderr });
          });
        }));

  }

  private absolutizeLocalSource(source: string, projectLocal: boolean): string {
    if (!(source.startsWith('./') || source.startsWith('../'))) return source;
    const base = projectLocal && this.projectPiDir ? path.resolve(this.projectPiDir, '..') : this.agentDir;
    return path.resolve(base, source);
  }

  private get backupsDir(): string {
    return path.join(this.agentDir, 'pi-ws-desktop-backups');
  }

  private targetsFor(params: PreviewResourceOpParamsT): { files: string[] } {
    const local = params.local === true;
    if (params.kind === 'mcp-add' || params.kind === 'mcp-remove') {
      return { files: [path.join(local && this.projectPiDir ? this.projectPiDir : this.agentDir, 'mcp.json')] };
    }
    return { files: [path.join(local && this.projectPiDir ? this.projectPiDir : this.agentDir, 'settings.json')] };
  }

  private argvFor(params: PreviewResourceOpParamsT): string[] {
    const local = params.local === true ? ['-l'] : [];
    // Relative local sources are resolved against the DECLARING settings dir
    // (packages.md), never against the bridge's cwd — `pi install ./x` itself
    // resolves relative paths against its process cwd.
    const source = this.absolutizeLocalSource(params.source, params.local === true);
    switch (params.kind) {
      case 'package-install':
        return ['install', source, ...local];
      case 'package-remove':
        return ['remove', source, ...local];
      case 'package-update':
        return ['update', source, ...local];
      case 'mcp-add': {
        const transport = params.url !== undefined ? ['--url', params.url] : ['--', ...(params.command ?? [])];
        const envFlatten = Object.entries(params.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
        return ['mcp', 'add', params.source, ...local, ...transport, ...envFlatten];
      }
      case 'mcp-remove':
        return ['mcp', 'remove', params.source, ...local];
      default:
        throw new BridgeError('INVALID_REQUEST', `unsupported op kind`);
    }
  }

  async preview(params: PreviewResourceOpParamsT): Promise<{ plan: ResourceOpPlanT }> {
    const files = this.targetsFor(params).files;
    const argv = this.argvFor(params);
    const secretValues = Object.values(params.env ?? {}).filter((v) => v.length >= 4);
    const { display, redacted } = maskArgvForDisplay(argv, secretValues);

    const backups: PlanRecord['backups'] = [];
    const backupIds: string[] = [];
    await fsp.mkdir(this.backupsDir, { recursive: true });
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    for (const file of files) {
      const made = await (async (): Promise<string | null> => {
        try {
          const backupName = `${stamp}-${path.basename(file)}`;
          const target = path.join(this.backupsDir, backupName);
          await fsp.copyFile(file, target); // preview: snapshot for the plan id
          backupIds.push(backupName);
          return target;
        } catch {
          return null; // target does not exist yet — rollback will remove it
        }
      })();
      backups.push({ file, backupPath: made });
    }

    const planId = `${params.kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
    const plan: ResourceOpPlanT = {
      planId,
      kind: params.kind,
      description: `pi ${display.join(' ')}`,
      command: ['pi', ...display],
      commandRedacted: redacted,
      filesTouched: files,
      backupId: backupIds.length > 0 ? backupIds.join(',') : null,
      expiresAt: this.now() + PLAN_TTL_MS,
    };
    this.plans.set(planId, { params, plan, backups });
    return { plan };
  }

  async apply(planId: string, confirm: true): Promise<{
    ok: boolean;
    opId: string;
    output: string;
    backupId: string | null;
    filesTouched: string[];
    verified: boolean;
  }> {
    if (confirm !== true) throw new BridgeError('INVALID_REQUEST', 'resource op requires explicit confirmation');
    const record = this.plans.get(planId);
    if (!record) throw new BridgeError('INVALID_REQUEST', 'unknown resource op plan — preview it again');
    if (this.now() >= record.plan.expiresAt) {
      this.plans.delete(planId);
      throw new BridgeError('INVALID_REQUEST', 'resource op plan expired — preview it again');
    }
    this.plans.delete(planId); // single-use plan

    // Refresh backups immediately before the write (state right before apply).
    for (const b of record.backups) {
      if (b.backupPath) {
        try {
          await fsp.copyFile(b.file, b.backupPath);
        } catch {
          b.backupPath = null; // file vanished between preview and apply
        }
      }
    }

    const argv = this.argvFor(record.params);
    const secretValues = Object.values(record.params.env ?? {}).filter((v) => v.length >= 4);
    const spawnResult = await this.spawnFnImpl(argv);
    const output = maskOutput(`${spawnResult.stdout}\n${spawnResult.stderr}`.trim(), secretValues);

    const ok = spawnResult.code === 0;
    const verified = ok ? await this.verify(record.params) : false;
    const opId = planId;
    this.applied.set(opId, { backups: record.backups });

    return {
      ok,
      opId,
      output,
      backupId: record.plan.backupId,
      filesTouched: record.plan.filesTouched,
      verified,
    };
  }

  private async verify(params: PreviewResourceOpParamsT): Promise<boolean> {
    const [file] = this.targetsFor(params).files;
    try {
      const text = await fsp.readFile(file, 'utf8');
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (params.kind === 'mcp-add' || params.kind === 'mcp-remove') {
        const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
        const present = params.source in servers;
        return params.kind === 'mcp-add' ? present : !present;
      }
      const packages = Array.isArray(parsed.packages) ? parsed.packages : [];
      const absolutized = this.absolutizeLocalSource(params.source, params.local === true);
      const wanted = new Set<string>([params.source, absolutized]);
      // The real CLI stores local sources in normalized form (observed: the
      // basename inside the agent dir) — accept that spelling too.
      if (params.source.startsWith('./') || params.source.startsWith('../') || path.posix.isAbsolute(params.source)) {
        wanted.add(path.basename(absolutized));
      }
      const listed = packages.some((p) =>
        typeof p === 'string'
          ? wanted.has(p)
          : typeof p === 'object' && p !== null && wanted.has((p as { source?: string }).source ?? ''),
      );
      if (params.kind === 'package-install') return listed;
      if (params.kind === 'package-remove') return !listed;
      return true; // update: settings still parses
    } catch {
      return false;
    }
  }

  async rollback(opId: string, confirm: true): Promise<{ ok: boolean; restored: string[] }> {
    if (confirm !== true) throw new BridgeError('INVALID_REQUEST', 'rollback requires explicit confirmation');
    const record = this.applied.get(opId);
    if (!record) throw new BridgeError('INVALID_REQUEST', 'unknown op — nothing to roll back');
    this.applied.delete(opId);
    const restored: string[] = [];
    for (const b of record.backups) {
      if (b.backupPath) {
        try {
          await fsp.copyFile(b.backupPath, b.file);
          restored.push(b.file);
        } catch {
          /* below: reported via absence from `restored` */
        }
      } else {
        try {
          await fsp.unlink(b.file); // op created this file — remove it
          restored.push(b.file);
        } catch {
          /* never existed */
        }
      }
    }
    return { ok: restored.length > 0, restored };
  }

  /** Test hook: force a plan past its TTL. */
  async expire(planId: string): Promise<void> {
    const record = this.plans.get(planId);
    if (record) record.plan.expiresAt = this.now() - 1;
  }

  /** true when a kept backup exists (used by inventory diagnostics). */
  async hasBackups(): Promise<boolean> {
    try {
      const items = await fsp.readdir(this.backupsDir);
      return items.length > 0;
    } catch {
      return false;
    }
  }

}
