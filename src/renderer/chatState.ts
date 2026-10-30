/**
 * Chat UI state + event reducer (pure, no React).
 *
 * UI26 R01: extracted from useChat so per-session state can live in a keyed
 * store (`sessionChat.ts`) without a circular import. `useChat.ts` re-exports
 * these symbols, so existing imports keep working unchanged.
 *
 * Event semantics follow the verified Pi docs: `message_end` is the
 * authoritative final message (deltas are display-only until then),
 * `agent_settled` closes the sending state, `closed` drops back to an
 * explicit-reopen state (user-initiated CANCELLED shows no scary banner).
 */
import { messageText } from './entryText';
import { parseBridgeError } from './bridgeError';
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
  /**
   * UI21 F1-B R02 (P1): отправка, судьба которой НЕ подтверждена (тайм-аут ACK).
   * Текст хранится здесь, чтобы его нельзя было потерять, и чтобы явный повтор
   * не отправил второе сообщение, если Pi уже принял первое.
   */
  pendingSend: {
    text: string;
    at: number;
    /**
     * Сколько записей было в ленте ПЕРЕД отправкой. Доказательством доставки
     * считается пользовательская запись с тем же текстом, появившаяся после
     * этой отметки: так исключается более раннее такое же сообщение, но
     * засчитывается доставка, пришедшая ещё до тайм-аута ACK.
     */
    entryCountBeforeSend: number;
  } | null;
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
  pendingSend: null,
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
