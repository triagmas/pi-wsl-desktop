/**
 * UI-B R01 — общий контракт терминала (shared, без Electron).
 *
 * Контракт: значения из renderer никогда не попадают в argv как есть — distro,
 * cwd и размеры проходят валидацию/клэмп; кадры помощника разбираются
 * потоково, с жёстким лимитом кадра (никакого бесконечного буфера).
 */
import { describe, expect, it } from 'vitest';
import {
  FrameDecoder,
  TERMINAL_LIMITS,
  TerminalError,
  clampCols,
  clampRows,
  isBase64,
  isSafeDistroName,
  isSafeWslCwd,
} from '../../src/shared/terminal';

describe('terminal shared contract', () => {
  it('clamps sizes to supported ranges and applies defaults', () => {
    expect(clampCols(undefined)).toBe(TERMINAL_LIMITS.defaultCols);
    expect(clampRows(undefined)).toBe(TERMINAL_LIMITS.defaultRows);
    expect(clampCols(0)).toBe(TERMINAL_LIMITS.minCols);
    expect(clampRows(0)).toBe(TERMINAL_LIMITS.minRows);
    expect(clampCols(100_000)).toBe(TERMINAL_LIMITS.maxCols);
    expect(clampRows(100_000)).toBe(TERMINAL_LIMITS.maxRows);
    expect(clampCols(100.9)).toBe(100);
    expect(clampRows(Number.NaN)).toBe(TERMINAL_LIMITS.defaultRows);
    expect(clampCols('120' as unknown)).toBe(120);
  });

  it('accepts real WSL distro names and rejects anything shell-ish', () => {
    expect(isSafeDistroName('Ubuntu')).toBe(true);
    expect(isSafeDistroName('Ubuntu-22.04')).toBe(true);
    expect(isSafeDistroName('kali_linux')).toBe(true);
    expect(isSafeDistroName('')).toBe(false);
    expect(isSafeDistroName('Ubuntu 22.04')).toBe(false);
    expect(isSafeDistroName('Ubuntu;rm -rf /')).toBe(false);
    expect(isSafeDistroName('Ubuntu\n--exec')).toBe(false);
    expect(isSafeDistroName('x'.repeat(65))).toBe(false);
    expect(isSafeDistroName(null)).toBe(false);
  });

  it('accepts absolute POSIX cwd only', () => {
    expect(isSafeWslCwd('/home/u/proj')).toBe(true);
    expect(isSafeWslCwd('/')).toBe(true);
    expect(isSafeWslCwd('home/u/proj')).toBe(false);
    expect(isSafeWslCwd('C:\\Users\\u')).toBe(false);
    expect(isSafeWslCwd('/tmp/a\0b')).toBe(false);
    expect(isSafeWslCwd('/tmp/a\nb')).toBe(false);
    expect(isSafeWslCwd('')).toBe(false);
    expect(isSafeWslCwd(`/${'a'.repeat(5000)}`)).toBe(false);
    expect(isSafeWslCwd(42)).toBe(false);
  });

  it('validates base64 payloads strictly', () => {
    expect(isBase64(Buffer.from('echo hi\n').toString('base64'))).toBe(true);
    expect(isBase64('')).toBe(false);
    expect(isBase64('not base64!!')).toBe(false);
    expect(isBase64('YWJj=')).toBe(false);
    expect(isBase64('YWJ')).toBe(false);
    expect(isBase64(123)).toBe(false);
  });

  it('decodes NDJSON frames split across chunks', () => {
    const decoder = new FrameDecoder();
    expect(decoder.push('{"t":"rea')).toEqual([]);
    expect(decoder.push('dy","pid":7}\n{"t":"out","d":"YQ==')).toEqual([{ t: 'ready', pid: 7 }]);
    expect(decoder.push('"}\n')).toEqual([{ t: 'out', d: 'YQ==' }]);
  });

  it('rejects oversized frames instead of growing the buffer forever', () => {
    const decoder = new FrameDecoder(64);
    expect(() => decoder.push('x'.repeat(65))).toThrow(TerminalError);
    try {
      decoder.push('x'.repeat(65));
    } catch (err) {
      expect((err as TerminalError).code).toBe('TERMINAL_PROTOCOL');
    }
  });

  it('ignores blank lines and drops unparseable frames without throwing', () => {
    const decoder = new FrameDecoder();
    expect(decoder.push('\n\n{"t":"out","d":"YQ=="}\n\n')).toEqual([{ t: 'out', d: 'YQ==' }]);
    expect(decoder.push('not json\n')).toEqual([]);
    expect(decoder.push('{"t":"out","d":"YQ=="}\n')).toEqual([{ t: 'out', d: 'YQ==' }]);
  });
});
