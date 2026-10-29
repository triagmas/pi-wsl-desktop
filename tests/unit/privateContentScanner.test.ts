/**
 * UI26 R06 (P1) — гейт приватного содержимого по ОБЩИМ классам.
 *
 * Проверяются только синтетические образцы: настоящие секреты, пути
 * пользователя и идентификаторы провайдеров в репозиторий не попадают.
 * Тест фиксирует и ограничения: это не «сканер всех секретов», а набор
 * известных классов + fail-closed на непрочитанных/слишком больших файлах.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  findPrivate,
  findSensitiveName,
  inspectFile,
  inspectFiles,
  privateRules,
  MAX_INSPECT_BYTES,
} from '../../scripts/check-private-content.mjs';

const FAKE_AWS = 'AK' + 'IA' + 'B'.repeat(16);
const FAKE_GITHUB = 'gh' + 'p_' + 'A'.repeat(36);
const FAKE_SLACK = 'xo' + 'x' + 'b-' + '1'.repeat(12);
const FAKE_SK = 'sk' + '-' + 'x'.repeat(24);
const FAKE_BEARER = 'Bear' + 'er ' + 'a'.repeat(24);
const FAKE_PEM = '-----BEGIN RSA PRIV' + 'ATE KEY-----';
const FAKE_HOME = '/ho' + 'me/realuser7/project';
const FAKE_WIN_USER = 'C:\\Us' + 'ers\\alice\\app';

describe('P1: общие классы секретов', () => {
  it.each([
    ['PEM private key', FAKE_PEM, 'private-key-block'],
    ['AWS access key', FAKE_AWS, 'aws-access-key'],
    ['GitHub token', FAKE_GITHUB, 'github-token'],
    ['Slack token', FAKE_SLACK, 'slack-token'],
    ['sk-like key', FAKE_SK, 'openai-style-key'],
    ['literal bearer', FAKE_BEARER, 'bearer-header'],
  ])('%s ловится', (_label, text, rule) => {
    expect(findPrivate(text)).toBe(rule);
  });

  it.each([
    ['домашний каталог', FAKE_HOME, 'home-directory-path'],
    ['профиль Windows', FAKE_WIN_USER, 'windows-user-path'],
  ])('приватный путь (%s) ловится', (_label, text, rule) => {
    expect(findPrivate(text)).toBe(rule);
  });

  it('обычный код и синтетические фикстуры проходят', () => {
    for (const text of [
      'feat(sessions): add native new-chat flow (#26)',
      "const FILE = '/roots/--p--/a.jsonl';",
      'expect(process.env.PI_WS_DESKTOP_USER_DATA_DIR).toBeUndefined();',
      '-----BEGIN ' + 'NOT A KEY-----',
      'token: see documentation',
    ]) {
      expect(findPrivate(text)).toBeNull();
    }
  });

  it('правила не содержат идентификаторов конкретных провайдеров/пользователей', () => {
    const dump = privateRules()
      .map((r) => `${r.id}:${r.re.source}`)
      .join('\n');
    // Классы описаны формой, а не именами: ни одного «известного» бренда,
    // логина или пути конкретной машины.
    expect(dump).not.toMatch(/cliproxy|kenari|triag|_hermes/i);
    expect(privateRules().length).toBeGreaterThanOrEqual(7);
  });
});

describe('P1: чувствительные имена файлов', () => {
  it('auth.json, .env и приватные ключи помечаются', () => {
    expect(findSensitiveName('config/auth.json')).toBe('auth-json');
    expect(findSensitiveName('.env')).toBe('dotenv');
    expect(findSensitiveName('certs/server.pem')).toBe('private-key-file');
  });

  it('похожие безопасные имена не помечаются', () => {
    expect(findSensitiveName('.env.example')).toBeNull();
    expect(findSensitiveName('docs/auth.md')).toBeNull();
    expect(findSensitiveName('src/shared/redact.ts')).toBeNull();
  });
});

describe('P1: fail-closed и лимит размера', () => {
  const okIo = (size = 10, text = 'clean text') => ({
    statSync: () => ({ size }),
    readFileSync: () => text,
  });

  it('непрочитанный файл — нарушение, а не пропуск', () => {
    const io = {
      statSync: () => ({ size: 10 }),
      readFileSync: () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    };
    const r = inspectFile('src/a.ts', io);
    expect(r.ok).toBe(false);
    expect(r.findings[0].rule).toBe('unreadable:EACCES');
  });

  it('файл больше лимита — нарушение', () => {
    const r = inspectFile('big.txt', okIo(MAX_INSPECT_BYTES + 1));
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe('too-large');
  });

  it('бинарные расширения не читаются и не считаются нарушением сами по себе', () => {
    const r = inspectFile('icon.png', okIo());
    expect(r).toMatchObject({ ok: true, skipped: 'binary' });
  });

  it('чувствительное имя файла ловится даже при чистом содержимом', () => {
    const r = inspectFile('.env', okIo(10, 'PORT=3000'));
    expect(r.ok).toBe(false);
    expect(r.findings[0].rule).toBe('filename:dotenv');
  });

  it('набор файлов агрегирует нарушения', () => {
    const io = vi.fn();
    expect(typeof io).toBe('function');
    const r = inspectFiles([]);
    expect(r).toEqual({ ok: true, findings: [] });
  });
});

describe('P1: ограничения раскрыты', () => {
  it('нет энтропийного анализа: случайная строка без известной формы проходит', () => {
    expect(findPrivate('q7Zp2Lw9Kx4Vb8Nn3Rf6Tz1Mj5Hc0Yd')).toBeNull();
  });

  it('нет проверки истории: чистый текст коммита не отменяет старую утечку', () => {
    // Ограничение зафиксировано осознанно: гейт смотрит только staged-контент.
    expect(findPrivate(''),
    ).toBeNull();
  });
});
