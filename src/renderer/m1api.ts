/** Typed facade for the M1 bridge surface (SPEC §4.1). */
import type { DesktopApi } from './api';
import type { ChatEventT, ModelInfoT, ProjectInfoT, ReadSessionResultT, RpcStateT, SearchResultT, SessionInfoT } from './types';
export { parseBridgeError } from './bridgeError';

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
  /** UI26 R01: официальный новый диалог (Pi `new_session`), JSONL — на первой записи. */
  newSession: (api: DesktopApi, cwd: string): Promise<{ state: RpcStateT; sessionFile: string; materialized: boolean }> =>
    call(api, 'newSession', { cwd }),
  sendPrompt: (
    api: DesktopApi,
    message: string,
  ): Promise<{ disposition: string; sessionFile: string | null; sessionId: string | null; materialized: boolean }> =>
    call(api, 'sendPrompt', { message }),
  interrupt: (api: DesktopApi): Promise<{ interrupted: boolean }> => call(api, 'interrupt'),
  getState: (api: DesktopApi): Promise<{ state: RpcStateT | null; sessionFileExists?: boolean }> => call(api, 'getState'),
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
export type { ChatEventT };
