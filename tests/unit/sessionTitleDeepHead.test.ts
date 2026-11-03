/**
 * Owner Acceptance Repair R01 (#26, #6559283775): в реальном приложении сессии
 * подписывались техническим id сессии, потому что первое сообщение
 * пользователя лежит ПОСЛЕ системного промпта (десятки килобайт), а заголовок
 * читался только из первых 64 КиБ.
 *
 * Контракт: название берётся из реальной истории Pi (session_info.name или
 * первое пользовательское сообщение) в пределах ограниченного бюджета чтения;
 * технический id — только последний fallback при отсутствии данных.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSessionIndex, nodeFs } from '../../src/bridge/sessions';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

function sessionWithBigSystemPrompt(userText: string, padBytes = 70 * 1024): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'piwsd-title-'));
  const bucket = path.join(dir, 'sessions', '--p--');
  mkdirSync(bucket, { recursive: true });
  const file = path.join(bucket, '2026-03-14T09-12-05-120Z_5c7d9e10-4a2b-4f6c-8d3e-1b0a9c2f4e77.jsonl');
  const rows = [
    { type: 'session', version: 3, id: '5c7d9e10-4a2b-4f6c-8d3e-1b0a9c2f4e77', timestamp: '2026-03-14T09:12:05.120Z', cwd: '/p' },
    // системный промпт больше 64 КиБ — так выглядит реальный файл Pi
    { type: 'message', id: 'sys', parentId: null, timestamp: 'T', message: { role: 'system', content: 'x'.repeat(padBytes) } },
    { type: 'message', id: 'u1', parentId: 'sys', timestamp: 'T', message: { role: 'user', content: [{ type: 'text', text: userText }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: 'T', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ];
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

describe('session display names читают историю дальше 64 КиБ', () => {
  it('первое пользовательское сообщение после большого системного промпта становится названием', async () => {
    const home = sessionWithBigSystemPrompt('Починить прокрутку настроек');
    const idx = await buildSessionIndex({
      fs: nodeFs,
      env: { PI_CODING_AGENT_SESSION_DIR: path.join(home, 'sessions') },
      home,
      now: NOW,
    });
    expect(idx.sessions).toHaveLength(1);
    const s = idx.sessions[0];
    expect(s.displayName).toBe('Починить прокрутку настроек');
    expect(s.displayNameSource).toBe('firstUser');
    expect(s.id).toBe('5c7d9e10-4a2b-4f6c-8d3e-1b0a9c2f4e77'); // стабильный id сохранён
  });

  it('explicit Pi name всё ещё приоритетнее истории', async () => {
    const home = sessionWithBigSystemPrompt('Не должно попасть в заголовок');
    const file = path.join(
      home,
      'sessions',
      '--p--',
      '2026-03-14T09-12-05-120Z_5c7d9e10-4a2b-4f6c-8d3e-1b0a9c2f4e77.jsonl',
    );
    writeFileSync(
      file,
      JSON.stringify({ type: 'session_info', name: 'Имя из Pi' }) + '\n',
      { flag: 'a' },
    );
    const idx = await buildSessionIndex({
      fs: nodeFs,
      env: { PI_CODING_AGENT_SESSION_DIR: path.join(home, 'sessions') },
      home,
      now: NOW,
    });
    expect(idx.sessions[0].displayName).toBe('Имя из Pi');
    expect(idx.sessions[0].displayNameSource).toBe('pi');
  });

  it('без пользовательских сообщений остаётся честный короткий id', async () => {
    const home = sessionWithBigSystemPrompt('unused');
    const file = path.join(
      home,
      'sessions',
      '--p--',
      '2026-03-14T09-12-05-120Z_5c7d9e10-4a2b-4f6c-8d3e-1b0a9c2f4e77.jsonl',
    );
    writeFileSync(
      file,
      [
        JSON.stringify({ type: 'session', version: 3, id: '5c7d9e10-4a2b-4f6c-8d3e-1b0a9c2f4e77', timestamp: 'T', cwd: '/p' }),
        JSON.stringify({ type: 'message', id: 'sys', parentId: null, message: { role: 'system', content: 'x'.repeat(70 * 1024) } }),
      ].join('\n') + '\n',
    );
    const idx = await buildSessionIndex({
      fs: nodeFs,
      env: { PI_CODING_AGENT_SESSION_DIR: path.join(home, 'sessions') },
      home,
      now: NOW,
    });
    expect(idx.sessions[0].displayName).toBe('5c7d9e10');
    expect(idx.sessions[0].displayNameSource).toBe('id');
  });
});
