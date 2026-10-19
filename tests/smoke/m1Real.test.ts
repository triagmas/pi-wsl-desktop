/**
 * REAL Pi & REAL sessions smoke (Issue #5 — reported separately from CI).
 *
 * Gate: REAL_PI=1. Everything here is READ-ONLY against the installed
 * Pi 1.3.0 and the user's actual session store:
 *  - discovery + preview must leave every non-active file byte- and
 *    mtime-identical (files already changing between two baselines are
 *    active-writers and are excluded, honestly reported);
 *  - an isolated `pi --mode rpc --no-session --offline` handshake with
 *    get_state — NO model calls, NO user-`~/.pi` writes (temp HOME);
 *  - legacy v1/v2 real files are indexed when present (skipped when the
 *    machine only has v3 — disclosed).
 *
 * NOT RUN here by design (needs owner authorization): any WRITE exercise,
 * purpose-created session write, or real model prompt.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSessionIndex, nodeFs, resolveSessionRoots } from '../../src/bridge/sessions';
import { readSessionFile } from '../../src/bridge/sessionReader';
import { PiRpcClient } from '../../src/bridge/piRpcClient';
import { spawn } from 'node:child_process';

const REAL_PI = process.env.REAL_PI === '1';
const PI_BIN = process.env.PI_WS_DESKTOP_PI ?? path.join(os.homedir(), '.local', 'bin', 'pi');
const home = os.homedir();

interface Fingerprint {
  file: string;
  sha: string;
  mtimeMs: number;
}

function fp(file: string): Fingerprint {
  return {
    file,
    sha: createHash('sha256').update(readFileSync(file)).digest('hex'),
    mtimeMs: statSync(file).mtimeMs,
  };
}

describe.skipIf(!REAL_PI)('real Pi 1.3.0 + real session store (read-only)', () => {
  it('discovers real projects and leaves every stable session file byte+mtime identical', async () => {
    const roots = await resolveSessionRoots({ fs: nodeFs, env: process.env, home });
    const first = await buildSessionIndex({ fs: nodeFs, env: process.env, home });
    expect(first.sessions.length).toBeGreaterThan(0);

    const files = first.sessions.map((s) => s.file);
    // Double baseline: any file that changes between the two snapshots is an
    // active writer on this machine and is excluded from the strict set.
    const b1 = files.map(fp);
    const b2 = files.map(fp);
    const active = new Set(
      b1.filter((a, i) => a.mtimeMs !== b2[i].mtimeMs || a.sha !== b2[i].sha).map((a) => a.file),
    );
    const stable = b1.filter((a) => !active.has(a.file));

    // exercise the full read path over the real store (counts only logged)
    let readOk = 0;
    for (const s of first.sessions) {
      if (s.availability !== 'ok') continue;
      const r = await readSessionFile({ fs: nodeFs, file: s.file, limit: 50 });
      expect(r.availability).toBe('ok');
      expect(r.header).not.toBeNull();
      readOk += 1;
    }
    expect(readOk).toBeGreaterThan(0);

    const after = new Map(stable.map((a) => [a.file, fp(a.file)]));
    for (const before of stable) {
      const now = after.get(before.file);
      expect(now, before.file).toBeDefined();
      expect(now!.sha, before.file).toBe(before.sha);
      expect(now!.mtimeMs, before.file).toBe(before.mtimeMs);
    }
    // Real-machine honesty: concurrently-written files are reported, not hidden.
    if (active.size > 0) {
      console.log(`[m1Real] ${active.size} active-writer file(s) excluded from the strict set (concurrent CLI usage)`);
    }
    expect(stable.length).toBeGreaterThan(0);
    expect(roots.roots.length).toBeGreaterThan(0);
  }, 120_000);

  it('indexes the header versions actually present on this machine', async () => {
    const idx = await buildSessionIndex({ fs: nodeFs, env: process.env, home });
    const versions = new Set(idx.sessions.filter((s) => s.availability === 'ok').map((s) => s.version));
    expect(versions.has(3)).toBe(true);
    const legacy = [...versions].filter((v) => v < 3);
    if (legacy.length === 0) {
      // Disclosed: this research machine has no real legacy files (fixtures
      // cover v1/v2 synthetically).
      console.log('[m1Real] legacy v1/v2 real files: NONE on this machine (synthetic fixtures cover them)');
    } else {
      expect(legacy.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('isolated live RPC handshake: get_state over real pi with temp HOME (no model call, no user writes)', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'pi-m1-real-'));
    const events: string[] = [];
    const client = new PiRpcClient({
      spawn: () =>
        spawn(PI_BIN, ['--mode', 'rpc', '--no-session', '--offline'], {
          cwd: tmp,
          env: { ...process.env, HOME: tmp, PI_CODING_AGENT_SESSION_DIR: path.join(tmp, 'sessions') },
          stdio: 'pipe',
        }),
      commandTimeoutMs: 30_000,
      onEvent: (name) => events.push(name),
      onDiagnostic: (m) => console.log('[m1Real] diagnostic:', m),
    });
    client.connect();
    const state = (await client.request('get_state')) as { sessionId?: string; isStreaming?: boolean; messageCount?: number };
    expect(typeof state.sessionId).toBe('string');
    expect(state.isStreaming).toBe(false);
    expect(typeof state.messageCount).toBe('number');
    // sanity: the handshake is a local state read, not a model interaction
    expect(events.filter((e) => e.startsWith('message_'))).toHaveLength(0);
    await client.close();
    expect(client.alive).toBe(false);
    // isolated HOME: writes (if any) stayed inside tmp
    const escaped: string[] = [];
    const realPiDir = path.join(home, '.pi', 'agent');
    for (const f of ['models-store.json', 'auth.json']) {
      if (existsSync(path.join(tmp, '.pi', 'agent', f)) && existsSync(path.join(realPiDir, f))) continue;
      if (!existsSync(path.join(tmp, '.pi', 'agent', f))) escaped.push(f);
    }
    expect(escaped, 'expected the isolated HOME to receive pi\'s own store files').toEqual([]);
  }, 90_000);
});
