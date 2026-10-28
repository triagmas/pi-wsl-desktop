/**
 * Chat client state machine (M1): explicit write boundary, streamed text
 * reconstruction, tool lifecycle, error/recovery states.
 *
 * Event semantics follow the verified Pi docs: `message_end` is the
 * authoritative final message (deltas are display-only until then),
 * `agent_settled` closes the sending state, `closed` drops back to an
 * explicit-reopen state (user-initiated CANCELLED shows no scary banner).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi } from './api';
import { m1, parseBridgeError } from './m1api';
import { messageText } from './entryText';
import { redactSecrets } from '../shared/redact';
import type { ChatEventT, ModelInfoT, RpcStateT } from './types';

export type ChatStatus = 'closed' | 'opening' | 'open' | 'sending' | 'error';
export interface ChatEntry {
  key: string;
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'other';
  text: string;
  /**
   * UI21 R07 r02: доказуемое тождество события (id сообщения/записи), если Pi
   * его предоставил. Только по нему разрешена дедупликация — совпадение роли и
   * текста идентичностью не является.
   */
  eventId?: string;
  /** UI21-F1-C: set when stopReason==='error' — the bounded, redacted model
   *  error the pane must show instead of a blank assistant bubble. */
  error?: string;
}
export interface ChatTool {
  id: string;
  name: string;
  done: boolean;
  error: boolean;
}
export interface ChatUiState {
  status: ChatStatus;
  state: RpcStateT | null;
  entries: ChatEntry[];
  streamText: string;
  tools: ChatTool[];
  error: { code: string; message: string } | null;
  banner: { code: string; message: string } | null;
  /** UI21-F2: the catalog and the thinking levels are Pi's answer, never ours. */
  models: ModelInfoT[];
  thinkingLevels: string[];
  /** Catalog read failure (disconnected Pi, broken config) — chat stays usable. */
  modelsError: { code: string; message: string } | null;
  /** True while Pi's catalog/levels are being read (menu must not claim "empty"). */
  modelsLoading: boolean;
  /** Thinking-levels failure — INDEPENDENT of the catalog (it must not wipe it). */
  thinkingError: { code: string; message: string } | null;
}

export const initialChatState: ChatUiState = {
  status: 'closed',
  state: null,
  entries: [],
  streamText: '',
  tools: [],
  error: null,
  banner: null,
  models: [],
  thinkingLevels: [],
  modelsError: null,
  modelsLoading: false,
  thinkingError: null,
};

/**
 * UI21 R02: ONE safe error mapper for every error that can reach the DOM —
 * bridge/RPC failures, failed model runs, disconnect banners and catalog reads.
 * Plain text only (never Markdown/HTML), redacted and bounded by shared/redact.
 */
/**
 * UI21 R07 r01 (P1-A): единственная граница отображения ошибок.
 * Экспортируется, чтобы новые пути (чтение JSONL) не заводили вторую,
 * неотредактированную ветку — секрет из bridge/readSession не должен
 * попадать в DOM.
 */
export function toUiError(err: unknown): { code: string; message: string } {
  const parsed = parseBridgeError(err);
  return { code: parsed.code, message: redactSecrets(parsed.message) };
}

function entryFromMessage(
  message: {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    toolName?: unknown;
    stopReason?: unknown;
    errorMessage?: unknown;
  },
  index: number,
): ChatEntry {
  const role = message.role;
  const text = messageText(message.content);
  // Only a real id becomes an identity; absent/empty means "not provable".
  const eventId = typeof message.id === 'string' && message.id !== '' ? message.id : undefined;
  if (role === 'assistant') {
    // UI21-F1-C: a failed run must surface its real error — never a blank bubble.
    if (message.stopReason === 'error') {
      return { key: `e${index}`, kind: 'assistant', text, error: redactSecrets(message.errorMessage), ...(eventId ? { eventId } : {}) };
    }
    return { key: `e${index}`, kind: 'assistant', text, ...(eventId ? { eventId } : {}) };
  }
  if (role === 'user') return { key: `e${index}`, kind: 'user', text, ...(eventId ? { eventId } : {}) };
  if (role === 'system') return { key: `e${index}`, kind: 'system', text, ...(eventId ? { eventId } : {}) };
  if (role === 'toolResult') {
    const name = typeof message.toolName === 'string' ? message.toolName : 'tool';
    return { key: `e${index}`, kind: 'tool', text: `${name}: ${text}`, ...(eventId ? { eventId } : {}) };
  }
  return { key: `e${index}`, kind: 'other', text, ...(eventId ? { eventId } : {}) };
}

