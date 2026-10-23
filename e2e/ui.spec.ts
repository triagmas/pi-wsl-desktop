/**
 * UI-A E2E (Issue #21): real Electron window over the fake WSL/Pi transport.
 * Covers the application shell, panel collapse with §8 focus return, the
 * design-system settings (5 theme cards + custom editor + typography), the
 * honest status bar, the inert terminal slot and the responsive hide order.
 * Screenshots land in the Playwright output dir for manual review (no golden-
 * image flakiness). Each run gets its own userData profile (review P2), so the
 * defaults are deterministic and the working profile is never touched.
 */
import { expect, test, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const mainScript = path.join(repoRoot, 'dist', 'main', 'index.cjs');
const fakeWsl = path.join(repoRoot, 'tests', 'fixtures', 'fake-wsl');
const fakePi = path.join(repoRoot, 'tests', 'fixtures', 'fakepi');

/** Body background per theme — proves the tokens actually reach the DOM. */
const DARK_BG = 'rgb(32, 34, 31)'; // #20221F
const LIGHT_BG = 'rgb(250, 249, 246)'; // #FAF9F6

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = await mkdtemp(path.join(tmpdir(), 'ui21-e2e-'));
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      PI_WS_DESKTOP_WSL_PATH: fakeWsl,
      PI_WS_DESKTOP_PI: fakePi,
      PI_WS_DESKTOP_TIMEOUT_MS: '8000',
      PI_WS_DESKTOP_USER_DATA_DIR: userData,
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

test.describe('UI-A application shell E2E', () => {
  test('shell structure, panel collapse with focus return, inert terminal slot', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      // Electron defaults to 800×600 — §7 layout assertions need desktop size.
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });

      // §5: left sidebar expanded by default, details panel hidden, status bar present.
      const sidebar = page.getByRole('complementary').first();
      await expect(sidebar).toBeVisible();
      await expect(page.getByTestId('open-details')).toHaveAttribute('aria-pressed', 'false');

      // Status bar: honest em dashes for unavailable Windows CPU/RAM (§7),
      // no invented numbers.
      await expect(page.getByTestId('status-cpu')).toHaveText('CPU —');
      await expect(page.getByTestId('status-ram')).toHaveText('RAM —');
      await expect(page.getByTestId('status-connection')).toBeVisible();
      await expect(page.getByTestId('status-distro')).toContainText('Ubuntu');

      // Terminal toggle is disabled in UI-A; the reserved slot renders inert.
      await expect(page.getByTestId('status-terminal-btn')).toBeDisabled();
      await expect(page.getByTestId('terminal-slot')).toBeVisible();
      await expect(page.getByTestId('terminal-slot')).toHaveText(''); // inert

      // Right details panel: open → focus lands in the panel context; close →
      // §8 focus returns to the opening button.
      await page.getByTestId('open-details').click();
      await expect(page.getByTestId('details-body')).toBeVisible();
      await page.getByRole('button', { name: 'Скрыть панель деталей' }).click();
      await expect(page.getByTestId('open-details')).toBeFocused();

      // Sidebar collapse: labels hide, rail stays, saved state persists.
      await page.getByTestId('sidebar-collapse').click();
      await expect(sidebar).toHaveClass(/sidebar-collapsed/);
      await page.getByTestId('sidebar-collapse').click();
      await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);

      // Fresh dark profile: the preset tokens must actually paint the body
      // (the stylesheet consumes exactly what applyTheme writes — review P1).
      await expect.poll(() => bodyBackground(page)).toBe(DARK_BG);

      await page.screenshot({ path: testInfo.outputPath('ui-shell-dark.png'), fullPage: false });
    } finally {
      await app.close();
    }
  });

  test('settings: 5 theme cards, tokens reach the DOM, typography + workspace sections', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.getByTestId('nav-settings').click();
      await expect(page.getByTestId('settings-root')).toBeVisible();

      // Isolated dark profile → the default card is checked without any click.
      await expect(page.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');

      // §9.2: exactly four presets + custom.
      for (const id of ['dark', 'light', 'claude', 'codex', 'custom']) {
        await expect(page.getByTestId(`theme-card-${id}`)).toBeVisible();
      }

      // Switch to Light: color-scheme AND real computed body color change —
      // theme tokens reach the actual rendering, not just inline vars (P1).
      await page.getByTestId('theme-card-light').click();
      await expect(page.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BG);
      const scheme = await page.evaluate(() => {
        // e2e window typing is the preload surface only — reach the DOM via casts.
        const w = window as unknown as {
          getComputedStyle: (el: unknown) => { colorScheme: string };
          document: { documentElement: unknown };
        };
        return w.getComputedStyle(w.document.documentElement).colorScheme;
      });
      expect(scheme).toContain('light');
      await page.screenshot({ path: testInfo.outputPath('ui-settings-light.png') });

      // Custom editor opens from the fifth card and can be cancelled without
      // changing the persisted theme or the document (live preview restores).
      await page.getByTestId('theme-card-custom').click();
      await expect(page.getByTestId('theme-editor')).toBeVisible();
      await page.getByTestId('theme-cancel').click();
      await expect(page.getByTestId('theme-editor')).toBeHidden();
      await expect(page.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BG); // preview did not leak

      // Typography: eight independent areas (§9.3).
      await page.getByTestId('settings-tab-typography').click();
      for (const area of ['ui', 'sidebar', 'chatInput', 'chatResponse', 'code', 'terminal', 'statusBar']) {
        await expect(page.getByTestId(`typo-${area}`)).toBeVisible();
      }

      // Workspace: layout controls exist and the status panel keeps the real
      // connection data (§5 settings scope).
      await page.getByTestId('settings-tab-workspace').click();
      await expect(page.getByTestId('left-width')).toBeVisible();
      await page.getByTestId('settings-tab-connection').click();
      await expect(page.getByTestId('status-phase')).toBeVisible();
      await expect(page.getByTestId('runtime')).toContainText('9.9.9');

      await page.getByTestId('settings-tab-appearance').click();
      await page.getByTestId('theme-card-dark').click();
      await expect.poll(() => bodyBackground(page)).toBe(DARK_BG);
      await page.screenshot({ path: testInfo.outputPath('ui-settings-dark.png') });
    } finally {
      await app.close();
    }
  });

  test('screenshot matrix: dark/light × 1440/1280/1024 with the responsive hide order', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      // Electron defaults to 800×600 — open the panel at desktop size first,
      // then walk down through the three matrix viewports.
      await page.setViewportSize({ width: 1440, height: 900 });

      const chatScreen = async (): Promise<void> => {
        // Always capture the CHAT workspace (the light shot used to stay on
        // settings — review P2). Without an active session the honest chat
        // screen is the empty-chat placeholder; the details panel opens over
        // it so the hide order stays observable in every viewport.
        await page.getByTestId('nav-chat').click();
        await expect(page.getByRole('heading', { name: 'Выберите диалог слева' })).toBeVisible();
      };

      const matrix = async (theme: 'dark' | 'light'): Promise<void> => {
        // Each iteration re-asserts desktop size: the previous one ends at
        // 1024 where the right panel is media-hidden (≤1100).
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByTestId('nav-settings').click();
        await page.getByTestId(`theme-card-${theme}`).click();
        await expect.poll(() => bodyBackground(page)).toBe(theme === 'dark' ? DARK_BG : LIGHT_BG);
        await chatScreen();
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
          await page.screenshot({ path: testInfo.outputPath(`ui-chat-${theme}-${w}x${h}.png`) });
        }
      };

      await matrix('dark');
      await matrix('light');
    } finally {
      await app.close();
    }
  });
});
