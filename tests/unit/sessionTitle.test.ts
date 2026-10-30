/**
 * UI26 R01 — заголовки сессий.
 *
 * Контракт (#26): явный Pi `session_info.name` → первое user-сообщение →
 * короткий id. Обрезка безопасна для Unicode (не рвёт surrogate pairs) и не
 * переносит переводы строк в однострочный заголовок.
 */
import { describe, expect, it } from 'vitest';
import { collapseTitle, deriveDisplayName, TITLE_MAX, truncateTitle } from '../../src/shared/sessionTitle';

describe('collapseTitle', () => {
  it('схлопывает переводы строк и повторные пробелы', () => {
    expect(collapseTitle('\n  Привет,\n\tмир   🚀  \n')).toBe('Привет, мир 🚀');
  });

  it('не меняет обычный текст', () => {
    expect(collapseTitle('Просто текст')).toBe('Просто текст');
  });

  it('пустая строка остаётся пустой (не превращается в пробел)', () => {
    expect(collapseTitle('   \n\t ')).toBe('');
  });
});

describe('truncateTitle', () => {
  it('короткий текст не обрезается и не получает многоточие', () => {
    expect(truncateTitle('коротко', 20)).toBe('коротко');
  });

  it('ровно на границе — без многоточия', () => {
    expect(truncateTitle('x'.repeat(20), 20)).toBe('x'.repeat(20));
  });

  it('длинный текст обрезается до лимита ВКЛЮЧАЯ многоточие', () => {
    const out = truncateTitle('y'.repeat(200), 20);
    expect([...out]).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('не рвёт emoji (surrogate pairs) и не оставляет одиночный суррогат', () => {
    const out = truncateTitle('🚀'.repeat(100), 10);
    expect([...out]).toHaveLength(10);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(out).not.toMatch(/(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(out.startsWith('🚀')).toBe(true);
  });

  it('по умолчанию использует TITLE_MAX', () => {
    expect([...truncateTitle('z'.repeat(TITLE_MAX * 2))]).toHaveLength(TITLE_MAX);
  });

  it('не обрезает текст, состоящий только из многобайтовых символов, до пустой строки', () => {
    expect(truncateTitle('東京'.repeat(100), 5).length).toBeGreaterThan(0);
  });
});

describe('deriveDisplayName', () => {
  it('приоритет 1: явное имя Pi (обрезанное и очищенное)', () => {
    const r = deriveDisplayName({ piName: '  Разбор\nбага  ', firstUserText: 'первое сообщение', id: '01a1-aaaa-bbbb' });
    expect(r).toEqual({ displayName: 'Разбор бага', displayNameSource: 'pi' });
  });

  it('приоритет 2: первое user-сообщение, если имени нет', () => {
    const r = deriveDisplayName({ piName: null, firstUserText: '\n Починить  ленту \n', id: '01a1-aaaa' });
    expect(r).toEqual({ displayName: 'Починить ленту', displayNameSource: 'firstUser' });
  });

  it('пустое имя Pi (пробелы) не считается именем', () => {
    const r = deriveDisplayName({ piName: '   ', firstUserText: 'Текст', id: 'x' });
    expect(r.displayNameSource).toBe('firstUser');
  });

  it('длинное первое сообщение обрезается до TITLE_MAX', () => {
    const r = deriveDisplayName({ piName: null, firstUserText: 'а'.repeat(500), id: 'x' });
    expect([...r.displayName]).toHaveLength(TITLE_MAX);
    expect(r.displayName.endsWith('…')).toBe(true);
  });

  it('приоритет 3: короткий id, когда текста нет', () => {
    const r = deriveDisplayName({ piName: null, firstUserText: null, id: '01a18520-ac3f-739d-80d9-90583b059bca' });
    expect(r).toEqual({ displayName: '01a18520', displayNameSource: 'id' });
  });

  it('сообщение из одних пробелов не становится заголовком', () => {
    const r = deriveDisplayName({ piName: null, firstUserText: '   ', id: 'abcdef12-3456' });
    expect(r.displayNameSource).toBe('id');
    expect(r.displayName).toBe('abcdef12');
  });

  it('длинный id тоже обрезается в короткую форму без многоточия', () => {
    const r = deriveDisplayName({ piName: null, firstUserText: null, id: 'w'.repeat(60) });
    expect(r.displayName).toBe('w'.repeat(8));
  });

  it('не падает на пустом id (заголовок остаётся строкой)', () => {
    const r = deriveDisplayName({ piName: null, firstUserText: null, id: '' });
    expect(typeof r.displayName).toBe('string');
    expect(r.displayName.length).toBeGreaterThan(0);
  });
});
