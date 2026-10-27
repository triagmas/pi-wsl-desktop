/**
 * M1 E2E (real Electron window): discovery → read-only history → explicit
 * chat resume over the fake Pi RPC → streaming → interrupt → conflict state.
 * Renderer isolation is asserted by the M0 spec and re-asserted here.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp } from './launchApp';
import { existsSync, utimesSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const fakePiRpc = path.join(repoRoot, 'tests', 'fixtures', 'fake-pi-rpc');
const sessionsRoot = path.join(repoRoot, 'tests', 'fixtures', 'sessions');
const fixtureSession = path.join(sessionsRoot, '--e2e-project--', '2026-01-01T00-00-00-000Z_e2e.jsonl');
const T0 = new Date('2026-01-01T00:00:00.000Z');

interface ExtraEnv {
  activeWindow?: string;
  pi?: string;
  streamMs?: string;
}

function launch(extra: ExtraEnv = {}): Promise<{ app: ElectronApplication; page: Page }> {
  return launchApp({
    ...(extra.activeWindow !== undefined ? { PI_WS_DESKTOP_ACTIVE_WINDOW_MS: extra.activeWindow } : {}),
    ...(extra.pi !== undefined ? { PI_WS_DESKTOP_PI: extra.pi } : {}),
    ...(extra.streamMs !== undefined ? { FAKE_PI_STREAM_MS: extra.streamMs } : {}),
  });
}

test.describe('M1 sessions & chat E2E', () => {
  test('discovery lists the fixture project/session; history renders read-only', async () => {
    expect(existsSync(fixtureSession)).toBe(true);
    const { app, page } = await launch({ activeWindow: '0', pi: fakePiRpc });
    try {
      await expect(page).toHaveTitle('Pi WSL Desktop');
      // UI-A: chat is the default screen with the real status visible in the
      // empty state — wait for the bridge to be genuinely READY (visible text
      // alone ≠ ready on slow CI)
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });

      // M1 discovery: the sidebar lists the fixture project/session (§5)
      await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 15_000 });
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
      await expect(page.getByText('E2E fixture session')).toBeVisible({ timeout: 15_000 });
      await page.getByText('E2E fixture session').click();

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
      await expect(page.getByText('E2E fixture session')).toBeVisible({ timeout: 15_000 });
      await page.getByText('E2E fixture session').click();
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
