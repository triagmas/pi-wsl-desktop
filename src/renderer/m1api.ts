/** Typed facade for the M1 bridge surface (SPEC §4.1). */
import type { DesktopApi } from './api';
import type { ChatEventT, ProjectInfoT, ReadSessionResultT, RpcStateT, SearchResultT, SessionInfoT } from './types';

const call = <T>(api: DesktopApi, method: string, params?: Record<string, unknown>): Promise<T> =>
  api.request(method, params) as Promise<T>;

export const m1 = {
  subscribeEvents: (api: DesktopApi): Promise<{ subscribed: boolean }> => call(api, 'subscribeEvents', { topic: 'chat' }),
  listProjects: (api: DesktopApi): Promise<{ projects: ProjectInfoT[]; diagnostics: string[] }> => call(api, 'listProjects'),
  listSessions: (api: DesktopApi, projectId?: string): Promise<{ sessions: SessionInfoT[]; diagnostics: string[] }> =>
    call(api, 'listSessions', projectId === undefined ? {} : { projectId }),
  readSession: (
    api: DesktopApi,
    params: { file: string; sinceEntryId?: string; limit?: number },
  ): Promise<ReadSessionResultT> => call(api, 'readSession', params),
  openSession: (api: DesktopApi, file: string): Promise<{ state: RpcStateT | null }> => call(api, 'openSession', { file }),
  /** R03 п.2: REAL new session over Pi's RPC — returns the live state plus
   * the provisional SessionInfo record (real until the first message
   * materializes the file in the session index). */
  newSession: (
    api: DesktopApi,
    params: { projectPath?: string } = {},
  ): Promise<{ state: RpcStateT; session: SessionInfoT }> => call(api, 'newSession', params),
  sendPrompt: (api: DesktopApi, message: string): Promise<{ disposition: string }> => call(api, 'sendPrompt', { message }),
  interrupt: (api: DesktopApi): Promise<{ interrupted: boolean }> => call(api, 'interrupt'),
  getState: (api: DesktopApi): Promise<{ state: RpcStateT | null }> => call(api, 'getState'),
  closeSession: (api: DesktopApi): Promise<{ closed: boolean }> => call(api, 'closeSession'),
  search: (api: DesktopApi, query: string, includeContent?: boolean): Promise<SearchResultT> =>
    call(api, 'searchSessions', { query, ...(includeContent ? { includeContent: true } : {}) }),
};

/** Parse an IPC-rethrown error `{CODE}: message` into a structured value. */
export function parseBridgeError(err: unknown): { code: string; message: string } {
  // Production path: ipc.ts prefixes `{CODE}: message` (Error props do not
  // survive Electron serialization). Structured callers may attach `.code`.
  const attached = (err as { code?: unknown } | null)?.code;
  if (typeof attached === 'string' && attached.length > 0) {
    const raw = err instanceof Error ? err.message : String(err);
    return { code: attached, message: raw.replace(new RegExp(`^${attached}:\\s*`), '') };
  }
  const raw = err instanceof Error ? err.message : String(err);
  const m = /^([A-Z][A-Z0-9_]{2,}):(?:\s|$)/.exec(raw);
  if (m) return { code: m[1], message: raw.slice(m[0].length) || raw };
  return { code: 'UNKNOWN', message: raw };
}

export type { ChatEventT };
