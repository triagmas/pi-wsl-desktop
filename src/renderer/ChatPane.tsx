/**
 * Chat pane (D2): тот же явный write-boundary (M1: открытие/промпт/прерывание
 * только по клику, финализация по message_end, ошибки/реконнект), но
 * презентация — одобренный ui/ChatView: user-пузыри, ответы Pi, живые шаги
 * инструментов (steps реального tool-state), notice-блок уведомлений и
 * управляемый композер (textarea + отправка + прерывание).
 * Поведенческие контракты tests/ui/m1Chat.test.tsx сохранены 1:1.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SafeMarkdown } from './SafeMarkdown';
import { toUiError, type ChatController, type ChatEntry } from './useChat';
import type { DesktopApi } from './api';
import { m1 } from './m1api';
import { mergeTranscript, toChatEntries, type SavedEntry } from './transcript';
import { ChatView, type ChatTurn, type ChatTurnAssistant } from './ui/ChatView';

const HISTORY_PAGE = 100;
const HISTORY_GAP_KEY = '__history-gap__';

export interface ChatPaneProps {
  /** Controller + composer draft live above the panel (§9.1 item 4): hiding
   * panels, switching views or themes never drops them or aborts the stream. */
  chat: ChatController;
  draft: string;
  onDraftChange: (value: string) => void;
  /** R07 §2: read-only источник сохранённых сообщений (M1 pagination). */
  api?: DesktopApi | null;
  file?: string;
}

