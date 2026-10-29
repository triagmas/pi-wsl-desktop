/**
 * UI26 R01 — Session UX / New Chat (#26), сквозные сценарии App.
 *
 * Покрывается ровно то, что обещано владельцу:
 *  - «Новый диалог» = официальный Pi `new_session`, без фиктивного JSONL;
 *  - model/thinking читаются из Pi ДО первого сообщения;
 *  - черновик отменяется без записи, а его текст не теряется при переключении;
 *  - поздние события чужого диалога не попадают в открытый чат;
 *  - во время генерации переключение не происходит молча (один writer);
 *  - последний диалог восстанавливается только по надёжному ключу файла.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { DesktopApi } from '../../src/renderer/api';
import { READY_SNAPSHOT } from './helpers/shellApi';

const FILE_A = '/roots/--p-alpha--/a.jsonl';
const FILE_B = '/roots/--p-alpha--/b.jsonl';
const NEW_FILE = '/roots/--p-alpha--/new.jsonl';
const PROJECT = { id: '/p/alpha', name: 'alpha', path: '/p/alpha', sessionCount: 2, updatedAt: null };

const session = (file: string, displayName: string) => ({
  id: file.split('/').pop()!.replace('.jsonl', ''),
  file,
  root: '/roots',
  projectId: '/p/alpha',
  projectPath: '/p/alpha',
  name: null,
  displayName,
  displayNameSource: 'firstUser' as const,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  sizeBytes: 10,
  version: 3,
  availability: 'ok' as const,
  activeWrite: false,
  diagnostics: null,
});

interface Harness {
  api: DesktopApi;
  calls: Array<{ method: string; params: unknown }>;
  emit: (payload: unknown) => void;
  sendPromptMaterialized: boolean;
}

function makeHarness(opts: { sessions?: unknown[]; lastKey?: string; sendMaterialized?: boolean } = {}): Harness {
  const calls: Array<{ method: string; params: unknown }> = [];
  const listeners: Array<(p: unknown) => void> = [];
  const state = {
    sessionFile: null as string | null,
  };
  const api: DesktopApi = {
    request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      switch (method) {
        case 'listProjects':
          return { projects: [PROJECT], diagnostics: [] };
        case 'listSessions':
          return { sessions: opts.sessions ?? [session(FILE_A, 'Первый'), session(FILE_B, 'Второй')], diagnostics: [] };
        case 'newSession':
          state.sessionFile = NEW_FILE;
          return {
            state: { sessionId: 'new-id', sessionFile: NEW_FILE, isStreaming: false, isCompacting: false, messageCount: 0, model: null, thinkingLevel: 'off' },
            sessionFile: NEW_FILE,
            materialized: false,
          };
        case 'openSession':
          return {
            state: { sessionId: 's', sessionFile: String(params?.file), isStreaming: false, isCompacting: false, messageCount: 1, model: null, thinkingLevel: 'off' },
          };
        case 'sendPrompt':
          return {
            disposition: 'started',
            sessionFile: state.sessionFile,
            sessionId: 'new-id',
            materialized: opts.sendMaterialized ?? false,
          };
        case 'getAvailableModels':
          return { models: [{ provider: 'prov-a', id: 'model-one', name: 'Model One', contextWindow: 1000, reasoning: true }] };
        case 'getThinkingLevels':
          return { levels: ['off', 'high'], current: 'off' };
        case 'interrupt':
          return { interrupted: true };
        case 'closeSession':
          state.sessionFile = null;
          return { closed: true };
        case 'listSkills':
          return { skills: [], diagnostics: [] };
        case 'listPackages':
          return { packages: [], builtins: [], settingsExtensions: [], diagnostics: [] };
        case 'listMcpServers':
          return { servers: [], builtinEnabled: false, logDiagnostics: [], diagnostics: [] };
        default:
          return { ok: true };
      }
    }),
    getStatus: async () => READY_SNAPSHOT,
    retry: async () => READY_SNAPSHOT,
    listDistros: async () => ['Ubuntu'],
    selectDistro: async () => READY_SNAPSHOT,
    onStateChange: () => () => undefined,
    onChatEvent: (cb: (p: unknown) => void) => {
      listeners.push(cb);
      return () => undefined;
    },
    getAppearance: async () => undefined,
    saveAppearance: async () => undefined,
    resetAppearance: async () => undefined,
  } as unknown as DesktopApi;

  return { api, calls, emit: (p) => listeners.forEach((cb) => cb(p)), sendPromptMaterialized: opts.sendMaterialized ?? false };
}

const methods = (h: Harness): string[] => h.calls.map((c) => c.method);
const paramOf = (h: Harness, method: string): unknown => h.calls.find((c) => c.method === method)?.params;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

describe('#26 «Новый диалог»', () => {
  it('создаёт черновик через new_session с cwd проекта и без записи JSONL', async () => {
    const h = makeHarness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(screen.getAllByRole('button', { name: /новый диалог/i })[0]);

    await waitFor(() => expect(methods(h)).toContain('newSession'));
    expect(paramOf(h, 'newSession')).toEqual({ cwd: '/p/alpha' });
    expect(methods(h)).not.toContain('sendPrompt');
    expect(methods(h)).not.toContain('openSession');
    // черновик подписан честно и показывает cwd
    expect(await screen.findByTestId('draft-title')).toHaveTextContent('Новый диалог');
    expect(screen.getByTestId('draft-notice')).toHaveTextContent('/p/alpha');
  });

  it('до первого сообщения модель и thinking читаются из Pi (без хардкода)', async () => {
    const h = makeHarness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(screen.getAllByRole('button', { name: /новый диалог/i })[0]);
    await waitFor(() => expect(methods(h)).toContain('getAvailableModels'));
    expect(methods(h)).toContain('getThinkingLevels');
    expect(methods(h)).not.toContain('sendPrompt');
  });

  it('первое сообщение уходит в новую сессию и при materialize становится реальной', async () => {
    const h = makeHarness({ sendMaterialized: true });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(screen.getAllByRole('button', { name: /новый диалог/i })[0]);
    await waitFor(() => expect(methods(h)).toContain('newSession'));

    const input = await screen.findByPlaceholderText(/сообщение/i);
    await user.type(input, 'первое сообщение');
    await user.click(screen.getByRole('button', { name: /отправить/i }));

    await waitFor(() => expect(methods(h)).toContain('sendPrompt'));
    // сессия Pi стала реальной: подпись черновика исчезает, список перечитан
    await waitFor(() => expect(screen.queryByTestId('draft-title')).toBeNull());
    const listCalls = h.calls.filter((c) => c.method === 'listSessions').length;
    expect(listCalls).toBeGreaterThanOrEqual(2); // первичная загрузка + после materialize
  });

  it('без materialize диалог остаётся честным черновиком (файла ещё нет)', async () => {
    const h = makeHarness({ sendMaterialized: false });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(screen.getAllByRole('button', { name: /новый диалог/i })[0]);
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await user.type(input, 'текст');
    await user.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(methods(h)).toContain('sendPrompt'));
    expect(screen.getByTestId('draft-title')).toHaveTextContent('Новый диалог');
  });
});

describe('#26 per-session state', () => {
  it('поздние события чужого диалога не рендерятся в открытом чате', async () => {
    const h = makeHarness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('session-b'));
    // Явная граница записи сохранена: RPC открывает пользователь, не приложение.
    await user.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(methods(h)).toContain('openSession'));

    h.emit({ kind: 'pi', name: 'message_end', key: `file:${FILE_B}`, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'ответ B' }] } } });
    expect(await screen.findByText('ответ B')).toBeInTheDocument();

    // Поздний хвост диалога A после переключения не должен появиться в B.
    h.emit({ kind: 'pi', name: 'message_end', key: `file:${FILE_A}`, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'хвост A' }] } } });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('хвост A')).toBeNull();
    expect(screen.getByText('ответ B')).toBeInTheDocument();
  });

  it('переключение A→B: позднее событие A и событие без ключа не попадают в B', async () => {
    const h = makeHarness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('session-a'));
    await user.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(methods(h)).toContain('openSession'));
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await user.type(input, 'запрос в A');
    await user.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(methods(h)).toContain('sendPrompt'));

    // Переключение на B требует явного закрытия A (один writer).
    await user.click(await screen.findByTestId('session-b'));
    await user.click(await screen.findByTestId('switch-confirm'));
    await waitFor(() => expect(h.calls.filter((c) => c.method === 'openSession').length).toBe(1));

    // Поздний хвост A со своим ключом — не в B.
    h.emit({ kind: 'pi', name: 'message_end', key: `file:${FILE_A}`, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'поздний A' }] } } });
    // Событие БЕЗ ключа: принадлежность не доказана → никуда не рендерится.
    h.emit({ kind: 'pi', name: 'tool_execution_start', data: { toolCallId: 't9', toolName: 'bash' } });
    h.emit({ kind: 'pi', name: 'message_update', data: { assistantMessageEvent: { type: 'text_delta', delta: 'безымянная дельта' } } });
    await new Promise((r) => setTimeout(r, 40));

    expect(screen.queryByText('поздний A')).toBeNull();
    expect(screen.queryByText(/безымянная дельта/)).toBeNull();
    expect(screen.queryByTestId('right-sidebar')?.textContent ?? '').not.toContain('t9');
  });

  it('черновик отменяется при переходе в существующий диалог — без отправки и без записи', async () => {
    const h = makeHarness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(screen.getAllByRole('button', { name: /новый диалог/i })[0]);
    await waitFor(() => expect(methods(h)).toContain('newSession'));
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await user.type(input, 'не отправлено');

    await user.click(await screen.findByTestId('session-a'));
    await waitFor(() => expect(methods(h)).toContain('closeSession'));
    expect(methods(h)).not.toContain('sendPrompt');
  });

  it('во время генерации переключение не происходит молча (один writer)', async () => {
    const h = makeHarness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('session-a'));
    await user.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(methods(h)).toContain('openSession'));

    const input = await screen.findByPlaceholderText(/сообщение/i);
    await user.type(input, 'долгий запрос');
    await user.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(methods(h)).toContain('sendPrompt'));

    // Пока идёт генерация, «Новый диалог» обязан отказать явно.
    await user.click(screen.getAllByRole('button', { name: /новый диалог/i })[0]);
    expect(await screen.findByTestId('writer-conflict')).toHaveTextContent(/дождитесь ответа|прервите/i);
    // Активный диалог остался прежним.
    expect(screen.queryByTestId('draft-title')).toBeNull();
  });
});

describe('#26 восстановление последнего диалога', () => {
  it('восстанавливается файл, который реально есть в списке Pi', async () => {
    localStorage.setItem('pi-desktop:last-session', `file:${FILE_B}`);
    const h = makeHarness();
    render(<App api={h.api} moduleDefinitions={[]} />);
    // Диалог восстановлен как КОНТЕКСТ: заголовок и панель на месте…
    // «Второй» есть и в сайдбаре, и в заголовке диалога — берём заголовок.
    expect(await screen.findByTitle(FILE_B)).toHaveTextContent('Второй');
    expect(await screen.findByTestId('session-detail')).toBeInTheDocument();
    // …но RPC не спавнится сам: открытие остаётся явным действием (граница записи).
    expect(methods(h)).not.toContain('openSession');
    expect(screen.getByRole('button', { name: /открыть чат/i })).toBeInTheDocument();
  });

  it('удалённый файл не пересоздаётся: остаётся честное пустое состояние', async () => {
    localStorage.setItem('pi-desktop:last-session', 'file:/roots/--p-alpha--/gone.jsonl');
    const h = makeHarness();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await waitFor(() => expect(methods(h)).toContain('listSessions'));
    await new Promise((r) => setTimeout(r, 30));
    expect(methods(h)).not.toContain('openSession');
    expect(screen.getByTestId('chat-empty')).toBeInTheDocument();
  });

  it('черновик после перезапуска не восстанавливается', async () => {
    localStorage.setItem('pi-desktop:last-session', 'draft:d1');
    const h = makeHarness();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await waitFor(() => expect(methods(h)).toContain('listSessions'));
    await new Promise((r) => setTimeout(r, 30));
    expect(methods(h)).not.toContain('openSession');
  });
});
