/**
 * UI21 C2 (P1): утверждённая презентация маршрута «Ресурсы».
 * RED: продукт рендерит legacy main-tabs/таблицу — h1, вкладочный контур
 * Design Lab и настоящий input поиска отсутствуют.
 * Нерушимые контракты m2 (skill-row ⊃ skill-toggle/skill-status, .res-panel,
 * res-tab-*) сохраняются и проверяются здесь же.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourcesView } from '../../src/renderer/ResourcesView';
import { App } from '../../src/renderer/App';
import { makeApi as makeShellApi } from './helpers/shellApi';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = {
  phase: 'ready',
  attempt: 0,
  distro: 'Ubuntu',
  distros: null,
  runtime: null,
};

const SKILLS = {
  skills: [
    {
      name: 'code-review',
      dir: '/home/u/.agents/skills/code-review',
      source: 'user-agents',
      package: null,
      description: 'review diffs',
      status: 'ok',
      disableModelInvocation: false,
      diagnostics: [],
    },
    {
      name: 'ghost',
      dir: '/home/u/.pi/agent/ghost',
      source: 'user-settings',
      package: null,
      description: null,
      status: 'missing',
      disableModelInvocation: false,
      diagnostics: ['SKILL.md: not found'],
    },
  ],
  diagnostics: [],
};

function makeApi(route: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    switch (method) {
      case 'listSkills':
        return route.listSkills ?? { skills: [], diagnostics: [] };
      case 'listPackages':
        return { packages: [], builtins: [], settingsExtensions: [], diagnostics: [] };
      case 'listMcpServers':
        return { servers: [], builtinEnabled: true, logDiagnostics: [], diagnostics: [] };
      default:
        return {};
    }
  });
  const api = {
    request: request as DesktopApi['request'],
    getStatus: async () => READY,
    retry: vi.fn(async () => READY),
    listDistros: async () => [],
    selectDistro: vi.fn(async () => READY),
    onStateChange: () => () => undefined,
    onChatEvent: () => () => undefined,
    getAppearance: async () => undefined,
    saveAppearance: async () => undefined,
    resetAppearance: async () => undefined,
  } as unknown as DesktopApi;
  return { api };
}

describe('UI21 C2 — approved presentation (ResourcesView)', () => {
  it('renders the approved contour: h1, tablist with res-tab-*, real search input', async () => {
    const { api } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);

    const root = await screen.findByTestId('resources-view');
    const heading = within(root).getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Ресурсы');

    const tablist = within(root).getByRole('tablist');
    expect(within(tablist).getByTestId('res-tab-skills')).toHaveAttribute('aria-selected', 'true');

    const search = await screen.findByPlaceholderText('Найти навык…');
    expect(search.tagName).toBe('INPUT');

    expect(document.querySelector('.main-tabs')).toBeNull();
  });

  it('keeps skill rows with nested toggle/status (approved list, same m2 contract)', async () => {
    const { api } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);

    const rows = await screen.findAllByTestId('skill-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const codeReview = rows.find((r) => within(r).queryByText('code-review'));
    expect(codeReview).toBeDefined();
    expect(within(codeReview!).getByTestId('skill-status')).toBeInTheDocument();
    expect(within(codeReview!).getByTestId('skill-toggle')).toBeEnabled();

    const ghost = rows.find((r) => within(r).queryByText('ghost'));
    expect(ghost).toBeDefined();
    expect(within(ghost!).getByTestId('skill-toggle')).toBeDisabled();
  });

  it('search narrows the skill list and an empty result is an honest "not found", never an empty inventory', async () => {
    const user = userEvent.setup();
    const { api } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);

    const rows = await screen.findAllByTestId('skill-row');
    expect(rows).toHaveLength(2);

    const input = await screen.findByPlaceholderText('Найти навык…');
    await user.type(input, 'code');
    expect(await screen.findAllByTestId('skill-row')).toHaveLength(1);
    expect(screen.getByTestId('skill-row')).toHaveTextContent('code-review');

    await user.clear(input);
    await user.type(input, 'no-such-skill');
    await waitFor(() => expect(screen.queryByTestId('skill-row')).toBeNull());
    expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument();
    // инвентарь не исчез: диагностика/счётчики живы — строка meta присутствует
    expect(screen.getByTestId('res-meta')).toBeInTheDocument();
  });

  it('meta counts only loadable skills as enabled (missing/invalid are not enabled)', async () => {
    const { api } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);

    const meta = await screen.findByTestId('res-meta');
    // SKILLS = code-review (ok) + ghost (missing): only one is loadable.
    expect(meta).toHaveTextContent('2 навыков');
    expect(meta).toHaveTextContent('1 включено');
  });

  it('source filter narrows rows via the approved select (Данные source)', async () => {
    const user = userEvent.setup();
    const { api } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);

    await screen.findAllByTestId('skill-row');
    const select = screen.getByLabelText('Источник навыка');
    await user.selectOptions(select, 'user-settings');
    expect(await screen.findAllByTestId('skill-row')).toHaveLength(1);
    expect(screen.getByTestId('skill-row')).toHaveTextContent('ghost');

    await user.selectOptions(select, '');
    expect(await screen.findAllByTestId('skill-row')).toHaveLength(2);
  });

  it('tab clicks switch panels through the approved tablist (Packages/MCP)', async () => {
    const user = userEvent.setup();
    const { api } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);

    await user.click(await screen.findByTestId('res-tab-packages'));
    expect(await screen.findByTestId('res-tab-packages')).toHaveAttribute('aria-selected', 'true');
    await screen.findByTestId('panel-packages');
  });
});

describe('UI21 C2 — App route (composition root)', () => {
  it('nav-resources shows the approved contour inside resources-view', async () => {
    const user = userEvent.setup();
    render(<App api={makeShellApi()} moduleDefinitions={[]} />);

    await user.click(await screen.findByTestId('nav-resources'));
    const root = await screen.findByTestId('resources-view');
    within(root).getByRole('heading', { level: 1 });
    within(root).getByRole('tablist');
    expect(document.querySelector('.main-tabs')).toBeNull();
  });
});
