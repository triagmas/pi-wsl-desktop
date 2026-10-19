/**
 * Read-only history view: bounded pages via `sinceEntryId` cursors (no
 * unbounded DOM), honest partial/diagnostic notices, inert rendering.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DesktopApi } from './api';
import { m1, parseBridgeError } from './m1api';
import { entryView } from './entryText';
import { SafeMarkdown } from './SafeMarkdown';
import type { ReadSessionResultT } from './types';

const PAGE = 100;

export function HistoryView({ api, file }: { api: DesktopApi; file: string }) {
  const [result, setResult] = useState<ReadSessionResultT | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (since?: string) => {
      try {
        const next = await m1.readSession(api, { file, limit: PAGE, ...(since ? { sinceEntryId: since } : {}) });
        setResult((prev) =>
          prev && since ? { ...next, entries: [...next.entries, ...prev.entries] } : next,
        );
        setError(null);
      } catch (err) {
        setError(parseBridgeError(err));
      } finally {
        setLoading(false);
      }
    },
    [api, file],
  );

  useEffect(() => {
    // Deferred: the strict set-state-in-effect rule forbids synchronous
    // setState chains inside effect bodies; the fetch itself is async.
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (error) {
    return (
      <div className="error-box" role="alert" data-testid="history-error">
        <strong>{error.code}</strong> — {error.message}
        <div>
          <button type="button" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }
  if (loading && !result) {
    return (
      <div className="loading-row">
        <span data-testid="spinner" className="spinner" aria-hidden="true" />
        <span>Чтение истории…</span>
      </div>
    );
  }
  if (!result) return null;

  return (
    <div className="history" data-testid="history">
      {result.partialTrailing && (
        <p className="notice" data-testid="partial-note">
          Файл дописывается (идёт запись) — последняя запись может быть неполной.
        </p>
      )}
      {result.diagnostics.length > 0 && (
        <ul className="diagnostics" data-testid="read-diagnostics">
          {result.diagnostics.map((d) => (
            <li key={`${d.line}-${d.error}`}>
              Строка {d.line}: {d.error}
            </li>
          ))}
        </ul>
      )}
      <div className="history-entries">
        {result.entries.map((entry, i) => {
          const view = entryView(entry, i);
          if (view.kind === 'user' || view.kind === 'assistant') {
            return (
              <div key={view.key} className={`bubble bubble-${view.kind}`}>
                <span className="bubble-role">{view.kind}</span>
                <SafeMarkdown text={view.text} />
              </div>
            );
          }
          if (view.text === '') return null;
          return (
            <div key={view.key} className={`bubble bubble-${view.kind}`}>
              <span className="bubble-role">{view.kind}</span>
              <span>{view.text}</span>
            </div>
          );
        })}
      </div>
      {result.truncated && result.nextCursor && (
        <div className="history-more">
          <button
            type="button"
            data-testid="load-earlier"
            onClick={() => {
              setLoading(true); // event handler — not in an effect
              void load(result.nextCursor ?? undefined);
            }}
            disabled={loading}
          >
            {loading ? 'Загрузка…' : 'Показать ранее'}
          </button>
        </div>
      )}
    </div>
  );
}
