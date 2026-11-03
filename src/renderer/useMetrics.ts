/**
 * UI-B R01 — опрос метрик Windows-хоста из статус-бара.
 *
 * Правила: интервал ≈2 c, один запрос в полёте (никаких наложений), пауза
 * при скрытом окне и немедленное обновление при возврате, ошибка IPC не
 * обнуляет последние значения (лучше слегка старые данные, чем «0»).
 */
import { useEffect, useState } from 'react';
import type { DesktopApi } from './api';
import { EMPTY_METRICS, typeofSample, type MetricsSample } from '../shared/terminalMetrics';

export const METRICS_INTERVAL_MS = 2000;

export function useMetrics(api: DesktopApi | null, intervalMs: number = METRICS_INTERVAL_MS): MetricsSample {
  const [sample, setSample] = useState<MetricsSample>(EMPTY_METRICS);

  useEffect(() => {
    const getMetrics = api?.getMetrics;
    if (!getMetrics) return;
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (): void => {
      if (disposed || timer !== null) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      timer = setTimeout(() => void tick(), intervalMs);
    };

    const tick = async (): Promise<void> => {
      timer = null;
      if (disposed || inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlight = true;
      try {
        const next = await getMetrics();
        if (!disposed && typeofSample(next)) setSample(next);
      } catch {
        // IPC/мост недоступен — оставляем последний снимок, UI не врёт нулём.
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const onVisibility = (): void => {
      if (typeof document !== 'undefined' && document.hidden) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        return;
      }
      if (!inFlight) void tick();
    };

    void tick();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, intervalMs]);

  return sample;
}
