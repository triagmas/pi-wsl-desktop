/**
 * UI Integration V1: утверждённый контур «Настроек» из Design Lab Stage 2 R01 —
 * одна страница, колонка 760 px, разделы «Внешний вид» / «Типографика» /
 * «Подключение». Пять светлых и четыре тёмных палитры, четыре образца на
 * карточке, два настраиваемых шрифтовых слота и один системный.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

describe('Settings — контур Stage 2 R01 (маршрут App)', () => {
  it('показывает одну страницу с тремя разделами и колонкой 760 px', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));

    const root = await screen.findByTestId('settings-root');
    expect(root.classList.contains('dl2-screen')).toBe(true);
    const col = screen.getByTestId('settings-col');
    expect(col.classList.contains('dl2-col')).toBe(true);

    const heading = within(root).getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Настройки');
    expect(heading.classList.contains('dl2-h1')).toBe(true);
    expect(within(root).getByText(/внешний вид, типографика и подключение pi/i)).toBeInTheDocument();

    for (const id of ['settings-appearance', 'settings-typography', 'settings-connection']) {
      expect(screen.getByTestId(id)).toBeVisible();
      expect(screen.getByTestId(id).classList.contains('dl2-section')).toBe(true);
    }
    // Ширины панелей и высота терминала больше не настройки страницы.
    expect(screen.queryByTestId('settings-workspace')).toBeNull();
    expect(document.querySelector('.settings-tabs')).toBeNull();
  });

  it('тёмный режим — 4 палитры, светлый — 5; переключение режима работает', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));

    const dark = await screen.findByTestId('theme-card-dark');
    expect(dark).toHaveAttribute('aria-checked', 'true');
    for (const id of ['theme-card-dark', 'theme-card-claudeDark', 'theme-card-codexDark', 'theme-card-custom']) {
      expect(screen.getByTestId(id)).toBeVisible();
    }
    expect(screen.queryByTestId('theme-card-light')).toBeNull();

    await user.click(screen.getByTestId('theme-mode-light'));
    for (const id of ['theme-card-light', 'theme-card-astra', 'theme-card-claudeLight', 'theme-card-codexLight', 'theme-card-custom']) {
      expect(screen.getByTestId(id)).toBeVisible();
    }
    expect(screen.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByTestId('theme-card-astra'));
    expect(screen.getByTestId('theme-card-astra')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'false');
  });

  it('анатомия карточки: имя сверху, четыре образца в порядке контракта', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));

    const card = await screen.findByTestId('theme-card-dark');
    expect(card.classList.contains('dl2-preset')).toBe(true);
    expect(card.classList.contains('is-active')).toBe(true);
    expect(card.firstElementChild).toHaveTextContent('Тёмная');
    const swatches = [...card.querySelectorAll('[data-swatch]')];
    expect(swatches.map((el) => el.getAttribute('data-swatch'))).toEqual(['workspace', 'panels', 'accent', 'text']);
  });

  it('типографика: один системный блок без контролов + два слота с превью', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));

    const system = await screen.findByTestId('font-block-system');
    expect(system.querySelectorAll('input, select')).toHaveLength(0);
    expect(screen.getByTestId('font-system-value')).toHaveTextContent('13 px');

    for (const slot of ['reply', 'code']) {
      const block = screen.getByTestId(`font-block-${slot}`);
      expect(block.querySelectorAll('select')).toHaveLength(1);
      expect(block.querySelectorAll('input[type="number"]')).toHaveLength(1);
      const preview = screen.getByTestId(`preview-${slot}`);
      expect(preview.getAttribute('style')).toMatch(/font-family/);
      expect(preview.getAttribute('style')).toMatch(/font-size/);
    }
    // Старые восемь зон больше не редактируются.
    expect(screen.queryByTestId('typo-ui')).toBeNull();
  });

  it('нижняя панель: Apply / Cancel / Reset и состояние черновика', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));
    expect(screen.getByTestId('settings-state')).toHaveTextContent('применено');
    expect(screen.getByTestId('theme-apply')).toBeDisabled();
    await user.click(screen.getByTestId('theme-card-claudeDark'));
    expect(screen.getByTestId('settings-state')).toHaveTextContent('неприменённые');
    expect(screen.getByTestId('theme-apply')).toBeEnabled();
  });
});
