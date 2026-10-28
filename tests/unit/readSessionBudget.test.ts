/**
 * RED gate UI21 F1-B R03 (P1) — readSession обязан:
 *
 * 1) НИКОГДА не отдавать страницу больше `MAX_READ_RESULT_BYTES` (иначе кадр
 *    превышает MAX_FRAME_BYTES, кодировщик бросает, bridge выходит с кодом 1 и
 *    приложение «теряет» историю целиком);
 * 2) уметь идти ОБРАТНО от конца файла (`direction:'backward'`), чтобы после
 *    перезапуска показывать последние сообщения, а не самый старый абзац;
 * 3) не вставать намертво, если одна запись больше бюджета целиком.
 */
import { describe, expect, it } from 'vitest';
import { readSessionFile } from '../../src/bridge/sessionReader';
import { MAX_READ_RESULT_BYTES } from '../../src/shared/m1Protocol';
import type { DirEntry, FileMeta, FsLike } from '../../src/bridge/sessions';

function filesFs(files: Record<string, string>): FsLike {
  const fs: FsLike = {
    async readdir(): Promise<DirEntry[]> {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    async stat(p: string): Promise<FileMeta> {
      const c = files[p];
      if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return { size: Buffer.byteLength(c), mtimeMs: 1_700_000_000_000 };
    },
    async readHead(p, max) {
      return Buffer.from(files[p] ?? '').subarray(0, max).toString('utf8');
    },
    async readTail(p, max) {
      const b = Buffer.from(files[p] ?? '');
      return b.subarray(Math.max(0, b.length - max)).toString('utf8');
    },
    async readRange(p, offset, length) {
      return Buffer.from(files[p] ?? '').subarray(offset, offset + length);
    },
  };
  return fs;
}

const FILE = '/s/big.jsonl';
const header = (id = 'sess-1') =>
  JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-28T09:00:00.000Z', cwd: '/w' });

/** Запись с управляемым размером raw: text длиной `pad`. */
const entry = (id: string, role: 'user' | 'assistant', pad: number, parentId: string | null = null) =>
  JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-10-28T09:00:01.000Z',
    message: { role, content: [{ type: 'text', text: `${id}:${'x'.repeat(pad)}` }] },
  });

const totalBytes = (entries: Array<{ raw: unknown }>) =>
  entries.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e), 'utf8'), 0);

