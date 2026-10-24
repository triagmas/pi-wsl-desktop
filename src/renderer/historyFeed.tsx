/**
 * Read-only history feed (R03 п.1): the stored conversation is the primary
 * content of the chat workspace. SessionDetail loads it once per file and
 * feeds BOTH surfaces — the conversation scroll (inside ChatPane, same
 * scroll container as live entries) and the controller-less fallback.
 * Pure page accumulation lives in historyMerge (seam-tested); the forward
 * cursor semantics are unchanged from the original HistoryView.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi } from './api';
import { m1, parseBridgeError } from './m1api';
import { entryView } from './entryText';
import { mergeHistoryPage } from './historyMerge';
import { SafeMarkdown } from './SafeMarkdown';
import type { ReadSessionResultT } from './types';

const PAGE = 100;

export interface HistoryFeed {
  result: ReadSessionResultT | null;
  error: { code: string; message: string } | null;
  loading: boolean;
  loadMore: () => void;
  retry: () => void;
}

export function useHistoryFeed(api: DesktopApi | null, file: string): HistoryFeed {
  const [result, setResult] = useState<ReadSessionResultT | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  /** Review P1-5: strictly-increasing request generation — a response for a
   * retired file (or an older request) is never applied. */
  const reqSeq = useRef(0);

  const load = useCallback(
    async (since?: string) => {
      if (!api || !file) return;
      const seq = ++reqSeq.current;
      if (!since) {
        // Fresh load (not a pagination step): a file switch clears the previous
        // file's result/error immediately, and a retry starts clean (review P1-5).
        setResult(null);
        setError(null);
        setLoading(true);
      }
      try {
        const next = await m1.readSession(api, { file, limit: PAGE, ...(since ? { sinceEntryId: since } : {}) });
        if (seq !== reqSeq.current) return; // a newer file/request owns the view
        // The reader cursor is strictly forward — mergeHistoryPage appends
        // continuation pages (review round 4; pure + seam-tested).
        setResult((prev) => mergeHistoryPage(prev, next, since));
        setError(null);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        setError(parseBridgeError(err));
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [api, file],
  );

  useEffect(() => {
    if (!api || !file) return;
    // Review P1-5: invalidate in-flight responses for the retired file the
    // moment the file prop changes (a REF bump is effect-legal; the visible
    // file-scoped reset happens inside `load`, never synchronously here).
    reqSeq.current += 1;
    // Deferred: the strict set-state-in-effect rule forbids synchronous
    // setState chains inside effect bodies; the fetch itself is async.
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [api, file, load]);

  const loadMore = useCallback(() => {
    setLoading(true); // event handler — not in an effect
    void load(result?.nextCursor ?? undefined);
  }, [load, result]);

  const retry = useCallback(() => {
    setLoading(true); // event handler — not in an effect
    void load();
  }, [load]);

  return { result, error, loading, loadMore, retry };
}

export function HistoryErrorBox({ feed }: { feed: HistoryFeed }) {
  if (!feed.error) return null;
  return (
    <div className="error-box" role="alert" data-testid="history-error">
      <strong>{feed.error.code}</strong> — {feed.error.message}
      <div>
        <button type="button" onClick={feed.retry}>
          Повторить
        </button>
      </div>
    </div>
  );
}

export function HistoryLoading() {
  return (
    <div className="loading-row">
      <span data-testid="spinner" className="spinner" aria-hidden="true" />
      <span>Чтение истории…</span>
    </div>
  );
}

export function HistoryNotices({ feed }: { feed: HistoryFeed }) {
  const r = feed.result;
  if (!r) return null;
  return (
    <>
      {r.partialTrailing && (
        <p className="notice" data-testid="partial-note">
          Показана неполная хвостовая часть: файл дописывается (идёт запись) или превышен лимит чтения.
        </p>
      )}
      {r.diagnostics.length > 0 && (
        <ul className="diagnostics" data-testid="read-diagnostics">
          {r.diagnostics.map((d) => (
            <li key={`${d.line}-${d.error}`}>
              Строка {d.line}: {d.error}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function HistoryBubbles({ result }: { result: ReadSessionResultT }) {
  return (
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
  );
}

export function HistoryMore({ feed }: { feed: HistoryFeed }) {
  const r = feed.result;
  if (!r?.truncated || !r.nextCursor) return null;
  return (
    <div className="history-more">
      <button type="button" data-testid="load-more" disabled={feed.loading} onClick={feed.loadMore}>
        {feed.loading ? 'Загрузка…' : 'Загрузить продолжение'}
      </button>
    </div>
  );
}

/** Controller-less fallback (SessionsView test harness): original
 * HistoryView semantics — error replaces the list, loading shows a row. */
export function HistoryFeedView({ feed }: { feed: HistoryFeed }) {
  if (feed.error) return <HistoryErrorBox feed={feed} />;
  if (!feed.result && feed.loading) return <HistoryLoading />;
  if (!feed.result) return null;
  return (
    <>
      <HistoryNotices feed={feed} />
      <HistoryBubbles result={feed.result} />
      <HistoryMore feed={feed} />
    </>
  );
}
