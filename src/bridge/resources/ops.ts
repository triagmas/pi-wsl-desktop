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
import { resolveResourceEntry } from './agentConfig';
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
  spawnFn?: (argv: string[], opts?: { cwd?: string }) => SpawnResult | Promise<SpawnResult>;
  /** CLI executable (resolved by the bridge: env override → real pi). */
  cliPath?: string;
  /** Max retained applied-op records (round 2, N5 — bound in-memory ledgers). */
  appliedCap?: number;
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
    if (value.length > 0) out = out.split(value).join(MASK); // [r1 MINOR a] any length
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
  private readonly spawnFnImpl: (argv: string[], opts?: { cwd?: string }) => SpawnResult | Promise<SpawnResult>;
  private readonly appliedCap: number;
  private readonly plans = new Map<string, PlanRecord>();
  private readonly applied = new Map<string, AppliedRecord>();

  constructor(deps: ResourceOpsDeps) {
    this.home = deps.home;
    this.cliPath = deps.cliPath ?? 'pi';
    this.appliedCap = deps.appliedCap ?? 50;
    this.agentDir = deps.agentDir;
    this.projectPiDir = deps.projectPiDir;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 60_000;
    this.spawnFnImpl =
      deps.spawnFn ??
      (async (argv, opts) =>
        new Promise<SpawnResult>((resolve) => {
          // Like the M0 probe: real `pi` and fixture CLIs are `#!/usr/bin/env
          // node` scripts — guarantee the node directory is on PATH.
          const child = spawn(this.cliPath, argv, {
            cwd: opts?.cwd, // [round 2, N2] `-l` writes target <cwd>/.pi — pin cwd to the project root
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
    // settings.md:153 — project-settings paths resolve from the project `.pi`
    // directory (inventory already does); user settings resolve from agentDir.
    const base = projectLocal && this.projectPiDir ? this.projectPiDir : this.agentDir;
    return path.resolve(base, source);
  }

  private get backupsDir(): string {
    return path.join(this.agentDir, 'pi-ws-desktop-backups');
  }

  private targetsFor(params: PreviewResourceOpParamsT): { files: string[] } {
    const local = params.local === true;
    if (local && !this.projectPiDir) {
      // Fail closed instead of silently writing the USER settings when the
      // project is untrusted (project .pi is trust-gated on 1.3.0).
      throw new BridgeError('INVALID_REQUEST', 'project is not trusted — project-local writes are unavailable');
    }
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
        // `-l` is NOT a documented `pi update` option (1.3.0 cli.md) — project
        // scope is resolved by the CLI itself from both settings files.
        // Boundary (disclosed, round 3): for a project-scope update the CLI may
        // consult/rewrite BOTH settings files while we back up only the project
        // `settings.json`; byte-exact rollback covers the project file only.
        return ['update', source];
      case 'mcp-add': {
        // Presence-guard mirrors the schema (defense in depth for direct calls).
        const url = typeof params.url === 'string' && params.url.length > 0 ? params.url : undefined;
        const envFlatten = Object.entries(params.env ?? {})
          .filter(([, v]) => v.length > 0)
          .flatMap(([k, v]) => ['--env', `${k}=${v}`]);
        if (url !== undefined) {
          // `--env` documents itself as stdio-only; passing it with `--url`
          // would either be ignored or corrupt the config — reject instead.
          if (envFlatten.length > 0) {
            throw new BridgeError('INVALID_REQUEST', 'mcp-add: --env applies to stdio servers only (drop it for --url)');
          }
          return ['mcp', 'add', params.source, ...local, '--url', url];
        }
        // [review r1 BLOCKER] every `--env` MUST precede `--`: everything
        // after the separator is a literal server argument on 1.3.0.
        return ['mcp', 'add', params.source, ...local, ...envFlatten, '--', ...(params.command ?? [])];
      }
      case 'mcp-remove':
        return ['mcp', 'remove', params.source, ...local];
      case 'skill-set':
        // No CLI exists for per-skill toggling on 1.3.0 — a settings edit.
        // [round 2, N8] The plan command must not pretend to be a `pi …` argv
        // (contract: "exact argv the bridge will run" — nothing is spawned).
        return ['(file edit — no process spawned)', 'settings.json', 'skills', params.disable === true ? '-' : '+', params.source];
      default:
        throw new BridgeError('INVALID_REQUEST', `unsupported op kind`);
    }
  }

  /**
   * [round 3, report-only fix] Match an exclusion/plaintext entry against the
   * skill source in ANY spelling Pi accepts (`-<abs>`, `-~/.agents/…`,
   * relative) — otherwise «Включить» reports verified while the `-path`
   * exclusion silently stays in place.
   * Known Pi quirk (N7, disclosed): MCP server names differing only in `-`/`_`
   * are ONE server for Pi (the second is rejected) while this inventory lists
   * both — keep names canonical when creating servers from the GUI.
   */
  private entryMatchesSkill(entry: unknown, source: string, base: string): boolean {
    if (typeof entry !== 'string') return false;
    const stripped = entry.startsWith('-') || entry.startsWith('!') || entry.startsWith('+') ? entry.slice(1) : entry;
    if (stripped === source || entry === `-${source}`) return true;
    const a = resolveResourceEntry(stripped, base, this.home).path;
    const b = resolveResourceEntry(source, base, this.home).path;
    if (a === null || b === null) return false; // glob sources never match exactly
    // path.normalize merges mixed separators — '~/' expands via posix.join
    // while sources may arrive platform-shaped (Windows unit CI).
    return path.normalize(a) === path.normalize(b);
  }

  /** [round 5, P1] ONLY `-`/`!` spellings are EXCLUSIONS — plain/`+` entries
   * are INCLUDE declarations and must never be mistaken for one (otherwise
   * disable silently no-ops with a false `verified:true`, and enable wipes
   * the include). */
  private isExclusionMatch(entry: unknown, source: string, base: string): boolean {
    return typeof entry === 'string' && (entry.startsWith('-') || entry.startsWith('!')) && this.entryMatchesSkill(entry, source, base);
  }

  /** Base directory of the settings FILE this op edits (settings.md:153). */
  private skillSettingsBase(local: boolean): string {
    return local && this.projectPiDir ? this.projectPiDir : this.agentDir;
  }

  /** skill-set: edit settings.skills with the `-path` exclusion semantics. */
  private async editSkillSetting(params: PreviewResourceOpParamsT): Promise<void> {
    const [file] = this.targetsFor(params).files;
    let parsed: Record<string, unknown>;
    try {
      const text = await fsp.readFile(file, 'utf8');
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch (error) {
      throw new BridgeError('INVALID_REQUEST', `settings.json unreadable: ${(error as Error).message}`);
    }
    const skills = Array.isArray(parsed.skills) ? (parsed.skills as unknown[]) : [];
    const exclusion = `-${params.source}`;
    const base = this.skillSettingsBase(params.local === true);
    if (params.disable === true) {
      // includes never suppress the exclusion [round 5, P1]
      if (!skills.some((s) => this.isExclusionMatch(s, params.source, base))) skills.push(exclusion);
      parsed.skills = skills;
    } else {
      // enable: drop ONLY exclusion spellings — include declarations stay
      parsed.skills = skills.filter((s) => !this.isExclusionMatch(s, params.source, base));
    }
    await fsp.writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }

  private backupPathFor(basename: string): string {
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    // [review r1 MINOR b] random suffix: two previews in the same millisecond
    // must never overwrite each other's snapshot.
    const rand = Math.random().toString(36).slice(2, 8);
    return path.join(this.backupsDir, `${stamp}-${rand}-${basename}`);
  }

  /** [round 2, N5] Drop expired plans (their in-memory env values) eagerly. */
  private sweep(): void {
    for (const [id, rec] of [...this.plans]) {
      if (this.now() >= rec.plan.expiresAt) this.plans.delete(id);
    }
  }

  /** Test/diagnostics hook: in-memory ledger sizes (also sweeps — round 3, NEW-2: an idle bridge must not keep expired env secrets until restart). */
  stats(): { plans: number; applied: number } {
    this.sweep();
    return { plans: this.plans.size, applied: this.applied.size };
  }

  async preview(params: PreviewResourceOpParamsT): Promise<{ plan: ResourceOpPlanT }> {
    this.sweep();
    const files = this.targetsFor(params).files;
    const argv = this.argvFor(params);
    const secretValues = Object.values(params.env ?? {}).filter((v) => v.length > 0);
    const { display, redacted } = maskArgvForDisplay(argv, secretValues);

    const backups: PlanRecord['backups'] = [];
    const backupIds: string[] = [];
    await fsp.mkdir(this.backupsDir, { recursive: true });
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    for (const file of files) {
      const made = await (async (): Promise<string | null> => {
        try {
          const target = this.backupPathFor(path.basename(file));
          await fsp.copyFile(file, target); // preview: snapshot for the plan id
          backupIds.push(path.basename(target));
          return target;
        } catch {
          return null; // target does not exist yet — apply re-checks it
        }
      })();
      backups.push({ file, backupPath: made });
    }

    const planId = `${params.kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
    const spawned = params.kind !== 'skill-set'; // file-edit ops run no process (N8)
    const plan: ResourceOpPlanT = {
      planId,
      kind: params.kind,
      description: spawned ? `pi ${display.join(' ')}` : display.join(' '),
      command: spawned ? ['pi', ...display] : display,
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
    if (record && this.now() >= record.plan.expiresAt) {
      // target check BEFORE sweeping so the distinct `expired` message stays
      // reachable (round 5, P2 — the branch went dead behind an eager sweep)
      this.plans.delete(planId);
      throw new BridgeError('INVALID_REQUEST', 'resource op plan expired — preview it again');
    }
    this.sweep(); // [round 3, NEW-2] release other expired plans (env secrets)
    if (!record) throw new BridgeError('INVALID_REQUEST', 'unknown resource op plan — preview it again');
    this.plans.delete(planId); // single-use plan

    // Refresh backups immediately before the write (state right before apply).
    for (const b of record.backups) {
      if (b.backupPath) {
        try {
          await fsp.copyFile(b.file, b.backupPath);
        } catch {
          // Keep the preview-era backup on a transient error — never null a
          // valid snapshot (rollback would lose its only restore point).
        }
      } else {
        // [review r1 IMPORTANT#3] the file was absent at preview; if it exists
        // NOW (the user's own CLI ran during the TTL) snapshot it so rollback
        // RESTORES it instead of deleting someone else's data.
        try {
          const target = this.backupPathFor(path.basename(b.file));
          await fsp.copyFile(b.file, target);
          b.backupPath = target;
        } catch {
          /* still absent — our op creates it, rollback may remove it */
        }
      }
    }

    const argv = this.argvFor(record.params);
    const secretValues = Object.values(record.params.env ?? {}).filter((v) => v.length > 0);
    let spawnResult: SpawnResult;
    if (record.params.kind === 'skill-set') {
      try {
        await this.editSkillSetting(record.params);
        spawnResult = { code: 0, stdout: 'settings updated', stderr: '' };
      } catch (error) {
        spawnResult = { code: 1, stdout: '', stderr: (error as Error).message };
      }
    } else {
      // [round 2, N2] the real CLI writes `-l` targets into <process-cwd>/.pi;
      // pin cwd to the project root so backup/verify/rollback operate on the
      // SAME file the CLI actually rewrites.
      const cwd = record.params.local === true && this.projectPiDir ? path.dirname(this.projectPiDir) : undefined;
      spawnResult = await this.spawnFnImpl(argv, cwd === undefined ? undefined : { cwd });
    }
    const output = maskOutput(`${spawnResult.stdout}\n${spawnResult.stderr}`.trim(), secretValues);

    const ok = spawnResult.code === 0;
    const verified = ok ? await this.verify(record.params) : false;
    const opId = planId;
    this.applied.set(opId, { backups: record.backups });
    while (this.applied.size > this.appliedCap) {
      const oldest = this.applied.keys().next().value;
      if (oldest === undefined) break;
      this.applied.delete(oldest);
    }

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
    if (params.kind === 'skill-set') {
      try {
        const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as { skills?: unknown };
        const skills = Array.isArray(parsed.skills) ? (parsed.skills as unknown[]) : [];
        const base = this.skillSettingsBase(params.local === true);
        const hasExclusion = skills.some((s) => this.isExclusionMatch(s, params.source, base));
        return params.disable === true ? hasExclusion : !hasExclusion;
      } catch {
        return false;
      }
    }
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
    this.sweep();
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
        // [round 2, N6 + round 3, NEW-3] a rival CLI may have created this
        // file during our apply — its bytes MUST be preserved first. Fail
        // CLOSED: if the snapshot cannot be taken (backups area gone/read-only,
        // disk full) and the file still exists, keep it and report nothing
        // restored — never delete bytes we could not preserve.
        let snapshotOk: boolean;
        try {
          await fsp.mkdir(this.backupsDir, { recursive: true });
          await fsp.copyFile(b.file, this.backupPathFor(`${path.basename(b.file)}.preunlink`));
          snapshotOk = true;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            // ENOENT may mean the FILE vanished or the BACKUPS area raced
            // away between mkdir and copy — attribute it by stat'ing the
            // source: only a genuinely gone file may proceed to unlink.
            snapshotOk = await fsp.stat(b.file).then(() => false, () => true);
          } else {
            snapshotOk = false;
          }
        }
        if (snapshotOk) {
          try {
            await fsp.unlink(b.file); // op created this file — remove it
            restored.push(b.file);
          } catch {
            /* never existed */
          }
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
