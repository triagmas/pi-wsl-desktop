/**
 * UI-A R02 E2E (Issue #21): real Electron window over the fake WSL/Pi
 * transport. Covers the window chrome (menu removed, branded drag topbar),
 * layout geometry (composer anchored bottom, zero-height terminal, 28px
 * status bar, right-panel expansion), the truthful sidebar/empty state, the
 * design-system settings (5 theme cards + custom editor + typography) and
 * the dark/light screenshot matrix at 1440/1280/1024 (DPI scaling is the
 * host's; px-based shell scales linearly). Screenshots land in the Playwright
 * output dir for owner review (no golden-image flakiness). Each run gets its
 * own userData profile + synthetic HOME, so the defaults are deterministic
 * and the working profile is never touched.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakePi, launchApp, waitForReady } from './launchApp';
import { expectNoPrivatePaths, sanitizedScreenshot } from './hygiene';

const repoRoot = path.join(__dirname, '..');
const fakePiRpc = path.join(repoRoot, 'tests', 'fixtures', 'fake-pi-rpc');

/** Body background per theme — proves the tokens actually reach the DOM. */
const DARK_BG = 'rgb(32, 34, 31)'; // #20221F
const LIGHT_BG = 'rgb(250, 249, 246)'; // #FAF9F6

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  return launchApp({ PI_WS_DESKTOP_PI: fakePi });
}

/** UI-A R02 review P2: launch over the deterministic RPC transport that can
 * actually stream a reply, so the populated-chat geometry is exercised.
 * streamMs=150 keeps the stream bubble observable (same as the m1 streaming
 * spec) instead of flashing past in a single tick. */
async function launchRpc(): Promise<{ app: ElectronApplication; page: Page }> {
  return launchApp({
    PI_WS_DESKTOP_PI: fakePiRpc,
    PI_WS_DESKTOP_ACTIVE_WINDOW_MS: '0',
    FAKE_PI_STREAM_MS: '150',
  });
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    // e2e window typing is the preload surface only — reach the DOM via casts.
    const w = window as unknown as {
      getComputedStyle: (el: unknown) => { backgroundColor: string };
      document: { body: unknown };
    };
    return w.getComputedStyle(w.document.body).backgroundColor;
  });
}

async function openFixtureChat(page: Page): Promise<void> {
  // Named fixture session — representative chat for the visual matrix.
  await page.getByTestId('sidebar-search-input').fill('Поиск по истории');
  const row = page.locator('[data-testid^="session-"]').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId('chat-composer')).toBeVisible();
}