export function applyChatEvent(state: ChatUiState, ev: ChatEventT): ChatUiState {
  if (ev.kind === 'opened') {
    return { ...state, status: 'open', state: ev.state, error: null, banner: null };
  }
  if (ev.kind === 'closed') {
    const banner = ev.code === 'CANCELLED' ? null : { code: ev.code, message: redactSecrets(ev.message) };
    // UI21-F1-A P1: the live tool strip belongs to a running RPC — on close/
    // disconnect it must go with streamText, otherwise a reopened (resumed)
    // chat renders a phantom live run (stale ⏳ step from the dead process).
    return { ...state, status: 'closed', banner, error: null, streamText: '', tools: [] };
  }
  const data = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.name) {
    case 'message_end': {
      const msg = data.message as
        | { role?: unknown; content?: unknown; toolName?: unknown; stopReason?: unknown; errorMessage?: unknown }
        | undefined;
      if (!msg) return state;
      const entry = entryFromMessage(msg, state.entries.length);
      if (entry.text === '' && entry.kind === 'other') return state;
      return { ...state, entries: [...state.entries, entry], streamText: '' };
    }
    case 'message_update': {
      const evt = data.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
      if (evt?.type === 'text_delta' && typeof evt.delta === 'string') {
        return { ...state, streamText: state.streamText + evt.delta };
      }
      return state;
    }
    case 'tool_execution_start': {
      const id = typeof data.toolCallId === 'string' ? data.toolCallId : `t${state.tools.length}`;
      const name = typeof data.toolName === 'string' ? data.toolName : 'tool';
      return { ...state, tools: [...state.tools.filter((t) => t.id !== id), { id, name, done: false, error: false }] };
    }
    case 'tool_execution_end': {
      const id = typeof data.toolCallId === 'string' ? data.toolCallId : '';
      return {
        ...state,
        tools: state.tools.map((t) => (t.id === id ? { ...t, done: true, error: data.isError === true } : t)),
      };
    }
    case 'agent_settled':
      // Keep streamText: an aborted run never gets message_end, and losing the
      // partial output would be dishonest UX (message_end clears it normally).
      return state.status === 'sending' ? { ...state, status: 'open' } : state;
    default:
      return state;
  }
}

export interface ChatController {
  state: ChatUiState;
  open: () => Promise<void>;
  send: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  closeChat: () => Promise<boolean>;
  /** Re-read Pi's catalog + thinking levels (explicit refresh or after open). */
  refreshModels: () => Promise<void>;
  /** Explicit user choice. No auto-switch, no fallback, no prompt side effect. */
  selectModel: (provider: string, modelId: string) => Promise<void>;
  selectThinkingLevel: (level: string) => Promise<void>;
}