describe('readSessionFile — бюджет ответа (UI21 F1-B R03, P1)', () => {
  it('обрезает страницу по БАЙТАМ, а не только по числу записей', async () => {
    // 40 записей × ~40 КБ ≈ 1.6 МиБ — один limit:100 кадр превысил бы 1 МиБ.
    const rows = [header()];
    const ids: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const id = `m${String(i).padStart(3, '0')}`;
      ids.push(id);
      rows.push(entry(id, i % 2 === 0 ? 'user' : 'assistant', 40_000, i === 0 ? null : ids[i - 1]));
    }
    const fs = filesFs({ [FILE]: rows.join('\n') + '\n' });
    const first = await readSessionFile({ fs, file: FILE, limit: 100 });

    expect(first.entries.length).toBeGreaterThan(0);
    expect(first.entries.length).toBeLessThan(40); // обрезано бюджетом
    expect(totalBytes(first.entries)).toBeLessThanOrEqual(MAX_READ_RESULT_BYTES);
    expect(first.truncated).toBe(true);

    // Курсор двигается, следующая страница тоже влезает в бюджет.
    expect(first.nextCursor).toBe(first.entries[first.entries.length - 1]?.id ?? null);
    const second = await readSessionFile({ fs, file: FILE, limit: 100, sinceEntryId: first.nextCursor ?? undefined });
    expect(second.entries.length).toBeGreaterThan(0);
    expect(totalBytes(second.entries)).toBeLessThanOrEqual(MAX_READ_RESULT_BYTES);
    expect(second.entries[0]?.id).not.toBe(first.entries[0]?.id);
  });

  it('длинные id/parentId в raw не выносят страницу за бюджет (оценка — верхняя граница)', async () => {
    // `raw` — исходная строка JSONL, поэтому id/parentId/timestamp уже входят в
    // JSON.stringify(raw); обёртка записи добавляет лишь единицы байт. Тест
    // фиксирует, что страница из 500 записей с UUID-полями всё равно режется
    // бюджетом, а не лимитом записей.
    const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const rows = [header()];
    for (let i = 0; i < 500; i += 1) {
      rows.push(
        JSON.stringify({
          type: 'message',
          id: uuid(i),
          parentId: i === 0 ? null : uuid(i - 1),
          timestamp: '2026-10-28T09:00:01.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'q'.repeat(1_500) }] },
        }),
      );
    }
    const fs = filesFs({ [FILE]: rows.join('\n') + '\n' });
    const page = await readSessionFile({ fs, file: FILE, limit: 500 });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(totalBytes(page.entries)).toBeLessThanOrEqual(MAX_READ_RESULT_BYTES);
    // Страница действительно режется бюджетом, а не лимитом записей.
    expect(page.entries.length).toBeLessThan(500);
  });

  it('пропускает запись, которая одна больше бюджета, и не встаёт намертво', async () => {
    const huge = 'y'.repeat(900_000); // ~900 КБ raw + обвязка > бюджета… но < MAX_FRAME
    const rows = [
      header(),
      entry('m1', 'user', 10, null),
      JSON.stringify({
        type: 'message',
        id: 'huge',
        parentId: 'm1',
        timestamp: '2026-10-28T09:00:02.000Z',
        message: { role: 'toolResult', content: [{ type: 'text', text: huge }] },
      }),
      entry('m3', 'assistant', 10, 'huge'),
    ];
    const fs = filesFs({ [FILE]: rows.join('\n') + '\n' });
    const first = await readSessionFile({ fs, file: FILE, limit: 100 });
    // Страница заканчивается ПЕРЕД великаном: он придёт курсором следующей.
    expect(first.entries.map((e) => e.id)).toEqual(['m1']);
    expect(first.nextCursor).toBe('m1');

    // Вторая страница начинается с великана: он пропускается с диагностикой,
    // курсор идёт ЗА него — страница не зацикливается.
    const second = await readSessionFile({ fs, file: FILE, limit: 100, sinceEntryId: 'm1' });
    expect(second.entries.map((e) => e.id)).toEqual(['m3']);
    expect(second.diagnostics.some((d) => d.error.includes('MAX_READ_RESULT_BYTES'))).toBe(true);
  });
});

