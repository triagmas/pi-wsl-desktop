/**
 * UI-A Task 6 (Issue #21 §9.2–9.4): theme cards + custom editor behavior —
 * fail-safe contrast validation, live preview, Save/Cancel/Reset semantics,
 * independent per-area typography and workspace controls. Appearance state is
 * the ONLY data touched; Pi resources are never involved (§9.2).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsView, type SettingsViewProps } from '../../src/renderer/SettingsView';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from '../../src/shared/appearance';
import { THEME_PRESETS } from '../../src/shared/design/presets';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = {
  phase: 'ready',
  distro: 'Ubuntu',
  server: { running: true, pid: 1, url: 'http://127.0.0.1:1', version: '1.4.0', lastSeenMs: 5 },
  status: null,
  isDefaultDistro: true,
  distroError: null,
  runtime: {
    node: { version: 'v20.11.0' },
    pi: { version: '1.4.0', rpcSupported: true },
    electron: { version: '30.0.0' },
    platform: 'win32',
  } as unknown as RendererSnapshot['runtime'],
  distros: ['Ubuntu', 'Debian'],
} as unknown as RendererSnapshot;

const api = { onStateChange: () => () => undefined } as unknown as DesktopApi;

function makeProps(overrides: Partial<SettingsViewProps> = {}): SettingsViewProps & {
  onChange: ReturnType<typeof vi.fn>;
  onReset: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  const onReset = vi.fn();
  return {
    api,
    appearance: DEFAULT_APPEARANCE,
    ready: true,
    snapshot: READY,
    requestError: null,
    onRetry: vi.fn(),
    onRefresh: vi.fn(),
    onSelectDistro: vi.fn(),
    onChange,
    onReset,
    layout: {
      leftWidth: 260,
      rightWidth: 340,
      leftCollapsed: false,
      onLeftWidth: vi.fn(),
      onRightWidth: vi.fn(),
      onToggleLeft: vi.fn(),
      onTerminalHeight: vi.fn(),
    },
    ...overrides,
  } as SettingsViewProps & {
    onChange: ReturnType<typeof vi.fn>;
    onReset: ReturnType<typeof vi.fn>;
  };
}

function renderSettings(overrides: Partial<SettingsViewProps> = {}): ReturnType<typeof makeProps> {
  const props = makeProps(overrides);
  render(<SettingsView {...(props as SettingsViewProps)} />);
  return props;
}

describe('theme cards (§9.2)', () => {
  it('renders all four presets plus custom and applies a preset choice', async () => {
    const user = userEvent.setup();
    const p = renderSettings();

    for (const id of ['dark', 'light', 'claude', 'codex'] as const) {
      expect(screen.getByTestId(`theme-card-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('theme-card-custom')).toBeInTheDocument();
    expect(screen.getByTestId('theme-card-dark')).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByTestId('theme-card-light'));
    expect(p.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ preset: 'light' }) }),
    );
    // Only appearance state is produced — nothing else (§9.2 no Pi data).
    expect(Object.keys(p.onChange.mock.calls[0][0])).toEqual(Object.keys(DEFAULT_APPEARANCE));
  });

  it('shows the custom card note with the saved theme name', () => {
    const custom: AppearanceSettings = {
      ...DEFAULT_APPEARANCE,
      theme: {
        preset: 'custom',
        customName: 'Мой тёмный',
        custom: { ...THEME_PRESETS.dark.tokens, accentColor: '#a33c3c' },
      },
    };
    renderSettings({ appearance: custom });
    expect(screen.getByTestId('theme-card-custom')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('theme-card-custom')).toHaveTextContent('Мой тёмный');
    expect(screen.getByTestId('custom-summary')).toBeInTheDocument();
  });
});

describe('custom theme editor (§9.2)', () => {
  it('opens from the custom card, edits a token live, and saves valid tokens', async () => {
    const user = userEvent.setup();
    const p = renderSettings();

    await user.click(screen.getByTestId('theme-card-custom'));
    const editor = screen.getByTestId('theme-editor');
    expect(editor).toBeInTheDocument();

    // Every semantic color group is editable.
    const accent = within(editor).getByTestId('token-accentColor') as HTMLInputElement;
    expect(accent.type).toBe('color');
    expect(accent.value.toLowerCase()).toBe(THEME_PRESETS.dark.tokens.accentColor.toLowerCase());

    expect(accent.value.toLowerCase()).toBe(THEME_PRESETS.dark.tokens.accentColor.toLowerCase());

    // jsdom does not reliably emulate color inputs for React's controlled
    // onChange — drive a text token instead (same controlled update path).
    const radius = within(editor).getByTestId('token-radiusSmall') as HTMLInputElement;
    fireEvent.change(radius, { target: { value: '14px' } });
    expect(radius.value).toBe('14px');

    await user.click(within(editor).getByTestId('theme-name'));
    await user.clear(within(editor).getByTestId('theme-name'));
    await user.type(within(editor).getByTestId('theme-name'), 'Свежая');

    await user.click(within(editor).getByTestId('theme-apply'));
    expect(p.onChange).toHaveBeenCalledWith({
      ...DEFAULT_APPEARANCE,
      theme: {
        preset: 'custom',
        customName: 'Свежая',
        custom: expect.objectContaining({ radiusSmall: '14px' }),
      },
    });
    expect(screen.queryByTestId('theme-editor')).not.toBeInTheDocument();
  });

  it('rejects a custom theme whose pair fails contrast — fail-safe, with an issue list', async () => {
    const user = userEvent.setup();
    const p = renderSettings();
    await user.click(screen.getByTestId('theme-card-custom'));
    const editor = screen.getByTestId('theme-editor');

    // Near-identical colors ⇒ body/surface contrast below WCAG AA.
    const body = within(editor).getByTestId('token-bodyTextColor') as HTMLInputElement;
    fireEvent.change(body, { target: { value: '#262a26' } });
    fireEvent.blur(body); // validation runs on blur

    expect(screen.getByTestId('theme-issues')).toBeInTheDocument();
    await user.click(screen.getByTestId('theme-apply'));
    // Save must be refused — onChange never receives an invalid theme.
    const customCalls = p.onChange.mock.calls.filter(
      (c) => c[0].theme?.preset === 'custom',
    );
    expect(customCalls).toHaveLength(0);
    expect(screen.getByTestId('theme-editor')).toBeInTheDocument();
  });

  it('Cancel closes the editor without changing the persisted appearance', async () => {
    const user = userEvent.setup();
    const p = renderSettings();
    await user.click(screen.getByTestId('theme-card-custom'));
    await user.click(screen.getByTestId('theme-cancel'));
    expect(screen.queryByTestId('theme-editor')).not.toBeInTheDocument();
    // Cancel re-applies the SAME persisted state — nothing new is stored.
    expect(p.onChange).toHaveBeenCalledWith(DEFAULT_APPEARANCE);
  });

  it('Reset restores the editor to its base preset colors', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByTestId('theme-card-custom'));
    const radius = screen.getByTestId('token-radiusSmall') as HTMLInputElement;
    const original = THEME_PRESETS.dark.tokens.radiusSmall;
    fireEvent.change(radius, { target: { value: '21px' } });
    expect(radius.value).toBe('21px');
    await user.click(screen.getByTestId('theme-reset'));
    expect((screen.getByTestId('token-radiusSmall') as HTMLInputElement).value).toBe(original);
  });
});

describe('typography (§9.3)', () => {
  it('edits each area independently and previews the zone styles', async () => {
    const user = userEvent.setup();
    const p = makeProps();
    const view = render(<SettingsView {...(p as SettingsViewProps)} />);
    await user.click(screen.getByTestId('settings-tab-typography'));

    for (const area of [
      'ui',
      'sidebar',
      'chatInput',
      'chatResponse',
      'code',
      'toolOutput',
      'terminal',
      'statusBar',
    ]) {
      expect(screen.getByTestId(`typo-${area}`)).toBeInTheDocument();
    }

    const size = screen.getByTestId('chatResponse-size') as HTMLInputElement;
    fireEvent.change(size, { target: { value: '17' } });
    expect(p.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        typography: expect.objectContaining({
          chatResponse: expect.objectContaining({ fontSizePx: 17 }),
        }),
      }),
    );
    // Other areas untouched (independent per-area control).
    expect(p.onChange.mock.calls.at(-1)![0].typography.ui).toEqual(
      DEFAULT_APPEARANCE.typography.ui,
    );

    // The component is controlled: the parent applies the change and the
    // preview follows the next render (same as App wiring the store).
    const next = p.onChange.mock.calls.at(-1)![0] as AppearanceSettings;
    view.rerender(<SettingsView {...({ ...(p as SettingsViewProps), appearance: next } as SettingsViewProps)} />);
    const preview = screen.getByTestId('chatResponse-preview');
    expect(preview.style.fontSize).toBe('17px');
  });
});

describe('workspace + connection', () => {
  it('exposes layout controls wired to the shell (persisted, §9.4)', async () => {
    const user = userEvent.setup();
    const p = renderSettings();
    await user.click(screen.getByTestId('settings-tab-workspace'));
    fireEvent.change(screen.getByTestId('left-width'), { target: { value: '320' } });
    expect(p.layout.onLeftWidth).toHaveBeenCalledWith(320);
    await user.click(screen.getByTestId('left-collapsed'));
    expect(p.layout.onToggleLeft).toHaveBeenCalled();
  });

  it('shows the real WSL connection panel with distro switching (§5)', async () => {
    renderSettings();
    await userEvent.click(screen.getByTestId('settings-tab-connection'));
    const conn = screen.getByTestId('settings-connection');
    expect(within(conn).getByTestId('status-phase')).toBeInTheDocument();
    const distroSelect = within(conn).getByTestId('distro');
    expect(within(distroSelect).getByRole('option', { name: 'Ubuntu' })).toBeInTheDocument();
  });
});
