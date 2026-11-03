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
import path from 'node:path';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fakePi, launchApp } from './launchApp';

const repoRoot = path.join(__dirname, '..');
/** Рабочий фикстурный Pi RPC (как в m1.spec) — нужен для открытия истории. */
const fakePiRpc = path.join(repoRoot, 'tests', 'fixtures', 'fake-pi-rpc');

/** Body background per theme — proves the tokens actually reach the DOM. */
const DARK_BG = 'rgb(32, 34, 31)'; // #20221F
const LIGHT_BG = 'rgb(250, 249, 246)'; // #FAF9F6

async function launch(pi = fakePi): Promise<{ app: ElectronApplication; page: Page }> {
  return launchApp({ PI_WS_DESKTOP_PI: pi });
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
      // D3: approved DOM — корень ui/Sidebar (div), поэтому по testid, не по aside-роли.
      const sidebar = page.getByTestId('left-sidebar');
      await expect(sidebar).toBeVisible();
      await expect(page.getByTestId('open-details')).toHaveAttribute('aria-pressed', 'false');

      // Status bar: только реальные индикаторы (§7). UI-B приносит настоящие
      // метрики Windows-хоста из main-процесса; пока снимка нет — «—», и
      // выдуманных чисел быть не может.
      await expect(page.getByTestId('status-cpu')).toContainText(/CPU (—|\d+%)/);
      await expect(page.getByTestId('status-ram')).toContainText(/RAM (—|\d+([.,]\d+)? \/ \d+([.,]\d+)? ГБ)/);
      await expect(page.getByTestId('status-bar')).toContainText('Windows');
      await expect(page.getByTestId('status-connection')).toBeVisible();
      await expect(page.getByTestId('status-distro')).toContainText('Ubuntu');

      // D2 (owner #6395777040): честный тумблер терминала — НЕ disabled:
      // кнопка показывает состояние нижнего дока, слот несёт честное уведомление
      // о PTY-контракте (без фиктивного вывода).
      await expect(page.getByTestId('status-terminal-btn')).not.toBeDisabled();
      await expect(page.getByTestId('status-terminal-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('terminal-slot')).toBeVisible();
      await expect(page.getByTestId('terminal-slot')).toHaveText(''); // инвариант: в слоте НЕТ фиктивного вывода
      await expect(page.getByTestId('terminal-dock')).toHaveText(/PTY/i); // честная надпись дока о реальном PTY
      // UI-B: shell стартует только по действию пользователя — до клика сессии нет.
      await expect(page.getByTestId('terminal-xterm')).toHaveCount(0);

      // Right details panel: open → focus lands in the panel context; close →
      // §8 focus returns to the opening button.
      await page.getByTestId('open-details').click();
      await expect(page.getByTestId('right-sidebar')).toBeVisible();
      // R07 §1: единственный тумблер шапки и открывает, и закрывает панель.
      await page.getByTestId('open-details').click();
      await expect(page.getByTestId('right-sidebar')).toHaveCount(0);
      await expect(page.getByTestId('open-details')).toBeFocused();

      // Sidebar collapse: labels hide, rail stays, saved state persists.
      await page.getByTestId('sidebar-collapse').click();
      // D3: свёрнутая панель — approved ui/Rail (data-collapsed), не legacy-класс.
      await expect(sidebar).toHaveClass(/dl-rail/);
      await page.getByTestId('sidebar-collapse').click();
      await expect(sidebar).not.toHaveClass(/dl-rail/);
      // Don't snapshot mid-transition (width animates 140ms — round-2 review).
      await expect
        .poll(() => sidebar.evaluate((el) => (el as unknown as { offsetWidth: number }).offsetWidth))
        .toBe(321); // DEFAULT leftWidth = канон лабы

      // Fresh dark profile: the preset tokens must actually paint the body
      // (the stylesheet consumes exactly what applyTheme writes — review P1).
      await expect.poll(() => bodyBackground(page)).toBe(DARK_BG);

      await page.screenshot({ path: testInfo.outputPath('ui-shell-dark.png'), fullPage: false });
    } finally {
      await app.close();
    }
  });

  test('settings: 5 light / 4 dark palettes, four colors, two font slots', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      // Колонка 760 px требует десктопной ширины (Electron стартует с 800×600).
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByTestId('nav-settings').click();
      await expect(page.getByTestId('settings-root')).toBeVisible();

      // Контракт Stage 2 R01: одна страница, три раздела, колонка 760 px.
      for (const id of ['settings-appearance', 'settings-typography', 'settings-connection']) {
        await expect(page.getByTestId(id)).toBeVisible();
      }
      const colWidth = await page.evaluate(() => {
        const w = window as unknown as {
          document: { querySelector: (s: string) => unknown };
          getComputedStyle: (el: unknown) => { width: string };
        };
        const el = w.document.querySelector('[data-testid="settings-col"]');
        return el ? parseFloat(w.getComputedStyle(el).width) : 0;
      });
      expect(colWidth).toBeGreaterThan(740);
      expect(colWidth).toBeLessThan(780);

      // Тёмный режим по умолчанию: 4 палитры, выбрана «Тёмная».
      await expect(page.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');
      for (const id of ['dark', 'claudeDark', 'codexDark', 'custom']) {
        await expect(page.getByTestId(`theme-card-${id}`)).toBeVisible();
      }
      await expect(page.getByTestId('theme-card-light')).toHaveCount(0);

      // Светлый режим: 5 палитр.
      await page.getByTestId('theme-mode-light').click();
      for (const id of ['light', 'astra', 'claudeLight', 'codexLight', 'custom']) {
        await expect(page.getByTestId(`theme-card-${id}`)).toBeVisible();
      }
      await page.getByTestId('theme-card-light').click();
      await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BG);
      const schemeLight = await page.evaluate(() => {
        const w = window as unknown as {
          getComputedStyle: (el: unknown) => { colorScheme: string };
          document: { documentElement: unknown };
        };
        return w.getComputedStyle(w.document.documentElement).colorScheme;
      });
      expect(schemeLight).toContain('light');
      await page.screenshot({ path: testInfo.outputPath('ui-settings-light.png') });

      // «Своя» тема: ровно четыре поля цвета, живой предпросмотр, Apply.
      await page.getByTestId('theme-card-custom').click();
      await expect(page.getByTestId('theme-editor')).toBeVisible();
      const colorInputs = await page.getByTestId('theme-editor').locator('input[type="color"]').count();
      expect(colorInputs).toBe(4);
      await page.getByTestId('custom-accent').evaluate((node) => {
        // e2e-контекст: DOM-типы недоступны в node-конфиге TS — сужаем локально.
        // Натуральный setter нужен, чтобы React увидел onChange (трекер value).
        const g = globalThis as unknown as {
          HTMLInputElement: { prototype: object };
          Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
          Object: { getOwnPropertyDescriptor: (o: object, p: string) => { set?: (v: string) => void } | undefined };
        };
        const el = node as unknown as { dispatchEvent: (ev: unknown) => boolean };
        const desc = g.Object.getOwnPropertyDescriptor(g.HTMLInputElement.prototype, 'value');
        desc?.set?.call(el, '#0e7490');
        el.dispatchEvent(new g.Event('input', { bubbles: true }));
        el.dispatchEvent(new g.Event('change', { bubbles: true }));
      });
      await expect(page.getByTestId('custom-contrast-status')).toHaveAttribute('data-ok', 'true');
      await page.getByTestId('theme-apply').click();
      await expect(page.getByTestId('settings-state')).toHaveText(/применено/);
      // После применения черновик чист — «Отмена» недоступна (честное состояние).
      await expect(page.getByTestId('theme-cancel')).toBeDisabled();
      await expect(page.getByTestId('theme-card-custom')).toHaveAttribute('aria-checked', 'true');
      // Правим ещё раз и отменяем: редактор остаётся на сохранённой «своей» теме.
      await page.getByTestId('custom-accent').evaluate((node) => {
        const g = globalThis as unknown as {
          HTMLInputElement: { prototype: object };
          Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
          Object: { getOwnPropertyDescriptor: (o: object, p: string) => { set?: (v: string) => void } | undefined };
        };
        const el = node as unknown as { dispatchEvent: (ev: unknown) => boolean };
        const desc = g.Object.getOwnPropertyDescriptor(g.HTMLInputElement.prototype, 'value');
        desc?.set?.call(el, '#123456');
        el.dispatchEvent(new g.Event('input', { bubbles: true }));
        el.dispatchEvent(new g.Event('change', { bubbles: true }));
      });
      await expect(page.getByTestId('theme-cancel')).toBeEnabled();
      await page.getByTestId('theme-cancel').click();
      await expect(page.getByTestId('settings-state')).toHaveText(/применено/);
      await expect(page.getByTestId('theme-editor')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('ui-settings-custom.png') });

      // Типографика: системный блок без контролов + два слота с превью.
      await expect(page.getByTestId('font-block-system').locator('input, select')).toHaveCount(0);
      for (const slot of ['reply', 'code']) {
        await expect(page.getByTestId(`font-${slot}-family`)).toBeVisible();
        await expect(page.getByTestId(`font-${slot}-size`)).toBeVisible();
        await expect(page.getByTestId(`preview-${slot}`)).toBeVisible();
      }

      // Ширины панелей и высота терминала больше не настройки страницы.
      await expect(page.getByTestId('left-width')).toHaveCount(0);
      await expect(page.getByTestId('settings-workspace')).toHaveCount(0);

      // Подключение: реальные данные моста.
      await expect(page.getByTestId('status-phase')).toBeVisible();
      await expect(page.getByTestId('runtime-pi')).toContainText('версия');

      await page.getByTestId('theme-mode-dark').click();
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
        if (theme === 'light') await page.getByTestId('theme-mode-light').click();
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
  const { app, page } = await launch(fakePiRpc);
  try {
    await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });

    // P1-code: R07 — сохранённая история открывается в общей ленте сразу,
    // без вкладки «История»; фикстура содержит markdown с inline/fenced-кодом.
    await page.getByText('E2E fixture session').click();
    await expect(page.locator('[data-testid="chat-pane"] .dl-md code').first()).toBeVisible({ timeout: 20_000 });

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
      const el =
        w.document.querySelector('.dl-side .dl-sidebar') ??
        w.document.querySelector('aside.left-sidebar');
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

    // P1-nav: в коротком окне навигация остаётся достижимой (fallback-скролл
    // сайдбара), а не срезается за обрезом flex-none блоков.
    await page.setViewportSize({ width: 1024, height: 600 });
    const settingsNav = page.getByTestId('nav-settings');
    await settingsNav.scrollIntoViewIfNeeded();
    await expect(settingsNav).toBeVisible();

    // P1-code: шрифт области кода управляется code-токеном настроек,
    // а не унаследованной константой response-зоны.
    // R07: сохранённая история теперь в общей ленте (chat-pane), не во вкладке.
    const code = page.locator('[data-testid="chat-pane"] .dl-md code').first();
    await expect(code).toBeVisible();
    const family = await code.evaluate((el) => {
      const w = window as unknown as { getComputedStyle: (e: unknown) => { fontFamily: string } };
      return w.getComputedStyle(el).fontFamily;
    });
    const token = await page.evaluate(() => {
      const w = window as unknown as {
        document: { querySelector: (s: string) => unknown };
        getComputedStyle: (el: unknown) => { getPropertyValue: (n: string) => string };
      };
      const root = w.getComputedStyle(w.document.querySelector('html'));
      return root.getPropertyValue('--pw-font-code-family').trim();
    });
    expect(token.length).toBeGreaterThan(0);
    // вычисленный шрифт кода совпадает с токеном настроек, а не с унаследованным
    const firstFace = token.split(',')[0].replace(/["']/g, '').trim();
    expect(family).toContain(firstFace);

    // Полный code-контракт §9.3 (round-3 P2): размер и интерлиньяж inline- и
    // fenced-кода берутся из токенов настроек, а не наследуют ответ/историю.
    const codeZone = await page.evaluate(() => {
      const w = window as unknown as {
        document: { querySelector: (s: string) => unknown };
        getComputedStyle: (el: unknown) => {
          getPropertyValue: (n: string) => string;
          fontSize: string;
          lineHeight: string;
        };
      };
      const rootStyle = w.getComputedStyle(w.document.querySelector('html'));
      return {
        size: rootStyle.getPropertyValue('--pw-font-code-size').trim(),
        lineHeight: rootStyle.getPropertyValue('--pw-font-code-line-height').trim(),
        elFontSize: w.getComputedStyle(w.document.querySelector('[data-testid="chat-pane"] .dl-md code')).fontSize,
        elLineHeight: w.getComputedStyle(w.document.querySelector('[data-testid="chat-pane"] .dl-md code')).lineHeight,
        fencFontSize: w.getComputedStyle(w.document.querySelector('[data-testid="chat-pane"] .dl-md pre code')).fontSize,
        fencLineHeight: w.getComputedStyle(w.document.querySelector('[data-testid="chat-pane"] .dl-md pre code')).lineHeight,
      };
    });
    expect(codeZone.size).toMatch(/px$/);
    expect(codeZone.elFontSize).toBe(codeZone.size);
    // line-height токен безразмерный (например 1.6) → used value в px
    const expectedLh = parseFloat(codeZone.lineHeight) * parseFloat(codeZone.elFontSize);
    expect(Math.abs(parseFloat(codeZone.elLineHeight) - expectedLh)).toBeLessThan(0.6);
    expect(codeZone.fencFontSize).toBe(codeZone.size);
    const fencLh = parseFloat(codeZone.fencLineHeight);
    expect(Math.abs(fencLh - expectedLh)).toBeLessThan(0.6);
  } finally {
    await app.close();
  }
});

