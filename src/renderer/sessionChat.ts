/**
 * UI26 R01 — keyed per-conversation renderer state (#26).
 *
 * Why this exists: a single "active chat" slot is not enough once the UI can
 * hold a draft next to real sessions. Streaming, tools, errors and drafts must
 * belong to one conversation, and a late event of chat A must never be
 * rendered inside chat B.
 *
 * Keys:
 *  - `file:<sessionFile>` — a real Pi session (the file may not exist yet
 *    right after `new_session`; Pi materializes it on the first write);
 *  - `draft:<id>` — an explicit draft that has no Pi session and no file.
 *
 * Everything here is pure: no React, no IPC, no filesystem.
 */
import { applyChatEvent, initialChatState, type ChatUiState } from './chatState';
import type { ChatEventT } from './types';

export type SessionKey = string;

const FILE_PREFIX = 'file:';
const DRAFT_PREFIX = 'draft:';

export const fileKey = (file: string): SessionKey => `${FILE_PREFIX}${file}`;
export const draftKey = (id: string): SessionKey => `${DRAFT_PREFIX}${id}`;
export const isDraftKey = (key: SessionKey): boolean => key.startsWith(DRAFT_PREFIX);
export const fileOfKey = (key: SessionKey): string | null => (key.startsWith(FILE_PREFIX) ? key.slice(FILE_PREFIX.length) : null);

export interface DraftMeta {
  /** Explicit `cwd` the new Pi session will be created in. */
  cwd: string;
  createdAt: number;
}

export interface SessionChatStore {
  activeKey: SessionKey | null;
  byKey: Record<SessionKey, ChatUiState>;
  drafts: Record<SessionKey, DraftMeta>;
  /** Composer text per conversation — never a single global draft. */
  draftText: Record<SessionKey, string>;
  /** Events for an unknown, non-active session: counted, never rendered. */
  dropped: number;
}

export function emptyStore(): SessionChatStore {
  return { activeKey: null, byKey: {}, drafts: {}, draftText: {}, dropped: 0 };
}

export function stateOf(store: SessionChatStore, key: SessionKey): ChatUiState {
  return store.byKey[key] ?? initialChatState;
}

export function activeState(store: SessionChatStore): ChatUiState {
  return store.activeKey ? stateOf(store, store.activeKey) : initialChatState;
}

/** Make `key` visible, seeding an empty state the first time. */
export function activate(store: SessionChatStore, key: SessionKey): SessionChatStore {
  return {
    ...store,
    activeKey: key,
    byKey: store.byKey[key] ? store.byKey : { ...store.byKey, [key]: initialChatState },
  };
}

/** Apply a state patch to ONE conversation (active or not). */
export function patchKey(
  store: SessionChatStore,
  key: SessionKey,
  patch: Partial<ChatUiState> | ((state: ChatUiState) => ChatUiState),
): SessionChatStore {
  const next = typeof patch === 'function' ? patch(stateOf(store, key)) : { ...stateOf(store, key), ...patch };
  return { ...store, byKey: { ...store.byKey, [key]: next } };
}

/**
 * Route one bridge event.
 *  - with `key`: applied to that conversation only (creating it when it is the
 *    active one — a session can stream before the renderer seeded it);
 *  - without `key`: ownership is NOT proven, so the event is applied only in the
 *    single unambiguous case — exactly one conversation holds the RPC slot
 *    (`opening`/`open`/`sending`). Zero live or two live conversations means
 *    "cannot know", and a late delta must never land in a dialog that merely
 *    happens to be visible (UI26 R02).
 * A non-active unknown key is dropped and counted: buffering unbounded foreign
 * conversations would leak memory and could still be mis-rendered later.
 */
