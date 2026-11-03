/**
 * UI26-A2 — визуальная правка после приёмки A1 (Issue #26 #6521586714).
 *
 * Контракт:
 * 1. правая панель на узком окне остаётся overlay, но её можно закрыть
 *    Escape, и фокус возвращается на единственный тумблер (второго не добавляем);
 * 2. заголовок панели — то же пользовательское имя, что в breadcrumb, а не
 *    технический id сессии;
 * 3. служебная модель-заглушка Pi (`unknown/unknown`) не выдаётся за реальную;
 * 4. баннеры единственного writer'а имеют собственные стили, а центр не уходит
 *    под overlay-панель на узком окне (защита от «невидимых» контролов).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

const FILE = '/home/u/.pi/agent/sessions/--p--/s1.jsonl';

const PROJECTS = {
  projects: [{ id: 'p', path: '/tmp/p', sessionCount: 1, lastActivityAt: '2026-01-01T00:00:00.000Z' }],
  diagnostics: [] as string[],
};
const SESSIONS = {
  sessions: [
    {
      id: 's1',
      file: FILE,
      root: '/home/u/.pi/agent/sessions',
      projectId: 'p',
      projectPath: '/tmp/p',
      name: 's1',
      displayName: 'Разговор о ленте',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sizeBytes: 120,
      version: 3,
      availability: 'ok' as const,
      activeWrite: false,
      diagnostics: null,
    },
  ],
  diagnostics: [] as string[],
};
const PAGE = {
  entries: [
    { id: 'h1', type: 'message', raw: { type: 'message', message: { role: 'user', content: 'сохранённый вопрос' } } },
    {
      id: 'h2',
      type: 'message',
      raw: { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'сохранённый ответ' }] } },
    },
  ],
  diagnostics: [] as string[],
  truncated: false,
  partialTrailing: false,
  nextCursor: null,
};

/** Pi отдаёт служебную модель-заглушку, когда провайдер не выбран. */
function makeSessionApi(model: { provider: string; id: string } | null = null) {
  const api = makeApi();
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'listProjects') return PROJECTS;
    if (method === 'listSessions') return SESSIONS;
    if (method === 'readSession') return PAGE;
    if (method === 'openSession' || method === 'attachSession')
      return { state: { model, thinkingLevel: null, session: params?.file ?? FILE } };
    if (method === 'getAvailableModels') return { models: [] };
    if (method === 'getThinkingLevels') return { levels: [] };
    return { ok: true };
  });
  const onChatEvent = vi.fn(() => () => undefined);
  return { ...api, request, onChatEvent } as typeof api;
}

async function openSession(user: ReturnType<typeof userEvent.setup>) {
  const search = await screen.findByLabelText(/поиск чатов/i);
  await user.type(search, 's1');
  await user.click(await screen.findByTestId('session-s1'));
  await screen.findByTestId('session-detail');
}

describe('UI26-A2 — overlay правой панели', () => {
  it('Escape закрывает панель и возвращает фокус на единственный тумблер', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const toggle = screen.getByTestId('open-details');
    await user.click(toggle);
    expect(screen.getByTestId('right-sidebar')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('open-details')).toHaveFocus();
    // второго тумблера внутри панели по-прежнему нет (R07 §1)
    expect(screen.queryByTestId('close-details')).not.toBeInTheDocument();
  });

  it('при открытии фокус уходит в колонку деталей', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('open-details'));
    const aside = screen.getByTestId('right-sidebar').closest('aside');
    expect(aside).not.toBeNull();
    expect(aside).toHaveAttribute('tabindex', '-1');
    expect(aside).toHaveFocus();
  });
});

describe('UI26-A2 — заголовок панели', () => {
  it('использует пользовательское имя из breadcrumb, а не технический id', async () => {
    const user = userEvent.setup();
    render(<App api={makeSessionApi()} moduleDefinitions={[]} />);
    await openSession(user);
    const crumbLabel = document.querySelector('.dl-crumb strong')?.textContent ?? '';
    expect(crumbLabel).toBe('Разговор о ленте');

    await user.click(screen.getByTestId('open-details'));
    const panel = screen.getByTestId('right-sidebar');
    expect(panel.textContent).toContain(crumbLabel);
    // технический id не должен подменять пользовательское имя
    expect(panel.textContent).not.toContain(FILE);
  });
});

describe('UI26-A2 — модель из Pi', () => {
  it('служебная модель unknown/unknown не показывается как реальная', async () => {
    const user = userEvent.setup();
    render(<App api={makeSessionApi({ provider: 'unknown', id: 'unknown' })} moduleDefinitions={[]} />);
    await openSession(user);
    const notice = document.querySelector('[data-testid="chat-open-notice"] button');
    if (notice) await user.click(notice);
    const chip = await screen.findByTestId('model-selector');
    expect(chip.textContent).not.toContain('unknown/unknown');
    expect(chip.textContent).toContain('Нет моделей');
  });

  it('реальная модель из Pi показывается как provider/id', async () => {
    const user = userEvent.setup();
    render(<App api={makeSessionApi({ provider: 'prov', id: 'model-x' })} moduleDefinitions={[]} />);
    await openSession(user);
    const notice = document.querySelector('[data-testid="chat-open-notice"] button');
    if (notice) await user.click(notice);
    const chip = await screen.findByTestId('model-selector');
    expect(chip.textContent).toContain('prov/model-x');
  });
});

describe('UI26-A2 — стили guard-баннеров и overlay', () => {
  const css = (...parts: string[]) => readFileSync(resolve(process.cwd(), 'src/renderer', ...parts), 'utf8');

  it('баннеры writer-guard имеют собственные правила и акцентное подтверждение', () => {
    const index = css('index.css');
    expect(index).toMatch(/\.switch-guard\s*\{/);
    expect(index).toMatch(/\.switch-guard-actions\s*\{/);
    expect(index).toMatch(/\.switch-guard-actions button\s*\{/);
    expect(index).toMatch(/\[data-testid\$='-confirm'\]/);
  });

  it('на узком окне центр резервирует ширину overlay-панели', () => {
    const layout = css('design', 'layout.css');
    expect(layout).toMatch(
      /\.dl-frame\[data-layout="app"\]\[data-details="on"\]\s+\.dl-main\s*\{\s*padding-right:\s*min\(var\(--dl-app-details-w\),\s*84vw\)/,
    );
  });
});
