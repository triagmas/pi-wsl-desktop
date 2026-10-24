/**
 * M1 E2E (real Electron window): discovery → read-only history → explicit
 * chat resume over the fake Pi RPC → streaming → interrupt → conflict state.
 * Renderer isolation is asserted by the M0 spec and re-asserted here.
 */
import { expect, test } from '@playwright/test';
import { launchApp } from './launchApp';
import type { LaunchedApp } from './launchApp';
import { existsSync, readdirSync, utimesSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const fakePiRpc = path.join(repoRoot, 'tests', 'fixtures', 'fake-pi-rpc');
const T0 = new Date('2026-01-01T00:00:00.000Z');

/** Fixture path inside the per-launch copy (R03 п.6: never the repo). */
function fixtureOf(sessionsRoot: string): string {
  return path.join(sessionsRoot, '--e2e-project--', '2026-01-01T00-00-00-000Z_e2e.jsonl');
}

interface ExtraEnv {
  activeWindow?: string;
  pi?: string;
  streamMs?: string;
}

function launch(extra: ExtraEnv = {}): Promise<LaunchedApp> {
  return launchApp({
    ...(extra.activeWindow !== undefined ? { PI_WS_DESKTOP_ACTIVE_WINDOW_MS: extra.activeWindow } : {}),
    ...(extra.pi !== undefined ? { PI_WS_DESKTOP_PI: extra.pi } : {}),
    ...(extra.streamMs !== undefined ? { FAKE_PI_STREAM_MS: extra.streamMs } : {}),
  });
}

test.describe('M1 sessions & chat E2E', () => {
  test('discovery lists the fixture project/session; history renders read-only', async () => {
    const { app, page, sessionsRoot } = await launch({ activeWindow: '0', pi: fakePiRpc });
    try {
      expect(existsSync(fixtureOf(sessionsRoot))).toBe(true);
      await expect(page).toHaveTitle('Pi WSL Desktop');
      // UI-A R02: connection diagnostics moved to Settings — wait for the
      // bridge to be genuinely READY via the loaded fixture list.
      await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 30_000 });

      // M1 discovery: the sidebar lists the fixture project/session (§5)
      await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('E2E fixture session')).toBeVisible({ timeout: 15_000 });

      await page.getByText('E2E fixture session').click();
      await expect(page.getByTestId('session-detail')).toBeVisible();
      // R03 п.1: the stored conversation renders immediately (no tab hop).
      await expect(page.getByText('Привет из фикстуры')).toBeVisible({ timeout: 15_000 });
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
    const { app, page, sessionsRoot } = await launch({ activeWindow: '0', pi: fakePiRpc, streamMs: '150' });
    const fixtureSession = fixtureOf(sessionsRoot);
    try {
      await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('E2E fixture session')).toBeVisible({ timeout: 15_000 });
      await page.getByText('E2E fixture session').click();

      // R03 п.1 write boundary: the composer is visible and enabled at once,
      // but no session opens by itself — only the explicit send below.
      const input = page.getByPlaceholder(/сообщение/i);
      await expect(input).toBeVisible({ timeout: 20_000 });
      await expect(input).toBeEnabled();
      await expect(page.getByTestId('chat-status')).toHaveCount(0);

      // streaming: deltas render as they arrive, then message_end finalizes
      await input.fill('привет e2e');
      await page.getByRole('button', { name: /отправить/i }).click();
      await expect(page.getByText(/Hello 🌍/)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Hello 🌍 — done')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('chat-status')).toHaveText('Чат открыт', { timeout: 20_000 });

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
      await expect(page.getByPlaceholder(/сообщение/i)).toBeEnabled();

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

  test('«Новый диалог» creates a REAL session end-to-end: materializes on the first message, persists (R03 п.2)', async () => {
    const { app, page, sessionsRoot } = await launch({ activeWindow: '0', pi: fakePiRpc, streamMs: '150' });
    try {
      await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 30_000 });

      // honest primary action — real creation over Pi RPC, not a relabelled
      // open-latest fallback
      const newBtn = page.getByTestId('sidebar-new-chat');
      await expect(newBtn).toHaveText('Новый диалог');
      await expect(newBtn).toHaveAttribute('title', /Pi RPC/);
      await newBtn.click();

      // provisional dialog: label from the bridge record, conversation-first
      // surface (no tabs), empty WITHOUT any error, live composer
      await expect(page.getByTestId('chat-head')).toContainText('Новый диалог');
      await expect(page.getByTestId('tab-chat')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer')).toBeEnabled();
      await expect(page.getByTestId('chat-error')).toHaveCount(0);
      await expect(page.getByTestId('history-error')).toHaveCount(0);
      // no warning badge on an honest 'empty' provisional record
      await expect(page.getByTestId('chat-head')).not.toContainText('⚠');
      // no fake row in the index — the file does not exist yet (mirrors Pi)
      await expect(page.locator('button[data-testid^="session-"]').filter({ hasText: 'Новый диалог' })).toHaveCount(0);

      // the first explicit send materializes the file (fake mirrors
      // session-manager._persist: header + queued session_info + messages)
      await page.getByPlaceholder(/сообщение/i).fill('первый реплике нового диалога');
      await page.getByRole('button', { name: /отправить/i }).click();
      await expect(page.getByText('Hello 🌍 — done')).toBeVisible({ timeout: 20_000 });

      // real file under the session root (per-launch tmp copy — repo untouched)
      const materialized = readdirSync(sessionsRoot).some((f) => f.endsWith('.jsonl') && f.includes('fake-session-0001'));
      expect(materialized).toBe(true);

      // the sidebar picks up the REAL session under its synthetic project and
      // the durable session_info name
      const project = page.getByTestId('project-list').getByRole('button', { name: 'Pi Desktop' });
      await expect(project).toBeVisible({ timeout: 15_000 });
      await project.click();
      const row = page.locator('button[data-testid^="session-"]').filter({ hasText: 'Новый диалог' });
      await expect(row).toHaveCount(1);

      // persistence round-trip: switch away and back, close the chat — the
      // stored conversation is still there (the session lives on disk)
      await page.getByRole('button', { name: /закрыть чат/i }).click();
      await expect(page.getByText('E2E fixture session')).toBeVisible();
      await page.getByText('E2E fixture session').click();
      await expect(page.getByText('Привет из фикстуры')).toBeVisible();
      await row.click();
      await expect(page.getByText('первый реплике нового диалога')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Hello 🌍 — done')).toBeVisible();
      // review P1-1: exactly ONE copy of the turn after the round trip
      await expect(page.getByText('первый реплике нового диалога')).toHaveCount(1);

      // second turn — the reopened dialog must accept a prompt without
      // losing or duplicating the stored one (review P2-8, E2E level)
      await page.getByPlaceholder(/сообщение/i).fill('второй тёрн');
      await page.getByRole('button', { name: /отправить/i }).click();
      await expect(page.getByTestId('chat-status')).toHaveText('Чат открыт', { timeout: 20_000 });
      await expect(page.getByText('первый реплике нового диалога')).toHaveCount(1);
      await expect(page.getByText('второй тёрн')).toHaveCount(1);

      // review P1-2: leaving and returning to the chat view must not
      // refetch persisted history on top of the retained live entries
      await page.getByTestId('nav-settings').click();
      await page.getByTestId('nav-chat').click();
      await expect(page.getByText('первый реплике нового диалога')).toHaveCount(1);
      await expect(page.getByText('второй тёрн')).toHaveCount(1);
      await expect(page.getByTestId('chat-status')).toHaveText('Чат открыт');
    } finally {
      await app.close();
    }
  });

  test('a freshly-modified session file surfaces SESSION_CONFLICT instead of opening', async () => {
    const { app, page, sessionsRoot } = await launch({ pi: fakePiRpc });
    const fixtureSession = fixtureOf(sessionsRoot);
    try {
      await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('E2E fixture session')).toBeVisible({ timeout: 15_000 });
      await page.getByText('E2E fixture session').click();
      // history settles first, so the no-spinner assertion below is stable
      await expect(page.getByText('Привет из фикстуры')).toBeVisible({ timeout: 15_000 });
      // deterministic "live CLI" state: bump the mtime immediately before the
      // explicit send whose open must observe the 10s active window
      // (R03: operates on the per-launch tmp copy, never the repo fixture).
      utimesSync(fixtureSession, new Date(), new Date());
      await page.getByPlaceholder(/сообщение/i).fill('open attempt');
      await page.getByRole('button', { name: /отправить/i }).click();
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
