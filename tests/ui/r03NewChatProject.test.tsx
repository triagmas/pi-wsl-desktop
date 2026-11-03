/**
 * R03-1 (#26, #6572954720, P1) — «Новый диалог» обязан брать последний ЯВНО
 * выбранный проект, а не проект случайно открытого чата.
 *
 * В R02 приоритет был `activeSession?.projectPath ?? activeDraft?.cwd ??
 * readStoredProject()`: открытый чат проекта A перебивал явный выбор B, и
 * новый черновик уезжал в A. Здесь зафиксирован наблюдаемый контракт:
 *  • общий «Новый диалог» → последний явно выбранный и ВАЛИДНЫЙ проект;
 *  • `+` у проекта → именно этот проект (сильнее любого запомненного);
 *  • удалённый/устаревший проект → явный chooser, без скрытой смены cwd;
 *  • выбор переживает перезапуск, пока проект существует в Pi;
 *  • один проект — однозначный выбор, несколько — только явный.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

const A = { id: '/p/a', name: 'alpha', path: '/p/a', sessionCount: 1, updatedAt: null };
const B = { id: '/p/b', name: 'beta', path: '/p/b', sessionCount: 1, updatedAt: null };

function project(id: string, name: string) {
  return { id, name, path: id, sessionCount: 1, updatedAt: null };
}

function session(id: string, projectPath: string) {
  return {
    id,
    file: `/roots/--${id}--/${id}.jsonl`,
    root: '/roots',
    projectId: projectPath,
    projectPath,
    name: null,
    displayName: `Диалог ${id}`,
    displayNameSource: 'firstUser' as const,
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    sizeBytes: 10,
    version: 3,
    availability: 'ok' as const,
    activeWrite: false,
    diagnostics: null,
  };
}

const EMPTY_READ = {
  header: null,
  entries: [],
  leafId: null,
  nextCursor: null,
  prevCursor: null,
  atStart: true,
  truncated: false,
  partialTrailing: false,
  diagnostics: [],
  availability: 'ok' as const,
};

function openState(file: string) {
  return {
    sessionId: 'open-1',
    sessionFile: file,
    isStreaming: false,
    isCompacting: false,
    messageCount: 1,
    model: null,
    thinkingLevel: 'off',
  };
}

function harness(initialProjects: unknown[]) {
  const api = makeApi();
  const base = api._request.getMockImplementation() as unknown as (
    method: string,
    params?: unknown,
  ) => Promise<unknown>;
  const calls: Array<{ method: string; params?: unknown }> = [];
  let projects = initialProjects;
  api._request.mockImplementation(async (method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method === 'listProjects') return { projects, diagnostics: [] };
    if (method === 'listSessions') return { sessions: [session('sa', '/p/a'), session('sb', '/p/b')], diagnostics: [] };
    if (method === 'readSession') return EMPTY_READ;
    if (method === 'openSession') return { state: openState(String((params as { file: string }).file)) };
    if (method === 'newSession') {
      const cwd = String((params as { cwd: string }).cwd);
      return { state: openState(`/roots/--new--/${cwd.replace(/\//g, '_')}.jsonl`), sessionFile: `/roots/--new--/${cwd.replace(/\//g, '_')}.jsonl`, materialized: false };
    }
    if (method === 'closeSession') return { closed: true };
    if (method === 'getAvailableModels') return { models: [] };
    if (method === 'getThinkingLevels') return { levels: [], current: null };
    return base(method, params);
  });
  return {
    api,
    calls,
    setProjects: (next: unknown[]) => {
      projects = next;
    },
    newSessionCalls: () => calls.filter((c) => c.method === 'newSession'),
  };
}

const globalNewChat = () => screen.getAllByRole('button', { name: /^Новый диалог/ })[0];

beforeEach(() => {
  localStorage.clear();
});

describe('R03-1 · общий «Новый диалог» и явный выбор проекта', () => {
  it('чат A → выбор проекта B → «Новый диалог» создаёт черновик в B', async () => {
    const h = harness([A, B]);
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);

    // открываем чат проекта A
    // первый проект раскрыт по умолчанию — сессии видны без клика по проекту
    await user.click(await screen.findByTestId('session-sa'));
    await user.click(await screen.findByRole('button', { name: 'Открыть чат' }));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'openSession')).toBe(true));

    // и теперь ЯВНО выбираем проект B
    await user.click(screen.getByTestId('project-/p/b'));
    expect(localStorage.getItem('pi-desktop:last-project')).toBe('/p/b');

    // общий «Новый диалог»: активный чат A не должен перебивать выбор B
    await user.click(globalNewChat());
    await user.click(await screen.findByTestId('new-chat-confirm'));

    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/b' });
  });

  it('чат A → «+» проекта B → черновик в B', async () => {
    const h = harness([A, B]);
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);

    // первый проект раскрыт по умолчанию — сессии видны без клика по проекту
    await user.click(await screen.findByTestId('session-sa'));
    await user.click(await screen.findByRole('button', { name: 'Открыть чат' }));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'openSession')).toBe(true));

    await user.click(screen.getByTestId('project-new-/p/b'));
    await user.click(await screen.findByTestId('new-chat-confirm'));

    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/b' });
  });

  it('выбранный проект удалён → chooser, без подстановки другого cwd', async () => {
    const h = harness([A, B]);
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-/p/b'));
    expect(localStorage.getItem('pi-desktop:last-project')).toBe('/p/b');

    // проект исчез из Pi
    h.setProjects([A]);
    await user.click(globalNewChat());

    expect(await screen.findByTestId('project-chooser')).toBeVisible();
    expect(screen.queryByTestId('project-chooser-/p/b')).toBeNull();
    expect(screen.getByTestId('project-chooser-/p/a')).toBeVisible();
    expect(h.newSessionCalls().length).toBe(0);
  });

  it('выбор переживает перезапуск приложения (проект всё ещё в Pi)', async () => {
    const first = harness([A, B]);
    const user = userEvent.setup();
    const view = render(<App api={first.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-/p/b'));
    view.unmount();

    // «перезапуск»: новый экземпляр приложения, тот же localStorage
    const second = harness([A, B]);
    render(<App api={second.api} moduleDefinitions={[]} />);
    await waitFor(() => expect(screen.getByTestId('project-/p/b')).toBeVisible());
    await user.click(globalNewChat());

    await waitFor(() => expect(second.newSessionCalls().length).toBe(1));
    expect(second.newSessionCalls()[0].params).toEqual({ cwd: '/p/b' });
  });

  it('несколько проектов без явного выбора → chooser, без угадывания', async () => {
    const h = harness([A, B]);
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await waitFor(() => expect(screen.getByTestId('project-/p/a')).toBeVisible());

    await user.click(globalNewChat());
    expect(await screen.findByTestId('project-chooser')).toBeVisible();
    expect(h.newSessionCalls().length).toBe(0);
  });

  it('единственный проект → черновик в нём без chooser', async () => {
    const h = harness([project('/p/solo', 'solo')]);
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await waitFor(() => expect(screen.getByTestId('project-/p/solo')).toBeVisible());

    await user.click(globalNewChat());
    await waitFor(() => expect(h.newSessionCalls().length).toBe(1));
    expect(h.newSessionCalls()[0].params).toEqual({ cwd: '/p/solo' });
  });

  it('ошибка подключения не отправляет второй new_session автоматически', async () => {
    const h = harness([A, B]);
    const user = userEvent.setup();
    // первый вызов «падает», второй (ручной retry) — успешен
    let attempt = 0;
    const base = h.api._request.getMockImplementation() as unknown as (
      method: string,
      params?: unknown,
    ) => Promise<unknown>;
    h.api._request.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'newSession') {
        attempt += 1;
        if (attempt === 1) throw new Error('BRIDGE_TIMEOUT: request newSession timed out');
      }
      return base(method, params);
    });
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-/p/b'));
    await user.click(globalNewChat());

    expect(await screen.findByTestId('chat-error')).toBeVisible();
    // черновик и композер на месте, второй попытки не было
    expect(await screen.findByTestId('draft-notice')).toBeVisible();
    expect(document.querySelector('.dl-composer-input')).not.toBeNull();
    expect(attempt).toBe(1);

    // повтор — только по явному действию пользователя (не автоматически)
    const retry = screen.queryByTestId('chat-retry');
    if (retry) {
      await user.click(retry);
      await waitFor(() => expect(attempt).toBe(2));
    }
  });
});