export function useChat(api: DesktopApi | null, file: string): ChatController {
  const [state, setState] = useState<ChatUiState>(initialChatState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    return api.onChatEvent((payload) => {
      if (!mounted.current) return;
      setState((s) => applyChatEvent(s, payload as ChatEventT));
    });
  }, [api]);

  // Switching the active session resets the visible chat state — a draft or
  // stream from another file must never leak into this one (§9.1 item 4).
  useEffect(() => {
    setState(initialChatState);
  }, [file]);

  const open = useCallback(async () => {
    if (!api) return;
    setState((s) => ({ ...s, status: 'opening', error: null, banner: null }));
    try {
      const r = await m1.openSession(api, file);
      if (!mounted.current) return;
      setState((s) => ({ ...s, status: 'open', state: r.state, error: null, banner: null }));
      // UI21-F2: the catalog/levels are Pi's answer for THIS session; a failing
      // read must not break the chat, so it is reported separately below.
      void refreshModelsRef.current();
    } catch (err) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, status: 'error', error: toUiError(err) }));
    }
  }, [api, file]);

  const send = useCallback(
    async (text: string) => {
      if (!api || text.trim() === '') return;
      setState((s) => ({ ...s, status: 'sending', error: null }));
      try {
        await m1.sendPrompt(api, text);
        // stays 'sending' until agent_settled arrives via events
      } catch (err) {
        if (!mounted.current) return;
        setState((s) => ({ ...s, status: 'open', error: toUiError(err) }));
      }
    },
    [api],
  );

  const interrupt = useCallback(async () => {
    if (!api) return;
    try {
      await m1.interrupt(api);
    } catch (err) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, error: toUiError(err) }));
    }
  }, [api]);

  // UI21-F2: read-through model catalog + thinking levels from the live Pi RPC.
  const refreshModels = useCallback(async () => {
    if (!api) return;
    setState((s) => ({ ...s, modelsLoading: true }));
    // The two reads are independent: a thinking-levels failure must never
    // discard a valid model catalog, and vice versa.
    const [catalog, levels] = await Promise.allSettled([m1.getAvailableModels(api), m1.getThinkingLevels(api)]);
    if (!mounted.current) return;
    setState((s) => ({
      ...s,
      modelsLoading: false,
      ...(catalog.status === 'fulfilled'
        ? { models: catalog.value.models, modelsError: null }
        : { models: [], modelsError: toUiError(catalog.reason) }),
      ...(levels.status === 'fulfilled'
        ? { thinkingLevels: levels.value.levels, thinkingError: null }
        : { thinkingLevels: [], thinkingError: toUiError(levels.reason) }),
    }));
  }, [api]);

  const refreshModelsRef = useRef(refreshModels);
  useEffect(() => {
    refreshModelsRef.current = refreshModels;
  }, [refreshModels]);

  const selectModel = useCallback(
    async (provider: string, modelId: string) => {
      if (!api) return;
      if (stateRef.current.status === 'sending') return; // no silent mid-run switch
      try {
        const r = await m1.setModel(api, provider, modelId);
        if (!mounted.current) return;
        setState((s) => ({ ...s, state: r.state ?? s.state, error: null }));
        // Thinking levels belong to the selected model — re-read them from Pi.
        void refreshModelsRef.current();
      } catch (err) {
        if (!mounted.current) return;
        setState((s) => ({ ...s, error: toUiError(err) }));
      }
    },
    [api],
  );

  const selectThinkingLevel = useCallback(
    async (level: string) => {
      if (!api) return;
      if (stateRef.current.status === 'sending') return;
      try {
        const r = await m1.setThinkingLevel(api, level);
        if (!mounted.current) return;
        setState((s) => ({ ...s, state: r.state ?? s.state, error: null }));
      } catch (err) {
        if (!mounted.current) return;
        setState((s) => ({ ...s, error: toUiError(err) }));
      }
    },
    [api],
  );

  const closeChat = useCallback(async (): Promise<boolean> => {
    if (!api) return false;
    try {
      await m1.closeSession(api);
    } catch (err) {
      if (!mounted.current) return false;
      setState((s) => ({ ...s, error: toUiError(err) }));
      // Review P1: a refused close is a FAILED close — the caller must not
      // treat it as success and switch away from a possibly live session.
      return false;
    }
    if (!mounted.current) return true;
    setState((s) => ({ ...s, status: 'closed', banner: null, error: null, streamText: '', tools: [] }));
    return true;
  }, [api]);

  return { state, open, send, interrupt, closeChat, refreshModels, selectModel, selectThinkingLevel };
}
