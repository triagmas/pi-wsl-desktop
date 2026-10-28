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
import { useOverlayDismiss } from './ui/overlayA11y';
import { anchorScrollTop, isAtBottom, stickScrollTop } from './feedScroll';

const HISTORY_PAGE = 100;

/** Позиция прокрутки ленты — модульная функция, чтобы мутация DOM не считалась
 *  изменением значения, переданного в хук (react-compiler/immutability). */
function scrollFeedTo(feed: HTMLElement | null, top: number): void {
  if (feed) feed.scrollTop = top;
}

/** Сброс/установка значения ref вне тела компонента (то же ограничение правила). */
function setRefValue<T>(ref: { current: T }, value: T): void {
  ref.current = value;
}
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
  const { state, open, send, resend, interrupt, closeChat, selectModel, selectThinkingLevel } = chat;
  // Актуальный черновик для отложенных колбэков (поздний ACK не должен стирать
  // текст, набранный после отправки).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // UI21-F2: selector UI state is presentation-only; the truth lives in Pi.
  const [menu, setMenu] = useState<'model' | 'thinking' | null>(null);
  const [filter, setFilter] = useState('');
  /* R02: меню модели/thinking — Escape, клик вне, стрелки и возврат фокуса.
   * Триггеры исключены из outside-click: их toggle обрабатывается самим чипом. */
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useOverlayDismiss({
    open: menu !== null,
    rootRef: menuRef,
    onDismiss: () => setMenu(null),
    returnFocusRef,
    ignoreSelector: '[data-testid="model-selector"],[data-testid="thinking-selector"]',
  });

  // Открытый список забирает фокус (поиск/первый пункт), чтобы стрелки работали.
  useEffect(() => {
    if (menu === null) return;
    const first = menuRef.current?.querySelector<HTMLElement>('.dl-chip-menu-search, .dl-chip-menu-item');
    first?.focus();
  }, [menu]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('.dl-chip-menu-item') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = current < 0 ? (delta > 0 ? 0 : items.length - 1) : (current + delta + items.length) % items.length;
    items[next].focus();
  };
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
    /** R03: курсор на БОЛЕЕ РАННЮЮ страницу (обратная пагинация). */
    prevCursor: string | null;
    /** R03: true → старше этой страницы записей нет. */
    atStart: boolean;
  }>({ file: null, entries: [], prevCursor: null, atStart: true });
  // R07 r02: ошибка принадлежит файлу — при переключении не «протекает».
  const [historyError, setHistoryError] = useState<{ file: string; code: string; message: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historySeq = useRef(0);
  const pageCountRef = useRef(0);

  const loadHistory = useCallback(
    async (before?: string) => {
      if (!api || file === '') return;
      const seq = ++historySeq.current;
      setHistoryLoading(true);
      try {
        // R03 (P1): читаем С КОНЦА файла. Раньше первая страница была самой
        // старой, и после перезапуска пользователь видел начало давнего
        // диалога — «история пропала». Более ранние страницы подгружаются
        // обратным курсором и вставляются СВЕРХУ.
        const page = await m1.readSession(api, {
          file,
          limit: HISTORY_PAGE,
          direction: 'backward',
          ...(before ? { beforeEntryId: before } : {}),
        });
        if (seq !== historySeq.current) return; // a newer session/file won
        const nextPage = before ? pageCountRef.current : 0;
        // Якорь фиксируем ПЕРЕД коммитом вставки старых записей (и только для
        // них): смена текста кнопки «Загрузка…» не должна его расходовать.
        if (before) {
          const feed = feedRef.current;
          if (feed) pendingAnchorRef.current = { height: feed.scrollHeight, top: feed.scrollTop };
        }
        const next = toChatEntries(page.entries as SavedEntry[], nextPage);
        pageCountRef.current = nextPage + 1;
        setSaved((prev) => {
          const prevEntries = prev.file === file ? prev.entries : [];
          return {
            file,
            entries: before ? [...next, ...prevEntries] : next,
            prevCursor: page.prevCursor ?? null,
            atStart: page.atStart === true,
          };
        });
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

  const loadOlder = useCallback(() => {
    void loadHistory(saved.prevCursor ?? undefined);
  }, [loadHistory, saved.prevCursor]);

  // Session switch: drop the previous session's transcript immediately — a
  // saved message from another file must never leak into this one.
  useEffect(() => {
    historySeq.current += 1;
    // Deferred: the strict set-state-in-effect rule forbids sync chains here.
    pageCountRef.current = 0;
    const t = window.setTimeout(() => {
      setSaved({ file, entries: [], prevCursor: null, atStart: true });
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
    // UI21 F1-B R02 (P1): черновик очищается ТОЛЬКО когда Pi подтвердил приём.
    // При тайм-ауте ACK текст остаётся у пользователя, повтора нет.
    void (async () => {
      const submitted = draft;
      const r = await send(submitted);
      // Стираем только тот черновик, который отправляли: пока ждали ACK,
      // пользователь мог начать печатать новое сообщение.
      if (r.ok && draftRef.current === submitted) onDraftChange('');
    })();
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
            {state.pendingSend ? (
              // Исход отправки неизвестен: только явный повтор, текст сохранён.
              <button
                type="button"
                data-testid="chat-resend"
                onClick={() => {
                  const pendingText = state.pendingSend?.text ?? '';
                  void (async () => {
                    const r = await resend();
                    if (r.ok && draftRef.current === pendingText) onDraftChange('');
                  })();
                }}
              >
                Повторить отправку
              </button>
            ) : (
              <button type="button" onClick={() => void open()}>
                Повторить подключение
              </button>
            )}
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
      <div
        className="dl-chip-menu"
        id="dl-chip-model-menu"
        data-testid="model-menu"
        role="dialog"
        aria-label="Выбор модели"
        aria-modal="false"
      >
        <input
          className="dl-chip-menu-search"
          placeholder="Поиск модели"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Поиск модели"
        />
        <div className="dl-chip-menu-list" role="listbox" aria-label="Модели Pi">
          {filteredModels.map((m) => (
            <button
              key={`${m.provider}:${m.id}`}
              type="button"
              role="option"
              aria-selected={m.provider === activeModel?.provider && m.id === activeModel?.id}
              className="dl-chip-menu-item"
              data-testid={`model-option-${m.provider}:${m.id}`}
              onClick={() => {
                setMenu(null);
                returnFocusRef.current?.focus();
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
      <div
        className="dl-chip-menu"
        id="dl-chip-thinking-menu"
        data-testid="thinking-menu"
        role="dialog"
        aria-label="Уровень thinking"
        aria-modal="false"
      >
        <div className="dl-chip-menu-list" role="listbox" aria-label="Уровни thinking">

          {thinkingLevels.length === 0 && state.thinkingError && (
            <div className="dl-chip-menu-empty" data-testid="thinking-menu-error">
              Уровни thinking недоступны: {state.thinkingError.code} — {state.thinkingError.message}
            </div>
          )}
          {thinkingLevels.map((level) => (
            <button
              key={level}
              type="button"
              role="option"
              aria-selected={level === thinkingLabel}
              className="dl-chip-menu-item"
              data-testid={`thinking-option-${level}`}
              onClick={() => {
                setMenu(null);
                returnFocusRef.current?.focus();
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
  // R03 (P1): лента открывается ПОСЛЕДНИМИ сообщениями; пока на диске есть
  // более ранние записи, разрыв стоит СВЕРХУ — живые ходы никогда не выдаются
  // за прямое продолжение скрытого куска.
  // R03: лента открывается на ПОСЛЕДНЕМ сообщении. Прокручиваем вниз только
  // когда меняется ХВОСТ ленты (первая загрузка, новый живой ход, смена файла):
  // подгрузка более ранних страниц вставляет записи сверху и позицию не рвёт.
  const feedRef = useRef<HTMLDivElement | null>(null);
  const tailKeyRef = useRef<string | null>(null);
  /** Держаться последнего сообщения, пока пользователь не отлистал вверх. */
  const stickRef = useRef(true);
  /** Якорь видимой позиции при подгрузке более ранних записей. */
  const pendingAnchorRef = useRef<{ height: number; top: number } | null>(null);

  const hasOlder = saved.file === file && !saved.atStart && saved.prevCursor !== null;
  const transcript = mergeTranscript(savedEntries, state.entries);
  if (hasOlder) {
    transcript.splice(0, 0, { key: HISTORY_GAP_KEY, kind: 'other', text: '' });
  }

  const tailKey = transcript.length > 0 ? transcript[transcript.length - 1]?.key ?? null : null;
  // «Держимся низа» — пока пользователь сам не отлистал вверх. Наблюдатели
  // перекрывают и поздний reflow markdown, и промежуточные commit'ы с пустой
  // лентой (они сбрасывают scrollTop в 0 — раньше именно это и оставляло
  // пользователя в начале файла).
  useEffect(() => {
    // Новая сессия (файл) → снова держимся последнего сообщения.
    setRefValue(stickRef, true);
    setRefValue(pendingAnchorRef, null);
    setRefValue(tailKeyRef, null);
    const feed = feedRef.current;
    if (!feed) return;
    const apply = (structural: boolean): void => {
      const anchor = pendingAnchorRef.current;
      // Якорь расходуется ТОЛЬКО структурной вставкой (подгрузка старых
      // записей). Изменение текста («Загрузка…») или дозапись стрима его не
      // трогают, иначе позиция считается по устаревшей высоте.
      if (structural && anchor !== null) {
        pendingAnchorRef.current = null;
        scrollFeedTo(
          feed,
          anchorScrollTop(
            { scrollTop: anchor.top, scrollHeight: anchor.height, clientHeight: feed.clientHeight },
            { scrollHeight: feed.scrollHeight },
          ),
        );
        return;
      }
      if (stickRef.current) scrollFeedTo(feed, stickScrollTop({ scrollHeight: feed.scrollHeight }));
    };
    apply(true);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            apply(false);
          });
    observer?.observe(feed);
    const mutations =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((records) => {
            apply(records.some((r) => r.type === 'childList'));
          });
    mutations?.observe(feed, { childList: true, subtree: true, characterData: true });
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
    };
  }, [file]);

  useEffect(() => {
    if (tailKey === null || tailKey === tailKeyRef.current) return;
    tailKeyRef.current = tailKey;
    // Хвост вырос (живой ход/перезагрузка). Догоняем ТОЛЬКО если пользователь
    // не отлистал вверх — иначе `message_end` вырывал бы его из чтения.
    if (stickRef.current) scrollFeedTo(feedRef.current, feedRef.current?.scrollHeight ?? 0);
  }, [tailKey]);

  const gapBlock: ReactNode = hasOlder ? (
    <div className="chat-history-gap" data-testid="chat-history-gap">
      <p className="muted">
        Показаны последние сохранённые записи. Выше в файле есть ещё записи — загрузите предыдущие, чтобы
        увидеть, что было раньше.
      </p>
      <button
        type="button"
        data-testid="chat-history-more"
        onClick={loadOlder}
        disabled={historyLoading}
      >
        {historyLoading ? 'Загрузка…' : 'Загрузить предыдущие сохранённые записи'}
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
        feedRef={feedRef}
        onFeedScroll={() => {
          const feed = feedRef.current;
          if (!feed) return;
          stickRef.current = isAtBottom({
            scrollTop: feed.scrollTop,
            scrollHeight: feed.scrollHeight,
            clientHeight: feed.clientHeight,
          });
        }}
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
                        returnFocusRef.current = document.activeElement as HTMLElement | null;
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
                      onThinkingClick: () => {
                        returnFocusRef.current = document.activeElement as HTMLElement | null;
                        setMenu((m) => (m === 'thinking' ? null : 'thinking'));
                      },
                    }
                  : {}),
                menu:
                  menu === 'model' || menu === 'thinking' ? (
                    <div
                      className="dl-chip-menu-anchor"
                      ref={menuRef}
                      onKeyDown={onMenuKeyDown}
                      data-testid="chip-menu-anchor"
                    >
                      {menu === 'model' ? modelMenu : thinkingMenu}
                    </div>
                  ) : null,
                modelMenuOpen: menu === 'model',
                thinkingMenuOpen: menu === 'thinking',
              }
            : null
        }
      />
    </div>
  );
}
