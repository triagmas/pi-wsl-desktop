/**
 * UI26 R02 — явное обновление списка после внешних изменений Pi CLI (#26).
 *
 * Постоянный watcher не нужен: достаточно явного Refresh, который перечитывает
 * проекты и сессии из Pi. Проверяется, что обновляются И названия, И порядок
 * (сортировка по последней активности), а старые данные не «залипают».
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import type { DesktopApi } from '../../src/renderer/api';
import { READY_SNAPSHOT } from './helpers/shellApi';

const PROJECT = { id: '/p/alpha', name: 'alpha', path: '/p/alpha', sessionCount: 2, updatedAt: null };

const mkSession = (file: string, displayName: string, updatedAt: string) => ({
  id: file.split('/').pop()!.replace('.jsonl', ''),
  file,
  root: '/roots',
  projectId: '/p/alpha',
  projectPath: '/p/alpha',
  name: null,
  displayName,
  displayNameSource: 'firstUser' as const,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt,
  sizeBytes: 10,
  version: 3,
  availability: 'ok' as const,
  activeWrite: false,
  diagnostics: null,
});

function harness() {
  let sessions = [
    mkSession('/roots/--p--/old.jsonl', 'Старое имя', '2026-10-19T00:00:00.000Z'),
    mkSession('/roots/--p--/b.jsonl', 'Второй', '2026-10-20T00:00:00.000Z'),
  ];
  let listCalls = 0;
  const api = {
    request: async (method: string) => {
      if (method === 'listProjects') return { projects: [PROJECT], diagnostics: [] };
      if (method === 'listSessions') {
        listCalls += 1;
        return { sessions, diagnostics: [] };
      }
      if (method === 'listSkills') return { skills: [], diagnostics: [] };
      if (method === 'listPackages') return { packages: [], builtins: [], settingsExtensions: [], diagnostics: [] };
      if (method === 'listMcpServers') return { servers: [], builtinEnabled: false, logDiagnostics: [], diagnostics: [] };
      return { ok: true };
    },
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

  return {
    api,
    calls: () => listCalls,
    // «Внешний» Pi CLI: переименовал сессию и дописал её последней.
    externalCliTouch: () => {
      sessions = [
        mkSession('/roots/--p--/b.jsonl', 'Второй', '2026-10-20T00:00:00.000Z'),
        mkSession('/roots/--p--/old.jsonl', 'Переименовано в Pi CLI', '2026-10-21T00:00:00.000Z'),
      ];
    },
  };
}

const titles = (): string[] =>
  Array.from(document.querySelectorAll('[data-testid^="session-"]')).map((el) => el.textContent ?? '');

describe('#26 явный Refresh', () => {
  it('перечитывает названия и порядок сессий после внешнего изменения', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await screen.findByTestId('session-old');
    expect(titles()).toEqual(['Старое имя', 'Второй']);

    h.externalCliTouch();
    await user.click(await screen.findByTestId('refresh-sessions'));

    await waitFor(() => expect(titles()).toContain('Переименовано в Pi CLI'));
    // Название обновилось…
    expect(titles()).not.toContain('Старое имя');
    // …и порядок пересортирован по последней активности (свежая — первой).
    expect(titles()).toEqual(['Второй', 'Переименовано в Pi CLI']);
    expect(h.calls()).toBeGreaterThanOrEqual(2);
  });

  it('Refresh доступен по имени и с клавиатуры, не ломая поиск', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    h.externalCliTouch();
    const refresh = await screen.findByTestId('refresh-sessions');
    expect(refresh).toHaveAccessibleName(/обновить/i);
    refresh.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(h.calls()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(titles()).toContain('Переименовано в Pi CLI'));
    // Поиск по-прежнему работает по обновлённым названиям.
    const search = screen.getByPlaceholderText(/поиск чатов/i);
    await user.type(search, 'Переименовано');
    expect(titles()).toEqual(['Переименовано в Pi CLI']);
  });
});
