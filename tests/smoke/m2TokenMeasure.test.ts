/**
 * M2 token-cost measurement runner (Issue #12, plan Task 3 realignment).
 *
 * OPTIONAL, owner-authorized harness — NOT a routing requirement. Task
 * routing success does not depend on paid benchmarking; genuine savings
 * stay NOT MEASURED until ordinary work passively provides comparable data
 * (TOKEN_EFFICIENCY.md §5). This runner only exists so the owner MAY
 * authorize a bounded comparison later; it never auto-runs, never creates
 * a consent file, and never requests permission by itself.
 *
 * If authorized, it runs the three fixed synthetic tasks (A/B/C from
 * m2AcceptanceTasks) twice each — a baseline tier and a candidate tier —
 * through the REAL Pi and REAL provider: 6 paid calls, STOP-GATE 1
 * enforced in code. Tier levels are PARAMETERS read from
 * PI_ACCEPTANCE_TIER_LEVELS (comma-separated, default "baseline=,candidate=off");
 * the harness makes no claim about which levels a model supports — check
 * get_available_thinking_levels first (see m2ThinkingParity smoke).
 *
 * Gates: REAL_PI=1 AND PI_ACCEPTANCE_PAID_CONSENT=1 AND
 * PI_ACCEPTANCE_CONSENT_FILE=<json validated by assertPaidCallConsent with
 * requiredCalls=6>. Without them every run is NOT RUN — never PASS.
 *
 * Every run: fresh isolated session dir + throwaway HOME (credential copy,
 * always deleted), pre/post get_state cost capture, post-run synthetic
 * JSONL parse, deterministic checker verdict. The private per-run report is
 * written under .superpowers (git-ignored); the console summary is
 * sanitized — no provider/model identifiers, no prompts, no credentials.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertIsolatedSessionRoot, assertPaidCallConsent } from '../../scripts/lib/acceptanceGuards';
import { ACCEPTANCE_TASKS } from '../../scripts/lib/m2AcceptanceTasks';
import { PiRpcClient } from '../../src/bridge/piRpcClient';
import { nodeFs, resolveSessionRoots } from '../../src/bridge/sessions';

const REAL_PI = process.env.REAL_PI === '1';
const PAID = process.env.PI_ACCEPTANCE_PAID_CONSENT === '1';
const PI_BIN = process.env.PI_WS_DESKTOP_PI ?? path.join(os.homedir(), '.local', 'bin', 'pi');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runtimeRoot = path.join(repoRoot, '.superpowers', 'acceptance-runtime');
const measureDir = path.join(runtimeRoot, 'measure');
// Tier levels are parameters, not a policy claim: the default candidate is
// `off` only because it is the single level BELOW the current baseline that
// this machine's default model map offers (see m2ThinkingParity). Pass
// PI_ACCEPTANCE_TIER_LEVELS="baseline=,candidate=low" etc. to measure other
// levels on a model that actually supports them (get_available_thinking_levels).
const TIER_SPEC = process.env.PI_ACCEPTANCE_TIER_LEVELS ?? 'baseline=,candidate=off';
const TIERS: Array<{ tier: string; thinking: string | null }> = TIER_SPEC.split(',')
  .map((entry) => {
    const [tier, level] = entry.split('=' );
    return { tier: tier.trim(), thinking: level !== undefined && level.trim() !== '' ? level.trim() : null };
  })
  .filter((t) => t.tier.length > 0);
if (TIERS.length !== 2) {
  throw new Error(`PI_ACCEPTANCE_TIER_LEVELS must describe exactly two tiers, got ${TIERS.length}`);
}

interface Cost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface RunReport {
  task: 'A' | 'B' | 'C';
  tier: string;
  thinking: string | null;
  ok: boolean;
  checkDetail: string;
  cost: Cost | 'NOT MEASURED';
  wallMs: number;
  attempts: number;
  eventsSeen: string[];
}

function snapshotMeta(root: string): string[] {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          const st = lstatSync(p);
          lines.push(`${p} size=${st.size} mtime=${st.mtimeMs} ino=${st.ino}`);
        } catch {
          lines.push(`ERR ${p}`);
        }
      }
    }
  };
  walk(root);
  return lines.sort();
}

const digest = (lines: string[]): string => createHash('sha256').update(lines.join('\n')).digest('hex');

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}

function extractAssistantReply(jsonlFile: string): string {
  const texts: string[] = [];
  for (const line of readFileSync(jsonlFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = rec?.message;
    if (rec?.type === 'message' && msg?.role === 'assistant') {
      if (typeof msg.content === 'string') texts.push(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block.text === 'string') texts.push(block.text);
        }
      }
    }
  }
  return texts.join('\n');
}

function collectUsageFromJsonl(jsonlFile: string): Cost | null {
  const total: Cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let seen = false;
  for (const line of readFileSync(jsonlFile, 'utf8').split('\n')) {
    if (!line.includes('usage')) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const u = rec?.usage ?? rec?.message?.usage;
    if (u && typeof u === 'object') {
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
        if (typeof u[k] === 'number') {
          total[k] += u[k];
          seen = true;
        }
      }
    }
  }
  return seen ? total : null;
}

function makeRpc(home: string, thinking: string | null, events: string[], sessionDir: string): PiRpcClient {
  return new PiRpcClient({
    spawn: () =>
      spawn(
        PI_BIN,
        ['--mode', 'rpc', ...(thinking ? ['--thinking', thinking] : [])],
        {
          cwd: path.join(runtimeRoot, 'project'),
          env: { ...process.env, HOME: home, PI_CODING_AGENT_SESSION_DIR: sessionDir },
          stdio: 'pipe',
        },
      ),
    commandTimeoutMs: 30_000,
    settleTimeoutMs: 300_000,
    onEvent: (name) => events.push(name),
    onDiagnostic: (m) => console.log('[m2Measure] diagnostic:', m),
  });
}

describe.skipIf(!REAL_PI || !PAID)('m2 token measurement (Issue #12, STOP-GATE 1)', () => {
  it('validates the owner consent for all 6 paid calls before anything runs', () => {
    const consentPath = process.env.PI_ACCEPTANCE_CONSENT_FILE;
    expect(consentPath, 'PI_ACCEPTANCE_CONSENT_FILE required').toBeTruthy();
    const consent: unknown = JSON.parse(readFileSync(consentPath!, 'utf8'));
    const settings = JSON.parse(
      readFileSync(path.join(os.homedir(), '.pi', 'agent', 'settings.json'), 'utf8'),
    ) as { defaultProvider?: string };
    expect(() =>
      assertPaidCallConsent(consent, { expectedProvider: settings.defaultProvider!, requiredCalls: 6 }),
    ).not.toThrow();
    mkdirSync(measureDir, { recursive: true });
    mkdirSync(path.join(runtimeRoot, 'project'), { recursive: true });
  });

  for (const task of ACCEPTANCE_TASKS) {
    for (const { tier, thinking } of TIERS) {
      it(
        `run ${task.id}/${tier}: one paid call, isolated session, deterministic checker`,
        async () => {
          const consent: unknown = JSON.parse(
            readFileSync(process.env.PI_ACCEPTANCE_CONSENT_FILE!, 'utf8'),
          );
          const settings = JSON.parse(
            readFileSync(path.join(os.homedir(), '.pi', 'agent', 'settings.json'), 'utf8'),
          ) as { defaultProvider?: string };
          assertPaidCallConsent(consent, {
            expectedProvider: settings.defaultProvider!,
            requiredCalls: 6,
          });

          const roots = await resolveSessionRoots({ fs: nodeFs, env: process.env, home: os.homedir() });
          const realDigests = roots.roots.map((r) => digest(snapshotMeta(r)));

          const runId = `${task.id}-${tier}`;
          const sessionDir = path.join(measureDir, runId);
          rmSync(sessionDir, { recursive: true, force: true });
          mkdirSync(sessionDir, { recursive: true });
          assertIsolatedSessionRoot(sessionDir, roots.roots);

          const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'pi-measure-home-'));
          const agentDir = path.join(tmpHome, '.pi', 'agent');
          mkdirSync(agentDir, { recursive: true });
          const realAgentDir = path.join(os.homedir(), '.pi', 'agent');
          // Stripped settings copy: same model/provider/thinking defaults, no
          // package auto-installs in the throwaway home (deterministic startup).
          const realSettings = JSON.parse(readFileSync(path.join(realAgentDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
          const strippedSettings = { ...realSettings };
          delete strippedSettings.packages;
          writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify(strippedSettings));
          copyFileSync(path.join(realAgentDir, 'auth.json'), path.join(agentDir, 'auth.json'));
          chmodSync(path.join(agentDir, 'auth.json'), 0o600);

          const events: string[] = [];
          const client = makeRpc(tmpHome, thinking, events, sessionDir);
          const started = Date.now();
          try {
            client.connect();
            await client.request('get_state');
            const result = await client.promptAndWait(task.prompt, { settleTimeoutMs: 300_000 });
            expect(result.aborted).toBe(false);
            const post = (await client.request('get_state')) as { model?: { cost?: Cost } };
            const wallMs = Date.now() - started;
            const cost: Cost | 'NOT MEASURED' =
              post.model?.cost && post.model.cost.input + post.model.cost.output > 0
                ? post.model.cost
                : 'NOT MEASURED';

            const created = collectFiles(sessionDir).filter((f) => f.endsWith('.jsonl'));
            expect(created.length, `expected one session jsonl under ${sessionDir}`).toBe(1);
            const reply = extractAssistantReply(created[0]);
            const verdict = task.check(reply);
            const jsonlUsage = collectUsageFromJsonl(created[0]);

            const report: RunReport = {
              task: task.id,
              tier,
              thinking,
              ok: verdict.ok,
              checkDetail: verdict.detail,
              cost: cost === 'NOT MEASURED' && jsonlUsage ? jsonlUsage : cost,
              wallMs,
              attempts: 1,
              eventsSeen: [...new Set(events)].sort(),
            };
            writeFileSync(path.join(measureDir, `${runId}.json`), `${JSON.stringify(report, null, 2)}\n`);
            console.log(
              `[m2Measure] ${runId}: ok=${verdict.ok} wallMs=${wallMs} cost=${cost === 'NOT MEASURED' ? 'NOT MEASURED' : 'captured'} detail=${verdict.detail}`,
            );
            expect(events).toContain('agent_settled');
          } finally {
            await client.close();
            rmSync(tmpHome, { recursive: true, force: true });
          }

          roots.roots.forEach((r, i) => {
            expect(digest(snapshotMeta(r)), `real session root changed: ${r}`).toBe(realDigests[i]);
          });
        },
        420_000,
      );
    }
  }

  it('aggregates the six private run reports into a sanitized summary', () => {
    const reports: RunReport[] = [];
    for (const t of ['A', 'B', 'C']) {
      for (const { tier } of TIERS) {
        const f = path.join(measureDir, `${t}-${tier}.json`);
        expect(existsSync(f), `missing run report ${f} — a run was NOT RUN`).toBe(true);
        reports.push(JSON.parse(readFileSync(f, 'utf8')) as RunReport);
      }
    }
    expect(reports.length).toBe(6);
    writeFileSync(
      path.join(measureDir, 'measure-summary.json'),
      `${JSON.stringify(reports, null, 2)}\n`,
    );
    for (const r of reports) {
      console.log(
        `[m2Measure] summary ${r.task}/${r.tier}: ok=${r.ok} attempts=${r.attempts} cost=${r.cost === 'NOT MEASURED' ? 'NOT MEASURED' : 'captured'} wallMs=${r.wallMs}`,
      );
    }
  });
});

describe.skipIf(!REAL_PI || PAID)('m2 token measurement honesty gate', () => {
  it('reports NOT RUN while the paid consent gate is not set', () => {
    console.log('[m2Measure] paid measurement tier: NOT RUN (no owner consent gate set)');
    expect(true).toBe(true);
  });
});
