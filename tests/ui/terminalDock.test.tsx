import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Реестр созданных эмуляторов: фабрика vi.mock хойстится, поэтому состояние
 *  живёт в vi.hoisted-объекте, а не в обычной переменной модуля. */
const xterm = vi.hoisted(() => ({ terminals: [] as Array<Record<string, unknown>> }));

vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    dataHandler: ((data: string) => void) | null = null;
    resizeHandler: ((size: { cols: number; rows: number }) => void) | null = null;
    written: string[] = [];
    disposed = false;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      xterm.terminals.push(this as unknown as Record<string, unknown>);
    }
    loadAddon() {}
    open() {}
    focus() {}
    write(data: string | Uint8Array) {
      this.written.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
    }
    onData(cb: (data: string) => void) {
      this.dataHandler = cb;
      return () => {
        this.dataHandler = null;
      };
    }
    onResize(cb: (size: { cols: number; rows: number }) => void) {
      this.resizeHandler = cb;
      return () => {
        this.resizeHandler = null;
      };
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { Terminal: FakeTerminal };
});
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() {
      return { cols: 100, rows: 30 };
    }
  },
}));

interface FakeXterm {
  written: string[];
  disposed: boolean;
  dataHandler: ((data: string) => void) | null;
  resizeHandler: ((size: { cols: number; rows: number }) => void) | null;
}

const terminals = xterm.terminals as unknown as FakeXterm[];

import { TerminalDock } from '../../src/renderer/shell/TerminalDock';
import type { DesktopApi } from '../../src/renderer/api';
import type { TerminalEvent } from '../../src/shared/terminal';

function makeTerminalApi() {
  const listeners: Array<(event: TerminalEvent) => void> = [];
  let seq = 0;
  const api = {
    terminal: {
      open: vi.fn(async (_request: { distro: string; cwd: string; cols: number; rows: number }) => {
        seq += 1;
        return { id: `t${seq}`, distro: 'Ubuntu', cwd: '/home/u/p', cols: 100, rows: 30, pid: null };
      }),
      attach: vi.fn(async (_id: string) => true),
      write: vi.fn(async () => true),
      resize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onEvent: (cb: (event: TerminalEvent) => void) => {
        listeners.push(cb);
        return () => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
    },
    emit: (event: TerminalEvent) => {
      for (const cb of listeners) cb(event);
    },
    listenerCount: () => listeners.length,
  };
  return api;
}

function renderDock(api: ReturnType<typeof makeTerminalApi> | null, overrides: Partial<Parameters<typeof TerminalDock>[0]> = {}) {
  return render(
    <TerminalDock
      api={(api as unknown) as DesktopApi}
      distro="Ubuntu"
      cwd="/home/u/p"
      height={240}
      onHeightPreview={() => undefined}
      onHeightCommit={() => undefined}
      onToggleExpand={() => undefined}
      onClose={() => undefined}
      {...overrides}
    />,
  );
}

afterEach(() => {
  terminals.length = 0;
});

describe('terminal dock: только по явному действию', () => {
  it('does not spawn a shell on mount and keeps the slot honest', () => {
    const api = makeTerminalApi();
    renderDock(api);
    expect(api.terminal.open).not.toHaveBeenCalled();
    expect(screen.getByTestId('terminal-slot')).toHaveTextContent('');
    expect(screen.getByTestId('terminal-dock')).toHaveTextContent(/PTY/i);
  });

  it('opens a real session with the selected distro and project cwd', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    await waitFor(() => expect(api.terminal.open).toHaveBeenCalledTimes(1));
    expect(api.terminal.open).toHaveBeenCalledWith(
      expect.objectContaining({
        distro: 'Ubuntu',
        cwd: '/home/u/p',
        cols: expect.any(Number),
        rows: expect.any(Number),
      }),
    );
    const openedWith = api.terminal.open.mock.calls[0]?.[0];
    expect(openedWith.cols).toBeGreaterThanOrEqual(2);
    expect(openedWith.rows).toBeGreaterThanOrEqual(1);
    expect(await screen.findByTestId('terminal-xterm')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ubuntu · bash/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('adds a second tab with + and keeps each tab separate', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    await screen.findByTestId('terminal-xterm');
    await user.click(screen.getByTestId('terminal-new-tab'));
    await waitFor(() => expect(api.terminal.open).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('refuses to open without a connected distro instead of faking a shell', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api, { distro: null, cwd: null });
    await user.click(screen.getByTestId('terminal-launch'));
    expect(api.terminal.open).not.toHaveBeenCalled();
    expect(screen.getByTestId('terminal-dock')).toHaveTextContent(/дистрибутив/i);
  });
});

describe('terminal dock: данные и жизненный цикл', () => {
  it('sends typed input as base64 through the typed IPC', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    await screen.findByTestId('terminal-xterm');
    const term = terminals[0];
    term.dataHandler?.('ls\n');
    await waitFor(() =>
      expect(api.terminal.write).toHaveBeenCalledWith('t1', Buffer.from('ls\n').toString('base64')),
    );
  });

  it('writes PTY output byte-faithfully into the emulator', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    await screen.findByTestId('terminal-xterm');
    api.emit({ type: 'data', id: 't1', b64: Buffer.from('привет\n').toString('base64') });
    await waitFor(() => expect(terminals[0].written).toContain('привет\n'));
  });

  it('closes only the tab that was closed', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    await screen.findByTestId('terminal-xterm');
    await user.click(screen.getByTestId('terminal-new-tab'));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    const closeButtons = screen.getAllByRole('button', { name: /Закрыть вкладку/ });
    await user.click(closeButtons[0]);
    await waitFor(() => expect(api.terminal.close).toHaveBeenCalledTimes(1));
    expect(api.terminal.close).toHaveBeenCalledWith('t1');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('shows an honest state when the process is lost', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    await screen.findByTestId('terminal-xterm');
    api.emit({ type: 'exit', id: 't1', code: 137, lost: true, message: 'терминальный процесс завершился неожиданно' });
    expect(await screen.findByTestId('terminal-status')).toHaveTextContent(/заверш/i);
    expect(screen.getByTestId('terminal-status')).toHaveTextContent(/137/);
  });

  it('explains a cwd fallback instead of silently switching directories', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    await screen.findByTestId('terminal-xterm');
    api.emit({
      type: 'notice',
      id: 't1',
      code: 'CWD_FALLBACK',
      message: 'Проект недоступен: терминал открыт в домашнем каталоге',
    });
    expect(await screen.findByTestId('terminal-notice')).toHaveTextContent(/домашнем каталоге/);
  });
});

