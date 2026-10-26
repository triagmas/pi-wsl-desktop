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
});
