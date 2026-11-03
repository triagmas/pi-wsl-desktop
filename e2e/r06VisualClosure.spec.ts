/**
 * M4 R06 / визуальное закрытие V1–V3 (Issues #16, #21, #37).
 *
 * Реальная Electron-геометрия на 1000×760, 1440×900 и максимизированном окне:
 *  V1 — заголовок диалога сокращается по правилу ellipsis и не уезжает под
 *       чип «Чат»/правую панель; полный текст доступен в title;
 *  V2 — пояснение и кнопка пустого дока терминала не перекрываются;
 *  V3 — подпись «Установить навык» не обрезается и не сжимается.
 *
 * Каждый прогон получает свой userData/home и синтетическую сессию с длинным
 * заголовком; реальный Pi, `~/.pi` и рабочая установка не читаются.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakePi, launchApp } from './launchApp';

const LONG_TITLE = 'Терминал: PTY, resize и закрытие вкладок';
const INSTALL_LABEL = 'Установить навык';
const SESSION_ID = 'r06-session-0001';

/** Минимальная структурная типизация DOM для evaluate() (node-tsconfig без DOM lib). */
interface Box {
  getBoundingClientRect(): { x: number; y: number; width: number; height: number; right: number; bottom: number };
  scrollWidth: number;
  clientWidth: number;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): Box | null;
  contains(other: Box | null): boolean;
  dataset: Record<string, string | undefined>;
  focus(): void;
}
interface Doc {
  querySelector(selector: string): Box | null;
  elementFromPoint(x: number, y: number): Box | null;
  documentElement: { scrollWidth: number };
  activeElement: Box | null;
}
interface Dom {
  document: Doc;
  innerWidth: number;
  getComputedStyle(element: Box): { position: string; textOverflow: string };
}

interface Fixture {
  app: ElectronApplication;
  page: Page;
  root: string;
}

