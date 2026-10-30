/**
 * Chat client state machine (M1): explicit write boundary, streamed text
 * reconstruction, tool lifecycle, error/recovery states.
 *
 * UI26 R01 (#26): state is now kept PER CONVERSATION (`sessionChat.ts`), not in
 * one global slot:
 *  - switching dialogs no longer destroys the other one's stream/draft/errors;
 *  - a late event stamped with another session key is never rendered here;
 *  - a draft (`file === ''` + `cwd`) opens the official Pi `new_session` and is
 *    bound to the real file once Pi reports it — the bridge never guesses paths.
 *
 * Event semantics follow the verified Pi docs: `message_end` is the
 * authoritative final message (deltas are display-only until then),
 * `agent_settled` closes the sending state, `closed` drops back to an
 * explicit-reopen state (user-initiated CANCELLED shows no scary banner).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi } from './api';
import { m1 } from './m1api';
import {
  activeState,
  activate,
  bindDraft,
  emptyStore,
  fileKey,
  getDraftText,
  patchKey,
  recordEvent,
  setDraftText,
  type SessionChatStore,
} from './sessionChat';
import { toUiError, type ChatUiState } from './chatState';
import type { ChatEventT } from './types';

/** UI26 R03: bounded re-check of delayed session materialization (read-only). */
const MATERIALIZE_POLLS = 60;
const MATERIALIZE_POLL_MS = 250;

// UI26 R01: public surface unchanged — old imports of `useChat` keep working.
export { applyChatEvent, initialChatState, toUiError } from './chatState';
export type { ChatEntry, ChatStatus, ChatTool, ChatUiState } from './chatState';

export interface ChatController {
  state: ChatUiState;
  /** Key of the conversation this controller currently shows. */
  key: string;
  /** Composer text of THIS conversation (per-session draft). */
  draftText: string;
  setDraftText: (text: string) => void;
  open: () => Promise<void>;
  send: (text: string) => Promise<{ ok: boolean }>;
  /** UI21 F1-B R02: явный повтор неподтверждённой отправки (без дублей). */
  resend: () => Promise<{ ok: boolean; skipped: boolean }>;
  interrupt: () => Promise<void>;
  closeChat: () => Promise<boolean>;
  /** Re-read Pi's catalog + thinking levels (explicit refresh or after open). */
  refreshModels: () => Promise<void>;
  /** Explicit user choice. No auto-switch, no fallback, no prompt side effect. */
  selectModel: (provider: string, modelId: string) => Promise<void>;
  selectThinkingLevel: (level: string) => Promise<void>;
}

export interface UseChatOptions {
  /**
   * Explicit conversation key (`file:<path>` или `draft:<id>`). Defaults to the
   * file key, so a single-session caller behaves exactly as before.
   */
  key?: string;
  /** Project cwd for a draft: the new Pi session is created inside it. */
  cwd?: string | null;
  /**
   * Called when Pi assigned a session file. `materialized` distinguishes
   * "Pi reserved a file (new_session, JSONL not written yet)" from
   * "the JSONL now exists (first write happened)".
   */
  onSessionCreated?: (file: string, info: { materialized: boolean }) => void;
}

