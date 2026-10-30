/**
 * UI26 R01 — per-session renderer state (#26).
 *
 * Правила контракта:
 *  - состояние, черновик, ошибки и события принадлежат КОНКРЕТНОМУ диалогу,
 *    а не «активному окну»;
 *  - поздние события чата A никогда не попадают в видимый чат B;
 *  - событие без ключа (старый bridge) относится к активному диалогу;
 *  - draft живёт без JSONL и мигрирует в файл после materialize.
 */
import { describe, expect, it } from 'vitest';
import {
  activate,
  activeState,
  bindDraft,
  createDraft,
  dropDraft,
  emptyStore,
  fileKey,
  getDraftText,
  isAnySending,
  recordEvent,
  restorableKey,
  setDraftText,
  stateOf,
} from '../../src/renderer/sessionChat';
import type { ChatEventT } from '../../src/renderer/types';

const A = fileKey('/sessions/a.jsonl');
const B = fileKey('/sessions/b.jsonl');

const textEnd = (key: string | undefined, text: string): ChatEventT =>
  ({ kind: 'pi', name: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text }] } }, ...(key ? { key } : {}) }) as ChatEventT;

const userSendStart = (key: string): ChatEventT =>
  ({ kind: 'opened', state: null, key }) as unknown as ChatEventT;

describe('activate / stateOf', () => {
  it('активация создаёт пустое состояние closed', () => {
    const s = activate(emptyStore(), A);
    expect(s.activeKey).toBe(A);
    expect(stateOf(s, A).status).toBe('closed');
    expect(stateOf(s, A).entries).toEqual([]);
  });

  it('повторная активация не стирает уже полученное состояние', () => {
    let s = activate(emptyStore(), A);
    s = recordEvent(s, textEnd(A, 'ответ A'));
    s = activate(s, B);
    s = activate(s, A);
    expect(stateOf(s, A).entries.map((e) => e.text)).toEqual(['ответ A']);
    expect(activeState(s).entries.map((e) => e.text)).toEqual(['ответ A']);
  });
});

describe('recordEvent — маршрутизация по ключу сессии', () => {
  it('событие активной сессии обновляет её', () => {
    let s = activate(emptyStore(), A);
    s = recordEvent(s, textEnd(A, 'привет'));
    expect(stateOf(s, A).entries).toHaveLength(1);
  });

  it('ПОЗДНЕЕ событие A при активной B не попадает в B (главный регресс #26)', () => {
    let s = activate(emptyStore(), A);
    s = activate(s, B);
    s = recordEvent(s, textEnd(A, 'хвост от A'));
    expect(stateOf(s, A).entries.map((e) => e.text)).toEqual(['хвост от A']);
    expect(stateOf(s, B).entries).toEqual([]);
    expect(activeState(s).entries).toEqual([]);
  });

  it('событие без ключа попадает в ЕДИНСТВЕННЫЙ живой диалог (не в активный по совпадению)', () => {
    // UI26 R03 (P1-2): даже ровно один живой диалог — НЕ доказательство
    // происхождения. Событие без ключа отбрасывается и считается.
    let s = activate(emptyStore(), A);
    s = recordEvent(s, { kind: 'opened', state: null, key: A } as ChatEventT); // A живой
    s = activate(s, B); // B просматривается, но RPC не открыт
    s = recordEvent(s, textEnd(undefined, 'без ключа'));
    expect(stateOf(s, A).entries).toEqual([]);
    expect(stateOf(s, B).entries).toEqual([]);
    expect(s.dropped).toBe(1);
  });

  it('событие без ключа при нуле живых диалогов отбрасывается', () => {
    let s = activate(emptyStore(), B);
    s = recordEvent(s, textEnd(undefined, 'без ключа'));
    expect(stateOf(s, B).entries).toEqual([]);
    expect(s.dropped).toBe(1);
  });

  it('событие неизвестной НЕактивной сессии отбрасывается и считается', () => {
    let s = activate(emptyStore(), A);
    s = recordEvent(s, textEnd(fileKey('/sessions/ghost.jsonl'), 'чужая сессия'));
    expect(activeState(s).entries).toEqual([]);
    expect(s.dropped).toBe(1);
  });

  it('событие неизвестной АКТИВНОЙ сессии применяется (сессия ещё не была открыта)', () => {
    let s = activate(emptyStore(), A);
    s = { ...s, byKey: {} };
    s = recordEvent(s, textEnd(A, 'первое'));
    expect(stateOf(s, A).entries.map((e) => e.text)).toEqual(['первое']);
  });
});

