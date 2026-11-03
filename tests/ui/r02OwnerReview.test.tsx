/**
 * UI Owner Review R02 (Issue #21, #6566550672).
 *
 * Владелец проверил реальную Windows-сборку и нашёл:
 *  • глобальный «Новый диалог» уходит в произвольный projects[0] вместо
 *    последнего явно открытого проекта;
 *  • в новом диалоге нет поля ввода — только «Подключение к сессии…»;
 *  • левый сайдбар живёт на разных сетках (иконки 20 px, разные отступы).
 *
 * Тесты фиксируют поведение, а не разметку: какой cwd реально уходит в
 * официальный new_session, есть ли композер в каждом состоянии, и остаётся ли
 * одна сетка иконок/отступов.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

const P1 = { id: '/p/one', name: 'one', path: '/p/one', sessionCount: 0, updatedAt: null };
const P2 = { id: '/p/two', name: 'two', path: '/p/two', sessionCount: 1, updatedAt: null };

const SESSION = {
  id: 's-two',
  file: '/roots/--p-two--/s.jsonl',
  root: '/roots',
  projectId: '/p/two',
  projectPath: '/p/two',
  name: null,
  displayName: 'Очень длинное название диалога, которое не должно налезать на кнопку плюс',
  displayNameSource: 'firstUser' as const,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  sizeBytes: 10,
  version: 3,
  availability: 'ok' as const,
  activeWrite: false,
  diagnostics: null,
};

function newState(file = '/roots/--p--/new.jsonl') {
  return {
    sessionId: 's-new',
    sessionFile: file,
    isStreaming: false,
    isCompacting: false,
    messageCount: 0,
    model: null,
    thinkingLevel: 'off',
  };
}

function harness(opts: {
  projects?: unknown[];
  sessions?: unknown[];
  newSession?: (params: unknown) => Promise<unknown>;
} = {}) {
  const api = makeApi();
  const base = api._request.getMockImplementation() as unknown as (
    method: string,
    params?: unknown,
  ) => Promise<unknown>;
  const calls: Array<{ method: string; params?: unknown }> = [];
  api._request.mockImplementation(async (method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method === 'listProjects') return { projects: opts.projects ?? [P1, P2], diagnostics: [] };
    if (method === 'listSessions') return { sessions: opts.sessions ?? [], diagnostics: [] };
    if (method === 'newSession') {
      if (opts.newSession) return opts.newSession(params);
      return { state: newState(), sessionFile: '/roots/--p--/new.jsonl', materialized: false };
    }
    if (method === 'getAvailableModels') return { models: [] };
    if (method === 'getThinkingLevels') return { levels: [], current: null };
    return base(method, params);
  });
  return { api, calls, newSessionCalls: () => calls.filter((c) => c.method === 'newSession') };
}

const globalNewChat = () => screen.getAllByRole('button', { name: /^Новый диалог/ })[0];

beforeEach(() => {
  localStorage.clear();
});

describe('R02 · «Новый диалог» использует последний открытый проект', () => {
  it('после явного открытия второго проекта глобальная кнопка создаёт черновик в нём', async () => {
    const h = harness({ sessions: [SESSION] });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('project-/p/two'));
    await user.click(globalNewChat());

    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    // projects[0] = /p/one — но пользователь открыл /p/two.
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/two' });
    expect(await screen.findByTestId('draft-cwd')).toHaveAttribute('title', '/p/two');
  });

  it('«+» конкретного проекта создаёт диалог именно в этом проекте', async () => {
    const h = harness({ sessions: [SESSION] });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('project-/p/two'));
    await user.click(screen.getByTestId('project-new-/p/one'));

    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/one' });
  });

  it('без достоверного проекта — явный выбор, без произвольного каталога', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('project-/p/one');

    await user.click(globalNewChat());

    expect(await screen.findByTestId('project-chooser')).toBeVisible();
    expect(screen.getByTestId('project-chooser-/p/one')).toBeVisible();
    expect(screen.getByTestId('project-chooser-/p/two')).toBeVisible();
    // до выбора — ни одного new_session и никакого «угаданного» cwd
    expect(h.newSessionCalls().length).toBe(0);

    await user.click(screen.getByTestId('project-chooser-/p/two'));
    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/two' });
  });

  it('устаревший сохранённый проект не подставляется молча', async () => {
    localStorage.setItem('pi-desktop:last-project', '/p/gone');
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('project-/p/one');

    await user.click(globalNewChat());

    expect(await screen.findByTestId('project-chooser')).toBeVisible();
    expect(h.newSessionCalls().some((c) => (c.params as { cwd: string }).cwd === '/p/gone')).toBe(false);
  });

  it('сохранённый существующий проект используется после перезапуска', async () => {
    localStorage.setItem('pi-desktop:last-project', '/p/two');
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('project-/p/one');

    await user.click(globalNewChat());

    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/two' });
  });

  it('единственный проект Pi — однозначный выбор, а не «первый из списка»', async () => {
    const h = harness({ projects: [P2] });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('project-/p/two');

    await user.click(globalNewChat());

    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/two' });
  });
});

describe('R02 · композер существует в каждом состоянии', () => {
  it('черновик: поле ввода видно и честно неактивно во время подключения', async () => {
    const h = harness({ newSession: () => new Promise(() => {}) }); // «висит» подключение
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('project-/p/one');
    await user.click(screen.getByTestId('project-new-/p/one'));

    expect(await screen.findByTestId('chat-opening')).toBeVisible();
    const input = document.querySelector('.dl-composer-input') as HTMLTextAreaElement | null;
    expect(input).not.toBeNull();
    expect(input!.disabled).toBe(true);
  });

  it('ошибка подключения: диагностика, повтор и поле ввода на месте', async () => {
    const h = harness({
      newSession: async () => {
        throw new Error('BRIDGE_TIMEOUT: request newSession timed out after 10000ms');
      },
    });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('project-/p/one');
    await user.click(screen.getByTestId('project-new-/p/one'));

    const err = await screen.findByTestId('chat-error');
    expect(err.textContent).toMatch(/BRIDGE_TIMEOUT/);
    expect(screen.getByRole('button', { name: /Повторить подключение/i })).toBeVisible();
    expect(document.querySelector('.dl-composer-input')).not.toBeNull();
    // пустого экрана нет: и диагностика, и поле ввода
    expect(await screen.findByTestId('chat-open-notice')).toBeVisible();
  });
});

describe('R02 · сайдбар: одна сетка', () => {
  it('иконки проектов, сессий и навигации живут в общей колонке', async () => {
    const h = harness({ sessions: [SESSION] });
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('project-/p/two');
    // сессии проекта видны только в раскрытой группе
    await user.click(screen.getByTestId('project-/p/two'));
    await screen.findByTestId('session-s-two');

    const project = screen.getByTestId('project-/p/two');
    const session = screen.getByTestId('session-s-two');
    const nav = screen.getByTestId('nav-chat');
    for (const row of [project, session, nav]) {
      expect(row.querySelector('.dl-row-icon'), 'ряд без иконочной колонки').not.toBeNull();
      expect(row.querySelector('.dl-row-icon svg')).not.toBeNull();
    }
    // длинное название не наезжает на «+»: полный текст остаётся в title
    expect(session.querySelector('.dl-row-text')).toHaveAttribute('title', SESSION.displayName);
  });
});
