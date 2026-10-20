/**
 * M2 two-phase resource operations (Issue #7 write boundary).
 *
 * Phase 1 `preview`: builds the exact CLI argv, materializes a BACKUP of
 * every file the op will rewrite (side-effect free with respect to user
 * config — only our own backup dir is written) and returns a redacted plan.
 * Phase 2 `apply(planId, confirm: true)`: reuses the previewed plan within
 * its TTL, refreshes the backup immediately before the write (fail-closed:
 * no write without a fresh snapshot), runs the documented Pi CLI (bounded
 * timeout, bounded output), redacts known secret VALUES from every response
 * and verifies the post-state. `rollback` restores the backed-up bytes ONLY
 * when they still match the post-apply anchor, and snapshots the current
 * bytes (`.prerestore`) before any overwrite, so nothing is ever destroyed
 * losslessly-unchecked. Residual path-TOCTOU windows are disclosed at the
 * call sites — no absolute guarantee is claimed.
 *
 * Secrets: request-supplied env values exist ONLY in the in-memory plan
 * record and the CLI argv; responses carry masks. Backups live under
 * `<agentDir>/pi-ws-desktop-backups` so isolated-HOME tests stay isolated.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  /** [round 7, P1] digest of each target RIGHT AFTER our write — the anchor
   * rollback compares against to detect foreign modifications. */
  after: Map<string, string | null>;
}