export function recordEvent(store: SessionChatStore, ev: ChatEventT): SessionChatStore {
  const key = (ev as { key?: string }).key;
  if (!key) {
    // UI26 R03 (P1-2): "one live conversation" is NOT proof of provenance — a
    // late event of a just-closed chat would be filed into the single survivor.
    // The bridge stamps every event with the RPC connection it came from, so an
    // event without a key is unattributable and is dropped (and counted).
    return { ...store, dropped: store.dropped + 1 };
  }
  if (store.byKey[key]) return patchKey(store, key, (s) => applyChatEvent(s, ev));
  if (key === store.activeKey) return patchKey(store, key, (s) => applyChatEvent(s, ev));
  return { ...store, dropped: store.dropped + 1 };
}

export function createDraft(store: SessionChatStore, input: { id: string; cwd: string; now: number }): SessionChatStore {
  const key = draftKey(input.id);
  const next: SessionChatStore = {
    ...store,
    activeKey: key,
    byKey: { ...store.byKey, [key]: initialChatState },
    drafts: { ...store.drafts, [key]: { cwd: input.cwd, createdAt: input.now } },
    draftText: { ...store.draftText, [key]: '' },
  };
  return next;
}

export function setDraftText(store: SessionChatStore, key: SessionKey, text: string): SessionChatStore {
  if (store.draftText[key] === text) return store;
  return { ...store, draftText: { ...store.draftText, [key]: text } };
}

export function getDraftText(store: SessionChatStore, key: SessionKey): string {
  return store.draftText[key] ?? '';
}

/**
 * Draft → real session after Pi assigned a session file. The state (entries,
 * stream, tools, model) and the composer text follow the conversation, so the
 * user never sees their own message disappear when the file materializes.
 */
export function bindDraft(store: SessionChatStore, draft: SessionKey, file: string): SessionChatStore {
  const target = fileKey(file);
  if (draft === target) return store;
  const byKey = { ...store.byKey };
  const carried = byKey[draft];
  delete byKey[draft];
  if (carried) byKey[target] = carried;
  const draftText = { ...store.draftText };
  const carriedText = draftText[draft];
  delete draftText[draft];
  if (carriedText !== undefined) draftText[target] = carriedText;
  const drafts = { ...store.drafts };
  delete drafts[draft];
  return {
    ...store,
    byKey,
    draftText,
    drafts,
    activeKey: store.activeKey === draft ? target : store.activeKey,
  };
}

/** Explicit "cancel draft": no file, no Pi session, nothing left behind. */
export function dropDraft(store: SessionChatStore, key: SessionKey): SessionChatStore {
  const byKey = { ...store.byKey };
  delete byKey[key];
  const draftText = { ...store.draftText };
  delete draftText[key];
  const drafts = { ...store.drafts };
  delete drafts[key];
  return {
    ...store,
    byKey,
    draftText,
    drafts,
    activeKey: store.activeKey === key ? null : store.activeKey,
  };
}

/**
 * Conversations that hold the single bridge slot: an RPC is opening, open, or
 * generating. The bridge is one-client (#26), so while any of these exist a
 * switch must not be silent — it is either blocked or explicitly confirmed.
 */
export function busyKeys(store: SessionChatStore): SessionKey[] {
  return Object.entries(store.byKey)
    .filter(([, s]) => s.status === 'opening' || s.status === 'open' || s.status === 'sending')
    .map(([k]) => k);
}

export function isAnySending(store: SessionChatStore): boolean {
  return busyKeys(store).length > 0;
}

/**
 * Restore only a reliable key: a real session file present in Pi's own list.
 * A draft is never restored (its JSONL does not exist), and a vanished file
 * leads to an empty state instead of a recreated session.
 */
export function restorableKey(saved: string | null | undefined, sessions: Array<{ file: string }>): SessionKey | null {
  if (!saved) return null;
  if (isDraftKey(saved)) return null;
  const file = fileOfKey(saved);
  if (!file) return null;
  return sessions.some((s) => s.file === file) ? saved : null;
}

/** Title for a draft: first user message of this conversation, else a label. */
export function draftTitle(store: SessionChatStore, key: SessionKey, fallback = 'Новый диалог'): string {
  const first = stateOf(store, key).entries.find((e) => e.kind === 'user' && e.text.trim() !== '');
  return first ? first.text : fallback;
}
