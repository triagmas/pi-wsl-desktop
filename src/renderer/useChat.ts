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
import type { ChatEventT, ModelInfoT, RpcStateT } from './types';

export type ChatStatus = 'closed' | 'opening' | 'open' | 'sending' | 'error';
export interface ChatEntry {
  key: string;
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'other';
  text: string;
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
};

/**
 * UI21-F1-C review fix: redaction is a *conservative best-effort* filter over
 * the message before it reaches the DOM — not a guarantee that every arbitrary
 * secret format is caught. It covers the formats we can name precisely
 * (provider key prefixes with their real separators, HTTP auth schemes,
 * `key: value` credentials) and then removes long high-entropy identifiers we
 * do not recognise, so an unknown token shape still cannot pass through raw.
 */
const MODEL_ERROR_FALLBACK = 'Генерация завершилась с ошибкой';
const MODEL_ERROR_MAX = 300;
/** Ordered [pattern, replacement] matrix; order matters (scheme before value). */
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // Provider key shapes. GitHub token prefixes use an underscore, not a hyphen.
  [/\b(?:sk|pk|rk)-[A-Za-z0-9._-]{6,}/g, '[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{6,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{6,}/g, '[redacted]'],
  [/\bglpat-[A-Za-z0-9_-]{6,}/g, '[redacted]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{6,}/g, '[redacted]'],
  // HTTP auth schemes: drop the credential, not just the scheme word.
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [redacted]'],
  // Header-style credentials: drop the scheme + credential value, but stop at the
  // next whitespace-delimited token so unrelated trailing text is preserved.
  [/\b(authorization|proxy-authorization)\s*[:=]\s*[^\s,;}]+(?:\s+[^\s,;}]+)?/gi, 'authorization: [redacted]'],
  [/\b(api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd)\s*[:=]\s*[^\s,;}]+/gi, '$1: [redacted]'],
  // Conservative catch-all: long identifiers mixing letters and digits are
  // treated as credentials — an unrecognised token shape must not leak.
  [/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '[redacted]'],
];
/** Best-effort path shapes; not a claim to catch every possible file path. */
const PATH_PATTERN = /(?:[A-Za-z]:[\\/][^\s"'`]+)|(?:\/(?:home|mnt|Users|root|var|etc|tmp|opt|srv|usr|proc|sys|dev|private|Applications)\/[^\s"'`]*)/g;

function sanitizeModelError(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return MODEL_ERROR_FALLBACK;
  let text = raw
    // eslint-disable-next-line no-control-regex -- stripping C0/C1 control chars is the point
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  text = text.replace(PATH_PATTERN, '[path]').trim();
  if (text.length > MODEL_ERROR_MAX) text = `${text.slice(0, MODEL_ERROR_MAX)}…`;
  return text === '' ? MODEL_ERROR_FALLBACK : text;
}

function entryFromMessage(
  message: { role?: unknown; content?: unknown; toolName?: unknown; stopReason?: unknown; errorMessage?: unknown },
  index: number,
): ChatEntry {
  const role = message.role;
  const text = messageText(message.content);
  if (role === 'assistant') {
    // UI21-F1-C: a failed run must surface its real error — never a blank bubble.
    if (message.stopReason === 'error') {
      return { key: `e${index}`, kind: 'assistant', text, error: sanitizeModelError(message.errorMessage) };
    }
    return { key: `e${index}`, kind: 'assistant', text };
  }
  if (role === 'user') return { key: `e${index}`, kind: 'user', text };
  if (role === 'system') return { key: `e${index}`, kind: 'system', text };
  if (role === 'toolResult') {
    const name = typeof message.toolName === 'string' ? message.toolName : 'tool';
    return { key: `e${index}`, kind: 'tool', text: `${name}: ${text}` };
  }
  return { key: `e${index}`, kind: 'other', text };
}

export function applyChatEvent(state: ChatUiState, ev: ChatEventT): ChatUiState {
  if (ev.kind === 'opened') {
    return { ...state, status: 'open', state: ev.state, error: null, banner: null };
  }
  if (ev.kind === 'closed') {
    const banner = ev.code === 'CANCELLED' ? null : { code: ev.code, message: ev.message };
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
      setState((s) => ({ ...s, status: 'error', error: parseBridgeError(err) }));
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
        setState((s) => ({ ...s, status: 'open', error: parseBridgeError(err) }));
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
      setState((s) => ({ ...s, error: parseBridgeError(err) }));
    }
  }, [api]);

  // UI21-F2: read-through model catalog + thinking levels from the live Pi RPC.
  const refreshModels = useCallback(async () => {
    if (!api) return;
    setState((s) => ({ ...s, modelsLoading: true }));
    try {
      const [catalog, levels] = await Promise.all([m1.getAvailableModels(api), m1.getThinkingLevels(api)]);
      if (!mounted.current) return;
      setState((s) => ({ ...s, models: catalog.models, thinkingLevels: levels.levels, modelsError: null, modelsLoading: false }));
    } catch (err) {
      if (!mounted.current) return;
      // An unreadable catalog is an honest empty state, not an invented list.
      setState((s) => ({ ...s, models: [], thinkingLevels: [], modelsError: parseBridgeError(err), modelsLoading: false }));
    }
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
        setState((s) => ({ ...s, error: parseBridgeError(err) }));
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
        setState((s) => ({ ...s, error: parseBridgeError(err) }));
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
      setState((s) => ({ ...s, error: parseBridgeError(err) }));
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