export function useChat(api: DesktopApi | null, file: string, opts: UseChatOptions = {}): ChatController {
  const key = opts.key ?? fileKey(file);
  const isDraft = file === '' && typeof opts.cwd === 'string' && opts.cwd !== '';
  const [store, setStore] = useState<SessionChatStore>(() => activate(emptyStore(), key));
  const storeRef = useRef(store);
  storeRef.current = store;
  const mounted = useRef(true);
  const createdRef = useRef<((f: string, i: { materialized: boolean }) => void) | undefined>(opts.onSessionCreated);
  createdRef.current = opts.onSessionCreated;

  /**
   * UI26 R03 (P1-3): Pi may create the JSONL only AFTER the prompt ACK. The
   * bridge reports `materialized:false` then; we re-check the real file with a
   * bounded poll (read-only `getState.sessionFileExists`) and promote the draft
   * to a real session as soon as the file exists. The renderer never writes a
   * JSONL and never assumes existence.
   */
  const materializeWatch = useRef<Set<string>>(new Set());
  const watchMaterialized = useCallback(
    (target: string) => {
      if (!api || materializeWatch.current.has(target)) return;
      materializeWatch.current.add(target);
      void (async () => {
        const convKey = fileKey(target);
        try {
          for (let i = 0; i < MATERIALIZE_POLLS; i += 1) {
            await new Promise((r) => setTimeout(r, MATERIALIZE_POLL_MS));
            // UI26 R04 (P1): the poll belongs to ONE conversation and must stop
            // safely when that conversation is switched away, closed, failed or
            // disconnected — otherwise a later poll of another session could
            // "materialize" this draft with someone else's file.
            if (!mounted.current) return;
            const conv = storeRef.current.byKey[convKey];
            if (!conv || conv.status === 'closed' || conv.status === 'error') return;
            const st = await m1.getState(api).catch(() => null);
            if (!st?.sessionFileExists) continue;
            // Existence alone proves nothing: Pi must still be bound to THIS
            // file, and our conversation must still be alive after the await.
            if (st.state?.sessionFile !== target) return;
            const after = storeRef.current.byKey[convKey];
            if (!after || after.status === 'closed' || after.status === 'error') return;
            createdRef.current?.(target, { materialized: true });
            return;
          }
        } finally {
          materializeWatch.current.delete(target);
        }
      })();
    },
    [api],
  );

  // The active key may be a draft that got bound to a file after materialize:
  // in that case the caller's `key` follows it through onSessionCreated.
  const activeKeyRef = useRef(key);
  activeKeyRef.current = key;

  const state = activeState(store);
  const draftText = getDraftText(store, key);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Store updates are applied to a synchronous ref first and then published to
   * React. Without this, two awaited calls in the same tick (open → refresh)
   * would both observe the stale status and open the bridge twice.
   */
  const update = useCallback((fn: (s: SessionChatStore) => SessionChatStore) => {
    storeRef.current = fn(storeRef.current);
    setStore(storeRef.current);
  }, []);

  // Activate the requested conversation. Existing state is PRESERVED (#26):
  // switching back restores the other dialog's stream, tools and errors.
  useEffect(() => {
    update((s) => activate(s, key));
  }, [key, update]);

  useEffect(() => {
    if (!api) return;
    return api.onChatEvent((payload) => {
      if (!mounted.current) return;
      // Scoped routing: an event of another conversation is never rendered here.
      update((s) => recordEvent(s, payload as ChatEventT));
    });
  }, [api, update]);

  const patch = useCallback((next: (s: ChatUiState) => ChatUiState) => {
    update((s) => patchKey(s, activeKeyRef.current, next));
  }, [update]);

  /**
   * Open (or create) the bridge side of THIS conversation.
   *
   * Draft: `newSession` — the official Pi command. The returned file may not
   * exist yet (Pi 1.4.0 materializes lazily), which is exactly why the draft
   * costs nothing until the user really sends something.
   */
  const openFlightRef = useRef<Promise<boolean> | null>(null);

  const ensureOpen = useCallback(async (): Promise<boolean> => {
    if (!api) return false;
    // UI26 R03 (P1-1): single-flight. A second caller joins the in-flight open
    // instead of starting another `newSession` — the bridge slot allows exactly
    // one Pi process, and a duplicate renderer call must not race it.
    const inflight = openFlightRef.current;
    if (inflight) return inflight;
    const run = (async () => {
      const current = storeRef.current;
      const status = current.byKey[activeKeyRef.current]?.status ?? 'closed';
      if (status === 'open' || status === 'sending') return true;
      patch((s) => ({ ...s, status: 'opening', error: null, banner: null }));
      try {
        if (isDraft) {
          const r = await m1.newSession(api, String(opts.cwd));
          if (!mounted.current) return true;
          // The conversation key follows Pi's file: every further patch (and
          // every event stamped with `file:<path>`) must land on the SAME slot.
          const target = fileKey(r.sessionFile);
          update((s) => bindDraft(s, activeKeyRef.current, r.sessionFile));
          activeKeyRef.current = target;
          patch((s) => ({ ...s, status: 'open', state: r.state, error: null, banner: null }));
          createdRef.current?.(r.sessionFile, { materialized: r.materialized });
        } else {
          const r = await m1.openSession(api, file);
          if (!mounted.current) return true;
          patch((s) => ({ ...s, status: 'open', state: r.state, error: null, banner: null }));
        }
        return true;
      } catch (err) {
        if (!mounted.current) return false;
        patch((s) => ({ ...s, status: 'error', error: toUiError(err) }));
        return false;
      }
    })();
    openFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (openFlightRef.current === run) openFlightRef.current = null;
    }
  }, [api, file, isDraft, opts.cwd, patch, update]);

  const ensureOpenRef = useRef(ensureOpen);
  ensureOpenRef.current = ensureOpen;

  const open = useCallback(async () => {
    if (!api) return;
    if (!(await ensureOpenRef.current())) return;
    void refreshModelsRef.current();
  }, [api]);

  /**
   * UI21 F1-B R02 (P1, review): одно решение о восстановлении на ВСЕ пути
   * отправки. Совпадение текста — консервативная эвристика (доказуемого eventId
   * у промпта нет), поэтому она используется только чтобы НЕ отправить второй
   * раз уже принятое сообщение, и только для записей, появившихся после НАЧАЛА
   * отправки. Транскрипт она никогда не удаляет и exactly-once не гарантирует.
   */
  const deliveredSince = useCallback((pending: NonNullable<ChatUiState['pendingSend']>): boolean => {
    const text = pending.text.trim();
    const entries = storeRef.current.byKey[activeKeyRef.current]?.entries ?? [];
    return entries.slice(pending.entryCountBeforeSend).some((e) => e.kind === 'user' && e.text.trim() === text);
  }, []);

  const send = useCallback(
    async (text: string): Promise<{ ok: boolean }> => {
      if (!api || text.trim() === '') return { ok: false };
      // Обычный Send после неподтверждённой отправки не должен дублировать
      // уже принятое сообщение: сначала то же решение, что и у «Повторить».
      const unresolved = storeRef.current.byKey[activeKeyRef.current]?.pendingSend;
      if (unresolved && unresolved.text.trim() === text.trim() && deliveredSince(unresolved)) {
        patch((s) => ({
          ...s,
          pendingSend: null,
          error: null,
          banner: { code: 'DELIVERED', message: 'Pi уже принял это сообщение — повтор не отправлен' },
        }));
        return { ok: true };
      }
      // #26: черновик становится реальной сессией Pi ровно в момент первой
      // подтверждённой отправки — и только через официальный new_session.
      if (!(await ensureOpenRef.current())) return { ok: false };
      const entryCountBeforeSend = storeRef.current.byKey[activeKeyRef.current]?.entries.length ?? 0;
      patch((s) => ({ ...s, status: 'sending', error: null, pendingSend: null }));
      try {
        const r = await m1.sendPrompt(api, text);
        // The renderer binds its state to Pi's real file — no path guessing.
        if (r.sessionFile) {
          const target = fileKey(r.sessionFile);
          update((s) => bindDraft(s, activeKeyRef.current, r.sessionFile as string));
          activeKeyRef.current = target;
          createdRef.current?.(r.sessionFile, { materialized: r.materialized });
          if (!r.materialized) watchMaterialized(r.sessionFile);
        }
        // stays 'sending' until agent_settled arrives via events
        return { ok: true };
      } catch (err) {
        if (!mounted.current) return { ok: false };
        // Приём НЕ подтверждён: текст остаётся у пользователя (композер его не
        // очищает), автоповтора нет, причина показывается кодом bridge.
        patch((s) => ({
          ...s,
          status: 'open',
          error: toUiError(err),
          pendingSend: { text, at: Date.now(), entryCountBeforeSend },
        }));
        return { ok: false };
      }
    },
    [api, deliveredSince, patch, update, watchMaterialized],
  );

  /**
   * UI21 F1-B R02 (P1): явный повтор после неподтверждённой отправки.
   * Отправляет второй раз ТОЛЬКО если Pi не предъявил уже принятое сообщение;
   * иначе фиксирует факт доставки баннером и снимает ожидание (без дубля).
   */
  const resend = useCallback(async (): Promise<{ ok: boolean; skipped: boolean }> => {
    const pending = storeRef.current.byKey[activeKeyRef.current]?.pendingSend;
    if (!pending) return { ok: false, skipped: false };
    if (deliveredSince(pending)) {
      if (mounted.current) {
        patch((s) => ({
          ...s,
          pendingSend: null,
          error: null,
          banner: { code: 'DELIVERED', message: 'Pi уже принял это сообщение — повтор не отправлен' },
        }));
      }
      return { ok: true, skipped: true };
    }
    const r = await send(pending.text);
    return { ok: r.ok, skipped: false };
  }, [send, deliveredSince, patch]);

  const interrupt = useCallback(async () => {
    if (!api) return;
    try {
      await m1.interrupt(api);
    } catch (err) {
      if (!mounted.current) return;
      patch((s) => ({ ...s, error: toUiError(err) }));
    }
  }, [api, patch]);

  // UI21-F2: read-through model catalog + thinking levels from the live Pi RPC.
  const refreshModels = useCallback(async () => {
    if (!api) return;
    // #26: Pi can answer the catalog for a draft too — but only once the
    // official new_session exists. Model/thinking before the first prompt is a
    // supported flow, not a special case with baked-in defaults.
    if (!(await ensureOpenRef.current())) return;
    patch((s) => ({ ...s, modelsLoading: true }));
    // The two reads are independent: a thinking-levels failure must never
    // discard a valid model catalog, and vice versa.
    const [catalog, levels] = await Promise.allSettled([m1.getAvailableModels(api), m1.getThinkingLevels(api)]);
    if (!mounted.current) return;
    patch((s) => ({
      ...s,
      modelsLoading: false,
      ...(catalog.status === 'fulfilled'
        ? { models: catalog.value.models, modelsError: null }
        : { models: [], modelsError: toUiError(catalog.reason) }),
      ...(levels.status === 'fulfilled'
        ? { thinkingLevels: levels.value.levels, thinkingError: null }
        : { thinkingLevels: [], thinkingError: toUiError(levels.reason) }),
    }));
  }, [api, patch]);

  const refreshModelsRef = useRef(refreshModels);
  useEffect(() => {
    refreshModelsRef.current = refreshModels;
  }, [refreshModels]);

  const selectModel = useCallback(
    async (provider: string, modelId: string) => {
      if (!api) return;
      const status = storeRef.current.byKey[activeKeyRef.current]?.status;
      if (status === 'sending') return; // no silent mid-run switch
      if (!(await ensureOpenRef.current())) return;
      try {
        const r = await m1.setModel(api, provider, modelId);
        if (!mounted.current) return;
        patch((s) => ({ ...s, state: r.state ?? s.state, error: null }));
        // Thinking levels belong to the selected model — re-read them from Pi.
        void refreshModelsRef.current();
      } catch (err) {
        if (!mounted.current) return;
        patch((s) => ({ ...s, error: toUiError(err) }));
      }
    },
    [api, patch],
  );

  const selectThinkingLevel = useCallback(
    async (level: string) => {
      if (!api) return;
      const status = storeRef.current.byKey[activeKeyRef.current]?.status;
      if (status === 'sending') return;
      if (!(await ensureOpenRef.current())) return;
      try {
        const r = await m1.setThinkingLevel(api, level);
        if (!mounted.current) return;
        patch((s) => ({ ...s, state: r.state ?? s.state, error: null }));
      } catch (err) {
        if (!mounted.current) return;
        patch((s) => ({ ...s, error: toUiError(err) }));
      }
    },
    [api, patch],
  );

  const closeChat = useCallback(async (): Promise<boolean> => {
    if (!api) return false;
    try {
      await m1.closeSession(api);
    } catch (err) {
      if (!mounted.current) return false;
      patch((s) => ({ ...s, error: toUiError(err) }));
      // Review P1: a refused close is a FAILED close — the caller must not
      // treat it as success and switch away from a possibly live session.
      return false;
    }
    if (!mounted.current) return true;
    patch((s) => ({ ...s, status: 'closed', banner: null, error: null, streamText: '', tools: [] }));
    return true;
  }, [api, patch]);

  const setDraftTextForKey = useCallback(
    (text: string) => {
      update((s) => setDraftText(s, activeKeyRef.current, text));
    },
    [update],
  );

  return {
    state,
    key,
    draftText,
    setDraftText: setDraftTextForKey,
    open,
    send,
    resend,
    interrupt,
    closeChat,
    refreshModels,
    selectModel,
    selectThinkingLevel,
  };
}