test.describe('UI-A R02 application shell E2E', () => {
  test('R03 п.6: no private path material in visible text', async () => {
    // RED-first: today the bridge resourceCwd is process.cwd(), so the
    // Resources diagnostics render the real checkout path (/mnt/f/…) —
    // the exact leak the owner saw in ui-04. The fix (synthetic
    // PI_WS_DESKTOP_AGENT_CWD in launchApp) must make this pass.
    const { app, page } = await launch();
    try {
      await waitForReady(page);
      await page.getByTestId('nav-resources').click();
      await expect(page.getByTestId('resources-view')).toBeVisible({ timeout: 15_000 });
      await expectNoPrivatePaths(page);
      await page.getByTestId('nav-settings').click();
      await expect(page.locator('h1.settings-title')).toBeVisible({ timeout: 15_000 });
      await expectNoPrivatePaths(page);
      await page.getByTestId('nav-chat').click();
      await expectNoPrivatePaths(page);
    } finally {
      await app.close();
    }
  });

  test('window chrome: no application menu, branded topbar; layout geometry', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('left-sidebar')).toBeVisible({ timeout: 30_000 });

      // A1: the default File/Edit/View/Window menu is gone in the main process.
      const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu());
      expect(menu).toBeNull();

      // A1: slim branded drag topbar above the body (native caption buttons
      // render on top via titleBarOverlay — geometry 48px matches overlay).
      const topbar = page.getByTestId('shell-topbar');
      await expect(topbar).toBeVisible();
      await expect(page.getByTestId('brand-mark')).toBeVisible();
      await expect(page.getByText('Pi WSL Desktop')).toBeVisible();
      const topbarBox = await topbar.boundingBox();
      expect(Math.round(topbarBox?.height ?? 0)).toBe(48);

      // A2: expanded sidebar geometry and the honest new-chat action.
      const sidebar = page.getByTestId('left-sidebar');
      const sidebarBox = await sidebar.boundingBox();
      expect(Math.round(sidebarBox?.width ?? 0)).toBe(260);
      await expect(page.getByTestId('sidebar-new-chat')).toHaveText('Открыть последний диалог');
      await expect(page.getByTestId('sidebar-new-chat')).toHaveAttribute('title', /Pi CLI/);

      // A2: fixture hierarchy — real sessions with truthful labels: real
      // names where session_info provides one, readable file stems otherwise.
      await expect(page.getByTestId('project-list')).toContainText('Поиск по истории');
      await expect(page.getByTestId('project-list')).toContainText('E2E fixture session');
      // stem-fallback: the session without session_info shows its file stem.
      await expect(page.getByTestId('project-list')).toContainText('stem-check');

      // A6: the status bar is a flush 28px line with honest metrics.
      const statusBox = await page.getByTestId('status-bar').boundingBox();
      expect(Math.round(statusBox?.height ?? 0)).toBe(28);
      expect((statusBox?.y ?? 0) + (statusBox?.height ?? 0)).toBeLessThanOrEqual(901);
      await expect(page.getByTestId('status-cpu')).toHaveText('CPU —');
      await expect(page.getByTestId('status-ram')).toHaveText('RAM —');
      await expect(page.getByTestId('status-terminal-btn')).toBeDisabled();

      // A6: zero terminal height — no strip at all while the dock is closed.
      await expect(page.getByTestId('terminal-slot')).toHaveCount(0);
      await expect(page.getByTestId('terminal-dock')).toHaveCount(0);

      // A3: quiet empty state without the diagnostics card.
      await expect(page.getByTestId('chat-empty')).toBeVisible();
      await expect(page.getByTestId('status-phase')).toHaveCount(0);
      await expect(page.getByTestId('empty-open-latest')).toBeVisible();

      // A3: open a fixture session → composer anchored at the pane bottom.
      await openFixtureChat(page);
      const paneBox = await page.getByTestId('chat-pane').boundingBox();
      const formBox = await page.locator('.chat-form').boundingBox();
      expect(formBox).not.toBeNull();
      expect((formBox?.y ?? 0) + (formBox?.height ?? 0)).toBeGreaterThan((paneBox?.y ?? 0) + (paneBox?.height ?? 0) - 6);
      // The message list scrolls above the composer, not under it.
      const entriesBox = await page.getByTestId('chat-entries').boundingBox();
      expect(entriesBox?.y ?? 0).toBeLessThan(formBox?.y ?? 0);

      await sanitizedScreenshot(page, testInfo.outputPath('ui-01-chat-dark-expanded.png'));
    } finally {
      await app.close();
    }
  });

  test('collapsed rail + open details panel; center expands when hidden (A2/A4/A6)', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('left-sidebar')).toBeVisible({ timeout: 30_000 });
      await openFixtureChat(page);

      // A4: details panel opens with an honest Обзор tab only.
      await page.getByTestId('open-details').click();
      await expect(page.getByTestId('details-body')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Обзор' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: 'Файлы' })).toHaveCount(0);
      await expect(page.getByTestId('right-sidebar')).toContainText('Поиск по истории');

      const centerWithPanel = await page.getByTestId('center-workspace').boundingBox();

      // A4: closing returns focus to the toggle; the center expands.
      await page.getByRole('button', { name: 'Скрыть панель деталей' }).click();
      await expect(page.getByTestId('open-details')).toBeFocused();
      const centerWide = await page.getByTestId('center-workspace').boundingBox();
      expect(centerWide?.width ?? 0).toBeGreaterThan(centerWithPanel?.width ?? 0);

      // A2: rail state — 48px, icon-only, rail actions visible. (Width
      // animates 140ms — never snapshot mid-transition.)
      await page.getByTestId('sidebar-collapse').click();
      await expect(page.getByTestId('left-sidebar')).toHaveClass(/sidebar-collapsed/);
      await expect
        .poll(async () => Math.round((await page.getByTestId('left-sidebar').boundingBox())?.width ?? 0))
        .toBe(48);
      await expect(page.getByTestId('rail-new-chat')).toBeVisible();
      await expect(page.getByTestId('rail-search')).toBeVisible();
      await page.getByTestId('open-details').click();
      await expect(page.getByTestId('details-body')).toBeVisible();

      await sanitizedScreenshot(page, testInfo.outputPath('ui-02-chat-dark-rail-details.png'));
    } finally {
      await app.close();
    }
  });

  test('settings: theme cards, tokens reach the DOM, typography + workspace + connection', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('left-sidebar')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('nav-settings').click();
      await expect(page.getByTestId('settings-root')).toBeVisible();

      // Isolated dark profile → the default card is checked without any click.
      await expect(page.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');

      // §9.2: exactly four presets + custom.
      for (const id of ['dark', 'light', 'claude', 'codex', 'custom']) {
        await expect(page.getByTestId(`theme-card-${id}`)).toBeVisible();
      }

      // Switch to Light: color-scheme AND real computed body color change.
      await page.getByTestId('theme-card-light').click();
      await expect(page.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BG);

      // Custom editor opens from the fifth card and can be cancelled without
      // changing the persisted theme or the document (live preview restores).
      await page.getByTestId('theme-card-custom').click();
      await expect(page.getByTestId('theme-editor')).toBeVisible();
      await sanitizedScreenshot(page, testInfo.outputPath('ui-06-theme-editor.png'));
      await page.getByTestId('theme-cancel').click();
      await expect(page.getByTestId('theme-editor')).toBeHidden();
      await expect(page.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BG); // preview did not leak

      // Typography: eight independent areas (§9.3).
      await page.getByTestId('settings-tab-typography').click();
      for (const area of ['ui', 'sidebar', 'chatInput', 'chatResponse', 'code', 'terminal', 'statusBar']) {
        await expect(page.getByTestId(`typo-${area}`)).toBeVisible();
      }

      // The sidebar zone must drive the REAL project/session rows.
      const rowFontSize = () =>
        page.evaluate(() => {
          const w = window as unknown as {
            document: { querySelector: (s: string) => unknown };
            getComputedStyle: (el: unknown) => { fontSize: string };
          };
          const el = w.document.querySelector('.session-row') ?? w.document.querySelector('.project-row');
          return el ? w.getComputedStyle(el).fontSize : 'missing';
        });
      await expect.poll(rowFontSize).not.toBe('missing');
      await page.getByTestId('sidebar-size').fill('19');
      await expect.poll(rowFontSize).toBe('19px');
      await page.getByTestId('sidebar-weight').selectOption('700');
      const rowWeight = () =>
        page.evaluate(() => {
          const w = window as unknown as {
            document: { querySelector: (s: string) => unknown };
            getComputedStyle: (el: unknown) => { fontWeight: string };
          };
          const el = w.document.querySelector('.session-row') ?? w.document.querySelector('.project-row');
          return el ? w.getComputedStyle(el).fontWeight : 'missing';
        });
      await expect.poll(rowWeight).toBe('700');

      // A3: connection diagnostics live in Settings → Connection (real data).
      await page.getByTestId('settings-tab-connection').click();
      await expect(page.getByTestId('status-phase')).toContainText('Готово');
      await expect(page.getByTestId('runtime')).toContainText('9.9.9');

      // Workspace: layout controls exist and still persist through the store.
      await page.getByTestId('settings-tab-workspace').click();
      await expect(page.getByTestId('left-width')).toBeVisible();

      await page.getByTestId('settings-tab-appearance').click();
      await page.getByTestId('theme-card-dark').click();
      await expect.poll(() => bodyBackground(page)).toBe(DARK_BG);
      await sanitizedScreenshot(page, testInfo.outputPath('ui-settings-dark.png'));
    } finally {
      await app.close();
    }
  });

  test('resources → skills: reference layout with search and source filter (A5)', async () => {
    const testInfo = test.info();
    // Spec-owned synthetic agent home with labeled fixture skills (mirrors the
    // m2 spec isolation — the working profile and real ~/.pi are never read).
    const home = mkdtempSync(path.join(tmpdir(), 'piwsd-e2e-uia-home-'));
    const agent = path.join(home, '.pi', 'agent');
    mkdirSync(agent, { recursive: true });
    for (const [slug, label] of [
      ['brainstorming', 'Помогает превратить идею в понятный план'],
      ['code-review', 'Review diffs before merge'],
    ] as const) {
      mkdirSync(path.join(home, '.agents', 'skills', slug), { recursive: true });
      writeFileSync(
        path.join(home, '.agents', 'skills', slug, 'SKILL.md'),
        `---\nname: ${slug}\ndescription: ${label}\n---\n# ${slug}\n`,
      );
    }
    const { app, page } = await launchApp({ PI_WS_DESKTOP_PI: fakePi, PI_WS_DESKTOP_AGENT_HOME: home });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      // UI-A R02 review P1: genuine bridge READY before the inventory request.
      await waitForReady(page);
      await page.getByTestId('nav-resources').click();
      await expect(page.getByRole('heading', { name: 'Ресурсы' })).toBeVisible();
      await expect(page.getByText('Навыки, расширения и подключения вашего Pi')).toBeVisible();
      await expect(page.getByTestId('skills-search')).toBeVisible();
      await expect(page.getByTestId('skills-source-filter')).toBeVisible();
      // Rows render real fixture skill data (synthetic home, labeled fixtures).
      const rows = page.getByTestId('skill-row');
      await expect(rows).toHaveCount(2, { timeout: 30_000 });
      await expect(rows.first()).toContainText('brainstorming');
      // Client-side search narrows to one row.
      await page.getByTestId('skills-search').fill('code');
      await expect(page.getByTestId('skill-row')).toHaveCount(1);
      await sanitizedScreenshot(page, testInfo.outputPath('ui-04-resources-dark.png'));
    } finally {
      await app.close();
    }
  });

  test('populated chat: messages render, composer enabled and anchored, entries scroll independently (R02 P2)', async () => {
    // UI-A R02 review P2: the visual matrix must also exercise a POPULATED,
    // open chat — not just the closed/composer-disabled state — so the
    // bottom-anchored composer is validated against real streamed content.
    const testInfo = test.info();
    const { app, page } = await launchRpc();
    try {
      await waitForReady(page);
      await openFixtureChat(page);
      const openBtn = page.getByRole('button', { name: /открыть чат/i });
      await expect(openBtn).toBeVisible();
      await openBtn.click();
      const input = page.getByPlaceholder(/сообщение/i);
      await expect(input).toBeVisible({ timeout: 20_000 });
      await expect(input).toBeEnabled();

      // Stream a synthetic prompt through the deterministic fake RPC. m1
      // already pins the delta-by-delta streaming + interrupt; here we only
      // need a POPULATED, finalized chat to validate the layout, so we wait
      // for the durable final entries (stable, not the transient stream bubble).
      await input.fill('populate the visual matrix');
      await page.getByRole('button', { name: /отправить/i }).click();
      await expect(page.getByText('Hello 🌍 — done')).toBeVisible({ timeout: 20_000 });
      // Both the user prompt and the assistant reply are on screen.
      await expect(page.locator('.bubble-user')).toContainText('populate the visual matrix');
      await expect(page.locator('.bubble-assistant')).toContainText('Hello 🌍 — done');
      await expect(page.getByTestId('chat-status')).toHaveText('Чат открыт', { timeout: 20_000 });

      // The composer is still enabled after the run and stays bottom-anchored:
      // its bottom edge sits at the workspace bottom (within a small padding
      // tolerance), independent of how tall the entries list has grown.
      await expect(input).toBeEnabled();
      const ws = await page.getByTestId('view-chat').boundingBox();
      const form = await page.locator('.chat-form').boundingBox();
      expect(ws && form).toBeTruthy();
      if (ws && form) {
        const gap = ws.y + ws.height - (form.y + form.height);
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(24); // padding, not a layout break
      }
      await sanitizedScreenshot(page, testInfo.outputPath('ui-05-chat-populated-dark.png'));
    } finally {
      await app.close();
    }
  });

  test('screenshot matrix: dark/light × 1440/1280/1024 with the responsive hide order', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('left-sidebar')).toBeVisible({ timeout: 30_000 });
      await page.setViewportSize({ width: 1440, height: 900 });

      const openChat = async (): Promise<void> => {
        await page.getByTestId('nav-chat').click();
        await openFixtureChat(page);
      };

      const matrix = async (theme: 'dark' | 'light'): Promise<void> => {
        // Each iteration re-asserts desktop size: the previous one ends at
        // 1024 where the right panel is media-hidden (≤1100).
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByTestId('nav-settings').click();
        await page.getByTestId(`theme-card-${theme}`).click();
        await expect.poll(() => bodyBackground(page)).toBe(theme === 'dark' ? DARK_BG : LIGHT_BG);
        await openChat();
        await page.getByTestId('open-details').click();
        await expect(page.getByTestId('details-body')).toBeVisible();
        for (const [w, h] of [
          [1440, 900],
          [1280, 800],
          [1024, 768],
        ] as const) {
          await page.setViewportSize({ width: w, height: h });
          // Hide order (§7): the right details panel hides first (≤1100),
          // while the left sidebar survives down to the rail (≤800).
          if (w <= 1100) {
            await expect(page.getByTestId('right-sidebar')).toBeHidden();
          } else {
            await expect(page.getByTestId('right-sidebar')).toBeVisible();
          }
          await expect(page.getByTestId('left-sidebar')).toBeVisible();
          // No terminal strip appears at any viewport in UI-A.
          await expect(page.getByTestId('terminal-slot')).toHaveCount(0);
          await sanitizedScreenshot(page, testInfo.outputPath(`ui-matrix-${theme}-${w}x${h}.png`));
        }
      };

      await matrix('dark');
      await matrix('light');
    } finally {
      await app.close();
    }
  });
});