const PLAN_TTL_MS = 5 * 60_000;
/** stateDigest sentinel: the file exists but cannot be read (never matches a digest). */
const UNREADABLE = '!unreadable';
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

  /** skill-set: edit settings.skills with the `-path` exclusion semantics.
   * Returns the exact bytes written — the caller anchors on THIS buffer (no
   * re-read race, round 8 F1). */
  private async editSkillSetting(params: PreviewResourceOpParamsT): Promise<string> {
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
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    await fsp.writeFile(file, text, 'utf8');
    return text;
  }

  private backupPathFor(basename: string): string {
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    // [review r1 MINOR b] random suffix: two previews in the same millisecond
    // must never overwrite each other's snapshot.
    const rand = Math.random().toString(36).slice(2, 8);
    return path.join(this.backupsDir, `${stamp}-${rand}-${basename}`);
  }

  /** sha256 of a file, `null` when absent, `UNREADABLE` on any other error. */
  private async stateDigest(file: string): Promise<string | null> {
    try {
      const buf = await fsp.readFile(file);
      return createHash('sha256').update(buf).digest('hex');
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : UNREADABLE;
    }
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

    // [round 7, P1] Refresh the snapshot immediately before the write — and
    // FAIL CLOSED if a fresh snapshot cannot be guaranteed. Proceeding on a
    // stale preview-era backup (or over a file we could not snapshot) would
    // let a later rollback resurrect outdated bytes / destroy a file the user
    // created during the TTL. No CLI call happens after any failure here.
    for (const b of record.backups) {
      let exists: boolean;
      try {
        await fsp.stat(b.file);
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
        else throw new BridgeError('INVALID_REQUEST', `cannot inspect ${path.basename(b.file)} before writing — preview it again`);
      }
      if (!exists) {
        if (b.backupPath) {
          // existed at preview, gone now = external change we cannot snapshot
          throw new BridgeError('INVALID_REQUEST', `${path.basename(b.file)} was removed since preview — preview it again`);
        }
        continue; // absent both at preview and now — our op creates it
      }
      try {
        await fsp.mkdir(this.backupsDir, { recursive: true });
        if (b.backupPath) {
          await fsp.copyFile(b.file, b.backupPath); // refresh in place
        } else {
          // created by the user's own CLI during the TTL — snapshot so
          // rollback RESTORES their file instead of deleting it
          const target = this.backupPathFor(path.basename(b.file));
          await fsp.copyFile(b.file, target);
          b.backupPath = target;
        }
      } catch {
        throw new BridgeError(
          'INVALID_REQUEST',
          `cannot snapshot ${path.basename(b.file)} before writing — rollback safety (preview it again)`,
        );
      }
    }

    // [round 8, F1] pre-write anchor: captured AFTER the snapshot gate and
    // BEFORE our write. On a FAILED op we assume our write did not happen, so
    // the anchor stays at this pre-state — user edits landing during the
    // spawn then surface as rollback CONFLICTS instead of being reverted.
    const pre = new Map<string, string | null>();
    for (const b of record.backups) pre.set(b.file, await this.stateDigest(b.file));

    const argv = this.argvFor(record.params);
    const secretValues = Object.values(record.params.env ?? {}).filter((v) => v.length > 0);
    let spawnResult: SpawnResult;
    let skillBytes: string | null = null;
    if (record.params.kind === 'skill-set') {
      try {
        skillBytes = await this.editSkillSetting(record.params);
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
    // [round 8, F1] anchor IMMEDIATELY after the write, BEFORE verify():
    // - success: digest of what our write produced (skill-set anchors on the
    //   buffer it actually wrote — no re-read race);
    // - failure: keep the PRE-write anchor (our write is presumed absent), so
    //   foreign edits during the spawn cannot be misattributed as ours.
    const after = new Map<string, string | null>();
    if (ok) {
      for (const b of record.backups) {
        const digest = skillBytes !== null && record.params.kind === 'skill-set' ? createHash('sha256').update(skillBytes, 'utf8').digest('hex') : await this.stateDigest(b.file);
        after.set(b.file, digest);
      }
    } else {
      for (const [file, digest] of pre) after.set(file, digest);
    }
    const verified = ok ? await this.verify(record.params) : false;
    const opId = planId;
    this.applied.set(opId, { backups: record.backups, after });
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

  async rollback(opId: string, confirm: true): Promise<{ ok: boolean; restored: string[]; conflicts: string[] }> {
    if (confirm !== true) throw new BridgeError('INVALID_REQUEST', 'rollback requires explicit confirmation');
    this.sweep();
    const record = this.applied.get(opId);
    if (!record) throw new BridgeError('INVALID_REQUEST', 'unknown op — nothing to roll back');
    this.applied.delete(opId);
    const restored: string[] = [];
    const conflicts: string[] = [];
    for (const b of record.backups) {
      const cur = await this.stateDigest(b.file);
      const expected = record.after.get(b.file);
      if (b.backupPath) {
        // [round 7, P1 + round 8, F1] the file must equal the post-apply
        // anchor (for FAILED ops: the pre-write anchor). Foreign edits,
        // foreign deletions and unreadable states are CONFLICTS — kept as is.
        if (cur === null && expected === null) continue; // already absent — nothing to restore
        if (expected === undefined || cur !== expected || cur === UNREADABLE || expected === UNREADABLE) {
          conflicts.push(b.file);
          continue;
        }
        // SECURITY (honest limits): matching the anchor is NECESSARY, not
        // sufficient — bytes landing in [write → anchor] (the CLI runtime;
        // excluded for failed spawns, whose anchor is the pre-write state)
        // and in [digest → copyFile] below are not provably ours. Therefore
        // the CURRENT bytes are snapshotted (`.prerestore`) BEFORE any
        // overwrite: even a misattributed window stays recoverable
        // losslessly. Residual path-TOCTOU remains (a racer between snapshot
        // and copy); full closure needs fd-based/locked writes — disclosed,
        // not claimed as absolute.
        try {
          await fsp.mkdir(this.backupsDir, { recursive: true });
          await fsp.copyFile(b.file, this.backupPathFor(`${path.basename(b.file)}.prerestore`));
        } catch {
          conflicts.push(b.file); // cannot preserve current bytes → do NOT overwrite
          continue;
        }
        try {
          await fsp.copyFile(b.backupPath, b.file);
          restored.push(b.file);
        } catch {
          /* reported via absence from `restored`; prerestore kept the bytes */
        }
      } else {
        // [round 7, P1] only OUR bytes may be removed: the file must still
        // match the post-apply anchor. Anything else (foreign file, foreign
        // edit) is a conflict and stays in place.
        if (cur === UNREADABLE || expected === undefined || expected === null || cur !== expected) {
          if (cur !== null) conflicts.push(b.file);
          continue;
        }
        // [round 2, N6 + round 3, NEW-3] a rival CLI may have created this
        // file during our apply — its bytes MUST be preserved first. Fail
        // CLOSED: if the snapshot cannot be taken (backups area gone/read-only,
        // disk full) and the file still exists, keep it and report nothing
        // restored — never delete bytes we could not preserve.
        let snapshotSucceeded = false;
        let fileWasMissing = false;
        try {
          await fsp.mkdir(this.backupsDir, { recursive: true });
          await fsp.copyFile(b.file, this.backupPathFor(`${path.basename(b.file)}.preunlink`));
          snapshotSucceeded = true;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            // ENOENT may mean the FILE vanished or the BACKUPS area raced away
            // between mkdir and copy — attribute it by stat'ing the source.
            fileWasMissing = await fsp.stat(b.file).then(() => false, () => true);
          }
        }
        if (snapshotSucceeded) {
          // bytes preserved → remove ours
          try {
            await fsp.unlink(b.file);
            restored.push(b.file);
          } catch {
            /* ENOENT (never existed) or EACCES/EBUSY (still there) — either
             * way the file is untouched and absent from `restored` → ok:false */
          }
        } else if (!fileWasMissing) {
          // exists but could NOT be preserved → keep it (fail-closed)
        }
        // stat-confirmed absence: nothing to delete, and nothing to lose —
        // do NOT unlink (round 6 NEW-1: a racer recreating the file between
        // stat and unlink would otherwise lose bytes we never preserved).
      }
    }
    return { ok: conflicts.length === 0 && restored.length > 0, restored, conflicts };
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