/**
 * R01 (#6559283775): владелец проверял реальный Windows-EXE и нашёл четыре
 * регрессии. Здесь — реальные layout-инварианты, которые jsdom не измерить:
 * прокрутка Settings (единственный скролл-контейнер), настоящие действия
 * «Проекты» и терминала, отсутствие кнопки refresh в шапке.
 */
test.describe('R01 owner acceptance repair', () => {
  const screenGeometry = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as {
        document: { querySelector: (s: string) => unknown };
        getComputedStyle: (el: unknown) => { overflowY: string; height: string };
      };
      const el = w.document.querySelector('[data-testid="settings-root"]') as unknown as {
        clientHeight: number;
        scrollHeight: number;
        scrollTop: number;
      } | null;
      const page_ = w.document.querySelector('[data-testid="view-settings"]') as unknown as {
        clientHeight: number;
      } | null;
      if (!el || !page_) return null;
      const cs = w.getComputedStyle(el);
      return {
        overflowY: cs.overflowY,
        screenClient: el.clientHeight,
        screenScroll: el.scrollHeight,
        slotHeight: page_.clientHeight,
        scrollTop: el.scrollTop,
      };
    });

  test('Settings прокручивается до конца в тёмной и светлой теме', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1280, height: 700 });
      await page.getByTestId('nav-settings').click();
      await expect(page.getByTestId('settings-root')).toBeVisible();

      for (const mode of ['dark', 'light'] as const) {
        await page.getByTestId(`theme-mode-${mode}`).click();
        const g = await screenGeometry(page);
        expect(g).not.toBeNull();
        // один настоящий скролл-контейнер: контент выше вьюпорта
        expect(g!.overflowY).toBe('auto');
        expect(g!.screenClient).toBe(g!.slotHeight);
        expect(g!.screenScroll).toBeGreaterThan(g!.screenClient + 200);

        // колесо мыши
        const box = await page.getByTestId('settings-root').boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + 40);
        await page.mouse.wheel(0, 4000);
        await expect
          .poll(async () => (await screenGeometry(page))!.scrollTop)
          .toBeGreaterThan(100);

        // End → низ, действия доступны и в пределах окна
        await page.keyboard.press('End');
        await expect
          .poll(async () => {
            const cur = (await screenGeometry(page))!;
            return cur.scrollTop + cur.screenClient;
          })
          .toBeGreaterThanOrEqual((await screenGeometry(page))!.screenScroll - 4);
        await expect(page.getByTestId('theme-apply')).toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath(`r01-settings-${mode}-bottom.png`),
          fullPage: false,
        });

        // Home → верх
        await page.keyboard.press('Home');
        await expect.poll(async () => (await screenGeometry(page))!.scrollTop).toBe(0);
        await expect(page.getByTestId('settings-appearance')).toBeInViewport();
        await expect(page.getByTestId(`theme-mode-${mode}`)).toHaveAttribute('aria-checked', 'true');
      }

      // .dl-main остаётся без собственной прокрутки — не появился второй скролл
      const mainOverflow = await page.evaluate(() => {
        const w = window as unknown as {
          document: { querySelector: (s: string) => unknown };
          getComputedStyle: (el: unknown) => { overflowY: string };
        };
        const el = w.document.querySelector('.dl-main');
        return el ? w.getComputedStyle(el).overflowY : '';
      });
      expect(mainOverflow).toBe('hidden');
    } finally {
      await app.close();
    }
  });

  test('«Проекты», терминал и названия сессий работают в реальном окне', async () => {
    const testInfo = test.info();
    const { app, page } = await launch();
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1440, height: 900 });

      // --- «Проекты» ---
      const toggle = page.getByTestId('projects-toggle');
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const tree = page.getByTestId('project-list');
      await expect(tree).toBeVisible();
      // кнопка refresh больше не занимает место в шапке
      await expect(page.getByTestId('refresh-sessions')).toHaveCount(0);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(tree).toHaveCount(0);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(tree).toBeVisible();

      // клавиатура: заголовок — обычная кнопка
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');

      // --- названия сессий ---
      const titles = await page.evaluate(() => {
        const w = window as unknown as { document: { querySelectorAll: (s: string) => ArrayLike<{ textContent: string | null }> } };
        return Array.from(w.document.querySelectorAll('[data-testid^="session-"]')).map(
          (el) => (el.textContent ?? '').trim(),
        );
      });
      expect(titles.length).toBeGreaterThan(0);
      for (const t of titles) {
        expect(t, 'технический id вместо названия').not.toMatch(/^[0-9a-f]{8}$/);
      }

      // --- терминал ---
      const dock = page.getByTestId('terminal-dock');
      await expect(dock).toBeVisible();
      const h0 = (await dock.boundingBox())!.height;
      await page.getByTestId('terminal-expand').click();
      await expect(page.getByTestId('terminal-expand')).toHaveAttribute('aria-pressed', 'true');
      const h1 = (await dock.boundingBox())!.height;
      expect(h1).toBeGreaterThan(h0 + 40);
      await page.screenshot({ path: testInfo.outputPath('r01-terminal-expanded.png'), fullPage: false });
      await page.getByTestId('terminal-expand').click();
      await expect(page.getByTestId('terminal-expand')).toHaveAttribute('aria-pressed', 'false');
      expect((await dock.boundingBox())!.height).toBeCloseTo(h0, 0);

      // UI-B R01: док скрывается, но остаётся смонтированным — внутри живёт
      // настоящий PTY, поэтому проверяем видимость, а не удаление из DOM.
      await page.getByTestId('terminal-close').click();
      await expect(page.getByTestId('terminal-dock-host')).toHaveAttribute('hidden', '');
      await expect(dock).toBeHidden();
      await page.getByTestId('status-terminal-btn').click();
      await expect(page.getByTestId('terminal-dock-host')).not.toHaveAttribute('hidden');
      await expect(dock).toBeVisible();
    } finally {
      await app.close();
    }
  });
});

