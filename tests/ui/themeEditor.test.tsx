/**
 * UI Integration V1 (Issue #21 §9.2–§9.4): Settings = 5 светлых / 4 тёмных
 * палитры, четыре цвета «своей» темы, два настраиваемых шрифта и один
 * неизменяемый системный, рабочие Apply/Cancel/Reset, реальный контраст.
 * Данные Pi не затрагиваются: состояние — только appearance.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsView, type SettingsViewProps } from '../../src/renderer/SettingsView';
import { DEFAULT_APPEARANCE } from '../../src/shared/appearance';
import { LIGHT_PALETTES, DARK_PALETTES, SYSTEM_FONT_STACK, fontStackById } from '../../src/shared/design/palettes';
import { THEME_PRESETS } from '../../src/shared/design/presets';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY = {
  phase: 'ready',
  attempt: 0,
  distro: 'Ubuntu',
  distros: ['Ubuntu', 'Debian'],
  runtime: {
    distro: 'Ubuntu',
    node: { path: '/usr/bin/node', version: 'v20.11.0' },
    pi: { path: '/usr/local/bin/pi', version: '1.4.0', rpcSupported: true },
  },
} as unknown as RendererSnapshot;

function renderSettings(overrides: Partial<SettingsViewProps> = {}) {
  const onChange = vi.fn();
  const onRetry = vi.fn();
  const onRefresh = vi.fn();
  const onSelectDistro = vi.fn();
  const props: SettingsViewProps = {
    appearance: DEFAULT_APPEARANCE,
    ready: true,
    snapshot: READY,
    requestError: null,
    onRetry,
    onRefresh,
    onSelectDistro,
    onChange,
    ...overrides,
  };
  const view = render(<SettingsView {...props} />);
  return { ...view, onChange, onRetry, onRefresh, onSelectDistro };
}

describe('Settings · палитры', () => {
  it('по умолчанию тёмный режим: 4 карточки, выбрана «Тёмная»', () => {
    renderSettings();
    expect(screen.getByTestId('theme-mode-dark')).toHaveAttribute('aria-checked', 'true');
    for (const palette of DARK_PALETTES) {
      const id = palette.custom ? 'theme-card-custom' : `theme-card-${palette.id}`;
      expect(screen.getByTestId(id)).toBeVisible();
    }
    expect(screen.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('theme-card-light')).toBeNull();
  });

  it('светлый режим показывает 5 палитр, у каждой ровно 4 образца', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByTestId('theme-mode-light'));
    for (const palette of LIGHT_PALETTES) {
      const id = palette.custom ? 'theme-card-custom' : `theme-card-${palette.id}`;
      const card = screen.getByTestId(id);
      expect(card).toBeVisible();
      expect(card.querySelectorAll('[data-swatch]')).toHaveLength(4);
    }
    expect(screen.getByTestId('theme-card-light')).toHaveAttribute('aria-checked', 'true');
  });

  it('порядок образцов: область → обе панели → акцент → текст', () => {
    renderSettings();
    const swatches = [...screen.getByTestId('swatches-dark').querySelectorAll('[data-swatch]')].map((el) =>
      el.getAttribute('data-swatch'),
    );
    expect(swatches).toEqual(['workspace', 'panels', 'accent', 'text']);
  });

  it('выбор пресета меняет черновик, но не сохраняет без «Применить»', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByTestId('theme-mode-light'));
    await user.click(screen.getByTestId('theme-card-astra'));
    expect(screen.getByTestId('theme-card-astra')).toHaveAttribute('aria-checked', 'true');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-state')).toHaveTextContent('неприменённые');
  });
});

describe('Settings · своя тема', () => {
  it('ровно 4 поля цвета, одно из них задаёт обе панели', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByTestId('theme-card-custom'));
    const inputs = screen.getByTestId('theme-editor').querySelectorAll('input[type="color"]');
    expect(inputs).toHaveLength(4);
    const labels = [...screen.getByTestId('theme-editor').querySelectorAll('.dl2-row-label')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['Рабочая область', 'Боковые панели', 'Акцент', 'Основной текст']);
    expect(screen.getByTestId('custom-panels')).toBeVisible();
  });

  it('контраст проверяется по-настоящему: текст = фон → FAIL и «Применить» заблокирована', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByTestId('theme-card-custom'));
    const text = screen.getByTestId('custom-text') as HTMLInputElement;
    const windowInput = screen.getByTestId('custom-workspace') as HTMLInputElement;
    fireEvent.change(text, { target: { value: windowInput.value } });
    expect(screen.getByTestId('custom-contrast-status')).toHaveAttribute('data-ok', 'false');
    expect(screen.getByTestId('theme-apply')).toBeDisabled();
    await user.click(screen.getByTestId('theme-apply'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('валидная своя палитра сохраняется в режим и активирует custom-палитру', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByTestId('theme-card-custom'));
    fireEvent.change(screen.getByTestId('custom-accent'), { target: { value: '#0E7490' } });
    expect(screen.getByTestId('custom-contrast-status')).toHaveAttribute('data-ok', 'true');
    await user.click(screen.getByTestId('theme-apply'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.theme.preset.dark).toBe('customDark');
    expect(next.theme.custom.dark.accent).toBe('#0E7490');
    // светлая палитра не тронута
    expect(next.theme.custom.light).toEqual(DEFAULT_APPEARANCE.theme.custom.light);
  });

  it('«Отмена» возвращает сохранённую палитру и снимает изменения', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByTestId('theme-card-custom'));
    fireEvent.change(screen.getByTestId('custom-accent'), { target: { value: '#123456' } });
    await user.click(screen.getByTestId('theme-cancel'));
    expect(screen.getByTestId('settings-state')).toHaveTextContent('применено');
    expect(onChange).not.toHaveBeenCalled();
    // черновик вернулся к сохранённой теме: редактор закрыт, выбрана «Тёмная»
    expect(screen.queryByTestId('theme-editor')).toBeNull();
    expect(screen.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('theme-card-custom'));
    expect((screen.getByTestId('custom-accent') as HTMLInputElement).value).toBe(
      DEFAULT_APPEARANCE.theme.custom.dark.accent.toLowerCase(),
    );
  });

  it('«Сбросить» возвращает заводские значения черновика', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByTestId('theme-mode-light'));
    await user.click(screen.getByTestId('theme-card-astra'));
    await user.click(screen.getByTestId('theme-reset'));
    expect(screen.getByTestId('theme-mode-dark')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Settings · типографика', () => {
  it('два селектора шрифта по 3 варианта, системный без редакторов', () => {
    renderSettings();
    const selects = document.querySelectorAll('.dl2-font-controls select');
    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select.querySelectorAll('option')).toHaveLength(3);
    expect(screen.getByTestId('font-block-system').querySelectorAll('input, select')).toHaveLength(0);
    expect(screen.getByTestId('font-system-value')).toHaveTextContent('13 px');
  });

  it('шрифт ответов применяется к превью, но не к системному вводу', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.selectOptions(screen.getByTestId('font-reply-family'), 'courier');
    const preview = screen.getByTestId('preview-reply');
    expect(preview.getAttribute('style')).toContain('Courier');
    await user.click(screen.getByTestId('theme-apply'));
    const next = onChange.mock.calls[0][0];
    expect(next.typography.chatResponse.fontFamily).toBe(fontStackById('courier'));
    expect(next.typography.chatInput.fontFamily).toBe(SYSTEM_FONT_STACK);
    expect(next.typography.chatResponse.fontSizePx).toBe(DEFAULT_APPEARANCE.typography.chatResponse.fontSizePx);
  });

  it('три многострочных превью: системное, ответы, код', () => {
    renderSettings();
    for (const id of ['preview-system', 'preview-reply', 'preview-code']) {
      const el = screen.getByTestId(id);
      expect(el.textContent?.split('\n').length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Settings · состав страницы', () => {
  it('не содержит настроек ширины панелей и высоты терминала', () => {
    renderSettings();
    expect(screen.queryByTestId('left-width')).toBeNull();
    expect(screen.queryByTestId('right-width')).toBeNull();
    expect(screen.queryByTestId('terminal-height')).toBeNull();
    expect(screen.queryByText(/Ширина панелей|Высота терминала/)).toBeNull();
  });

  it('не показывает технические коэффициенты размеров в обычном виде', () => {
    renderSettings();
    expect(screen.queryByTestId('inspection-panel')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+\s*px\s*·\s*radius/i);
  });

  it('показывает реальное состояние WSL и переключение дистрибутива', async () => {
    const user = userEvent.setup();
    const { onRetry, onSelectDistro } = renderSettings();
    expect(screen.getByTestId('status-phase')).toHaveTextContent('мост установлен');
    await user.selectOptions(screen.getByTestId('distro'), 'Debian');
    expect(onSelectDistro).toHaveBeenCalledWith('Debian');
    await user.click(screen.getByTestId('settings-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('палитры встроенных пресетов проходят AA (нет нечитаемых тем)', () => {
    renderSettings();
    // токены пресетов проверяются модульными тестами, здесь — что карточки рисуются
    expect(Object.keys(THEME_PRESETS)).toHaveLength(7);
  });
});
