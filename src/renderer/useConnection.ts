import { useCallback, useEffect, useState } from 'react';
import type { DesktopApi } from './api';
import type { RendererSnapshot } from './types';

const NO_API_SNAPSHOT: RendererSnapshot = {
  phase: 'error',
  attempt: 0,
  lastError: { code: 'NO_API', message: 'Preload API unavailable (window.piDesktop missing)' },
  distro: null,
  distros: null,
  runtime: null,
};

const IDLE_SNAPSHOT: RendererSnapshot = {
  phase: 'idle',
  attempt: 0,
  distro: null,
  distros: null,
  runtime: null,
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function useConnection(api: DesktopApi | null) {
  const [snapshot, setSnapshot] = useState<RendererSnapshot>(api ? IDLE_SNAPSHOT : NO_API_SNAPSHOT);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    let sawEvent = false; // a pushed state always wins over the initial pull
    void api
      .getStatus()
      .then((s) => {
        if (alive && !sawEvent) setSnapshot(s);
      })
      .catch((err: unknown) => {
        if (alive && !sawEvent) {
          setSnapshot({ ...NO_API_SNAPSHOT, lastError: { code: 'NO_API', message: message(err) } });
        }
      });
    const off = api.onStateChange((s) => {
      sawEvent = true;
      if (alive) setSnapshot(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, [api]);

  const retry = useCallback(async () => {
    if (!api) return;
    setRequestError(null);
    try {
      setSnapshot(await api.retry());
    } catch (err) {
      setRequestError(message(err));
    }
  }, [api]);

  const selectDistro = useCallback(
    async (distro: string) => {
      if (!api) return;
      setRequestError(null);
      try {
        setSnapshot(await api.selectDistro(distro));
      } catch (err) {
        setRequestError(message(err));
      }
    },
    [api],
  );

  const refreshRuntime = useCallback(async () => {
    if (!api) return;
    setRequestError(null);
    try {
      const runtime = (await api.request('getRuntimeInfo')) as RendererSnapshot['runtime'];
      setSnapshot((s) => ({ ...s, runtime }));
    } catch (err) {
      setRequestError(message(err));
    }
  }, [api]);

  return { snapshot, requestError, retry, selectDistro, refreshRuntime };
}
