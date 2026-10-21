/**
 * M2 runtime acceptance smoke (Issue #12, plan Task 1) — isolated REAL Pi.
 *
 * Free tier (gate REAL_PI=1): RPC handshake + ordinary read-only session
 * events against the installed Pi with an ISOLATED session root and a
 * throwaway HOME. No model call, no network (--offline), and the real user
 * session store must stay byte/mtime-identical (metadata comparison only —
 * session text is never read into the test).
 *
 * Paid tier (additional gates REAL_PI=1 AND PI_ACCEPTANCE_PAID_CONSENT=1 AND
 * PI_ACCEPTANCE_CONSENT_FILE=<json>): exactly ONE neutral prompt through the
 * real provider, validated by assertPaidCallConsent (STOP-GATE 1) against
 * the configured provider. The session must be written only under the
 * isolated root; the real store must stay identical; the throwaway HOME
 * holding the credential copy is always deleted.
 *
 * A skipped tier is NOT RUN, never PASS.
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
import { PiRpcClient } from '../../src/bridge/piRpcClient';
import { nodeFs, resolveSessionRoots } from '../../src/bridge/sessions';

const REAL_PI = process.env.REAL_PI === '1';
const PAID = process.env.PI_ACCEPTANCE_PAID_CONSENT === '1';
const PI_BIN = process.env.PI_WS_DESKTOP_PI ?? path.join(os.homedir(), '.local', 'bin', 'pi');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runtimeRoot = path.join(repoRoot, '.superpowers', 'acceptance-runtime');
const testSessionRoot = path.resolve(process.env.M2_ACCEPTANCE_SESSION_DIR ?? path.join(runtimeRoot, 'sessions'));

/** Metadata-only snapshot: paths, sizes, mtimes, inodes. Never reads text. */
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
      if (e.isDirectory()) {
        walk(p);
      } else {
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

function digest(lines: string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function realSessionRoots(): Promise<string[]> {
  const resolved = await resolveSessionRoots({ fs: nodeFs, env: process.env, home: os.homedir() });
  expect(resolved.roots.length).toBeGreaterThan(0);
  return resolved.roots;
}

function makeRpc(opts: { home: string; offline: boolean; events: string[] }): PiRpcClient {
  return new PiRpcClient({
    spawn: () =>
      spawn(PI_BIN, ['--mode', 'rpc', ...(opts.offline ? ['--offline'] : [])], {
        cwd: path.join(runtimeRoot, 'project'),
        env: {
          ...process.env,
          HOME: opts.home,
          PI_CODING_AGENT_SESSION_DIR: testSessionRoot,
        },
        stdio: 'pipe',
      }),
    commandTimeoutMs: 30_000,
    onEvent: (name) => opts.events.push(name),
    onDiagnostic: (m) => console.log('[m2Acceptance] diagnostic:', m),
  });
}

describe.skipIf(!REAL_PI)('m2 runtime acceptance — isolated real Pi (Issue #12)', () => {
  it('free: isolated RPC handshake, no model call, real session store untouched', async () => {
    mkdirSync(testSessionRoot, { recursive: true });
    mkdirSync(path.join(runtimeRoot, 'project'), { recursive: true });
    const roots = await realSessionRoots();
    expect(() => assertIsolatedSessionRoot(testSessionRoot, roots)).not.toThrow();

    const realStoreDigests = roots.map((r) => digest(snapshotMeta(r)));
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'pi-acc-home-'));
    const events: string[] = [];
    const client = makeRpc({ home: tmpHome, offline: true, events });
    try {
      client.connect();
      const state = (await client.request('get_state')) as {
        sessionId?: string;
        isStreaming?: boolean;
        messageCount?: number;
      };
      expect(typeof state.sessionId).toBe('string');
      expect(state.isStreaming).toBe(false);
      expect(typeof state.messageCount).toBe('number');
      // No model interaction happened: an offline handshake cannot bill.
      expect(events.includes('agent_settled')).toBe(false);
    } finally {
      await client.close();
      rmSync(tmpHome, { recursive: true, force: true });
    }

    roots.forEach((root, i) => {
      expect(digest(snapshotMeta(root)), `real session root changed: ${root}`).toBe(realStoreDigests[i]);
    });
  }, 120_000);

  it.skipIf(!PAID)(
    'paid (STOP-GATE 1): one neutral prompt writes a synthetic session only under the isolated root',
    async () => {
      const consentPath = process.env.PI_ACCEPTANCE_CONSENT_FILE;
      expect(consentPath, 'PI_ACCEPTANCE_CONSENT_FILE is required for the paid tier').toBeTruthy();
      const consent: unknown = JSON.parse(readFileSync(consentPath!, 'utf8'));
      const settings = JSON.parse(
        readFileSync(path.join(os.homedir(), '.pi', 'agent', 'settings.json'), 'utf8'),
      ) as { defaultProvider?: string };
      expect(typeof settings.defaultProvider).toBe('string');
      expect(() =>
        assertPaidCallConsent(consent, { expectedProvider: settings.defaultProvider!, requiredCalls: 1 }),
      ).not.toThrow();

      mkdirSync(testSessionRoot, { recursive: true });
      mkdirSync(path.join(runtimeRoot, 'project'), { recursive: true });
      const roots = await realSessionRoots();
      expect(() => assertIsolatedSessionRoot(testSessionRoot, roots)).not.toThrow();
      const realStoreDigests = roots.map((r) => digest(snapshotMeta(r)));
      const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'pi-acc-home-'));
      // Throwaway HOME with the provider defaults + credential copy; deleted
      // in finally. Contents are never logged or committed.
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

      const beforeFiles = new Set(
        (function collect(dir: string): string[] {
          const out: string[] = [];
          let entries;
          try {
            entries = readdirSync(dir, { withFileTypes: true });
          } catch {
            return out;
          }
          for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) out.push(...collect(p));
            else out.push(p);
          }
          return out;
        })(testSessionRoot),
      );

      const events: string[] = [];
      const client = makeRpc({ home: tmpHome, offline: false, events });
      try {
        client.connect();
        await client.request('get_state');
        const result = await client.promptAndWait('Reply with exactly: ACCEPTANCE-OK', {
          settleTimeoutMs: 300_000,
        });
        expect(result.aborted).toBe(false);
        expect(events).toContain('agent_start');
        expect(events).toContain('message_update');
        expect(events).toContain('message_end');
        expect(events).toContain('agent_settled');
      } finally {
        await client.close();
      }

      try {
        // Exactly one new session file under the isolated root; nowhere else.
        const created: string[] = [];
        const walk = (dir: string): void => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (!beforeFiles.has(p)) created.push(p);
          }
        };
        walk(testSessionRoot);
        expect(created.length).toBeGreaterThan(0);
        const jsonl = created.filter((f) => f.endsWith('.jsonl'));
        expect(jsonl.length).toBe(1);
        const body = readFileSync(jsonl[0], 'utf8');
        expect(body).toContain('ACCEPTANCE-OK');
        expect(body).toContain('Reply with exactly');

        // Real user store: metadata-identical after the paid run.
        roots.forEach((root, i) => {
          expect(digest(snapshotMeta(root)), `real session root changed: ${root}`).toBe(realStoreDigests[i]);
        });
        console.log(
          `[m2Acceptance] paid prompt evidence: 1 synthetic session written under isolated root; real store metadata unchanged; events=${events.join(',')}`,
        );
      } finally {
        rmSync(tmpHome, { recursive: true, force: true });
      }
    },
    420_000,
  );

  it('reports honest tier status in the run output', () => {
    // A skipped paid tier is NOT RUN, never PASS — this pin keeps the
    // distinction visible in every run of the suite.
    if (!PAID) {
      console.log('[m2Acceptance] paid prompt tier: NOT RUN (no owner consent gate set)');
    }
    expect(existsSync(path.join(repoRoot, '.superpowers'))).toBe(true);
  });
});
