/**
 * Sessions view (M1): project index → session list → detail.
 * Discovery is read-only; `subscribeEvents` is registered up front (Pi
 * fast-completion contract: subscribe BEFORE any prompt).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi } from './api';
import { m1, parseBridgeError } from './m1api';
import { SessionDetail } from './SessionDetail';
import type { ProjectInfoT, SessionInfoT } from './types';

const READY_DEADLINE_MS = 20_000;

export function SessionsView({
  api,
  readyDeadlineMs = READY_DEADLINE_MS,
}: {
  api: DesktopApi | null;
  /** Injectable for tests; production default 20s (SPEC §7 bounded loading). */
  readyDeadlineMs?: number;
}) {
  const [projects, setProjects] = useState<ProjectInfoT[]>([]);
  const [sessions, setSessions] = useState<SessionInfoT[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selProject, setSelProject] = useState<string | null>(null);
  const [open, setOpen] = useState<SessionInfoT | null>(null);
  const subscribed = useRef(false);

  const [ready, setReady] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [p, s] = await Promise.all([m1.listProjects(api), m1.listSessions(api)]);
      setProjects(p.projects);
      setSessions(s.sessions);
      setError(null);
    } catch (err) {
      setError(parseBridgeError(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Discovery needs a CONNECTED bridge: wait for phase 'ready' (the WSL
  // probe takes a moment after app start) instead of racing it into
  // DISCONNECTED — but with a bounded deadline (SPEC §7: no eternal
  // spinner without an escape). On deadline the view shows BRIDGE_TIMEOUT
  // + retry; a late 'ready' still loads normally.
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const markReady = (): void => {
      if (!alive) return;
      window.clearTimeout(deadline);
      setReady(true);
    };
    const deadline = window.setTimeout(() => {
      if (!alive || readySeen) return;
      setLoading(false);
      setError((prev) => prev ?? { code: 'BRIDGE_TIMEOUT', message: 'Мост не готов — подключение занимает дольше обычного' });
    }, readyDeadlineMs);
    let readySeen = false;
    void api
      .getStatus()
      .then((s) => {
        if (s.phase === 'ready') {
          readySeen = true;
          markReady();
        }
      })
      .catch(() => undefined);
    const off = api.onStateChange((s) => {
      if (s.phase === 'ready' && !readySeen) {
        readySeen = true;
        markReady();
      }
    });
    return () => {
      alive = false;
      window.clearTimeout(deadline);
      off();
    };
  }, [api, readyDeadlineMs]);

  useEffect(() => {
    if (!api || !ready || loadedOnce.current) return;
    loadedOnce.current = true;
    if (!subscribed.current) {
      subscribed.current = true;
      // subscribe BEFORE any prompt can exist (rpc.md fast-completion rule)
      void m1.subscribeEvents(api).catch(() => undefined);
    }
    // Deferred: strict set-state-in-effect forbids synchronous setState chains.
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [api, ready, load]);

  const retry = useCallback(async () => {
    if (!api) return;
    setError(null);
    setLoading(true);
    try {
      const s = await api.getStatus();
      if (s.phase === 'ready') {
        await load();
        return;
      }
      setLoading(false);
      setError({ code: 'BRIDGE_TIMEOUT', message: 'Мост ещё не готов — повторите через несколько секунд' });
    } catch (err) {
      setLoading(false);
      setError(parseBridgeError(err));
    }
  }, [api, load]);

  if (!api) {
    return (
      <div className="error-box" role="alert">
        <strong>NO_API</strong> — Preload API unavailable (window.piDesktop missing)
      </div>
    );
  }

  if (open) {
    return (
      <div className="m1-wrap">
        <button type="button" data-testid="sessions-back" onClick={() => setOpen(null)}>
          ← К спискам
        </button>
        <SessionDetail key={open.id} api={api} session={open} />
      </div>
    );
  }

  const shown = selProject === null ? sessions : sessions.filter((s) => s.projectId === selProject);

  return (
    <div className="m1-wrap" data-testid="sessions-view">
      {error && (
        <div className="error-box" role="alert" data-testid="sessions-error">
          <strong>{error.code}</strong> — {error.message}
          <div>
            <button type="button" onClick={() => void retry()}>
              Повторить
            </button>
          </div>
        </div>
      )}
      {loading && !error && (
        <div className="loading-row">
          <span data-testid="spinner" className="spinner" aria-hidden="true" />
          <span>Поиск проектов и сессий…</span>
        </div>
      )}
      {!loading && !error && (
        <div className="m1-grid">
          <section className="panel" aria-label="Проекты">
            <h3>Проекты</h3>
            <button
              type="button"
              className={selProject === null ? 'item item-selected' : 'item'}
              data-testid="project-all"
              onClick={() => setSelProject(null)}
            >
              Все проекты
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={selProject === p.path ? 'item item-selected' : 'item'}
                data-testid="project-item"
                onClick={() => setSelProject(p.path)}
              >
                <span>{p.path}</span>
                <span className="muted">({p.sessionCount})</span>
              </button>
            ))}
          </section>
          <section className="panel" aria-label="Сессии">
            <h3>Сессии</h3>
            {shown.length === 0 ? (
              <p className="notice" data-testid="sessions-empty">
                Сессий не найдено — откройте Pi в нужном проекте, и он появится здесь.
              </p>
            ) : (
              <ul className="session-list" data-testid="session-list">
                {shown.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="item session-item" data-testid="session-item" onClick={() => setOpen(s)}>
                      <span className="session-name">{s.name ?? s.id.slice(0, 8)}</span>
                      {s.activeWrite && <span className="badge badge-active">запись</span>}
                      {s.availability !== 'ok' && (
                        <span className="badge badge-warn">⚠ {s.diagnostics ?? s.availability}</span>
                      )}
                      <span className="muted session-time">{s.updatedAt}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
