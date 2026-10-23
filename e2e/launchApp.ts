/**
 * Shared E2E launch (round-2 review isolation): every run gets its own
 * userData AND a synthetic HOME with an explicit fixture session root —
 * neither the working desktop profile nor the real `~/.pi` sessions/projects
 * are ever read or written by an E2E run. Specs layer their transport
 * overrides (fake Pi, stream timing, agent-home for resources, …) on top.
 */
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
export const mainScript = path.join(repoRoot, 'dist', 'main', 'index.cjs');
export const fakeWsl = path.join(repoRoot, 'tests', 'fixtures', 'fake-wsl');
export const fakePi = path.join(repoRoot, 'tests', 'fixtures', 'fakepi');
export const sessionsRoot = path.join(repoRoot, 'tests', 'fixtures', 'sessions');

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  home: string;
}

export async function launchApp(
  extra: Record<string, string | undefined> = {},
): Promise<LaunchedApp> {
  const userData = await mkdtemp(path.join(tmpdir(), 'piwsd-e2e-data-'));
  const home = await mkdtemp(path.join(tmpdir(), 'piwsd-e2e-home-'));
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      HOME: home,
      PI_WS_DESKTOP_USER_DATA_DIR: userData,
      PI_WS_DESKTOP_WSL_PATH: fakeWsl,
      PI_WS_DESKTOP_TIMEOUT_MS: '8000',
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
  const app = await electron.launch({ args: [mainScript], env });
  const page = await app.firstWindow();
  return { app, page, userData, home };
}