function writeSyntheticSession(root: string): { sessions: string; proj: string } {
  const agent = path.join(root, 'agent');
  const sessions = path.join(agent, 'sessions');
  const proj = path.join(root, 'proj', 'alpha');
  mkdirSync(proj, { recursive: true });
  const slug = `--${proj.split(/[\\/]+/).filter(Boolean).join('-')}--`;
  const dir = path.join(sessions, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `2026-05-05T10-00-00-000Z_${SESSION_ID}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id: SESSION_ID, timestamp: '2026-05-05T10:00:00.000Z', cwd: proj }),
      JSON.stringify({
        type: 'message',
        id: 'm1',
        parentId: null,
        timestamp: '2026-05-05T10:00:01.000Z',
        message: { role: 'user', content: LONG_TITLE, timestamp: 1 },
      }),
      JSON.stringify({
        type: 'message',
        id: 'm2',
        parentId: 'm1',
        timestamp: '2026-05-05T10:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Синтетический ответ для геометрии шапки.' }],
          timestamp: 2,
        },
      }),
    ].join('\n') + '\n',
  );
  return { sessions, proj };
}

async function launchWithLongTitle(): Promise<Fixture> {
  const root = mkdtempSync(path.join(tmpdir(), 'piwsd-e2e-r06-'));
  const { sessions } = writeSyntheticSession(root);
  const { app, page } = await launchApp({ PI_WS_DESKTOP_PI: fakePi, PI_CODING_AGENT_SESSION_DIR: sessions });
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });
  return { app, page, root };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
}

interface HeaderMetrics {
  title: (Rect & { text: string; attr: string | null; clipped: boolean; overflow: string }) | null;
  chip: Rect | null;
  chipHit: boolean | null;
  detailsHit: boolean | null;
  overlaps: Record<string, boolean>;
  hOverflow: boolean;
}

async function measureHeader(page: Page): Promise<HeaderMetrics> {
  return page.evaluate(() => {
    const d = window as unknown as Dom;
    const rect = (el: Box | null): Rect | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
    };
    const hit = (el: Box | null): boolean | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const at = d.document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return !!(at && (at === el || el.contains(at)));
    };
    const row = d.document.querySelector('.dl-app-crumb');
    const title = row ? row.querySelector('strong') : null;
    const chip = d.document.querySelector('.dl-crumb-context');
    const actions = d.document.querySelector('.dl-toolbar-actions');
    const detailsBtn = d.document.querySelector('[data-testid="open-details"]');
    const panel = d.document.querySelector('.dl-details');
    const panelAbsolute = !!panel && d.getComputedStyle(panel).position === 'absolute';
    const tr = rect(title);
    const cr = rect(chip);
    const ar = rect(actions);
    const pr = rect(panel);
    const overlap = (a: Rect | null, b: Rect | null): boolean =>
      !!a && !!b && a.right > b.x + 1 && a.bottom > b.y + 1 && a.y < b.bottom - 1;
    return {
      title:
        tr && title
          ? {
              ...tr,
              text: title.textContent ?? '',
              attr: title.getAttribute('title'),
              clipped: title.scrollWidth > title.clientWidth + 1,
              overflow: d.getComputedStyle(title).textOverflow,
            }
          : null,
      chip: cr,
      chipHit: hit(chip),
      detailsHit: hit(detailsBtn),
      overlaps: {
        titleVsChip: overlap(tr, cr),
        titleVsActions: overlap(tr, ar),
        titleVsPanel: panelAbsolute ? overlap(tr, pr) : false,
      },
      hOverflow: d.document.documentElement.scrollWidth > d.innerWidth + 1,
    };
  }) as unknown as HeaderMetrics;
}

async function openFixtureSession(page: Page): Promise<void> {
  await page.locator(`[data-testid="session-${SESSION_ID}"]`).first().click();
  await expect(page.getByTestId('session-detail')).toBeVisible();
  await expect(page.locator('.dl-app-crumb')).toBeVisible();
  await page.waitForTimeout(400);
}

async function setDetails(page: Page, open: boolean): Promise<void> {
  const btn = page.getByTestId('open-details');
  const pressed = await btn.getAttribute('aria-pressed');
  if (open !== (pressed === 'true')) {
    await btn.click();
    await page.waitForTimeout(400);
  }
}

test.describe('M4 R06 visual closure', () => {
  let fx: Fixture;

  test.beforeAll(async () => {
    fx = await launchWithLongTitle();
    await openFixtureSession(fx.page);
  });

  test.afterAll(async () => {
    if (fx?.app) await fx.app.close();
    if (fx?.root) rmSync(fx.root, { recursive: true, force: true });
  });

  test('V1: заголовок сокращается ellipsis и не перекрывается шапкой', async () => {
    const { page } = fx;
    for (const size of [{ width: 1000, height: 760 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);

      await setDetails(page, true);
      const withPanel = await measureHeader(page);
      expect(withPanel.title, 'заголовок должен существовать').not.toBeNull();
      expect(withPanel.title!.text).toContain('Терминал');
      expect(withPanel.overlaps.titleVsChip, `@${size.width}: заголовок не под чипом «Чат»`).toBe(false);
      expect(withPanel.overlaps.titleVsActions, `@${size.width}: заголовок не под кнопками`).toBe(false);
      expect(withPanel.overlaps.titleVsPanel, `@${size.width}: заголовок не под правой панелью`).toBe(false);
      expect(withPanel.chipHit, 'чип «Чат» кликабелен').toBe(true);
      expect(withPanel.detailsHit, 'тумблер панели кликабелен').toBe(true);
      expect(withPanel.hOverflow, 'нет горизонтального переполнения').toBe(false);
      expect(withPanel.title!.attr, 'полный заголовок доступен в tooltip').toBe(LONG_TITLE);
      if (withPanel.title!.clipped) {
        expect(withPanel.title!.overflow, 'сокращение — именно ellipsis').toBe('ellipsis');
        expect(withPanel.title!.w, 'сокращённый заголовок остаётся читаемым').toBeGreaterThan(24);
      }

      await setDetails(page, false);
      const noPanel = await measureHeader(page);
      expect(noPanel.overlaps.titleVsChip, `@${size.width}: панель закрыта — наложения нет`).toBe(false);
      expect(noPanel.hOverflow).toBe(false);
      expect(noPanel.title!.attr).toBe(LONG_TITLE);
      if (size.width === 1440) {
        expect(noPanel.title!.clipped, 'на 1440 заголовок читается целиком').toBe(false);
      }
    }
  });

  test('V1: светлая тема — та же геометрия шапки', async () => {
    const { page } = fx;
    await page.setViewportSize({ width: 1000, height: 760 });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-root')).toBeVisible();
    await page.getByTestId('theme-mode-light').first().click();
    await page.waitForTimeout(300);
    await page.getByTestId('nav-chat').click();
    await openFixtureSession(page);
    await setDetails(page, true);
    const m = await measureHeader(page);
    expect(m.overlaps.titleVsChip).toBe(false);
    expect(m.overlaps.titleVsPanel).toBe(false);
    expect(m.chipHit).toBe(true);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('theme-mode-dark').first().click();
    await page.getByTestId('nav-chat').click();
    await openFixtureSession(page);
    await setDetails(page, false);
  });

  test('V2: пустой док терминала — текст и кнопка не перекрываются', async () => {
    const { page } = fx;
    await page.setViewportSize({ width: 1000, height: 760 });
    await setDetails(page, false);
    await expect(page.getByTestId('terminal-launch')).toBeVisible();

    for (const detailsOpen of [false, true]) {
      await setDetails(page, detailsOpen);
      const m = await page.evaluate(() => {
        const d = window as unknown as Dom;
        const rect = (el: Box | null): Rect | null => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
        };
        const note = d.document.querySelector('.dl-term-empty .dl-term-note');
        const btn = d.document.querySelector('[data-testid="terminal-launch"]');
        const dock = d.document.querySelector('[data-testid="terminal-dock"]');
        const nb = rect(note);
        const bb = rect(btn);
        return {
          note: nb,
          button: bb,
          dock: rect(dock),
          intersectArea:
            nb && bb
              ? Math.max(0, Math.min(nb.right, bb.right) - Math.max(nb.x, bb.x)) *
                Math.max(0, Math.min(nb.bottom, bb.bottom) - Math.max(nb.y, bb.y))
              : 0,
        };
      });
      expect(m.note, 'пояснение присутствует').not.toBeNull();
      expect(m.button, 'кнопка присутствует').not.toBeNull();
      expect(m.intersectArea, `details=${detailsOpen}: нет геометрического перекрытия`).toBe(0);
      const separateRows = m.button!.y >= m.note!.bottom - 1;
      expect(
        m.note!.w >= 240 || separateRows,
        `details=${detailsOpen}: текст не сжат в узкую колонку рядом с кнопкой (note=${Math.round(m.note!.w)})`,
      ).toBe(true);
      expect(m.button!.right).toBeLessThanOrEqual(m.dock!.right + 1);
    }

    await page.getByTestId('terminal-launch').focus();
    const focused = await page.evaluate(() => (window as unknown as Dom).document.activeElement?.dataset.testid ?? null);
    expect(focused, 'кнопка достижима с клавиатуры').toBe('terminal-launch');
  });

  test('V3: «Установить навык» не обрезается и не сжимается', async () => {
    const { page } = fx;
    for (const size of [{ width: 1000, height: 760 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await page.getByTestId('nav-resources').click();
      await expect(page.locator('.dl-res-toolbar')).toBeVisible({ timeout: 15_000 });
      const m = await page.evaluate(() => {
        const d = window as unknown as Dom;
        const rect = (el: Box | null): Rect | null => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
        };
        const btn = d.document.querySelector('.dl-install');
        return {
          button: rect(btn),
          panel: rect(d.document.querySelector('.dl-main')),
          scrollW: btn ? btn.scrollWidth : 0,
          clientW: btn ? btn.clientWidth : 0,
          text: btn?.textContent?.trim() ?? '',
          hOverflow: d.document.documentElement.scrollWidth > d.innerWidth + 1,
        };
      });
      expect(m.button, 'кнопка установки существует').not.toBeNull();
      expect(m.text).toContain(INSTALL_LABEL);
      expect(m.button!.w, `@${size.width}: кнопка не сжата`).toBeGreaterThanOrEqual(240);
      expect(m.button!.h, `@${size.width}: подпись в одну строку`).toBeLessThanOrEqual(56);
      expect(m.button!.right, `@${size.width}: кнопка внутри панели`).toBeLessThanOrEqual(m.panel!.right + 1);
      expect(m.scrollW, 'текст кнопки не обрезан').toBeLessThanOrEqual(m.clientW + 1);
      expect(m.hOverflow).toBe(false);
    }
    await page.getByTestId('nav-chat').click();
  });
});
