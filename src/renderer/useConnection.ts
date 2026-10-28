import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Актуальная фаза для обработчиков без лишних зависимостей useCallback.
  const phaseRef = useRef(snapshot.phase);
  useEffect(() => {
    phaseRef.current = snapshot.phase;
  }, [snapshot.phase]);
  const [requestError, setRequestError] = useState<string | null>(null);
  /**
   * Monotonic connection-generation counter (review R04 N1): every REAL
   * snapshot transition (phase/distro/attempt) bumps it, so consumers can
   * build keys that never repeat across a reconnect — `attempt` resets to 0
   * on READY, which made `ready:<distro>:<attempt>` collide after a reconnect
   * and let a toggle slip in while a fresh discovery was in flight.
   */
  const [connectionSeq, setConnectionSeq] = useState(0);
  const lastSnapshotRef = useRef<{ phase: string; distro: string | null; attempt: number }>({
    phase: api ? 'idle' : 'error',
    distro: null,
    attempt: 0,
  });

  useEffect(() => {
    if (!api) return;
    let alive = true;
    let sawEvent = false; // a pushed state always wins over the initial pull
    void api
      .getStatus()
      .then((s) => {
        if (alive && !sawEvent) {
          lastSnapshotRef.current = { phase: s.phase, distro: s.distro, attempt: s.attempt };
          setSnapshot(s);
        }
      })
      .catch((err: unknown) => {
        if (alive && !sawEvent) {
          setSnapshot({ ...NO_API_SNAPSHOT, lastError: { code: 'NO_API', message: message(err) } });
        }
      });
    const off = api.onStateChange((s) => {
      sawEvent = true;
      const last = lastSnapshotRef.current;
      if (last.phase !== s.phase || last.distro !== s.distro || last.attempt !== s.attempt) {
        lastSnapshotRef.current = { phase: s.phase, distro: s.distro, attempt: s.attempt };
        setConnectionSeq((n) => n + 1);
      }
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
    // UI21 F1-B R01: до READY запрос законно отвергается (DISCONNECTED) —
    // не показываем это как ошибку подключения.
    if (phaseRef.current !== 'ready') return;
    setRequestError(null);
    try {
      const runtime = (await api.request('getRuntimeInfo')) as RendererSnapshot['runtime'];
      setSnapshot((s) => ({ ...s, runtime }));
    } catch (err) {
      setRequestError(message(err));
    }
  }, [api]);

  return { snapshot, requestError, connectionSeq, retry, selectDistro, refreshRuntime };
}
