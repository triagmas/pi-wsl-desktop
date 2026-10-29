/**
 * UI26 R06 (P2) — воспроизводимый Windows GUI smoke: проверяемая логика.
 *
 * Сам smoke требует живого Windows-стола, поэтому в CI он `NOT RUN`; здесь
 * проверяются чистые части: разбор окон Win32, ownership по PID, разбор
 * аргументов и то, что успех требует ВИДИМОГО окна с ожидаемым заголовком.
 */
import { describe, expect, it } from 'vitest';
import {
  ownedWindows,
  parseWindows,
  ownedVisibleWindows,
  newPids,
  parseSmokeArgs,
  DEFAULT_EXPECT_TITLE,
  windowScript,
} from '../../scripts/win-gui-smoke.mjs';

describe('разбор Win32 EnumWindows', () => {
  it('читает pid/видимость/заголовок, включая заголовок с разделителем', () => {
    const out = ['WIN 101|True|Pi WSL Desktop', 'WIN 102|False|(hidden)', 'WIN 103|True|Title|with|pipes'].join('\n');
    expect(parseWindows(out)).toEqual([
      { pid: 101, visible: true, title: 'Pi WSL Desktop' },
      { pid: 102, visible: false, title: '(hidden)' },
      { pid: 103, visible: true, title: 'Title|with|pipes' },
    ]);
  });

  it('игнорирует посторонний вывод PowerShell', () => {
    expect(parseWindows('some noise\nWIN 5|True|App\n')).toEqual([{ pid: 5, visible: true, title: 'App' }]);
  });

  it('пустой вывод — пустой список', () => {
    expect(parseWindows('')).toEqual([]);
  });
});

describe('ownership и видимость', () => {
  const windows = [
    { pid: 10, visible: true, title: 'Pi WSL Desktop' },
    { pid: 11, visible: true, title: 'Other app' },
    { pid: 12, visible: false, title: 'Pi WSL Desktop' },
  ];

  it('берутся только видимые окна собственных PID', () => {
    expect(ownedVisibleWindows(windows, [10, 12])).toEqual([{ pid: 10, visible: true, title: 'Pi WSL Desktop' }]);
  });

  it('чужие окна не считаются доказательством', () => {
    expect(ownedVisibleWindows(windows, [99])).toEqual([]);
  });

  it('в отчёт попадают только собственные окна (приватность)', () => {
    expect(ownedWindows(windows, [10])).toEqual([{ pid: 10, visible: true, title: 'Pi WSL Desktop' }]);
  });

  it('newPids считает только появившиеся процессы', () => {
    expect(newPids([1, 2, 3], [2, 3, 4, 5])).toEqual([4, 5]);
  });

  it('скрипт перечисления окон содержит проверку видимости', () => {
    expect(windowScript([1])).toContain('IsWindowVisible');
    expect(windowScript([1])).toContain('EnumWindows');
  });
});

describe('аргументы smoke', () => {
  it('значения по умолчанию', () => {
    const a = parseSmokeArgs([], '/repo');
    expect(a).toEqual({
      exe: null,
      out: '/repo/win-gui-smoke.json',
      timeoutMs: 30000,
      expectTitle: DEFAULT_EXPECT_TITLE,
    });
  });

  it('явные флаги переопределяют', () => {
    const a = parseSmokeArgs(['--exe', 'F:\\e\\electron.exe', '--out', '/tmp/r.json', '--timeout-ms', '5000', '--expect-title', 'X']);
    expect(a).toMatchObject({ exe: 'F:\\e\\electron.exe', out: '/tmp/r.json', timeoutMs: 5000, expectTitle: 'X' });
  });
});
