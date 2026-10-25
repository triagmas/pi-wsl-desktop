/**
 * UI-A E2E (Issue #21): real Electron window over the fake WSL/Pi transport.
 * Covers the application shell, panel collapse with §8 focus return, the
 * design-system settings (5 theme cards + custom editor + typography), the
 * honest status bar, the inert terminal slot and the responsive hide order.
 * Screenshots land in the Playwright output dir for manual review (no golden-
 * image flakiness). Each run gets its own userData profile (review P2), so the
 * defaults are deterministic and the working profile is never touched.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { fakePi, launchApp } from './launchApp';

/** Body background per theme — proves the tokens actually reach the DOM. */
const DARK_BG = 'rgb(32, 34, 31)'; // #20221F
const LIGHT_BG = 'rgb(250, 249, 246)'; // #FAF9F6

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  return launchApp({ PI_WS_DESKTOP_PI: fakePi });
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

      // D2 (owner #6395777040): честный тумблер терминала — НЕ disabled:
      // кнопка показывает состояние нижнего дока, слот несёт честное уведомление
      // о PTY-контракте (без фиктивного вывода).
      await expect(page.getByTestId('status-terminal-btn')).not.toBeDisabled();
      await expect(page.getByTestId('status-terminal-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('terminal-slot')).toBeVisible();
      await expect(page.getByTestId('terminal-slot')).toHaveText(''); // инвариант: в слоте НЕТ фиктивного вывода
      await expect(page.getByTestId('terminal-dock')).toHaveText(/PTY/i); // честная надпись дока о реальном PTY в UI-B

      // Right details panel: open → focus lands in the panel context; close →
      // §8 focus returns to the opening button.
      await page.getByTestId('open-details').click();
      await expect(page.getByTestId('right-sidebar')).toBeVisible();
      await page.getByTestId('close-details').click();
      await expect(page.getByTestId('open-details')).toBeFocused();

      // Sidebar collapse: labels hide, rail stays, saved state persists.
      await page.getByTestId('sidebar-collapse').click();
      await expect(sidebar).toHaveClass(/sidebar-collapsed/);
      await page.getByTestId('sidebar-collapse').click();
      await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
      // Don't snapshot mid-transition (width animates 140ms — round-2 review).
      await expect
        .poll(() => sidebar.evaluate((el) => (el as unknown as { offsetWidth: number }).offsetWidth))
        .toBe(260);

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

      // The sidebar zone must drive the REAL project/session rows — not just a
      // dead selector (round-2 review). Fixture sessions render in the list.
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
      // Status bar and terminal slot consume their own zones as computed styles.
      await page.getByTestId('statusBar-size').fill('17');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const w = window as unknown as {
              document: { querySelector: (s: string) => unknown };
              getComputedStyle: (el: unknown) => { fontSize: string };
            };
            const el = w.document.querySelector('.status-bar');
            return el ? w.getComputedStyle(el).fontSize : 'missing';
          }),
        )
        .toBe('17px');

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
        // 1024 where the right panel becomes an overlay (≤1100).
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByTestId('nav-settings').click();
        await page.getByTestId(`theme-card-${theme}`).click();
        await expect.poll(() => bodyBackground(page)).toBe(theme === 'dark' ? DARK_BG : LIGHT_BG);
        await chatScreen();
        // open-details — toggle: после первой матрицы панель уже открыта
        // (rightVisible живёт в appearance), повторный клик закрыл бы её.
        const od = page.getByTestId('open-details');
        if ((await od.getAttribute('aria-pressed')) !== 'true') await od.click();
        await expect(page.getByTestId('right-sidebar')).toBeVisible();
        for (const [w, h] of [
          [1440, 900],
          [1280, 800],
          [1024, 768],
        ] as const) {
          await page.setViewportSize({ width: w, height: h });
          // D2 overlay-адаптив (Issue #21, owner #6395777040): на узком окне
          // открытая правая панель не вытесняет центральную колонку — она
          // ложится overlay-ом (position:absolute); на десктопе — обычная
          // колонка grid. Левая панель видима на всех трёх ширинах
          // (≤800 развёрнутая — overlay поверх центра).
          await expect(page.getByTestId('right-sidebar')).toBeVisible();
          const detailsPos = await page.evaluate((sel) => {
            const w = window as unknown as {
              document: { querySelector: (s: string) => unknown };
              getComputedStyle: (el: unknown) => { position: string };
            };
            const el = w.document.querySelector(sel);
            return el ? w.getComputedStyle(el).position : 'missing';
          }, 'aside.dl-details');
          // десктоп: обычная колонка grid (relative — контекст для resize-handle);
          // ≤1100: overlay (absolute) поверх центральной колонки.
          expect(detailsPos).toBe(w <= 1100 ? 'absolute' : 'relative');
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

test('D2 review coverage: tree scroll, left overlay ≤800, dock height clamp', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });

    // P1-3: продуктовое дерево проектов/сессий — скроллируемая область
    const treeOverflow = await page.evaluate(() => {
      const w = window as unknown as {
        document: { querySelector: (s: string) => unknown };
        getComputedStyle: (el: unknown) => { overflowY: string };
      };
      const el = w.document.querySelector('.dl-tree');
      return el ? w.getComputedStyle(el).overflowY : 'missing';
    });
    expect(treeOverflow).toBe('auto');

    // P1-2: узкое окно — развёрнутая левая панель ложится overlay-ом
    // поверх центральной колонки, а не сжимается в 71px-треке
    await page.setViewportSize({ width: 760, height: 800 });
    const sidePos = await page.evaluate(() => {
      const w = window as unknown as {
        document: { querySelector: (s: string) => unknown };
        getComputedStyle: (el: unknown) => { position: string };
      };
      const el = w.document.querySelector('aside.left-sidebar');
      return el ? w.getComputedStyle(el).position : 'missing';
    });
    expect(sidePos).toBe('absolute');

    // P1-5: низкое окно — док не съедает чат (max-height: 100% - 220px)
    await page.setViewportSize({ width: 1280, height: 440 });
    const dock = page.getByTestId('terminal-dock');
    await expect(dock).toBeVisible();
    const sizes = await page.evaluate(() => {
      const w = window as unknown as {
        document: { querySelector: (s: string) => unknown };
      };
      const parent = w.document.querySelector('.center-workspace') as unknown as { clientHeight: number };
      const dockEl = w.document.querySelector('[data-testid="terminal-dock"]') as unknown as {
        getBoundingClientRect: () => { height: number };
      };
      return { parentH: parent.clientHeight, dockH: dockEl.getBoundingClientRect().height };
    });
    expect(sizes.dockH).toBeLessThanOrEqual(sizes.parentH - 200);
  } finally {
    await app.close();
  }
});
