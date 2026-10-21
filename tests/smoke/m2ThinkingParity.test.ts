/**
 * M2 thinking-setting verification on DISPOSABLE Pi state (Issue #12,
 * plan Task 3 step 2).
 *
 * Everything here runs against throwaway HOMEs under os.tmpdir() with a
 * stripped copy of the user settings plus a credential copy that is always
 * deleted. The real ~/.pi/agent/settings.json and the real session store
 * are fingerprinted before/after and must be byte/mtime-identical. No model
 * call is made or needed: the effective level is read back via the offline
 * get_state surface (startup resolves the configured model locally).
 *
 * Measured parity on installed Pi 1.3.0 with the configured model:
 *  - the effective level is binary for this model: `off` vs `high`;
 *  - any granular level (minimal/low/medium/high/xhigh/max) reads back as
 *    `high`; an unsupported SETTINGS value falls back to `off`;
 *  - an unsupported --thinking flag value falls back to the settings
 *    default; `--thinking off` overrides the settings default;
 *  - settings are read at session start: a concurrent rewrite affects the
 *    NEXT session, never the running one.
 * These are pinned as parity tests, not assumed from upstream docs.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PiRpcClient } from '../../src/bridge/piRpcClient';
import { nodeFs, resolveSessionRoots } from '../../src/bridge/sessions';

const REAL_PI = process.env.REAL_PI === '1';
const PI_BIN = process.env.PI_WS_DESKTOP_PI ?? path.join(os.homedir(), '.local', 'bin', 'pi');
const realAgentDir = path.join(os.homedir(), '.pi', 'agent');

interface DisposableEnv {
  home: string;
  project: string;
  settingsFile: string;
}

function makeDisposable(overrides: Record<string, unknown> = {}): DisposableEnv {
  const home = mkdtempSync(path.join(os.tmpdir(), 'pi-think-home-'));
  const project = mkdtempSync(path.join(os.tmpdir(), 'pi-think-proj-'));
  mkdirSync(path.join(project, 'sessions'), { recursive: true });
  const agentDir = path.join(home, '.pi', 'agent');
  mkdirSync(agentDir, { recursive: true });
  const real = JSON.parse(readFileSync(path.join(realAgentDir, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  // Stripped: no auto package installs in the disposable home; thinking
  // defaults and model/provider identity are preserved.
  const settings: Record<string, unknown> = { ...real, ...overrides };
  delete settings.packages;
  const settingsFile = path.join(agentDir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify(settings));
  copyFileSync(path.join(realAgentDir, 'auth.json'), path.join(agentDir, 'auth.json'));
  chmodSync(path.join(agentDir, 'auth.json'), 0o600);
  return { home, project, settingsFile };
}

async function effectiveLevel(env: DisposableEnv, extraArgs: string[] = []): Promise<string> {
  const client = new PiRpcClient({
    spawn: () =>
      spawn(PI_BIN, ['--mode', 'rpc', ...extraArgs], {
        cwd: env.project,
        env: {
          ...process.env,
          HOME: env.home,
          PI_CODING_AGENT_SESSION_DIR: path.join(env.project, 'sessions'),
        },
        stdio: 'pipe',
      }),
    commandTimeoutMs: 30_000,
    onDiagnostic: (m) => console.log('[m2Thinking] diagnostic:', m),
  });
  try {
    client.connect();
    const state = (await client.request('get_state')) as { thinkingLevel?: string };
    return state.thinkingLevel ?? 'MISSING';
  } finally {
    await client.close();
  }
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

const digest = (lines: string[]): string =>
  createHash('sha256').update(lines.join('\n')).digest('hex');

describe.skipIf(!REAL_PI)('m2 thinking parity on disposable Pi state (Issue #12)', () => {
  let realStoreDigest = '';
  let realSettingsFingerprint = '';
  const disposables: DisposableEnv[] = [];

  beforeAll(async () => {
    const roots = await resolveSessionRoots({ fs: nodeFs, env: process.env, home: os.homedir() });
    realStoreDigest = digest(snapshotMeta(roots.roots[0]));
    realSettingsFingerprint = createHash('sha256')
      .update(readFileSync(path.join(realAgentDir, 'settings.json')))
      .digest('hex');
  });

  afterAll(() => {
    for (const d of disposables) rmSync(d.home, { recursive: true, force: true });
  });

  function env(overrides: Record<string, unknown> = {}): DisposableEnv {
    const e = makeDisposable(overrides);
    disposables.push(e);
    return e;
  }

  it('baseline: effective level equals the disposable settings default', async () => {
    const e = env({ defaultThinkingLevel: 'high' });
    expect(await effectiveLevel(e)).toBe('high');
  }, 90_000);

  it('change + restore: settings default level applies to NEW sessions and reverts', async () => {
    const e = env({ defaultThinkingLevel: 'high' });
    expect(await effectiveLevel(e)).toBe('high');
    writeFileSync(
      e.settingsFile,
      JSON.stringify({ ...JSON.parse(readFileSync(e.settingsFile, 'utf8')), defaultThinkingLevel: 'off' }),
    );
    expect(await effectiveLevel(e)).toBe('off'); // changed, verified by readback
    writeFileSync(
      e.settingsFile,
      JSON.stringify({ ...JSON.parse(readFileSync(e.settingsFile, 'utf8')), defaultThinkingLevel: 'high' }),
    );
    expect(await effectiveLevel(e)).toBe('high'); // restored, verified by readback
  }, 120_000);

  it('CLI parity: --thinking off overrides the settings default', async () => {
    const e = env({ defaultThinkingLevel: 'high' });
    expect(await effectiveLevel(e, ['--thinking', 'off'])).toBe('off');
  }, 90_000);

  it('measured clamp: granular levels read back as high on this model', async () => {
    const e = env({ defaultThinkingLevel: 'low' });
    expect(await effectiveLevel(e)).toBe('high');
    expect(await effectiveLevel(e, ['--thinking', 'medium'])).toBe('high');
  }, 120_000);

  it('negative: unsupported settings value falls back to off', async () => {
    const e = env({ defaultThinkingLevel: 'ultra' });
    expect(await effectiveLevel(e)).toBe('off');
  }, 90_000);

  it('negative: unsupported --thinking value falls back to the settings default', async () => {
    const e = env({ defaultThinkingLevel: 'high' });
    expect(await effectiveLevel(e, ['--thinking', 'ultra'])).toBe('high');
  }, 90_000);

  it('concurrent modification: running session unaffected, next session picks it up', async () => {
    const e = env({ defaultThinkingLevel: 'high' });
    const client = new PiRpcClient({
      spawn: () =>
        spawn(PI_BIN, ['--mode', 'rpc'], {
          cwd: e.project,
          env: {
            ...process.env,
            HOME: e.home,
            PI_CODING_AGENT_SESSION_DIR: path.join(e.project, 'sessions'),
          },
          stdio: 'pipe',
        }),
      commandTimeoutMs: 30_000,
    });
    try {
      client.connect();
      const before = (await client.request('get_state')) as { thinkingLevel?: string };
      expect(before.thinkingLevel).toBe('high');
      // Concurrent rewrite while the session is live.
      writeFileSync(
        e.settingsFile,
        JSON.stringify({ ...JSON.parse(readFileSync(e.settingsFile, 'utf8')), defaultThinkingLevel: 'off' }),
      );
      const during = (await client.request('get_state')) as { thinkingLevel?: string };
      expect(during.thinkingLevel).toBe('high'); // running session unchanged
    } finally {
      await client.close();
    }
    expect(await effectiveLevel(e)).toBe('off'); // next session picks it up
  }, 120_000);

  it('real user settings and real session store stayed untouched', async () => {
    const roots = await resolveSessionRoots({ fs: nodeFs, env: process.env, home: os.homedir() });
    expect(
      createHash('sha256').update(readFileSync(path.join(realAgentDir, 'settings.json'))).digest('hex'),
    ).toBe(realSettingsFingerprint);
    expect(digest(snapshotMeta(roots.roots[0]))).toBe(realStoreDigest);
  }, 90_000);
});
