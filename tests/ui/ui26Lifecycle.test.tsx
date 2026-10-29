/**
 * UI26 R02 — жизненный цикл отменённого нового диалога (#26).
 *
 * Обещания: отмена черновика не создаёт JSONL, не оставляет осиротевший
 * RPC-процесс (ровно один closeSession, без повторных спавнов) и НЕ стирает
 * composer-черновик другого диалога.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { DesktopApi } from '../../src/renderer/api';
import { READY_SNAPSHOT } from './helpers/shellApi';

const FILE_A = '/roots/--p-alpha--/a.jsonl';
const FILE_B = '/roots/--p-alpha--/b.jsonl';
const PROJECT = { id: '/p/alpha', name: 'alpha', path: '/p/alpha', sessionCount: 2, updatedAt: null };

const mkSession = (file: string, displayName: string) => ({
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

function harness(opts: { projects?: Array<{ id: string; name: string; path: string; sessionCount: number; updatedAt: null }> } = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let sessionFile: string | null = null;
  const api = {
    request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'listProjects') return { projects: opts.projects ?? [PROJECT], diagnostics: [] };
      if (method === 'listSessions') {
        return { sessions: [mkSession(FILE_A, 'Первый'), mkSession(FILE_B, 'Второй')], diagnostics: [] };
      }
      if (method === 'newSession') {
        sessionFile = '/roots/--p-alpha--/draft-new.jsonl';
        return {
          state: { sessionId: 'new', sessionFile, isStreaming: false, isCompacting: false, messageCount: 0, model: null, thinkingLevel: 'off' },
          sessionFile,
          materialized: false,
        };
      }
      if (method === 'openSession') {
        sessionFile = String(params?.file);
        return { state: { sessionId: 'x', sessionFile, isStreaming: false, isCompacting: false, messageCount: 1, model: null, thinkingLevel: 'off' } };
      }
      if (method === 'closeSession') {
        sessionFile = null;
        return { closed: true };
      }
      if (method === 'getAvailableModels') return { models: [] };
      if (method === 'getThinkingLevels') return { levels: [], current: null };
      if (method === 'listSkills') return { skills: [], diagnostics: [] };
      if (method === 'listPackages') return { packages: [], builtins: [], settingsExtensions: [], diagnostics: [] };
      if (method === 'listMcpServers') return { servers: [], builtinEnabled: false, logDiagnostics: [], diagnostics: [] };
      return { ok: true };
    }),
    getStatus: async () => READY_SNAPSHOT,
    retry: async () => READY_SNAPSHOT,
    listDistros: async () => ['Ubuntu'],
    selectDistro: async () => READY_SNAPSHOT,
    onStateChange: () => () => undefined,
    onChatEvent: () => () => undefined,
    getAppearance: async () => undefined,
    saveAppearance: async () => undefined,
    resetAppearance: async () => undefined,
  } as unknown as DesktopApi;
  return { api, calls, methods: () => calls.map((c) => c.method), countOf: (m: string) => calls.filter((c) => c.method === m).length };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('#26 отмена нового диалога', () => {
  it('переход в существующий диалог закрывает черновик ровно одним closeSession, без записи', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-new-/p/alpha'));
    await waitFor(() => expect(h.methods()).toContain('newSession'));

    await user.click(await screen.findByTestId('session-a'));
    await waitFor(() => expect(h.methods()).toContain('closeSession'));
    expect(h.countOf('closeSession')).toBe(1);
    // Ни одного сообщения → ни одной записи, ни второго newSession.
    expect(h.methods()).not.toContain('sendPrompt');
    expect(h.countOf('newSession')).toBe(1);
  });

  it('повторный `+` не копит RPC-процессы: предыдущий черновик закрыт', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-new-/p/alpha'));
    await waitFor(() => expect(h.countOf('newSession')).toBe(1));
    await user.click(screen.getByTestId('project-new-/p/alpha'));
    // Живой черновик занимает слот → требуется явное подтверждение.
    await user.click(await screen.findByTestId('new-chat-confirm'));
    // Предыдущий черновик закрыт ровно один раз, второй сессии не появилось
    // без закрытия первой: RPC-процессы не копятся.
    await waitFor(() => expect(h.countOf('closeSession')).toBe(1));
    await waitFor(() => expect(h.countOf('newSession')).toBe(2));
  });

  it('composer-черновик ДРУГОГО диалога не теряется при создании и отмене нового', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    // Пишем в реальный диалог A.
    await user.click(await screen.findByTestId('session-a'));
    await user.click(await screen.findByRole('button', { name: /открыть чат/i }));
    const inputA = await screen.findByPlaceholderText(/сообщение/i);
    await user.type(inputA, 'черновик A');

    // Новый диалог: занятый слот требует явного решения (не молчаливый kill).
    await user.click(await screen.findByTestId('project-new-/p/alpha'));
    expect(await screen.findByTestId('new-chat-guard')).toBeInTheDocument();
    await user.click(screen.getByTestId('new-chat-confirm'));
    await waitFor(() => expect(h.methods()).toContain('newSession'));
    await user.click(await screen.findByTestId('session-a'));
    await waitFor(() => expect(h.methods()).toContain('closeSession'));

    // Черновик A пережил и создание, и отмену нового диалога: слот закрывался
    // явно, но текст диалога остался в его собственном состоянии.
    await user.click(await screen.findByTestId('session-a'));
    const reopen = await screen.findByRole('button', { name: /открыть чат/i });
    await user.click(reopen);
    const inputBack = await screen.findByPlaceholderText(/сообщение/i);
    expect((inputBack as HTMLTextAreaElement | HTMLInputElement).value).toBe('черновик A');
  });

  it('пустой живой черновик → выбор сессии: ОДИН подтверждённый переход', async () => {
    // UI26 R03 (P1-4): уход из пустого черновика не должен ни требовать
    // повторного подтверждения, ни закрывать RPC дважды.
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-new-/p/alpha'));
    await waitFor(() => expect(h.countOf('newSession')).toBe(1));

    await user.click(await screen.findByTestId('session-a'));
    // Никакого второго диалога подтверждения: переход уже однозначен.
    expect(screen.queryByTestId('switch-guard')).toBeNull();
    // Черновик закрыт ровно один раз; выбранная сессия показана (RPC при
    // выборе не спавнится — открытие остаётся явным действием пользователя).
    await waitFor(() => expect(h.countOf('closeSession')).toBe(1));
    expect(await screen.findByTestId('session-detail')).toBeInTheDocument();
    expect(h.countOf('closeSession')).toBe(1);
    // Черновик закрыт, сессия A активна, новых RPC не появилось.
    expect(h.countOf('newSession')).toBe(1);
  });

  it('нет подтверждённого проекта → нет черновика и явное сообщение (без cwd "/")', async () => {
    // UI26 R03 (P1-5): никакого fallback cwd `/` — только подтверждённый проект
    // либо честное сообщение пользователю.
    const h = harness({ projects: [] });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    // Кнопка в шапке чата (у проектов своих кнопок нет — список пуст).
    const newChatBtn = (await screen.findAllByRole('button', { name: /новый диалог/i }))[0];
    await user.click(newChatBtn);
    expect(await screen.findByTestId('new-chat-no-project')).toBeInTheDocument();
    expect(h.countOf('newSession')).toBe(0);
  });
});
