/**
 * UI-B R01 — метрики в статус-баре: реальные данные, честные «—», опрос ~2 c
 * без наложения запросов и пауза при скрытом окне.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMetrics } from '../../src/renderer/useMetrics';
import { formatMetrics, type MetricsSample } from '../../src/shared/terminalMetrics';
import type { DesktopApi } from '../../src/renderer/api';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

const GB = 1024 ** 3;

function Harness({ api }: { api: DesktopApi | null }) {
  const metrics = useMetrics(api);
  const text = formatMetrics(metrics);
  return (
    <div>
      <span data-testid="cpu">{text.cpu}</span>
      <span data-testid="ram">{text.ram}</span>
    </div>
  );
}

function makeMetricsApi(sample: () => Promise<MetricsSample>) {
  return { getMetrics: vi.fn(sample) } as unknown as DesktopApi;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe('useMetrics: опрос статус-бара', () => {
  it('renders dashes until the first real sample arrives', async () => {
    const api = makeMetricsApi(async () => ({ at: 1, cpuPercent: null, memUsedBytes: null, memTotalBytes: null }));
    render(<Harness api={api} />);
    expect(screen.getByTestId('cpu')).toHaveTextContent('—');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('cpu')).toHaveTextContent('—');
    expect(screen.getByTestId('ram')).toHaveTextContent('—');
  });

  it('polls every ~2 s and renders CPU/RAM of the Windows host', async () => {
    const api = makeMetricsApi(async () => ({ at: Date.now(), cpuPercent: 12, memUsedBytes: 8.4 * GB, memTotalBytes: 32 * GB }));
    render(<Harness api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('cpu')).toHaveTextContent('12%');
    expect(screen.getByTestId('ram')).toHaveTextContent('8,4 / 32 ГБ');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(2);
  });

  it('never overlaps requests when a sample is slow', async () => {
    let resolve: ((sample: MetricsSample) => void) | null = null;
    const api = makeMetricsApi(
      () =>
        new Promise<MetricsSample>((r) => {
          resolve = r;
        }),
    );
    render(<Harness api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8200);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve?.({ at: Date.now(), cpuPercent: 40, memUsedBytes: GB, memTotalBytes: 2 * GB });
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(2);
  });

  it('pauses while the window is hidden and refreshes on return', async () => {
    const api = makeMetricsApi(async () => ({ at: Date.now(), cpuPercent: 5, memUsedBytes: GB, memTotalBytes: 4 * GB }));
    render(<Harness api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(1);
    await act(async () => {
      setHidden(true);
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(1);
    await act(async () => {
      setHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getMetrics).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous values when a later sample fails', async () => {
    let call = 0;
    const api = makeMetricsApi(async () => {
      call += 1;
      if (call === 1) return { at: Date.now(), cpuPercent: 7, memUsedBytes: GB, memTotalBytes: 8 * GB };
      throw new Error('IPC down');
    });
    render(<Harness api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('cpu')).toHaveTextContent('7%');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('cpu')).toHaveTextContent('7%');
  });
});

describe('status bar: метрики в реальном статус-баре', () => {
  it('renders the Windows-host CPU/RAM snapshot coming from the trusted main process', async () => {
    vi.useRealTimers();
    const api = makeApi();
    (api as unknown as { getMetrics: () => Promise<MetricsSample> }).getMetrics = async () => ({
      at: Date.now(),
      cpuPercent: 23,
      memUsedBytes: 12 * GB,
      memTotalBytes: 64 * GB,
    });
    render(<App api={api} moduleDefinitions={[]} />);
    await waitFor(() => expect(screen.getByTestId('status-cpu')).toHaveTextContent('CPU 23%'));
    expect(screen.getByTestId('status-ram')).toHaveTextContent('RAM 12 / 64 ГБ');
    expect(screen.getByTestId('status-os')).toHaveTextContent('Windows');
  });
});
