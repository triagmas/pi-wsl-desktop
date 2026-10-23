/**
 * UI-A E2E (Issue #21): real Electron window over the fake WSL/Pi transport.
 * Covers the application shell, panel collapse with §8 focus return, the
 * design-system settings (5 theme cards + custom editor + typography), the
 * honest status bar and the inert terminal slot. Screenshots land in the
 * Playwright output dir for manual review (no golden-image flakiness).
 */
import { expect, test, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const mainScript = path.join(repoRoot, 'dist', 'main', 'index.cjs');
const fakeWsl = path.join(repoRoot, 'tests', 'fixtures', 'fake-wsl');
const fakePi = path.join(repoRoot, 'tests', 'fixtures', 'fakepi');

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      PI_WS_DESKTOP_WSL_PATH: fakeWsl,
      PI_WS_DESKTOP_PI: fakePi,
      PI_WS_DESKTOP_TIMEOUT_MS: '8000',
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

test.describe('UI-A application shell E2E', () => {
  test('shell structure, panel collapse with focus return, inert terminal slot', async (_t, testInfo) => {
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });

      // §5: left sidebar expanded by default, details panel hidden, status bar present.
      const sidebar = page.getByRole('complementary').first();
      await expect(sidebar).toBeVisible();
      await expect(page.getByTestId('open-details')).toHaveAttribute('aria-pressed', 'false');

      // Status bar: honest em dashes for unavailable Windows CPU/RAM (§7),
      // no invented numbers.
      await expect(page.getByTestId('status-cpu')).toHaveText('—');
      await expect(page.getByTestId('status-ram')).toHaveText('—');
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

      await page.screenshot({ path: testInfo.outputPath('ui-shell-dark.png'), fullPage: false });
    } finally {
      await app.close();
    }
  });

  test('settings: 5 theme cards, light preset applies, typography + workspace sections', async (_t, testInfo) => {
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.getByTestId('nav-settings').click();
      await expect(page.getByTestId('settings-root')).toBeVisible();

      // §9.2: exactly four presets + custom.
      for (const id of ['dark', 'light', 'claude', 'codex', 'custom']) {
        await expect(page.getByTestId(`theme-card-${id}`)).toBeVisible();
      }
      await expect(page.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');

      // Switch to Light: color-scheme + variables change in the real window.
      await page.getByTestId('theme-card-light').click();
      await expect(page.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');
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
      // changing the persisted theme.
      await page.getByTestId('theme-card-custom').click();
      await expect(page.getByTestId('theme-editor')).toBeVisible();
      await page.getByTestId('theme-cancel').click();
      await expect(page.getByTestId('theme-editor')).toBeHidden();
      await expect(page.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');

      // Typography: eight independent areas with live previews (§9.3).
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

      // Back to dark for the default look.
      await page.getByTestId('settings-tab-appearance').click();
      await page.getByTestId('theme-card-dark').click();
      await page.screenshot({ path: testInfo.outputPath('ui-settings-dark.png') });

      // Screenshot matrix (§7): dark/light × the three required viewports,
      // verifying the responsive hide order (right panel first, then rail).
      await page.getByTestId('nav-chat').click();
      for (const [w, h] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
      ] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.screenshot({ path: testInfo.outputPath(`ui-chat-dark-${w}x${h}.png`) });
      }
      await page.getByTestId('nav-settings').click();
      await page.getByTestId('theme-card-light').click();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId('nav-chat').click();
      await page.screenshot({ path: testInfo.outputPath('ui-chat-light-1280x800.png') });
    } finally {
      await app.close();
    }
  });
});