/**
 * UI Owner Review R02 (Issue #21, comment #6566550672) — реальное окно Electron.
 *
 * Владелец проверял сборку руками: «Новый диалог» уходил в произвольный проект,
 * в черновике не было поля ввода, а левый сайдбар жил на трёх разных сетках.
 * Здесь это измеряется в CSS px: колонка иконок, зазор до имени, правая колонка
 * «+», симметрия полей чата.
 */
test.describe('R02 · сайдбар, чат и композер', () => {
  test('одна сетка сайдбара: иконки 16, общий зазор, «+» в своей колонке', async () => {
    const { app, page } = await launch(fakePiRpc);
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1280, height: 800 });
      // первый проект раскрыт по умолчанию — строки сессий уже видны
      const session = page.locator('[data-testid^="session-"]').first();
      await expect(session).toBeVisible();

      const geo = await page.evaluate(() => {
        type El = {
          getBoundingClientRect: () => { x: number; y: number; width: number; height: number; right: number };
          querySelector: (s: string) => El | null;
          scrollWidth: number;
          clientWidth: number;
        };
        const w = window as unknown as {
          getComputedStyle: (el: El) => { textOverflow: string; paddingRight: string };
          document: { querySelectorAll: (s: string) => ArrayLike<El> };
        };
        const rect = (el: El) => el.getBoundingClientRect();
        const pick = (sel: string) => Array.from(w.document.querySelectorAll(sel))[0] ?? null;
        const rows = [
          pick('[data-testid^="project-/"]'),
          pick('[data-testid^="session-"]'),
          pick('[data-testid="nav-chat"]'),
        ].filter((el): el is El => el !== null);
        const out = rows.map((row) => {
          const icon = row.querySelector('.dl-row-icon');
          const text = row.querySelector('.dl-row-text');
          return {
            row: rect(row),
            icon: icon ? rect(icon) : null,
            text: text ? rect(text) : null,
          };
        });
        const tree = pick('.dl-tree');
        const plus = pick('.dl-project-new');
        const projectRow = rows[0];
        return {
          rows: out,
          tree: tree ? rect(tree) : null,
          treeScrollW: tree ? tree.scrollWidth : null,
          treeClientW: tree ? tree.clientWidth : null,
          plus: plus ? rect(plus) : null,
          projectPadRight: projectRow
            ? w.getComputedStyle(projectRow).paddingRight
            : null,
          projectRowRight: projectRow ? rect(projectRow).right : null,
          textOverflow: projectRow && projectRow.querySelector('.dl-row-text')
            ? w.getComputedStyle(projectRow.querySelector('.dl-row-text') as El).textOverflow
            : null,
        };
      });

      expect(geo.rows.length).toBe(3);
      for (const row of geo.rows) {
        expect(row.icon, 'нет иконочной колонки').not.toBeNull();
        // 16 CSS px — внутри B1-диапазона 14–16 и одинаково во всех строках
        expect(Math.round(row.icon!.width)).toBe(16);
        expect(Math.round(row.icon!.height)).toBe(16);
      }
      const iconX = geo.rows.map((r) => Math.round(r.icon!.x));
      const textX = geo.rows.map((r) => Math.round(r.text!.x));
      const rowLeft = geo.rows.map((r) => Math.round(r.row.x));
      const rowRight = geo.rows.map((r) => Math.round(r.row.right));
      expect(new Set(iconX).size, `иконки не в одной колонке: ${iconX.join('/')}`).toBe(1);
      expect(new Set(textX).size, `имена не выровнены: ${textX.join('/')}`).toBe(1);
      expect(new Set(rowLeft).size, `левый край строк разный: ${rowLeft.join('/')}`).toBe(1);
      expect(new Set(rowRight).size, `правый край строк разный: ${rowRight.join('/')}`).toBe(1);

      // «+» — отдельная правая колонка 28×28 внутри дерева, имя не перекрыто
      expect(Math.round(geo.plus!.width)).toBe(28);
      expect(Math.round(geo.plus!.height)).toBe(28);
      expect(Math.abs(geo.plus!.right - geo.projectRowRight!)).toBeLessThanOrEqual(1);
      expect(geo.projectPadRight).toBe('36px');
      expect(geo.textOverflow).toBe('ellipsis');
      // нет горизонтального артефакта/переполнения под «Проекты»
      expect(geo.treeScrollW!).toBeLessThanOrEqual(geo.treeClientW! + 1);
    } finally {
      await app.close();
    }
  });

  test('чат и композер стоят в одной симметричной колонке', async () => {
    const { app, page } = await launch(fakePiRpc);
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByText('E2E fixture session').click();
      await expect(page.locator('[data-testid="chat-pane"] .dl-md').first()).toBeVisible({
        timeout: 20_000,
      });
      for (const width of [1280, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        const m = await page.evaluate(() => {
          type El = {
            getBoundingClientRect: () => { x: number; y: number; width: number; height: number; right: number };
          };
          const w = window as unknown as { document: { querySelectorAll: (s: string) => ArrayLike<El> } };
          const rect = (el: El) => el.getBoundingClientRect();
          const pick = (sel: string) => Array.from(w.document.querySelectorAll(sel))[0] ?? null;
          const feed = pick('[data-testid="chat-feed"]');
          const turn = pick('.dl-turn-assistant');
          const md = pick('.dl-md');
          const composer = pick('.dl-composer-wrap');
          const inner = pick('.dl-composer');
          return {
            feed: feed ? rect(feed) : null,
            feedScroll: feed
              ? { w: (feed as unknown as { scrollWidth: number }).scrollWidth, cw: (feed as unknown as { clientWidth: number }).clientWidth }
              : null,
            turn: turn ? rect(turn) : null,
            md: md ? rect(md) : null,
            composer: composer ? rect(composer) : null,
            inner: inner ? rect(inner) : null,
          };
        });
        expect(m.turn).not.toBeNull();
        // симметричные внешние поля: слева и справа одинаково (±2 px)
        const left = m.turn!.x - m.feed!.x;
        const right = m.feed!.right - m.turn!.right;
        expect(Math.abs(left - right), `width=${width}: ${left}/${right}`).toBeLessThanOrEqual(2);
        // мера текста не расползлась на всю ширину окна
        expect(m.md!.width).toBeLessThanOrEqual(742);
        expect(m.inner!.width).toBeLessThanOrEqual(790);
        expect(Math.abs(m.inner!.x - m.turn!.x)).toBeLessThanOrEqual(2);
        // лента не «уезжает» по горизонтали из-за длинного кода
        expect(m.feedScroll!.w).toBeLessThanOrEqual(m.feedScroll!.cw + 1);
      }
    } finally {
      await app.close();
    }
  });

  test('черновик: поле ввода на месте сразу, а не пустой экран', async () => {
    const { app, page } = await launch(fakePiRpc);
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.locator('[data-testid^="project-new-"]').first().click();

      const input = page.locator('.dl-composer-input');
      await expect(input).toBeVisible();
      // до готовности — честно неактивное поле с объяснением
      await expect(page.getByTestId('draft-notice')).toBeVisible();
      // после официального new_session поле становится рабочим
      await expect(input).toBeEnabled({ timeout: 20_000 });
      await expect(input).toHaveAttribute('placeholder', 'Сообщение…');
      await input.fill('Проверка композера');
      await expect(input).toHaveValue('Проверка композера');
    } finally {
      await app.close();
    }
  });

  test('«Новый диалог» берёт последний открытый проект, без угадывания', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'piwsd-r02-sessions-'));
    const src = path.join(repoRoot, 'tests', 'fixtures', 'sessions', '--e2e-project--');
    const file = (await readdir(src))[0];
    for (const [bucket, cwd, id] of [
      ['--e2e-one--', '/e2e/one', 'e2e-one-uuid'],
      ['--e2e-two--', '/e2e/two', 'e2e-two-uuid'],
    ] as const) {
      const dir = path.join(root, bucket);
      await mkdir(dir, { recursive: true });
      const body = (await readFile(path.join(src, file), 'utf8'))
        .replace('"cwd": "/"', `"cwd": "${cwd}"`)
        .replace('"id": "e2e-fixture-uuid"', `"id": "${id}"`);
      await writeFile(path.join(dir, file), body, 'utf8');
    }

    const { app, page } = await launchApp({
      PI_WS_DESKTOP_PI: fakePiRpc,
      PI_CODING_AGENT_SESSION_DIR: root,
    });
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(page.getByTestId('project-/e2e/one')).toBeVisible();

      // Ни один проект ещё не открывали → явный выбор, без произвольного cwd.
      await page.locator('.dl-newchat').first().click();
      await expect(page.getByTestId('project-chooser')).toBeVisible();
      await expect(page.getByTestId('project-chooser-/e2e/two')).toBeVisible();

      // Явно открываем второй проект и создаём диалог глобальной кнопкой.
      await page.getByTestId('project-chooser-/e2e/two').click();
      await expect(page.getByTestId('draft-cwd')).toHaveAttribute('title', '/e2e/two', {
        timeout: 20_000,
      });
    } finally {
      await app.close();
    }
  });
  /**
   * R03-1 (#26, #6572954720, P1): контекст нового диалога — последний ЯВНО
   * выбранный проект. Живой чат проекта «one» не должен перебивать выбор «two».
   */
  test('R03: «Новый диалог» после явного выбора другого проекта', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'piwsd-r03-sessions-'));
    const src = path.join(repoRoot, 'tests', 'fixtures', 'sessions', '--e2e-project--');
    const file = (await readdir(src))[0];
    // cwd проекта должен существовать: Pi запускается именно в нём
    const one = path.join(root, 'one');
    const two = path.join(root, 'two');
    await mkdir(one, { recursive: true });
    await mkdir(two, { recursive: true });
    for (const [bucket, cwd, id] of [
      ['--e2e-one--', one, 'e2e-one-uuid'],
      ['--e2e-two--', two, 'e2e-two-uuid'],
    ] as const) {
      const dir = path.join(root, bucket);
      await mkdir(dir, { recursive: true });
      const body = (await readFile(path.join(src, file), 'utf8'))
        .replace('"cwd": "/"', `"cwd": "${cwd}"`)
        .replace('"id": "e2e-fixture-uuid"', `"id": "${id}"`);
      await writeFile(path.join(dir, file), body, 'utf8');
    }

    const { app, page } = await launchApp({
      PI_WS_DESKTOP_PI: fakePiRpc,
      PI_CODING_AGENT_SESSION_DIR: root,
    });
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1280, height: 800 });

      // 1) диалог в проекте one (слот занят живым чатом)
      await page.getByTestId(`project-new-${one}`).click();
      await expect(page.getByTestId('draft-cwd')).toHaveAttribute('title', one, { timeout: 20_000 });
      await expect(page.locator('.dl-composer-input')).toBeEnabled({ timeout: 20_000 });

      // 2) пользователь явно выбирает проект two
      await page.getByTestId(`project-${two}`).click();

      // 3) общий «Новый диалог» → подтверждение → черновик именно в two
      await page.locator('.dl-newchat').first().click();
      await page.getByTestId('new-chat-confirm').click();
      await expect(page.getByTestId('draft-cwd')).toHaveAttribute('title', two, { timeout: 20_000 });
      // и поле ввода снова доступно — состояния диалога независимы
      await expect(page.locator('.dl-composer-input')).toBeEnabled({ timeout: 20_000 });
    } finally {
      await app.close();
    }
  });

  /**
   * R03-2: предпросмотр шрифта на одну ступень ниже рабочего размера, muted и
   * читаемый (AA) в обеих темах. Фактические контролы не уменьшены.
   */
  test('R03: предпросмотр шрифта на ступень ниже, контраст AA', async () => {
    const { app, page } = await launch(fakePiRpc);
    try {
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId('nav-settings').click();

      const read = () =>
        page.evaluate(() => {
          type El = {
            parentElement: El | null;
            backgroundColor: string;
          };
          const w = window as unknown as {
            getComputedStyle: (el: El) => { fontSize: string; color: string; backgroundColor: string };
            document: {
              body: El;
              querySelectorAll: (s: string) => ArrayLike<El>;
            };
          };
          const lum = (rgb: number[]) => {
            const [r, g, b] = rgb.map((v) => {
              const c = v / 255;
              return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const parse = (str: string) => (str.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
          const ratio = (fg: string, bg: string) => {
            const a = lum(parse(fg));
            const b = lum(parse(bg));
            return +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
          };
          const bgOf = (el: El) => {
            let node: El | null = el;
            while (node) {
              const bg = w.getComputedStyle(node).backgroundColor;
              if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
              node = node.parentElement;
            }
            return w.getComputedStyle(w.document.body).backgroundColor;
          };
          return Array.from(w.document.querySelectorAll('.dl2-preview')).map((el) => {
            const cs = w.getComputedStyle(el);
            const bg = bgOf(el);
            return { size: cs.fontSize, color: cs.color, contrast: ratio(cs.color, bg) };
          });
        });

      for (const theme of ['dark', 'light']) {
        await page.getByTestId(`theme-mode-${theme}`).click();
        const rows = await read();
        expect(rows.map((r) => r.size)).toEqual(['12px', '13px', '12px']);
        for (const row of rows) expect(row.contrast).toBeGreaterThanOrEqual(4.5);
        // контролы размера остались рабочими 13 px — уменьшен только образец
        await expect(page.getByTestId('font-reply-size')).toHaveValue('14');
      }
    } finally {
      await app.close();
    }
  });
});
