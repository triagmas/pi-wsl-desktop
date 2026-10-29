/**
 * UI26 R02 — `+` у каждого проекта (#26).
 *
 * Требования владельца: кнопка непосредственно возле проекта, БЕЗ вложенного
 * <button> (невалидный HTML и неработающий фокус), черновик создаётся именно в
 * cwd выбранного проекта, доступное имя, утверждённая композиция не переписана.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { DesktopApi } from '../../src/renderer/api';
import { READY_SNAPSHOT } from './helpers/shellApi';

const ALPHA = { id: '/p/alpha', name: 'alpha', path: '/p/alpha', sessionCount: 0, updatedAt: null };
const BETA = { id: '/p/beta', name: 'beta', path: '/p/beta', sessionCount: 0, updatedAt: null };

function harness() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const api = {
    request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'listProjects') return { projects: [ALPHA, BETA], diagnostics: [] };
      if (method === 'listSessions') return { sessions: [], diagnostics: [] };
      if (method === 'newSession') {
        return {
          state: { sessionId: 's', sessionFile: `/roots/--${String(params?.cwd)}--/new.jsonl`, isStreaming: false, isCompacting: false, messageCount: 0, model: null, thinkingLevel: 'off' },
          sessionFile: `/roots/new.jsonl`,
          materialized: false,
        };
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
  return { api, calls };
}

describe('#26 `+` у проекта', () => {
  it('у каждого проекта есть отдельная кнопка `+` рядом со строкой проекта', async () => {
    const h = harness();
    render(<App api={h.api} moduleDefinitions={[]} />);
    expect(await screen.findByTestId('project-/p/alpha')).toBeInTheDocument();
    const plusAlpha = await screen.findByTestId('project-new-/p/alpha');
    const plusBeta = await screen.findByTestId('project-new-/p/beta');
    expect(plusAlpha).toBeInTheDocument();
    expect(plusBeta).toBeInTheDocument();
    // Отдельная кнопка, а НЕ вложенная в кнопку проекта.
    expect(plusAlpha.closest('button')).toBe(plusAlpha);
    expect(screen.getByTestId('project-/p/alpha').contains(plusAlpha)).toBe(false);
    // Доступное имя содержит проект — понятно, куда именно создаётся диалог.
    expect(plusAlpha).toHaveAccessibleName(/alpha/i);
  });

  it('`+` создаёт черновик в cwd ИМЕННО этого проекта', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-new-/p/beta'));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'newSession')).toBe(true));
    expect(h.calls.find((c) => c.method === 'newSession')!.params).toEqual({ cwd: '/p/beta' });
    expect(await screen.findByTestId('draft-cwd')).toHaveAttribute('title', '/p/beta');
  });

  it('`+` доступна с клавиатуры (Enter) и не ломает сворачивание проекта', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<App api={h.api} moduleDefinitions={[]} />);
    const plus = await screen.findByTestId('project-new-/p/alpha');
    expect(plus.tagName).toBe('BUTTON');
    plus.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(h.calls.some((c) => c.method === 'newSession')).toBe(true));
    // Строка проекта остаётся управляемой своим собственным aria-expanded.
    expect(screen.getByTestId('project-/p/alpha')).toHaveAttribute('aria-expanded');
  });
});
