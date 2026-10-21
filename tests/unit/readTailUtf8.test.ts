/**
 * M2 P2#3 TDD: the display-name tail is a BYTE window, not a character
 * window. Never emit U+FFFD just because the window began midway through
 * a UTF-8 code point. This must remain read-only for real session JSONL.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../src/bridge/sessions';

const paths: string[] = [];
async function file(bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'piwsd-tail-utf8-'));
  paths.push(dir);
  const f = path.join(dir, 'session.jsonl');
  await writeFile(f, bytes);
  return f;
}

afterEach(async () => {
  await Promise.all(paths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('nodeFs.readTail — UTF-8 boundary safety (M2 P2#3)', () => {
  it('discards incomplete leading UTF-8 sequence when window begins in an emoji', async () => {
    const info = JSON.stringify({ type: 'session_info', name: 'Проект 🚀 東京' }) + '\n';
    const bytes = Buffer.from('start🚀\n' + info);
    const f = await file(bytes);
    const offset = Buffer.byteLength('start', 'utf8') + 2; // midway through four-byte rocket
    const tail = await nodeFs.readTail(f, bytes.length - offset);
    expect(tail).toBe('\n' + info);
    expect(tail).not.toContain('\uFFFD');
  });

  it('keeps an aligned UTF-8 character and never changes source bytes or mtime', async () => {
    const text = 'prefix\nПривет мир 🚀\n';
    const bytes = Buffer.from(text);
    const f = await file(bytes);
    const beforeBytes = await readFile(f);
    const beforeStat = await stat(f);
    const offset = Buffer.byteLength('prefix\n', 'utf8');
    expect(await nodeFs.readTail(f, bytes.length - offset)).toBe('Привет мир 🚀\n');
    expect(await readFile(f)).toEqual(beforeBytes);
    expect((await stat(f)).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('returns whole content unchanged for a short file', async () => {
    const text = 'Короткая сессия\n';
    const f = await file(Buffer.from(text));
    expect(await nodeFs.readTail(f, 64 * 1024)).toBe(text);
  });
});

describe('nodeFs.readTail — R1c EOF/corruption extremes', () => {
  it('a file ending mid-multibyte decodes without crashing and stays untouched', async () => {
    const bytes = Buffer.from('имя сессии 🚀', 'utf8').subarray(0, Buffer.byteLength('имя сессии 🚀') - 2); // cut the rocket in half
    const f = await file(bytes);
    const beforeBytes = await readFile(f);
    const beforeStat = await stat(f);
    const tail = await nodeFs.readTail(f, 64 * 1024);
    expect(typeof tail).toBe('string');
    expect(tail.startsWith('имя сессии')).toBe(true);
    expect(await readFile(f)).toEqual(beforeBytes);
    expect((await stat(f)).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('window starting on continuation bytes of a corrupt file drops only the incomplete head', async () => {
    // a lone continuation byte (as if a multibyte char lost its lead byte)
    const bytes = Buffer.concat([Buffer.from('prefix\n'), Buffer.from([0x83]), Buffer.from('\nreal line\n')]);
    const f = await file(bytes);
    const tail = await nodeFs.readTail(f, bytes.length - 7); // starts at the 0x83 byte
    expect(tail).not.toContain('\uFFFD');
    expect(tail).toContain('real line');
    expect(await readFile(f)).toEqual(bytes);
  });
});
