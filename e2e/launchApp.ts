/**
 * Shared E2E launch (round-2 review isolation): every run gets its own
 * userData AND a synthetic HOME with an explicit fixture session root —
 * neither the working desktop profile nor the real `~/.pi` sessions/projects
 * are ever read or written by an E2E run. Specs layer their transport
 * overrides (fake Pi, stream timing, agent-home for resources, …) on top.
 */
import { _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cpSync, mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
export const mainScript = path.join(repoRoot, 'dist', 'main', 'index.cjs');
export const fakeWsl = path.join(repoRoot, 'tests', 'fixtures', 'fake-wsl');
export const fakePi = path.join(repoRoot, 'tests', 'fixtures', 'fakepi');
/** Committed fixture sessions — copied per launch, never written in place. */
export const fixtureSessionsSource = path.join(repoRoot, 'tests', 'fixtures', 'sessions');

/** Frozen fixture mtime: the bridge open() rejects files whose mtime is
 * within the 10s active window (a live CLI may be writing). The per-launch
 * copy must never look "just modified", so every copied JSONL is pinned to
 * this timestamp (the m1 conflict test then bumps its own copy). */
const FROZEN_MTIME = new Date('2026-01-01T00:00:00.000Z');

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  home: string;
  /** Per-launch copy of the fixture sessions (writes never hit the repo). */
  sessionsRoot: string;
}

export async function launchApp(
  extra: Record<string, string | undefined> = {},
  options: {
    /** R03 п.4: extra Chromium args (e.g. --force-device-scale-factor for
     * the 125%/150% DPI audit attempt). Ignored flags are detected via
     * devicePixelRatio and reported as NOT RUN, never faked. */
    launchArgs?: string[];
  } = {},
): Promise<LaunchedApp> {
  const userData = await mkdtemp(path.join(tmpdir(), 'piwsd-e2e-data-'));
  const home = await mkdtemp(path.join(tmpdir(), 'piwsd-e2e-home-'));
  // R03 п.6: every path the renderer can show is synthetic — the agent
  // project lives under the throwaway HOME, and the session fixtures are a
  // throwaway copy (fake materialization in R03 writes here, not the repo).
  const agentCwd = path.join(home, 'projects', 'Pi Desktop');
  mkdirSync(agentCwd, { recursive: true });
  const sessionsRoot = path.join(home, 'sessions');
  cpSync(fixtureSessionsSource, sessionsRoot, { recursive: true, preserveTimestamps: true });
  const pinMtime = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) pinMtime(p);
      else if (entry.name.endsWith('.jsonl')) utimesSync(p, FROZEN_MTIME, FROZEN_MTIME);
    }
  };
  pinMtime(sessionsRoot);
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      HOME: home,
      PI_WS_DESKTOP_USER_DATA_DIR: userData,
      PI_WS_DESKTOP_WSL_PATH: fakeWsl,
      PI_WS_DESKTOP_TIMEOUT_MS: '8000',
      PI_WS_DESKTOP_AGENT_CWD: agentCwd,
      PI_CODING_AGENT_SESSION_DIR: sessionsRoot,
      FAKE_WSL_PROBE_JSON: JSON.stringify({
        ok: true,
        nodePath: process.execPath,
        nodeVersion: process.version,
        home: '/home/fake',
        bridgeOk: true,
      }),
      ...extra,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const app = await electron.launch({ args: [mainScript, ...(options.launchArgs ?? [])], env });
  const page = await app.firstWindow();
  return { app, page, userData, home, sessionsRoot };
}

/** UI-A R02 review P1: an honest bridge-READY gate. The left sidebar is
 * visible before the connection reaches READY, so a plain `left-sidebar`
 * visible-wait races bridge startup and can hang a resource-inventory test.
 * `sidebar-connection` renders «Pi подключён» only from `phase === 'ready'`
 * (LeftSidebar), so waiting for that text waits for the bridge itself. */
export async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByTestId('sidebar-connection')).toContainText('Pi подключён', { timeout: 30_000 });
}
