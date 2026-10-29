/**
 * UI26 R01 — реальный Pi, изолированный профиль, НОЛЬ inference.
 *
 * Проверяет на живом установленном Pi (не на фикстуре) ровно два обещания #26:
 *  1. `new_session` назначает sessionFile, но JSONL на диске НЕ появляется;
 *  2. отмена черновика (close до первой записи) не оставляет никакого файла.
 *
 * Запуск только по явному флагу, чтобы обычный suite не зависел от локального Pi:
 *   PI_WS_DESKTOP_REAL_PI=1 npx vitest run tests/integration/realNewSession.test.ts
 * Внутри создаётся синтетический PI_CODING_AGENT_DIR — реальный ~/.pi не трогается.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ChatSessionManager } from '../../src/bridge/chatSession';
import { nodeFs } from '../../src/bridge/sessions';
import type { ChatEventT } from '../../src/shared/m1Protocol';

const enabled = process.env.PI_WS_DESKTOP_REAL_PI === '1';

const tmp = enabled ? mkdtempSync(path.join(os.tmpdir(), 'piwsd-real-')) : '';
const AGENT = path.join(tmp, 'agent');
const WORK = path.join(tmp, 'work');

function piPath(): string | null {
  try {
    return execFileSync('bash', ['-lc', 'command -v pi'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const PI = enabled ? piPath() : null;

function manager(events: ChatEventT[]): ChatSessionManager {
  return new ChatSessionManager({
    fs: nodeFs,
    home: os.homedir(),
    env: { ...process.env, PI_CODING_AGENT_DIR: AGENT } as Record<string, string>,
    resolvePi: async () => PI,
    spawnRpc: ({ piPath: p, args, cwd, env }) => spawn(p, args, { cwd, env, stdio: 'pipe' }) as never,
    onEvent: (ev) => events.push(ev),
  });
}

describe.skipIf(!enabled || PI === null)('реальный Pi: new_session без фиктивного JSONL', () => {
  mkdirSync(AGENT, { recursive: true });
  mkdirSync(WORK, { recursive: true });

  afterAll(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('файл новой сессии назначен, но на диске его нет', async () => {
    const events: ChatEventT[] = [];
    const m = manager(events);
    const { state, sessionFile } = await m.newSession(WORK);
    expect(state.sessionFile).toBe(sessionFile);
    expect(sessionFile.startsWith(AGENT)).toBe(true);
    expect(existsSync(sessionFile)).toBe(false);
    // Ключ события = file:<sessionFile> — рендерер не перепутает диалоги.
    const opened = events.find((e) => e.kind === 'opened') as { key?: string } | undefined;
    expect(opened?.key).toBe(`file:${sessionFile}`);
    await m.close();
  });

  it('отмена черновика не оставляет ни одного JSONL в изолированном профиле', async () => {
    const events: ChatEventT[] = [];
    const m = manager(events);
    await m.newSession(WORK);
    await m.close();
    const walk = (dir: string): string[] => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
      );
    };
    expect(walk(path.join(AGENT, 'sessions')).filter((f) => f.endsWith('.jsonl'))).toEqual([]);
  });
});
