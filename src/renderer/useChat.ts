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
import type { ChatEventT, RpcStateT } from './types';

export type ChatStatus = 'closed' | 'opening' | 'open' | 'sending' | 'error';
export interface ChatEntry {
  key: string;
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'other';
  text: string;
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
}

export const initialChatState: ChatUiState = {
  status: 'closed',
  state: null,
  entries: [],
  streamText: '',
  tools: [],
  error: null,
  banner: null,
};

function entryFromMessage(message: { role?: unknown; content?: unknown; toolName?: unknown }, index: number): ChatEntry {
  const role = message.role;
  const text = messageText(message.content);
  if (role === 'assistant') return { key: `e${index}`, kind: 'assistant', text };
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
    return { ...state, status: 'closed', banner, error: null, streamText: '' };
  }
  const data = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.name) {
    case 'message_end': {
      const msg = data.message as { role?: unknown; content?: unknown; toolName?: unknown } | undefined;
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
  closeChat: () => Promise<void>;
}

export function useChat(api: DesktopApi | null, file: string): ChatController {
  const [state, setState] = useState<ChatUiState>(initialChatState);
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

  const closeChat = useCallback(async () => {
    if (!api) return;
    try {
      await m1.closeSession(api);
    } catch (err) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, error: parseBridgeError(err) }));
      return;
    }
    if (!mounted.current) return;
    setState((s) => ({ ...s, status: 'closed', banner: null, error: null, streamText: '' }));
  }, [api]);

  return { state, open, send, interrupt, closeChat };
}