describe('состояние и ошибки принадлежат диалогу', () => {
  it('sent start A не делает B «отправляющим»', () => {
    let s = activate(emptyStore(), A);
    s = activate(s, B);
    s = recordEvent(s, userSendStart(A));
    expect(stateOf(s, A).status).toBe('open');
    expect(stateOf(s, B).status).toBe('closed');
  });

  it('closed-событие A не показывает баннер в B', () => {
    let s = activate(emptyStore(), A);
    s = activate(s, B);
    s = recordEvent(s, { kind: 'closed', code: 'DISCONNECTED', message: 'Pi exited', key: A } as ChatEventT);
    expect(stateOf(s, A).banner?.code).toBe('DISCONNECTED');
    expect(stateOf(s, B).banner).toBeNull();
  });

  it('isAnySending видит генерацию в неактивной сессии', () => {
    let s = activate(emptyStore(), A);
    s = activate(s, B);
    s = recordEvent(s, userSendStart(A));
    expect(isAnySending(s)).toBe(true);
  });
});

describe('черновики (drafts)', () => {
  it('черновик создаётся без файла и без записи', () => {
    const s = createDraft(emptyStore(), { id: 'd1', cwd: '/work/proj', now: 1000 });
    expect(s.activeKey).toBe('draft:d1');
    expect(s.drafts['draft:d1']).toEqual({ cwd: '/work/proj', createdAt: 1000 });
    expect(stateOf(s, 'draft:d1').entries).toEqual([]);
  });

  it('тексты черновиков независимы между диалогами', () => {
    let s = createDraft(emptyStore(), { id: 'd1', cwd: '/p', now: 1 });
    s = setDraftText(s, 'draft:d1', 'черновик один');
    s = createDraft(s, { id: 'd2', cwd: '/p', now: 2 });
    s = setDraftText(s, 'draft:d2', 'черновик два');
    expect(getDraftText(s, 'draft:d1')).toBe('черновик один');
    expect(getDraftText(s, 'draft:d2')).toBe('черновик два');
  });

  it('bindDraft переносит состояние и текст на файл и снимает draft', () => {
    let s = createDraft(emptyStore(), { id: 'd1', cwd: '/p', now: 1 });
    s = setDraftText(s, 'draft:d1', 'отправленный текст');
    s = recordEvent(s, textEnd('draft:d1', 'ответ Pi'));
    s = bindDraft(s, 'draft:d1', '/sessions/new.jsonl');
    expect(s.drafts['draft:d1']).toBeUndefined();
    expect(s.activeKey).toBe(fileKey('/sessions/new.jsonl'));
    expect(stateOf(s, fileKey('/sessions/new.jsonl')).entries.map((e) => e.text)).toEqual(['ответ Pi']);
    expect(getDraftText(s, 'draft:d1')).toBe('');
  });

  it('dropDraft ничего не оставляет и не трогает другие диалоги', () => {
    let s = activate(emptyStore(), A);
    s = recordEvent(s, textEnd(A, 'существующий'));
    s = createDraft(s, { id: 'd1', cwd: '/p', now: 1 });
    s = setDraftText(s, 'draft:d1', 'выброшенный');
    s = dropDraft(s, 'draft:d1');
    expect(s.drafts['draft:d1']).toBeUndefined();
    expect(s.byKey['draft:d1']).toBeUndefined();
    expect(s.activeKey).toBeNull();
    expect(stateOf(s, A).entries.map((e) => e.text)).toEqual(['существующий']);
  });
});

describe('restorableKey', () => {
  const sessions = [{ file: '/sessions/a.jsonl' }, { file: '/sessions/b.jsonl' }];

  it('возвращает сохранённый ключ, если файл реально есть в списке', () => {
    expect(restorableKey(A, sessions)).toBe(A);
  });

  it('неизвестный/удалённый файл не восстанавливается', () => {
    expect(restorableKey(fileKey('/sessions/gone.jsonl'), sessions)).toBeNull();
  });

  it('черновик не восстанавливается после перезапуска', () => {
    expect(restorableKey('draft:d1', sessions)).toBeNull();
  });

  it('пустое сохранение не восстанавливается', () => {
    expect(restorableKey(null, sessions)).toBeNull();
  });
});

