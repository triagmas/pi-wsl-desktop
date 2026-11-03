/**
 * UI-B R01 — PTY-помощник (python3, stdlib).
 *
 * Здесь проверяется то, что нельзя проверить моками: скрипт синтаксически
 * валиден для python3 и действительно даёт интерактивный PTY — готовый кадр,
 * реальный размер окна, изменение размера и корректный выход по close.
 * Если python3 в окружении нет, живая часть пропускается (без ложного PASS).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PTY_HELPER_B64, PTY_HELPER_SOURCE, PYTHON_RUNNER, buildPtyArgv } from '../../src/main/ptyHelper';

const hasPython = spawnSync('python3', ['-V'], { encoding: 'utf8' }).status === 0;
/** Живой PTY требует POSIX: forkpty, /bin/bash, /tmp. На Windows-раннере
 *  python3 есть, но таких возможностей нет — сценарий относится к WSL/Linux. */
const isPosix = process.platform !== 'win32';

describe('pty helper: артефакт и argv', () => {
  it('ships the helper as a constant base64 payload (no interpolation possible)', () => {
    expect(Buffer.from(PTY_HELPER_B64, 'base64').toString('utf8')).toBe(PTY_HELPER_SOURCE);
    expect(PTY_HELPER_SOURCE).toContain('os.forkpty()');
    expect(PTY_HELPER_SOURCE).toContain('TIOCSWINSZ');
    expect(PTY_HELPER_SOURCE).not.toContain('${'); // TS-шаблон не подставляется в питон
  });

  it('builds a flat argv array for wsl.exe without any shell string', () => {
    const argv = buildPtyArgv({ distro: 'Ubuntu', cwd: '/home/u/p', cols: 120, rows: 40 });
    expect(argv.slice(0, 8)).toEqual(['-d', 'Ubuntu', '--exec', 'python3', '-u', '-c', PYTHON_RUNNER, PTY_HELPER_B64]);
    expect(argv.slice(8)).toEqual(['120', '40', '/home/u/p', '/bin/bash']);
    expect(argv.join(' ')).not.toContain('&&');
  });

  it('keeps the -c payload ASCII-only (Windows decodes argv in the ANSI code page)', () => {
    // Скрипт передаётся base64, а runner — чистый ASCII: кириллица в argv
    // ломает запуск на Windows (UnicodeDecodeError в дочернем процессе).
    expect(PYTHON_RUNNER).toMatch(/^[\x20-\x7e]+$/);
    expect(PTY_HELPER_B64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(PTY_HELPER_B64, 'base64').toString('utf8')).toContain('forkpty');
  });

  it('treats an empty cwd as «проекта нет» (домашний каталог + notice)', () => {
    const argv = buildPtyArgv({ distro: 'Ubuntu', cwd: '', cols: 80, rows: 24 });
    expect(argv[10]).toBe('');
  });

  it('validates distro and cwd before building argv', () => {
    expect(() => buildPtyArgv({ distro: 'Ubuntu;id', cwd: '/p', cols: 80, rows: 24 })).toThrow(/TERMINAL_BAD_DISTRO/);
    expect(() => buildPtyArgv({ distro: 'Ubuntu', cwd: 'p', cols: 80, rows: 24 })).toThrow(/TERMINAL_BAD_CWD/);
  });

  it.skipIf(!hasPython)('compiles as valid python3 source', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pty-helper-'));
    const file = path.join(dir, 'helper.py');
    writeFileSync(file, PTY_HELPER_SOURCE, 'utf8');
    // Явный utf-8: на Windows python3 иначе читает файл в ANSI-кодировке.
    const res = spawnSync(
      'python3',
      ['-c', 'import sys;compile(open(sys.argv[1],encoding="utf-8").read(),"helper.py","exec")', file],
      { encoding: 'utf8' },
    );
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });
});

describe.runIf(hasPython && isPosix)('pty helper: живой PTY', () => {
  it('allocates a real tty, resizes it and exits on close', async () => {
    const child = spawn('python3', ['-u', '-c', PYTHON_RUNNER, PTY_HELPER_B64, '80', '24', '/tmp', '/bin/bash'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const frames: Array<Record<string, unknown>> = [];
    let out = '';
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const frame = JSON.parse(line) as Record<string, unknown>;
          frames.push(frame);
          if (frame.t === 'out') out += Buffer.from(String(frame.d), 'base64').toString('utf8');
        } catch {
          // непарсибельный кадр — не повод падать
        }
        index = buffer.indexOf('\n');
      }
    });
    const send = (frame: unknown) => child.stdin.write(`${JSON.stringify(frame)}\n`);

    await waitFor(() => frames.some((f) => f.t === 'ready'), 8000);
    const ready = frames.find((f) => f.t === 'ready');
    expect(typeof ready?.pid).toBe('number');

    send({ t: 'in', d: Buffer.from('printf "SIZE=%s\\n" "$(stty size)"\n').toString('base64') });
    await waitFor(() => out.includes('SIZE=24 80'), 8000);

    send({ t: 'resize', c: 100, r: 30 });
    send({ t: 'in', d: Buffer.from('printf "SIZE2=%s\\n" "$(stty size)"\n').toString('base64') });
    await waitFor(() => out.includes('SIZE2=30 100'), 8000);

    send({ t: 'close' });
    await waitFor(() => frames.some((f) => f.t === 'exit'), 8000);
    child.kill();
    expect(frames.filter((f) => f.t === 'exit')).toHaveLength(1);
  }, 30_000);
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timeout waiting for condition');
}