/**
 * P1 (независимое ревью): закрытие вкладки, пока `terminal.open()` ещё не
 * завершился. Раньше закрытие не отправлялось, а созданный позже PTY
 * оставался сиротой в main-процессе.
 */
describe('terminal dock: отмена открытия', () => {
  function deferredApi() {
    const api = makeTerminalApi();
    let resolve!: (value: { id: string; distro: string; cwd: string; cols: number; rows: number; pid: number | null }) => void;
    let reject!: (reason: unknown) => void;
    api.terminal.open = vi.fn(
      () =>
        new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        }),
    ) as unknown as typeof api.terminal.open;
    return { api, resolve: () => resolve, reject: () => reject };
  }

  it('закрывает созданную сессию компенсационно, если вкладку закрыли во время open()', async () => {
    const user = userEvent.setup();
    const { api, resolve } = deferredApi();
    renderDock(api);

    await user.click(screen.getByTestId('terminal-launch'));
    await waitFor(() => expect(api.terminal.open).toHaveBeenCalledTimes(1));
    // сессия ещё не создана, вкладку закрываем «в полёте»
    expect(screen.getByTestId('terminal-status')).toHaveTextContent(/Запуск PTY/);
    await user.click(screen.getByRole('button', { name: /Закрыть вкладку/ }));
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(api.terminal.close).not.toHaveBeenCalled();

    resolve()({ id: 'late-1', distro: 'Ubuntu', cwd: '/home/u/p', cols: 100, rows: 30, pid: null });
    await waitFor(() => expect(api.terminal.close).toHaveBeenCalledWith('late-1'));
    // повторного закрытия и «ожившей» вкладки нет
    expect(api.terminal.close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-launch')).toBeInTheDocument();
  });

  it('не дублирует закрытие: крестик по живой сессии отправляет close один раз', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    renderDock(api);
    await user.click(screen.getByTestId('terminal-launch'));
    expect(await screen.findByTestId('terminal-xterm')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Закрыть вкладку/ }));
    await waitFor(() => expect(api.terminal.close).toHaveBeenCalledTimes(1));
    expect(api.terminal.close).toHaveBeenCalledWith('t1');
  });
});

describe('terminal dock: окружение своей вкладки', () => {
  it('подпись вкладки берётся из session.distro, а не из текущего выбора', async () => {
    const user = userEvent.setup();
    const api = makeTerminalApi();
    const { rerender } = renderDock(api, { distro: 'Ubuntu' });
    await user.click(screen.getByTestId('terminal-launch'));
    expect(await screen.findByRole('tab', { name: /Ubuntu · bash/ })).toBeInTheDocument();

    // Пользователь переключил дистрибутив в настройках — вкладка не переименовывается.
    rerender(
      <TerminalDock
        api={(api as unknown) as DesktopApi}
        distro="Debian"
        cwd="/home/u/p"
        height={240}
        onHeightPreview={() => undefined}
        onHeightCommit={() => undefined}
        onToggleExpand={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole('tab', { name: /Ubuntu · bash/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Debian/ })).not.toBeInTheDocument();
  });
});
