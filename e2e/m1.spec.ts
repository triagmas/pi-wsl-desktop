/**
 * M1 E2E (real Electron window): discovery → read-only history → explicit
 * chat resume over the fake Pi RPC → streaming → interrupt → conflict state.
 * Renderer isolation is asserted by the M0 spec and re-asserted here.
 */
import { expect, test, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, utimesSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const mainScript = path.join(repoRoot, 'dist', 'main', 'index.cjs');
const fakeWsl = path.join(repoRoot, 'tests', 'fixtures', 'fake-wsl');
const fakePiRpc = path.join(repoRoot, 'tests', 'fixtures', 'fake-pi-rpc');
const sessionsRoot = path.join(repoRoot, 'tests', 'fixtures', 'sessions');
const fixtureSession = path.join(sessionsRoot, '--e2e-project--', '2026-01-01T00-00-00-000Z_e2e.jsonl');
const T0 = new Date('2026-01-01T00:00:00.000Z');

interface ExtraEnv {
  activeWindow?: string;
  pi?: string;
  streamMs?: string;
}

async function launch(extra: ExtraEnv = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      PI_WS_DESKTOP_WSL_PATH: fakeWsl,
      PI_WS_DESKTOP_TIMEOUT_MS: '8000',
      PI_WS_DESKTOP_SESSION_DIR_OVERRIDE: '',
      PI_CODING_AGENT_SESSION_DIR: sessionsRoot,
      ...(extra.activeWindow !== undefined ? { PI_WS_DESKTOP_ACTIVE_WINDOW_MS: extra.activeWindow } : {}),
      ...(extra.pi !== undefined ? { PI_WS_DESKTOP_PI: extra.pi } : {}),
      ...(extra.streamMs !== undefined ? { FAKE_PI_STREAM_MS: extra.streamMs } : {}),
      FAKE_WSL_PROBE_JSON: JSON.stringify({
        ok: true,
        nodePath: process.execPath,
        nodeVersion: process.version,
        home: '/home/fake',
        bridgeOk: true,
      }),
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const app = await electron.launch({ args: [mainScript], env });
  const page = await app.firstWindow();
  return { app, page };
}

test.describe('M1 sessions & chat E2E', () => {
  test('discovery lists the fixture project/session; history renders read-only', async () => {
    expect(existsSync(fixtureSession)).toBe(true);
    const { app, page } = await launch({ activeWindow: '0', pi: fakePiRpc });
    try {
      await expect(page).toHaveTitle('Pi WSL Desktop');
      // M0 status tab is still the default (regression) — and wait for the
      // bridge to be genuinely READY (visible text alone ≠ ready on slow CI)
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });

      await page.getByTestId('tab-sessions').click();
      await expect(page.getByTestId('sessions-view')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('E2E fixture session')).toBeVisible({ timeout: 15_000 });

      await page.getByText('E2E fixture session').click();
      await expect(page.getByTestId('session-detail')).toBeVisible();
      await expect(page.getByText('Привет из фикстуры')).toBeVisible();
      await expect(page.getByText('Ответ фикстуры: всё читается без изменений')).toBeVisible();

      // renderer stays isolated inside the sessions surface
      const globals = await page.evaluate(() => ({
        process: typeof window.process,
        require: typeof (window as unknown as { require?: unknown }).require,
      }));
      expect(globals.process).toBe('undefined');
      expect(globals.require).toBe('undefined');
    } finally {
      await app.close();
    }
  });

  test('explicit chat resume streams from fake Pi RPC and interrupt returns to open state', async () => {
    const { app, page } = await launch({ activeWindow: '0', pi: fakePiRpc, streamMs: '150' });
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.getByTestId('tab-sessions').click();
      await page.getByText('E2E fixture session').click();
      await page.getByTestId('tab-chat').click();

      // write boundary: nothing opens by itself
      const openBtn = page.getByRole('button', { name: /открыть чат/i });
      await expect(openBtn).toBeVisible();
      await expect(page.getByPlaceholder(/сообщение/i)).toHaveCount(0);

      await openBtn.click();
      const input = page.getByPlaceholder(/сообщение/i);
      await expect(input).toBeVisible({ timeout: 20_000 });

      // review round 3 (#5): a second explicit open while a chat is open is
      // rejected with RESOURCE_BUSY (single chat slot, no zombie process)
      const busy = await page
        .evaluate((file) => {
          const desk = (window as unknown as {
            piDesktop: { request: (m: string, p: unknown) => Promise<unknown> };
          }).piDesktop;
          return desk.request('openSession', { file }).then(
            () => 'resolved',
            (e: Error) => e.message,
          );
        }, fixtureSession)
        .catch(() => 'rejected');
      expect(busy).toContain('RESOURCE_BUSY');
      // the already-open chat keeps working after the rejected attempt
      await expect(page.getByPlaceholder(/сообщение/i)).toBeVisible();

      // streaming: deltas render as they arrive, then message_end finalizes
      await input.fill('привет e2e');
      await page.getByRole('button', { name: /отправить/i }).click();
      await expect(page.getByText(/Hello 🌍/)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Hello 🌍 — done')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('chat-status')).toHaveText('Чат открыт', { timeout: 20_000 });

      // interrupt: a second run is stopped explicitly and state recovers
      await input.fill('ещё раз');
      await page.getByRole('button', { name: /отправить/i }).click();
      await expect(page.getByTestId('chat-status')).toHaveText('Генерация…', { timeout: 5_000 });
      await page.getByTestId('interrupt').click();
      await expect(page.getByTestId('chat-status')).toHaveText('Чат открыт', { timeout: 15_000 });
    } finally {
      await app.close();
    }
  });

  test('a freshly-modified session file surfaces SESSION_CONFLICT instead of opening', async () => {
    // deterministic "live CLI" state: mtime = right now (window default 10s)
    utimesSync(fixtureSession, new Date(), new Date());
    const { app, page } = await launch({ pi: fakePiRpc });
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.getByTestId('tab-sessions').click();
      await page.getByText('E2E fixture session').click();
      await page.getByTestId('tab-chat').click();
      await page.getByRole('button', { name: /открыть чат/i }).click();
      const alert = page.getByTestId('chat-error');
      await expect(alert).toBeVisible({ timeout: 20_000 });
      await expect(alert).toContainText('SESSION_CONFLICT');
      await expect(page.getByRole('button', { name: /повторить/i })).toBeVisible();
      await expect(page.getByTestId('spinner')).toHaveCount(0);
    } finally {
      await app.close();
      utimesSync(fixtureSession, T0, T0);
    }
  });
});
