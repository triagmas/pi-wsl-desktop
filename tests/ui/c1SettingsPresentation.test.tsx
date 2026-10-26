/**
 * UI21 C3 (P1): утверждённая презентация маршрута «Настройки».
 * RED: продукт рендерит legacy SettingsView (settings-title, nav-разделы,
 * секции скрыты по одной) вместо контура ui/SettingsScreen.
 * Функциональные контракты (5 радио-карточек тем, aria-checked, рабочие
 * секции) сохраняются и проверяются здесь же.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { TYPOGRAPHY_AREAS } from '../../src/shared/appearance';
import { makeApi } from './helpers/shellApi';

describe('UI21 C3 — approved settings contour (App route)', () => {
  it('nav-settings shows the approved contour with every section visible', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('nav-settings'));
    const root = await screen.findByTestId('settings-root');

    const heading = within(root).getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Настройки');
    expect(heading.classList.contains('dl-h1')).toBe(true);
    expect(within(root).getByText(/внешний вид, типографика и подключение pi/i)).toBeInTheDocument();

    // Approved flow: all four sections live on one screen (not one at a time).
    for (const id of ['settings-appearance', 'settings-typography', 'settings-workspace', 'settings-connection']) {
      expect(screen.getByTestId(id)).toBeVisible();
    }

    // Approved section chrome: h2 heading + dl-set-section class.
    const appearance = screen.getByTestId('settings-appearance');
    expect(within(appearance).getByRole('heading', { level: 2 })).toHaveTextContent('Внешний вид');
    expect(appearance.classList.contains('dl-set-section')).toBe(true);

    // The legacy one-section-at-a-time nav is gone.
    expect(document.querySelector('.settings-tabs')).toBeNull();
  });

  it('keeps the theme contract: radio cards with aria-checked and a working switch', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('nav-settings'));
    expect(await screen.findByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');
    await user.click(await screen.findByTestId('theme-card-light'));
    expect(screen.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');
  });

  it('follows the approved card anatomy: label above the swatches (C5.2 parity)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('nav-settings'));
    const card = await screen.findByTestId('theme-card-dark');
    expect(card.firstElementChild).toHaveTextContent('Тёмная');
    // C5.2: продукт использует одобренный контур карточек (dl-theme-*),
    // legacy-полоса .theme-swatch убрана.
    expect(card.classList.contains('dl-theme-card')).toBe(true);
    expect(card.parentElement?.classList.contains('dl-theme-grid')).toBe(true);
    expect(card.querySelectorAll('.dl-theme-swatch')).toHaveLength(4);
    expect(card.querySelector('.theme-swatch')).toBeNull();
    // active card styling = approved (border accent, без legacy ring).
    expect(card.classList.contains('dl-theme-card-active')).toBe(true);
  });

  it('keeps every typography zone as an approved compact row with all controls (C5.2)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('nav-settings'));
    // Каждая из 8 зон (не только ui): одобренная строка + доступная группа.
    for (const area of TYPOGRAPHY_AREAS) {
      const row = await screen.findByTestId(`typo-${area}`);
      // P2: обычный flex-ряд (div), без fieldset-специфики/легенды сверху;
      // имя группы сохранено на обёртке (fieldset aria-label).
      expect(row.tagName).toBe('DIV');
      expect(row.classList.contains('dl-type-row')).toBe(true);
      expect(row.querySelector('legend')).toBeNull();
      expect(row.querySelector('.dl-type-name')).not.toBeNull();
      const group = row.closest('fieldset');
      expect(group?.classList.contains('dl-type-group')).toBe(true);
      expect(group?.getAttribute('aria-label')).toBeTruthy();
      // legacy stacked fields are gone …
      expect(row.querySelector('.field-block')).toBeNull();
      expect(row.querySelector('.typo-preview')).toBeNull();
      // … все четыре контрола зоны сохранены и видимы.
      for (const t of [`${area}-family`, `${area}-size`, `${area}-line-height`, `${area}-weight`]) {
        expect(screen.getByTestId(t)).toBeInTheDocument();
      }
      // spec-slot shows the current zone values (approved row anatomy).
      expect(row.querySelector('.dl-type-spec')?.textContent).toMatch(/\d+px \/ [\d.]+ · \d+/);
      // P1: живое превью зоны (approved .dl-type-preview) со всеми4 свойствами.
      const preview = within(row).getByTestId(`${area}-preview`);
      expect(preview.classList.contains('dl-type-preview')).toBe(true);
      expect(preview.style.fontFamily).toBeTruthy();
      expect(preview.style.fontSize).toBeTruthy();
      expect(preview.style.lineHeight).toBeTruthy();
      expect(preview.style.fontWeight).toBeTruthy();
      expect(preview.textContent?.length).toBeGreaterThan(0);
    }
  });

  it('keeps workspace layout controls as compact rows (C5.2)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('nav-settings'));
    for (const t of ['left-width', 'right-width', 'terminal-height', 'left-collapsed']) {
      expect(screen.getByTestId(t)).toBeInTheDocument();
      expect(screen.getByTestId(t).closest('.dl-type-row')).not.toBeNull();
    }
  });
});
