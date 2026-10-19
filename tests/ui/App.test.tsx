import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = {
  phase: 'ready',
  attempt: 0,
  distro: 'Ubuntu',
  distros: ['Ubuntu', 'Ubuntu中文'],
  runtime: {
    distro: 'Ubuntu',
    node: { path: '/home/u/.local/bin/node', version: 'v22.23.2' },
    pi: { path: '/home/u/.local/bin/pi', version: '9.9.9', rpcSupported: true },
    agentDir: '/home/u/.pi/agent',
  },
};

interface MockApi {
  api: DesktopApi;
  emit: (snap: RendererSnapshot) => void;
  retry: ReturnType<typeof vi.fn>;
  selectDistro: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

function makeApi(initial: RendererSnapshot): MockApi {
  let current = initial;
  const subs: Array<(s: RendererSnapshot) => void> = [];
  const retry = vi.fn(async () => {
    current = { ...current, phase: 'connecting' };
    for (const cb of subs) cb(current);
    return current;
  });
  const selectDistro = vi.fn(async (distro: string) => {
    current = { ...current, distro, phase: 'ready' };
    for (const cb of subs) cb(current);
    return current;
  });
  const request = vi.fn(async (method: string) => {
    if (method === 'getRuntimeInfo') return current.runtime;
    return { ok: true };
  });
  const api: DesktopApi = {
    request: request as DesktopApi['request'],
    getStatus: async () => current,
    retry: retry as unknown as DesktopApi['retry'],
    listDistros: async () => current.distros ?? [],
    selectDistro: selectDistro as unknown as DesktopApi['selectDistro'],
    onStateChange: (cb) => {
      subs.push(cb);
      return () => undefined;
    },
  };
  return {
    api,
    emit: (snap) => {
      current = snap;
      for (const cb of subs) cb(snap);
    },
    retry,
    selectDistro,
    request,
  };
}

describe('App UI (RTL)', () => {
  it('renders progress while discovering and swaps to error when the connection fails — no eternal spinner', async () => {
    const mock = makeApi({ phase: 'discovering', attempt: 0, distro: null, distros: null, runtime: null });
    render(<App api={mock.api} />);
    expect(screen.getByTestId('status-phase')).toHaveTextContent(/поиск|подключени/i);
    expect(screen.queryByRole('button', { name: /повторить/i })).not.toBeInTheDocument();

    mock.emit({ phase: 'error', attempt: 3, distro: null, distros: null, runtime: null, lastError: { code: 'WSL_UNAVAILABLE', message: 'no distro' } });

    await waitFor(() => expect(screen.getByRole('button', { name: /повторить/i })).toBeInTheDocument());
    expect(screen.getByTestId('status-phase')).toHaveTextContent(/ошибк/i);
    expect(screen.getByTestId('error-code')).toHaveTextContent('WSL_UNAVAILABLE');
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  it('renders the ready state with real runtime versions', async () => {
    const mock = makeApi(READY);
    render(<App api={mock.api} />);
    await waitFor(() => expect(screen.getByTestId('status-phase')).toHaveTextContent(/готово/i));
    expect(screen.getByText('9.9.9')).toBeInTheDocument();
    expect(screen.getByText('v22.23.2')).toBeInTheDocument();
    expect(screen.getByTestId('distro')).toHaveTextContent('Ubuntu');
  });

  it('reconnects when the retry button is clicked', async () => {
    const user = userEvent.setup();
    const mock = makeApi({ phase: 'error', attempt: 5, distro: null, distros: null, runtime: null, lastError: { code: 'BRIDGE_TIMEOUT', message: 'timeout' } });
    render(<App api={mock.api} />);
    const retryButton = await screen.findByRole('button', { name: /повторить/i });
    await user.click(retryButton);
    expect(mock.retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('status-phase')).toHaveTextContent(/подключени/i));
  });

  it('lists available distros and selects a new one', async () => {
    const user = userEvent.setup();
    const mock = makeApi(READY);
    render(<App api={mock.api} />);
    const select = await screen.findByRole('combobox');
    expect(select).toHaveDisplayValue('Ubuntu');
    await user.selectOptions(select, 'Ubuntu中文');
    expect(mock.selectDistro).toHaveBeenCalledWith('Ubuntu中文');
  });

  it('surfaces a rejected runtime request as error text instead of crashing', async () => {
    const user = userEvent.setup();
    const mock = makeApi(READY);
    mock.request.mockRejectedValueOnce(new Error('method not allowed: exec'));
    render(<App api={mock.api} />);
    await waitFor(() => expect(screen.getByTestId('status-phase')).toHaveTextContent(/готово/i));
    await user.click(screen.getByRole('button', { name: /обновить данные/i }));
    await waitFor(() => expect(screen.getByTestId('request-error')).toHaveTextContent(/method not allowed/));
    // connection itself is unaffected
    expect(screen.getByTestId('status-phase')).toHaveTextContent(/готово/i);
  });

  it('shows a hard error when the preload API is missing entirely', async () => {
    render(<App api={null} />);
    expect(screen.getByTestId('status-phase')).toHaveTextContent(/ошибк/i);
    expect(screen.getByTestId('error-code')).toHaveTextContent('NO_API');
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });
});
