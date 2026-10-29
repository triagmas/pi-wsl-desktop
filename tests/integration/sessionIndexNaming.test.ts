/**
 * UI26 R01 — названия сессий и сортировка в индексе (#26).
 *
 * Pi остаётся источником истины: `session_info.name` имеет приоритет, первое
 * user-сообщение используется только когда имени нет, id — последний резерв.
 * Список сортируется по последней активности (mtime), а не по времени
 * создания: сессия, к которой только что обратились из CLI, поднимается вверх.
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSessionIndex, nodeFs } from '../../src/bridge/sessions';
import { TITLE_MAX } from '../../src/shared/sessionTitle';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'piwsd-name-'));
const ROOT = path.posix.join(tmp.replace(/\\/g, '/'), 'sessions');
const BUCKET = path.join(ROOT, '--p--');
mkdirSync(BUCKET, { recursive: true });

function header(id: string, cwd = '/p'): string {
  return `${JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-19T01:00:00.000Z', cwd })}\n`;
}
function userMsg(text: string): string {
  return `${JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: 'T', message: { role: 'user', content: text, timestamp: 1 } })}\n`;
}
function userMsgBlocks(text: string): string {
  return `${JSON.stringify({
    type: 'message',
    id: 'u1',
    parentId: null,
    timestamp: 'T',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 },
  })}\n`;
}
function info(name: string): string {
  return `${JSON.stringify({ type: 'session_info', id: 'n1', parentId: 'u1', timestamp: 'T', name })}\n`;
}

writeFileSync(path.join(BUCKET, 'named.jsonl'), header('id-named') + userMsg('Сообщение без веса') + info('Явное имя Pi'));
writeFileSync(path.join(BUCKET, 'derived.jsonl'), header('id-derived') + userMsg('\n  Починить   ленту\n'));
writeFileSync(path.join(BUCKET, 'blocks.jsonl'), header('id-blocks') + userMsgBlocks('Первое из блоков'));
writeFileSync(path.join(BUCKET, 'empty-chat.jsonl'), header('id-empty-chat') + info('   '));
writeFileSync(path.join(BUCKET, 'long.jsonl'), header('id-long') + userMsg('я'.repeat(400)));
writeFileSync(path.join(BUCKET, 'broken.jsonl'), header('id-broken') + '{"type":"message","id":"u1","message":{"role":"user","content":{"weird":true}}}\n');
writeFileSync(path.join(BUCKET, 'tool-first.jsonl'), header('id-tool-first') + `${JSON.stringify({ type: 'message', id: 't1', parentId: null, timestamp: 'T', message: { role: 'assistant', content: [{ type: 'text', text: 'сначала ассистент' }] } })}\n` + userMsg('Второе сообщение — первое пользовательское'));

// Порядок активности: named старее всех, tool-first — самый свежий.
const base = Date.parse('2026-10-19T10:00:00.000Z') / 1000;
utimesSync(path.join(BUCKET, 'named.jsonl'), base + 10, base + 10);
utimesSync(path.join(BUCKET, 'derived.jsonl'), base + 20, base + 20);
utimesSync(path.join(BUCKET, 'blocks.jsonl'), base + 30, base + 30);
utimesSync(path.join(BUCKET, 'empty-chat.jsonl'), base + 40, base + 40);
utimesSync(path.join(BUCKET, 'long.jsonl'), base + 50, base + 50);
utimesSync(path.join(BUCKET, 'broken.jsonl'), base + 60, base + 60);
utimesSync(path.join(BUCKET, 'tool-first.jsonl'), base + 70, base + 70);

const NOW = Date.parse('2026-10-19T12:00:00.000Z');

async function index() {
  const result = await buildSessionIndex({ fs: nodeFs, rootsOverride: [ROOT], env: {}, home: '/home/test', now: NOW, activeWindowMs: 1 });
  return result;
}

describe('именование сессий в индексе (#26)', () => {
  it('явное имя Pi имеет приоритет над первым сообщением', async () => {
    const { sessions } = await index();
    const s = sessions.find((x) => x.file.endsWith('named.jsonl'))!;
    expect(s.name).toBe('Явное имя Pi');
    expect(s.displayName).toBe('Явное имя Pi');
    expect(s.displayNameSource).toBe('pi');
  });

  it('без имени заголовком становится первое user-сообщение (очищенное)', async () => {
    const { sessions } = await index();
    const s = sessions.find((x) => x.file.endsWith('derived.jsonl'))!;
    expect(s.name).toBeNull();
    expect(s.displayName).toBe('Починить ленту');
    expect(s.displayNameSource).toBe('firstUser');
  });

  it('сообщение из блоков контента тоже читается', async () => {
    const { sessions } = await index();
    expect(sessions.find((x) => x.file.endsWith('blocks.jsonl'))!.displayName).toBe('Первое из блоков');
  });

  it('пустое имя Pi (пробелы) откатывается к первому сообщению/id', async () => {
    const { sessions } = await index();
    const s = sessions.find((x) => x.file.endsWith('empty-chat.jsonl'))!;
    expect(s.displayNameSource).not.toBe('pi');
    expect(s.displayName).toBe('id-empty');
  });

  it('длинное первое сообщение обрезается по TITLE_MAX', async () => {
    const { sessions } = await index();
    const name = sessions.find((x) => x.file.endsWith('long.jsonl'))!.displayName;
    expect([...name]).toHaveLength(TITLE_MAX);
    expect(name.endsWith('…')).toBe(true);
  });

  it('битая запись не ломает индекс — остаётся id', async () => {
    const { sessions } = await index();
    const s = sessions.find((x) => x.file.endsWith('broken.jsonl'))!;
    expect(s.displayNameSource).toBe('id');
    expect(s.displayName.length).toBeGreaterThan(0);
  });

  it('ищется первое ПОЛЬЗОВАТЕЛЬСКОЕ сообщение, а не первая запись', async () => {
    const { sessions } = await index();
    const s = sessions.find((x) => x.file.endsWith('tool-first.jsonl'))!;
    expect(s.displayName).toBe('Второе сообщение — первое пользовательское');
  });

  it('поле name не подменяется производным заголовком (контракт bridge сохранён)', async () => {
    const { sessions } = await index();
    for (const s of sessions) {
      if (s.displayNameSource === 'firstUser' || s.displayNameSource === 'id') expect(s.name).toBeNull();
    }
  });
});

describe('сортировка по последней активности (#26)', () => {
  it('самый свежий файл — первым, самый старый — последним', async () => {
    const { sessions } = await index();
    expect(sessions[0].file.endsWith('tool-first.jsonl')).toBe(true);
    expect(sessions[sessions.length - 1].file.endsWith('named.jsonl')).toBe(true);
  });

  it('порядок строго по убыванию updatedAt', async () => {
    const { sessions } = await index();
    const times = sessions.map((s) => Date.parse(s.updatedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
