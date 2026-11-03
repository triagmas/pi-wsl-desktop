/**
 * UI Integration V1 / Owner Acceptance Repair R01 (Issue #26, #6559283775).
 *
 * Владелец проверил реальный Windows-EXE и отклонил приёмку: «Проекты» не
 * сворачивают группу, крестик/разворот терминала инертны, кнопка обновления
 * появилась в несогласованном месте, страница Settings не имеет собственного
 * скролл-контейнера, а подписи сессий падают до технического ID.
 *
 * Эти тесты фиксируют ПОВЕДЕНИЕ (не разметку ради разметки), чтобы регрессии
 * не вернулись. Реальная прокрутка проверяется в e2e/ui.spec.ts (layout/geometry
 * в jsdom не измерить).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

const PROJECT = { id: '/p/alpha', name: 'alpha', path: '/p/alpha', sessionCount: 2, updatedAt: null };
const OTHER = { id: '/p/beta', name: 'beta', path: '/p/beta', sessionCount: 1, updatedAt: null };

const mkSession = (file: string, projectId: string, title: string) => ({
  id: file.split('/').pop()!.replace('.jsonl', ''),
  file,
  root: '/roots',
  projectId,
  projectPath: projectId,
  name: null,
  displayName: title,
  displayNameSource: 'firstUser' as const,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  sizeBytes: 10,
  version: 3,
  availability: 'ok' as const,
  activeWrite: false,
  diagnostics: null,
});

function harness() {
  const api = makeApi();
  const base = api._request.getMockImplementation() as unknown as (
    method: string,
    params?: unknown,
  ) => Promise<unknown>;
  api._request.mockImplementation(async (method: string, params?: unknown) => {
    if (method === 'listProjects') return { projects: [PROJECT, OTHER], diagnostics: [] };
    if (method === 'listSessions') {
      return {
        sessions: [
          mkSession('/roots/--p--/a.jsonl', '/p/alpha', 'Починить ленту чата'),
          mkSession('/roots/--p--/b.jsonl', '/p/alpha', 'Собрать релиз'),
          mkSession('/roots/--p--/c.jsonl', '/p/beta', 'Второй проект'),
        ],
        diagnostics: [],
      };
    }
    return base(method, params);
  });
  return api;
}

const listSessionCalls = (api: ReturnType<typeof harness>) =>
  api._request.mock.calls.filter(([m]) => m === 'listSessions').length;

describe('R01 · «Проекты» сворачивает всю группу', () => {
  it('заголовок — настоящая кнопка с aria-expanded и стрелкой по состоянию', async () => {
    const user = userEvent.setup();
    render(<App api={harness()} moduleDefinitions={[]} />);
    const toggle = await screen.findByTestId('projects-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('project-list')).toBeVisible();
    expect(await screen.findByTestId('project-/p/alpha')).toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByTestId('project-/p/alpha')).toBeNull());

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('project-/p/alpha')).toBeVisible();
  });

  it('клавиатура: Enter и Space переключают группу', async () => {
    const user = userEvent.setup();
    render(<App api={harness()} moduleDefinitions={[]} />);
    const toggle = await screen.findByTestId('projects-toggle');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('сворачивание отдельного проекта сохраняется после группового переключения', async () => {
    const user = userEvent.setup();
    render(<App api={harness()} moduleDefinitions={[]} />);
    const project = await screen.findByTestId('project-/p/alpha');
    expect(project).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('session-' + 'a')).toBeVisible();

    await user.click(project); // свернуть alpha
    expect(project).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByTestId('session-a')).toBeNull());

    await user.click(screen.getByTestId('projects-toggle')); // вся группа выкл
    await user.click(screen.getByTestId('projects-toggle')); // и снова вкл
    expect(screen.getByTestId('project-/p/alpha')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('project-/p/beta')).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByTestId('project-/p/beta'));
    expect(screen.getByTestId('session-c')).toBeVisible();
  });
});

describe('R01 · терминал: закрытие, повторное открытие, разворот', () => {
  it('крестик закрывает док и сохраняет terminalVisible=false', async () => {
    const user = userEvent.setup();
    const api = harness();
    render(<App api={api} moduleDefinitions={[]} />);
    expect(await screen.findByTestId('terminal-dock')).toBeVisible();
    await user.click(screen.getByTestId('terminal-close'));
    await waitFor(() => expect(screen.queryByTestId('terminal-dock')).toBeNull());
    expect(api._saveAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ terminalVisible: false }) }),
    );
  });

  it('кнопка статус-бара открывает закрытый док снова', async () => {
    const user = userEvent.setup();
    render(<App api={harness()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('terminal-close'));
    await waitFor(() => expect(screen.queryByTestId('terminal-dock')).toBeNull());
    await user.click(screen.getByTestId('status-terminal-btn'));
    expect(await screen.findByTestId('terminal-dock')).toBeVisible();
  });

  it('разворот увеличивает высоту и возвращает прежнюю', async () => {
    const user = userEvent.setup();
    render(<App api={harness()} moduleDefinitions={[]} />);
    await screen.findByTestId('terminal-dock');
    const heightOf = () => parseFloat((screen.getByTestId('terminal-dock') as HTMLElement).style.height);
    const before = heightOf();
    const expand = screen.getByTestId('terminal-expand');
    expect(expand).toHaveAttribute('aria-pressed', 'false');
    await user.click(expand);
    expect(expand).toHaveAttribute('aria-pressed', 'true');
    expect(heightOf()).toBeGreaterThan(before);
    await user.click(screen.getByTestId('terminal-expand'));
    expect(expand).toHaveAttribute('aria-pressed', 'false');
    expect(heightOf()).toBe(before);
  });

  it('перетаскивание верхней границы продолжает работать', async () => {
    const api = harness();
    render(<App api={api} moduleDefinitions={[]} />);
    const handle = await screen.findByTestId('terminal-dock-resize');
    expect(handle).toHaveAttribute('role', 'separator');
    // клавиатурный путь использует тот же commit, что и drag
    const before = Number(handle.getAttribute('aria-valuenow'));
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ terminalSlotHeight: before + 16 }) }),
      ),
    );
  });
});

describe('R01 · обновление списка не занимает место в шапке', () => {
  it('в шапке больше нет кнопки refresh; обновление доступно из контекста «Проекты»', async () => {
    const user = userEvent.setup();
    const api = harness();
    render(<App api={api} moduleDefinitions={[]} />);
    const toggle = await screen.findByTestId('projects-toggle');
    expect(screen.queryByTestId('refresh-sessions')).toBeNull();
    const before = listSessionCalls(api);
    await user.pointer({ keys: '[MouseRight]', target: toggle });
    await waitFor(() => expect(listSessionCalls(api)).toBeGreaterThan(before));
  });

  it('refresh в настройках подключения не затронут', async () => {
    const user = userEvent.setup();
    render(<App api={harness()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));
    expect(await screen.findByTestId('settings-refresh')).toBeVisible();
    expect(screen.getByTestId('settings-retry')).toBeVisible();
  });
});

describe('R01 · Settings имеет один настоящий скролл-контейнер', () => {
  it('страница — flex-слот центра, скроллится только .dl2-screen', async () => {
    const user = userEvent.setup();
    render(<App api={harness()} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));
    const page = await screen.findByTestId('view-settings');
    expect(page.className).toContain('dl-page-slot');
    const screenEl = screen.getByTestId('settings-root');
    expect(screenEl.className).toContain('dl2-screen');
    expect(page.contains(screenEl)).toBe(true);
    expect(within(screenEl).getByTestId('settings-col')).toBeVisible();
  });
});