export function ChatPane({ chat, draft, onDraftChange, api = null, file = '' }: ChatPaneProps) {
  const { state, open, send, interrupt, closeChat, selectModel, selectThinkingLevel } = chat;
  // UI21-F2: selector UI state is presentation-only; the truth lives in Pi.
  const [menu, setMenu] = useState<'model' | 'thinking' | null>(null);
  const [filter, setFilter] = useState('');
  const switchLocked = state.status === 'sending' || state.status === 'opening';

  /* ------------------------------------------------------------------ *
   * R07 §2: сохранённые сообщения Pi — в общей ленте.
   * Читаем ТОЛЬКО первую/следующую страницу M1 readSession (bounded), один
   * раз на файл; живые ходы никогда не перечитывают JSONL → дублей нет,
   * файл не изменяется, external-writer/явный open гейты не обходятся.
   * ------------------------------------------------------------------ */
  const [saved, setSaved] = useState<{
    /** R07 r01 (P2-A): записи принадлежат конкретному файлу — чужой файл
     *  никогда не рендерится, даже одним кадром до окончания чтения. */
    file: string | null;
    entries: ChatEntry[];
    cursor: string | null;
    truncated: boolean;
  }>({ file: null, entries: [], cursor: null, truncated: false });
  // R07 r02: ошибка принадлежит файлу — при переключении не «протекает».
  const [historyError, setHistoryError] = useState<{ file: string; code: string; message: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historySeq = useRef(0);
  const pageCountRef = useRef(0);

  const loadHistory = useCallback(
    async (since?: string) => {
      if (!api || file === '') return;
      const seq = ++historySeq.current;
      setHistoryLoading(true);
      try {
        const page = await m1.readSession(api, {
          file,
          limit: HISTORY_PAGE,
          ...(since ? { sinceEntryId: since } : {}),
        });
        if (seq !== historySeq.current) return; // a newer session/file won
        const nextPage = since ? pageCountRef.current : 0;
        const next = toChatEntries(page.entries as SavedEntry[], nextPage);
        pageCountRef.current = nextPage + 1;
        setSaved((prev) =>
          since
            ? { file, entries: [...(prev.file === file ? prev.entries : []), ...next], cursor: page.nextCursor ?? null, truncated: page.truncated }
            : { file, entries: next, cursor: page.nextCursor ?? null, truncated: page.truncated },
        );
        setHistoryError(null);
      } catch (err) {
        if (seq !== historySeq.current) return;
        // P1-A: та же централизованная редактирующая граница, что у остальных ошибок.
        setHistoryError({ file, ...toUiError(err) });
      } finally {
        if (seq === historySeq.current) setHistoryLoading(false);
      }
    },
    [api, file],
  );

  // Session switch: drop the previous session's transcript immediately — a
  // saved message from another file must never leak into this one.
  useEffect(() => {
    historySeq.current += 1;
    // Deferred: the strict set-state-in-effect rule forbids sync chains here.
    pageCountRef.current = 0;
    const t = window.setTimeout(() => {
      setSaved({ file, entries: [], cursor: null, truncated: false });
      setHistoryError(null);
      setHistoryLoading(false);
      void loadHistory();
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadHistory, file]);
  // Only entries read for THIS file are ever displayed (never the previous one).
  const savedEntries = saved.file === file ? saved.entries : [];
  const visibleHistoryError = historyError && historyError.file === file ? historyError : null;
  const activeModel = state.state?.model ?? null;
  // Defensive defaults: an older/partial state object must never crash the pane.
  const models = useMemo(() => state.models ?? [], [state.models]);
  const thinkingLevels = state.thinkingLevels ?? [];
  // P1 (review r01): the selector must stay reachable even with no active model
  // and an empty/failed catalog — otherwise empty/error/refresh states are
  // unreachable exactly when the user has nothing configured yet.
  const modelLabel = activeModel
    ? `${activeModel.provider}/${activeModel.id}`
    : state.modelsLoading
      ? 'Модель: загрузка…'
      : models.length > 0
        ? 'Модель'
        : 'Нет моделей';
  const thinkingLabel = state.state?.thinkingLevel ?? null;
  const filteredModels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q === '') return models;
    return models.filter((m) => `${m.provider}/${m.id}/${m.name}`.toLowerCase().includes(q));
  }, [models, filter]);

  const submit = (e?: FormEvent): void => {
    e?.preventDefault();
    if (draft.trim() === '' || state.status !== 'open') return;
    void send(draft);
    onDraftChange('');
  };

  const isOpenLike = state.status === 'open' || state.status === 'sending';
  const canSubmit = state.status === 'open' && draft.trim() !== '';

  /* ------------------------------------------------------------------ *
   * Уведомления (notice-слот ChatView): banner / error+retry / спиннер /
   * статус-строка с прерыванием / явный gate открытия.
   * ------------------------------------------------------------------ */
  const notice: ReactNode = (
    <>
      {visibleHistoryError && (
        <div className="error-box" role="alert" data-testid="chat-history-error">
          <strong>{visibleHistoryError.code}</strong> — {visibleHistoryError.message}
          <div>
            <button type="button" onClick={() => void loadHistory()}>
              Повторить чтение истории
            </button>
          </div>
        </div>
      )}
      {historyLoading && savedEntries.length === 0 && (
        <div className="loading-row" data-testid="chat-history-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Чтение сохранённых сообщений…</span>
        </div>
      )}
      {state.banner && (
        <div className="error-box" role="alert" data-testid="chat-banner">
          <strong>{state.banner.code}</strong> — {state.banner.message}. Откройте чат заново, когда будет готовы.
        </div>
      )}
      {state.error && (
        <div className="error-box" role="alert" data-testid="chat-error">
          <strong>{state.error.code}</strong> — {state.error.message}
          <div>
            <button type="button" onClick={() => void open()}>
              Повторить подключение
            </button>
          </div>
        </div>
      )}
      {state.status === 'opening' && (
        <div className="loading-row">
          <span data-testid="spinner" className="spinner" aria-hidden="true" />
          <span>Подключение к сессии…</span>
        </div>
      )}
      {state.status === 'error' && !state.error && (
        <div className="error-box" role="alert">Не удалось открыть чат</div>
      )}
      {!isOpenLike && state.status !== 'opening' && (
        // R07 r01 (P2-B): компактная группа действия; явное открытие Pi RPC
        // остаётся обязательным — никаких автоматических запросов к модели.
        <div className="chat-open-notice" data-testid="chat-open-notice">
          <button type="button" className="primary" onClick={() => void open()}>
            Открыть чат
          </button>
          <span className="muted">Запись — только через официальный Pi RPC и по вашему действию.</span>
        </div>
      )}
      {isOpenLike && (
        <div className="chat-status-row">
          <span data-testid="chat-status">
            {state.status === 'sending' ? 'Генерация…' : 'Чат открыт'}
          </span>
          {state.status === 'sending' && (
            <button type="button" data-testid="interrupt" onClick={() => void interrupt()}>
              Прервать
            </button>
          )}
          <button type="button" onClick={() => void closeChat()}>
            Закрыть чат
          </button>
        </div>
      )}
    </>
  );

  /* ------------------------------------------------------------------ *
   * Лента: записи сессии → user/assistant-ходы; стрим — отдельный ход
   * с живыми шагами реального tool-state (state.tools).
   * ------------------------------------------------------------------ */
  /* UI21-F2: выпадающие списки — данные из Pi (никогда не хардкод). */
  const modelMenu: ReactNode =
    menu === 'model' ? (
      <div className="dl-chip-menu" data-testid="model-menu" role="dialog" aria-label="Выбор модели">
        <input
          className="dl-chip-menu-search"
          placeholder="Поиск модели"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Поиск модели"
        />
        <div className="dl-chip-menu-list">
          {filteredModels.map((m) => (
            <button
              key={`${m.provider}:${m.id}`}
              type="button"
              className="dl-chip-menu-item"
              data-testid={`model-option-${m.provider}:${m.id}`}
              onClick={() => {
                setMenu(null);
                void selectModel(m.provider, m.id);
              }}
            >
              <span className="dl-chip-menu-provider">{m.provider}</span>
              <span className="dl-chip-menu-name">{m.name}</span>
              <span className="dl-chip-menu-id">{m.id}</span>
            </button>
          ))}
          {filteredModels.length === 0 && state.modelsLoading && (
            <div className="dl-chip-menu-empty" data-testid="model-menu-loading">
              Загрузка каталога из Pi…
            </div>
          )}
          {filteredModels.length === 0 && !state.modelsLoading && (
            <div className="dl-chip-menu-empty" data-testid="model-menu-empty">
              {state.modelsError
                ? `Каталог Pi недоступен: ${state.modelsError.message}`
                : models.length === 0
                  ? 'Pi не сообщил ни одной модели'
                  : 'Ничего не найдено'}
            </div>
          )}
        </div>
        <button
          type="button"
          className="dl-chip-menu-refresh"
          data-testid="model-menu-refresh"
          onClick={() => void chat.refreshModels?.()}
        >
          Обновить список из Pi
        </button>
      </div>
    ) : null;

  const thinkingMenu: ReactNode =
    menu === 'thinking' ? (
      <div className="dl-chip-menu" data-testid="thinking-menu" role="dialog" aria-label="Уровень thinking">
        <div className="dl-chip-menu-list">
          {thinkingLevels.length === 0 && state.thinkingError && (
            <div className="dl-chip-menu-empty" data-testid="thinking-menu-error">
              Уровни thinking недоступны: {state.thinkingError.code} — {state.thinkingError.message}
            </div>
          )}
          {thinkingLevels.map((level) => (
            <button
              key={level}
              type="button"
              className="dl-chip-menu-item"
              data-testid={`thinking-option-${level}`}
              onClick={() => {
                setMenu(null);
                void selectThinkingLevel(level);
              }}
            >
              <span className="dl-chip-menu-name">{level}</span>
            </button>
          ))}
        </div>
      </div>
    ) : null;

  // R07 §2: единая лента — сначала сохранённое (read-only), затем живые ходы.
  // R07 r01 (P1-B): пока есть непрочитанные более поздние записи, между ними
  // вставляется явный разрыв — живые ходы не выдаются за прямое продолжение.
  const hasGap = saved.file === file && saved.truncated && saved.cursor !== null;
  const transcript = mergeTranscript(savedEntries, state.entries);
  if (hasGap) {
    // Разрыв встаёт ровно на стык: после показанных сохранённых записей,
    // перед первым живым ходом (или в конец, если живых ещё нет).
    const firstLive = transcript.findIndex((e) => e.key.startsWith('l:'));
    transcript.splice(firstLive === -1 ? transcript.length : firstLive, 0, {
      key: HISTORY_GAP_KEY,
      kind: 'other',
      text: '',
    });
  }

  const gapBlock: ReactNode = hasGap ? (
    <div className="chat-history-gap" data-testid="chat-history-gap">
      <p className="muted">
        Показаны первые сохранённые записи. Дальше по файлу есть ещё записи — загрузите следующие по
        порядку, чтобы увидеть, что было до текущего чата.
      </p>
      <button
        type="button"
        data-testid="chat-history-more"
        onClick={() => void loadHistory(saved.cursor ?? undefined)}
        disabled={historyLoading}
      >
        {historyLoading ? 'Загрузка…' : 'Загрузить следующие сохранённые записи'}
      </button>
    </div>
  ) : null;

  const turns: ChatTurn[] = transcript.map((entry) => {
    // R07 r01 (P1-B): разрыв — отдельный ход между сохранённым и живым.
    if (entry.key === HISTORY_GAP_KEY) {
      return { kind: 'assistant', id: HISTORY_GAP_KEY, body: gapBlock };
    }
    if (entry.kind === 'user') {
      return { kind: 'user', id: entry.key, text: entry.text };
    }
    // UI21 R02: tool results are their own kind of chat content (§9.3
    // toolOutput zone). Keep them semantically separate from assistant prose —
    // the .bubble-tool presentation (tool card surface + its own typography
    // tokens) was lost when every non-user entry became an assistant turn.
    if (entry.kind === 'tool') {
      return {
        kind: 'assistant',
        id: entry.key,
        body: (
          <div className="bubble bubble-tool" data-testid="chat-tool-entry">
            <span className="bubble-role">tool</span>
            <SafeMarkdown text={entry.text} />
          </div>
        ),
      };
    }
    const turn: ChatTurnAssistant = {
      kind: 'assistant',
      id: entry.key,
      // UI21-F1-C: a failed run shows the existing .error-box alert with the
      // actual (redacted) model error — never a blank bubble, never parsed
      // as markdown. Normal entries keep the unchanged markdown path.
      body: entry.error ? (
        <>
          {entry.text !== '' && <SafeMarkdown text={entry.text} />}
          <div className="error-box" role="alert" data-testid="chat-message-error">
            <strong>Генерация не удалась</strong> — {entry.error}
          </div>
        </>
      ) : (
        <SafeMarkdown text={entry.text} />
      ),
    };
    return turn;
  });

  const toolSteps = state.tools.map((tool) => ({
    id: tool.id,
    // Глиф состояния в тексте: шаг честно показывает «выполняется/готово/ошибка».
    text: `${tool.name} ${tool.error ? '✗' : tool.done ? '✓' : '⏳'}`,
    active: !tool.done && !tool.error,
    more: undefined,
  }));
  const streaming = state.status === 'sending' || state.streamText !== '' || state.tools.length > 0;
  if (streaming && isOpenLike) {
    turns.push({
      kind: 'assistant',
      id: 'live',
      body: state.streamText !== '' ? <SafeMarkdown text={state.streamText} /> : null,
      steps: toolSteps,
      stepsTestId: 'tools',
    });
  }

  return (
    <div className="dl-chatpane" data-testid="chat-pane">
      <ChatView
        notice={notice}
        turns={turns}
        showIdentity={false}
        stepCircle={26}
        composer={
          isOpenLike
            ? {
                placeholder: 'Сообщение…',
                density: 'standard',
                value: draft,
                onValueChange: onDraftChange,
                onSubmit: () => submit(),
                submitDisabled: !canSubmit,
                inputDisabled: state.status !== 'open',
                // UI21-F2: model + thinking come straight from Pi get_state.
                ...(isOpenLike
                  ? {
                      model: modelLabel,
                      modelDisabled: switchLocked,
                      onModelClick: () => {
                        setFilter('');
                        setMenu((m) => (m === 'model' ? null : 'model'));
                      },
                    }
                  : {}),
                ...(thinkingLabel !== null
                  ? {
                      thinking: thinkingLabel,
                      // A levels failure keeps the selector open so the honest
                      // error is reachable; it is not a fabricated single level.
                      thinkingDisabled: switchLocked || (thinkingLevels.length <= 1 && state.thinkingError === null),
                      onThinkingClick: () => setMenu((m) => (m === 'thinking' ? null : 'thinking')),
                    }
                  : {}),
                menu: menu === 'model' ? modelMenu : menu === 'thinking' ? thinkingMenu : null,
              }
            : null
        }
      />
    </div>
  );
}
