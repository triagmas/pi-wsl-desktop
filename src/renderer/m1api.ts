/** Typed facade for the M1 bridge surface (SPEC §4.1). */
import type { DesktopApi } from './api';
import type { ChatEventT, ModelInfoT, ProjectInfoT, ReadSessionResultT, RpcStateT, SearchResultT, SessionInfoT } from './types';

const call = <T>(api: DesktopApi, method: string, params?: Record<string, unknown>): Promise<T> =>
  api.request(method, params) as Promise<T>;

export const m1 = {
  subscribeEvents: (api: DesktopApi): Promise<{ subscribed: boolean }> => call(api, 'subscribeEvents', { topic: 'chat' }),
  listProjects: (api: DesktopApi): Promise<{ projects: ProjectInfoT[]; diagnostics: string[] }> => call(api, 'listProjects'),
  listSessions: (api: DesktopApi, projectId?: string): Promise<{ sessions: SessionInfoT[]; diagnostics: string[] }> =>
    call(api, 'listSessions', projectId === undefined ? {} : { projectId }),
  readSession: (
    api: DesktopApi,
    params: {
      file: string;
      sinceEntryId?: string;
      /** UI21 F1-B R03: обратная пагинация (последние записи первыми). */
      beforeEntryId?: string;
      direction?: 'forward' | 'backward';
      limit?: number;
    },
  ): Promise<ReadSessionResultT> => call(api, 'readSession', params),
  openSession: (api: DesktopApi, file: string): Promise<{ state: RpcStateT | null }> => call(api, 'openSession', { file }),
  sendPrompt: (api: DesktopApi, message: string): Promise<{ disposition: string }> => call(api, 'sendPrompt', { message }),
  interrupt: (api: DesktopApi): Promise<{ interrupted: boolean }> => call(api, 'interrupt'),
  getState: (api: DesktopApi): Promise<{ state: RpcStateT | null }> => call(api, 'getState'),
  closeSession: (api: DesktopApi): Promise<{ closed: boolean }> => call(api, 'closeSession'),
  // UI21-F2: read-through to the installed Pi; no catalogue or defaults here.
  getAvailableModels: (api: DesktopApi): Promise<{ models: ModelInfoT[] }> => call(api, 'getAvailableModels'),
  setModel: (api: DesktopApi, provider: string, modelId: string): Promise<{ state: RpcStateT | null }> =>
    call(api, 'setModel', { provider, modelId }),
  getThinkingLevels: (api: DesktopApi): Promise<{ levels: string[]; current: string | null }> =>
    call(api, 'getThinkingLevels'),
  setThinkingLevel: (api: DesktopApi, level: string): Promise<{ state: RpcStateT | null }> =>
    call(api, 'setThinkingLevel', { level }),
  search: (api: DesktopApi, query: string, includeContent?: boolean): Promise<SearchResultT> =>
    call(api, 'searchSessions', { query, ...(includeContent ? { includeContent: true } : {}) }),
};

/**
 * UI21 F1-B R02 (P1): Electron оборачивает ошибку IPC-обработчика в
 * `Error invoking remote method '<channel>': Error: …`, поэтому стабильный код
 * из main (`{CODE}: message`) оказывался НЕ в начале строки и терялся —
 * пользователь видел «UNKNOWN» вместо `BRIDGE_TIMEOUT`. Обёртку снимаем
 * послойно (Electron может обернуть повторно), не трогая остальной текст.
 */
const IPC_WRAPPER = /^(?:Error invoking remote method '[^']*':\s*)?(?:Error:\s*)?/;

function stripIpcWrapper(raw: string): string {
  let text = raw.trim();
  for (let i = 0; i < 4; i += 1) {
    const m = IPC_WRAPPER.exec(text);
    if (!m || m[0].length === 0) break;
    text = text.slice(m[0].length).trim();
  }
  return text;
}

/** Parse an IPC-rethrown error `{CODE}: message` into a structured value. */
export function parseBridgeError(err: unknown): { code: string; message: string } {
  // Production path: ipc.ts prefixes `{CODE}: message` (Error props do not
  // survive Electron serialization). Structured callers may attach `.code`.
  const raw = err instanceof Error ? err.message : String(err);
  const text = stripIpcWrapper(raw);
  const attached = (err as { code?: unknown } | null)?.code;
  if (typeof attached === 'string' && attached.length > 0) {
    // Текст мог быть помечен ДРУГИМ кодом (например `UNKNOWN:` из bridge) —
    // структурный `.code` всё равно главнее, но его префикс в тексте лишний.
    const stripped = text.replace(new RegExp(`^([A-Z][A-Z0-9_]{2,}):\\s*`), '');
    return { code: attached, message: stripped || text };
  }
  const m = /^([A-Z][A-Z0-9_]{2,}):(?:\s|$)/.exec(text);
  if (m) return { code: m[1], message: text.slice(m[0].length) || text };
  return { code: 'UNKNOWN', message: text };
}

export type { ChatEventT };
