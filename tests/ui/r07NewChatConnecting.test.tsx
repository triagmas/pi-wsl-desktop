/**
 * R07 P2 (#38) — «Новый диалог» во время подключения сессии.
 *
 * Воспроизведение из Issue #38: пока Pi поднимает RPC (`status: 'opening'`),
 * подтверждение «Закрыть чат и создать новый» раньше молча ждало ответа: ни
 * видимого статуса, ни ошибки. Требование — видимая обратная связь и
 * предсказуемый результат:
 *   1) нажатие подтверждения сразу показывает, что текущий чат закрывается;
 *   2) ошибка закрытия показывается явно и подтверждение можно повторить;
 *   3) после завершения подключения новый диалог действительно создаётся.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { DesktopApi } from '../../src/renderer/api';
import { READY_SNAPSHOT } from './helpers/shellApi';

const PROJECT = { id: '/p/alpha', name: 'alpha', path: '/p/alpha', sessionCount: 0, updatedAt: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  api: DesktopApi;
  methods: () => string[];
  countOf: (method: string) => number;
  /** Первый `newSession`: держим открытым, пока тест не отпустит «подключение». */
  releaseOpen: () => void;
  /** `closeSession`: держим открытым, пока тест не отпустит закрытие. */
  releaseClose: () => void;
  openGate: Promise<void>;
  closeGate: Promise<void>;
}

function harness(opts: { closeError?: string } = {}): Harness {
  const calls: string[] = [];
  const openGate = deferred<void>();
  const closeGate = deferred<void>();
  let newSessionCalls = 0;
  const state = (sessionFile: string | null) => ({
    sessionId: 'x',
    sessionFile,
    isStreaming: false,
    isCompacting: false,
    messageCount: 0,
    model: null,
    thinkingLevel: 'off',
  });

  const api = {
    request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push(method);
      if (method === 'listProjects') return { projects: [PROJECT], diagnostics: [] };
      if (method === 'listSessions') return { sessions: [], diagnostics: [] };
      if (method === 'getAvailableModels') return { models: [] };
      if (method === 'getThinkingLevels') return { levels: [], current: null };
      if (method === 'newSession') {
        newSessionCalls += 1;
        if (newSessionCalls === 1) await openGate.promise; // «Подключение к сессии…»
        const file = `/roots/--p-alpha--/draft-${newSessionCalls}.jsonl`;
        return { state: state(file), sessionFile: file, materialized: false };
      }
      if (method === 'openSession') {
        const file = String(params?.file ?? '');
        return { state: state(file) };
      }
      if (method === 'closeSession') {
        await closeGate.promise;
        if (opts.closeError) throw new Error(opts.closeError);
        return { closed: true };
      }
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

  return {
    api,
    methods: () => calls,
    countOf: (m: string) => calls.filter((c) => c === m).length,
    releaseOpen: () => openGate.resolve(),
    releaseClose: () => closeGate.resolve(),
    openGate: openGate.promise,
    closeGate: closeGate.promise,
  };
}

let harnessApi: Harness;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
  harnessApi = harness();
});

describe('#38 «Новый диалог» во время подключения', () => {
  it('подтверждение во время connecting сразу показывает, что чат закрывается', async () => {
    const user = userEvent.setup();
    render(<App api={harnessApi.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-new-/p/alpha'));
    expect(await screen.findByTestId('chat-opening')).toBeInTheDocument();

    // Пока подключение идёт, пользователь просит новый диалог.
    const globalNewChat = document.querySelector('.dl-newchat') as HTMLButtonElement;
    await user.click(globalNewChat);
    expect(await screen.findByTestId('new-chat-guard')).toBeInTheDocument();

    await user.click(screen.getByTestId('new-chat-confirm'));
    // RED до фикса: здесь не было ни статуса, ни ошибки — «кнопка не работает».
    expect(await screen.findByTestId('new-chat-closing')).toBeInTheDocument();
    expect(screen.getByTestId('new-chat-confirm')).toBeDisabled();
    expect(screen.getByTestId('new-chat-cancel')).toBeDisabled();

    // Подключение завершилось, затем закрытие — новый диалог создан.
    harnessApi.releaseOpen();
    await Promise.resolve();
    harnessApi.releaseClose();
    await waitFor(() => expect(harnessApi.countOf('newSession')).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('new-chat-guard')).toBeNull());
  });

  it('ошибка закрытия видима и подтверждение можно повторить', async () => {
    harnessApi = harness({ closeError: 'RESOURCE_BUSY: Диалог уже создаётся — дождитесь ответа Pi' });
    // Сразу отпускаем подключение: проверяем именно неуспешное закрытие.
    harnessApi.releaseOpen();
    const user = userEvent.setup();
    render(<App api={harnessApi.api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('project-new-/p/alpha'));
    await waitFor(() => expect(harnessApi.countOf('newSession')).toBe(1));

    const globalNewChat = document.querySelector('.dl-newchat') as HTMLButtonElement;
    await user.click(globalNewChat);
    await screen.findByTestId('new-chat-guard');
    harnessApi.releaseClose();
    await user.click(screen.getByTestId('new-chat-confirm'));

    // RED до фикса: fail-closed завершался молча, баннер не менялся.
    expect(await screen.findByTestId('new-chat-error')).toHaveTextContent(/RESOURCE_BUSY|не удалось/i);
    expect(screen.getByTestId('new-chat-confirm')).toBeEnabled();
    expect(screen.getByTestId('new-chat-guard')).toBeInTheDocument();
    // Повторная попытка — новый RPC closeSession, без тихого «ничего».
    await user.click(screen.getByTestId('new-chat-confirm'));
    await waitFor(() => expect(harnessApi.countOf('closeSession')).toBe(2));
  });
});