describe('UI26 R02 — доказанная принадлежность событий', () => {
  const opened = (key: string): ChatEventT => ({ kind: 'opened', state: null, key }) as unknown as ChatEventT;
  const toolStart = (key: string | undefined, id: string): ChatEventT =>
    ({ kind: 'pi', name: 'tool_execution_start', data: { toolCallId: id, toolName: 'bash' }, ...(key ? { key } : {}) }) as ChatEventT;

  it('позднее tool-событие A не появляется в открытом B', () => {
    let s = activate(emptyStore(), A);
    s = recordEvent(s, opened(A));
    s = activate(s, B);
    s = recordEvent(s, opened(B));
    s = recordEvent(s, toolStart(A, 't1'));
    expect(stateOf(s, A).tools.map((t) => t.id)).toEqual(['t1']);
    expect(stateOf(s, B).tools).toEqual([]);
  });

  it('событие без ключа при ДВУХ живых диалогах не угадывается (dropped)', () => {
    let s = activate(emptyStore(), A);
    s = recordEvent(s, opened(A));
    s = activate(s, B);
    s = recordEvent(s, opened(B));
    s = recordEvent(s, textEnd(undefined, 'чья-то дельта'));
    expect(stateOf(s, A).entries).toEqual([]);
    expect(stateOf(s, B).entries).toEqual([]);
    expect(s.dropped).toBe(1);
  });

  it('reconnect: после closed события без ключа не воскрешают старый диалог', () => {
    let s = activate(emptyStore(), A);
    s = recordEvent(s, opened(A));
    s = recordEvent(s, { kind: 'closed', code: 'DISCONNECTED', message: 'Pi exited', key: A } as ChatEventT);
    s = recordEvent(s, textEnd(undefined, 'поздний хвост'));
    expect(stateOf(s, A).entries).toEqual([]);
    expect(s.dropped).toBe(1);
  });

  it('reconnect: после повторного открытия события ПРИХОДЯТ С КЛЮЧОМ', () => {
    // UI26 R03: bridge всегда штампует событие ключом своего RPC-соединения,
    // поэтому reconnect проверяется ключевым потоком, а keyless — отбрасывается.
    let s = activate(emptyStore(), A);
    s = recordEvent(s, opened(A));
    s = recordEvent(s, { kind: 'closed', code: 'DISCONNECTED', message: 'x', key: A } as ChatEventT);
    s = recordEvent(s, opened(A));
    s = recordEvent(s, textEnd(A, 'новый ответ'));
    expect(stateOf(s, A).entries.map((e) => e.text)).toEqual(['новый ответ']);
    s = recordEvent(s, textEnd(undefined, 'без ключа после reconnect'));
    expect(stateOf(s, A).entries.map((e) => e.text)).toEqual(['новый ответ']);
    expect(s.dropped).toBe(1);
  });

  it('draft→file: событие с ключом файла попадает в мигрировавший диалог', () => {
    let s = createDraft(emptyStore(), { id: 'd1', cwd: '/p', now: 1 });
    s = recordEvent(s, opened('draft:d1'));
    s = bindDraft(s, 'draft:d1', '/sessions/new.jsonl');
    s = recordEvent(s, textEnd(fileKey('/sessions/new.jsonl'), 'первый ответ'));
    expect(stateOf(s, fileKey('/sessions/new.jsonl')).entries.map((e) => e.text)).toEqual(['первый ответ']);
    expect(s.dropped).toBe(0);
    // А keyless после миграции всё равно отбрасывается.
    s = recordEvent(s, textEnd(undefined, 'безымянный'));
    expect(stateOf(s, fileKey('/sessions/new.jsonl')).entries).toHaveLength(1);
    expect(s.dropped).toBe(1);
  });

  it('draft отменён: осиротевшее keyless-событие не оседает нигде', () => {
    let s = createDraft(emptyStore(), { id: 'd1', cwd: '/p', now: 1 });
    s = recordEvent(s, opened('draft:d1'));
    s = dropDraft(s, 'draft:d1');
    s = recordEvent(s, textEnd(undefined, 'хвост отменённого'));
    expect(s.activeKey).toBeNull();
    expect(s.dropped).toBe(1);
  });
});
