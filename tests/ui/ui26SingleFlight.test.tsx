/**
 * UI26 R03 — конкурентное создание и отложенная материализация (#26).
 *
 * P1-1: два одновременных вызова не должны создавать два RPC-процесса
 *       (single-flight, слот резервируется до первого await).
 * P1-3: Pi может создать JSONL уже ПОСЛЕ ACK отправки — приложение обязано
 *       увидеть реальный файл и превратить черновик в настоящую сессию.
 */
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useChat } from '../../src/renderer/useChat';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };
const NEW_FILE = '/roots/--p--/new.jsonl';
const FILE_B = '/roots/--p--/b.jsonl';
const CWD = '/p/alpha';

function makeApi(opts: { newSessionDelayMs?: number; existsAfter?: number } = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let exists = 0;
  // Что bridge реально «держит» и существует ли файл — тест управляет этим,
  // как настоящий bridge после смены диалога.
  const bridge = { file: NEW_FILE as string | null, fileExists: false };
  const state = (sessionFile: string | null) => ({
    sessionId: 'sid',
    sessionFile,
    isStreaming: false,
    isCompacting: false,
    messageCount: 0,
    model: null,
    thinkingLevel: 'off',
  });
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    switch (method) {
      case 'newSession': {
        if (opts.newSessionDelayMs) await new Promise((r) => setTimeout(r, opts.newSessionDelayMs));
        return { state: state(NEW_FILE), sessionFile: NEW_FILE, materialized: false };
      }
      case 'openSession':
        return { state: state(String(params?.file)) };
      case 'sendPrompt':
        return { disposition: 'started', sessionFile: NEW_FILE, sessionId: 'sid', materialized: false };
      case 'getState': {
        exists += 1;
        const fileExists = opts.existsAfter === undefined ? bridge.fileExists : exists > opts.existsAfter;
        return { state: state(bridge.file), sessionFileExists: fileExists };
      }
      case 'closeSession':
        return { closed: true };
      case 'getAvailableModels':
        return { models: [] };
      case 'getThinkingLevels':
        return { levels: ['off'], current: 'off' };
      default:
        return {};
    }
  });
  const api: DesktopApi = {
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
  } as DesktopApi;
  return { api, calls, bridge, countOf: (m: string) => calls.filter((c) => c.method === m).length };
}

const created: Array<{ file: string; materialized: boolean }> = [];

function DraftProbe({ api, onCreated }: { api: DesktopApi; onCreated: (f: string, i: { materialized: boolean }) => void }) {
  const chat = useChat(api, '', { key: 'draft:d1', cwd: CWD, onSessionCreated: onCreated });
  return (
    <div>
      <button type="button" data-testid="open-twice" onClick={() => void Promise.all([chat.open(), chat.open()])}>
        открыть дважды
      </button>
      <button type="button" data-testid="send-one" onClick={() => void chat.send('привет')}>
        отправить
      </button>
      <span data-testid="status">{chat.state.status}</span>
      <span data-testid="entries">{chat.state.entries.length}</span>
    </div>
  );
}

describe('UI26 R03 P1-1 / P1-3', () => {
  it('два одновременных open() на черновике создают РОВНО одну сессию', async () => {
    created.length = 0;
    const h = makeApi({ newSessionDelayMs: 60 });
    const onCreated = (f: string, i: { materialized: boolean }) => created.push({ file: f, materialized: i.materialized });
    render(<DraftProbe api={h.api} onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-twice'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('open'));
    expect(h.countOf('newSession')).toBe(1);
    expect(created).toHaveLength(1);
  });

  it('отложенная материализация после ACK превращает черновик в сессию', async () => {
    created.length = 0;
    // Первые два опроса файла ещё нет, затем Pi его записал.
    const h = makeApi({ existsAfter: 2 });
    const onCreated = (f: string, i: { materialized: boolean }) => created.push({ file: f, materialized: i.materialized });
    render(<DraftProbe api={h.api} onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('send-one'));

    await waitFor(
      () => {
        expect(created.some((c) => c.materialized)).toBe(true);
      },
      { timeout: 12_000 },
    );
    expect(h.countOf('getState')).toBeGreaterThan(2);
    // Файл появляется сам по себе — приложение его не пишет, только читает.
    expect(h.countOf('newSession')).toBe(1);
  });
});

/** Черновик A, который можно «переключить» на существующую сессию B. */
function SwitchProbe({ api, onCreated }: { api: DesktopApi; onCreated: (f: string, i: { materialized: boolean }) => void }) {
  const [file, setFile] = useState('');
  const key = file === '' ? 'draft:d1' : `file:${file}`;
  const chat = useChat(api, file, { key, cwd: CWD, onSessionCreated: onCreated });
  return (
    <div>
      <button type="button" data-testid="send" onClick={() => void chat.send('привет')}>
        отправить
      </button>
      <button
        type="button"
        data-testid="go-b"
        onClick={async () => {
          await chat.closeChat();
          setFile(FILE_B);
        }}
      >
        на B
      </button>
      <span data-testid="status">{chat.state.status}</span>
    </div>
  );
}

describe('UI26 R04 P1 — материализация не должна принадлежать чужой сессии', () => {
  it('A ждёт файл → переход на B: A НЕ материализуется по чужому sessionFile', async () => {
    created.length = 0;
    const h = makeApi();
    const onCreated = (f: string, i: { materialized: boolean }) => created.push({ file: f, materialized: i.materialized });
    render(<SwitchProbe api={h.api} onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('send'));

    // Пока A жив, файла нет (newSession + ACK сообщают materialized:false).
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((c) => c.file === NEW_FILE && !c.materialized)).toBe(true);

    // Переход на существующий B: bridge теперь отвечает sessionFile=B и «файл есть».
    await user.click(screen.getByTestId('go-b'));
    h.bridge.file = FILE_B;
    h.bridge.fileExists = true;

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('closed'), { timeout: 4000 });
    // Опрос A должен прекратиться, а чужой файл — не «материализовать» A.
    await new Promise((r) => setTimeout(r, 1200));
    expect(created.filter((c) => c.materialized)).toEqual([]);
    expect(created.filter((c) => c.file === FILE_B)).toEqual([]);
  });

  it('позднее создание СВОЕГО файла A всё равно подтверждается', async () => {
    created.length = 0;
    const h = makeApi({ existsAfter: 2 });
    const onCreated = (f: string, i: { materialized: boolean }) => created.push({ file: f, materialized: i.materialized });
    render(<SwitchProbe api={h.api} onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('send'));
    await waitFor(() => expect(created.some((c) => c.materialized && c.file === NEW_FILE)).toBe(true), { timeout: 12_000 });
  });
});