describe('readSessionFile — обратная пагинация от конца файла (UI21 F1-B R03)', () => {
  const build = (n: number) => {
    const rows = [header()];
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = `m${String(i).padStart(3, '0')}`;
      ids.push(id);
      rows.push(entry(id, i % 2 === 0 ? 'user' : 'assistant', 200, i === 0 ? null : ids[i - 1]));
    }
    return { text: rows.join('\n') + '\n', ids };
  };

  it('direction=backward отдаёт САМЫЕ НОВЫЕ записи в хронологическом порядке', async () => {
    const { text, ids } = build(250);
    const fs = filesFs({ [FILE]: text });
    const page = await readSessionFile({ fs, file: FILE, limit: 100, direction: 'backward' });

    expect(page.entries).toHaveLength(100);
    expect(page.entries.map((e) => e.id)).toEqual(ids.slice(150));
    expect(page.atStart).toBe(false);
    expect(page.prevCursor).toBe(ids[150]);
  });

  it('beforeEntryId доходит до начала файла и выставляет atStart', async () => {
    const { text, ids } = build(250);
    const fs = filesFs({ [FILE]: text });
    const tail = await readSessionFile({ fs, file: FILE, limit: 100, direction: 'backward' });
    const middle = await readSessionFile({
      fs,
      file: FILE,
      limit: 100,
      direction: 'backward',
      beforeEntryId: tail.prevCursor ?? undefined,
    });
    expect(middle.entries.map((e) => e.id)).toEqual(ids.slice(50, 150));
    expect(middle.atStart).toBe(false);

    const head = await readSessionFile({
      fs,
      file: FILE,
      limit: 100,
      direction: 'backward',
      beforeEntryId: middle.prevCursor ?? undefined,
    });
    expect(head.entries.map((e) => e.id)).toEqual(ids.slice(0, 50));
    expect(head.atStart).toBe(true);
  });

  it('обратная страница тоже режется бюджетом — сохраняется САМОЕ НОВОЕ', async () => {
    const rows = [header()];
    for (let i = 0; i < 40; i += 1) {
      rows.push(entry(`m${String(i).padStart(3, '0')}`, 'assistant', 40_000, i === 0 ? null : `m${String(i - 1).padStart(3, '0')}`));
    }
    const fs = filesFs({ [FILE]: rows.join('\n') + '\n' });
    const page = await readSessionFile({ fs, file: FILE, limit: 100, direction: 'backward' });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.length).toBeLessThan(40);
    expect(totalBytes(page.entries)).toBeLessThanOrEqual(MAX_READ_RESULT_BYTES);
    // Именно ХВОСТ файла: последняя запись страницы — последняя в файле.
    expect(page.entries[page.entries.length - 1]?.id).toBe('m039');
  });

  it('legacy v1 без id: обратная пагинация идёт по позиционному курсору L<line>', async () => {
    // v1: ни id, ни parentId — курсор обязан быть позиционным, иначе «раньше»
    // недостижимо на старых файлах (регресс из review round 3 сохраняется).
    const lines = [JSON.stringify({ type: 'session', version: 1, id: 'legacy', timestamp: '2026-10-28T09:00:00.000Z', cwd: '/w' })];
    for (let i = 0; i < 30; i += 1) {
      lines.push(JSON.stringify({ type: 'message', message: { role: i % 2 === 0 ? 'user' : 'assistant', content: `legacy ${i}` } }));
    }
    const fs = filesFs({ [FILE]: lines.join('\n') + '\n' });
    const tail = await readSessionFile({ fs, file: FILE, limit: 10, direction: 'backward' });
    expect(tail.entries).toHaveLength(10);
    expect(tail.entries[tail.entries.length - 1]?.raw).toMatchObject({ message: { content: 'legacy 29' } });
    expect(tail.prevCursor).toMatch(/^L\d+$/);
    expect(tail.atStart).toBe(false);

    const older = await readSessionFile({ fs, file: FILE, limit: 10, direction: 'backward', beforeEntryId: tail.prevCursor ?? undefined });
    expect(older.entries).toHaveLength(10);
    expect(older.entries[older.entries.length - 1]?.raw).toMatchObject({ message: { content: 'legacy 19' } });
    expect(older.prevCursor).toMatch(/^L\d+$/);
  });

  it('неизвестный обратный курсор → диагностика, без молчаливого дампа всего файла', async () => {
    const { text } = build(10);
    const fs = filesFs({ [FILE]: text });
    const page = await readSessionFile({ fs, file: FILE, limit: 100, direction: 'backward', beforeEntryId: 'nope' });
    expect(page.entries).toEqual([]);
    expect(page.diagnostics.some((d) => d.error.includes('cursor not found'))).toBe(true);
  });
});

describe('encodeFrameOrError — превышение кадра не убивает bridge (UI21 F1-B R03, P1)', () => {
  it('огромный ответ превращается в bounded PROTOCOL_ERROR для того же requestId', async () => {
    const { encodeFrame, encodeFrameOrError } = await import('../../src/shared/protocol');
    const frame = {
      v: 1 as const,
      type: 'response' as const,
      requestId: 'req-1',
      status: 'ok' as const,
      result: { blob: 'z'.repeat(1_200_000) },
    };
    expect(() => encodeFrame(frame)).toThrow(/exceeds MAX_FRAME_BYTES/);

    const safe = encodeFrameOrError(frame);
    expect(Buffer.byteLength(safe, 'utf8')).toBeLessThan(4096);
    const parsed = JSON.parse(safe) as { type: string; status?: string; requestId?: string; error?: { code?: string } };
    expect(parsed.type).toBe('response');
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.status).toBe('error');
    expect(parsed.error?.code).toBe('PROTOCOL_ERROR');
  });
});
