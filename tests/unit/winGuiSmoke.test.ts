/**
 * UI26 R08 — безопасность ownership, очистки и путей Windows GUI smoke.
 *
 * Все проверки — на синтетических таблицах процессов: живой Windows не нужен.
 * Ключевые инварианты R08:
 *  - «новый electron.exe» НЕ является доказательством владения;
 *  - завершение идёт от потомков к родителю, с перепроверкой идентичности
 *    (PID + время создания) перед каждым kill;
 *  - PASS невозможен, если очистка не подтверждена или остался процесс;
 *  - посторонние процессы не завершаются ни при каких обстоятельствах;
 *  - значения не подставляются в PowerShell-код без экранирования.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPECT_TITLE,
  USER_DATA_PREFIX,
  encodePowerShell,
  isOwnedSmokeDir,
  killOrder,
  killProven,
  killScript,
  launchApp,
  launchScript,
  normalizeWinPath,
  ownedVisibleWindows,
  ownedWindows,
  ownershipCheck,
  parseProcessTable,
  parseSmokeArgs,
  parseStartOutput,
  parseTempRoot,
  parseUserDataVerification,
  parseWindows,
  probeProcessTable,
  processTableScript,
  psQuote,
  removeUserData,
  runSmoke,
  smokeVerdict,
  verifyOwnedIdentities,
  winDirname,
} from '../../scripts/win-gui-smoke.mjs';

const ROOT = 4242;
const APP_DIR = 'C:\\Apps\\win-electron';
const APP_EXE = `${APP_DIR}\\electron.exe`;
const TEMP_ROOT = 'C:\\Users\\placeholder\\AppData\\Local\\Temp';
const T0 = '2026-10-29T10:00:00.0000000Z';
const T1 = '2026-10-29T10:00:01.0000000Z';
const T2 = '2026-10-29T10:00:02.0000000Z';

const proc = (pid: number, parentPid: number, exe = APP_EXE, createdAt = T1) => ({ pid, parentPid, exe, createdAt });
const ids = (list: { pid: number; createdAt: string }[]) => list.map((p) => ({ pid: p.pid, createdAt: p.createdAt, exe: APP_EXE }));
const fakeFs = () =>
  ({
    ...fs,
    readdirSync: () => [
      'electron.exe',
      'resources.pak',
      'icudtl.dat',
      'snapshot_blob.bin',
      'ffmpeg.dll',
      'd3dcompiler_47.dll',
      'vulkan-1.dll',
      'vk_swiftshader.dll',
    ],
  }) as unknown as typeof fs;

describe('разбор вывода процессов и окон', () => {
  it('таблица процессов разбирается в структуры', () => {
    const out = [`PROC ${ROOT}|100|${APP_EXE}|${T0}`, `PROC 4243|${ROOT}|${APP_EXE}|${T1}`, 'noise'].join('\n');
    expect(parseProcessTable(out)).toEqual([
      { pid: ROOT, parentPid: 100, exe: APP_EXE, createdAt: T0 },
      { pid: 4243, parentPid: ROOT, exe: APP_EXE, createdAt: T1 },
    ]);
  });

  it('окна разбираются, включая заголовок с разделителем', () => {
    const out = ['WIN 101|True|Pi WSL Desktop', 'WIN 102|False|(hidden)', 'WIN 103|True|T|x'].join('\n');
    expect(parseWindows(out)).toEqual([
      { pid: 101, visible: true, title: 'Pi WSL Desktop' },
      { pid: 102, visible: false, title: '(hidden)' },
      { pid: 103, visible: true, title: 'T|x' },
    ]);
  });

  it('скрипт снимка процессов запрашивает родителя и время создания', () => {
    const s = processTableScript();
    for (const needle of ['Win32_Process', 'ParentProcessId', 'CreationDate', 'ExecutablePath']) {
      expect(s).toContain(needle);
    }
  });
});

describe('P1: принадлежность процессов доказывается', () => {
  it('корневой PID и его потомки — свои', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(4243, ROOT), proc(4244, 4243)];
    const r = ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR });
    expect(r.ok).toBe(true);
    expect(r.owned.sort()).toEqual([ROOT, 4243, 4244].sort());
    expect(r.identities?.map((i: { pid: number }) => i.pid).sort()).toEqual([ROOT, 4243, 4244].sort());
  });

  it('посторонний Electron не становится своим', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(9001, 7777), proc(9002, 9001)];
    expect(ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR }).owned).toEqual([ROOT]);
  });

  it('потомок с другим каталогом exe не считается своим', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(5000, ROOT, 'C:\\Other\\electron.exe')];
    expect(ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR }).owned).toEqual([ROOT]);
  });

  it('PID, переиспользованный чужим процессом, даёт INCONCLUSIVE', () => {
    const table = [proc(ROOT, 100, APP_EXE, T1), proc(5001, ROOT, APP_EXE, T0)];
    expect(ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR })).toMatchObject({
      ok: false,
      reason: 'child-created-before-root',
      owned: [],
    });
  });

  it('PID из baseline в роли потомка или корня даёт INCONCLUSIVE', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(5002, ROOT, APP_EXE, T1)];
    expect(ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR, baselinePids: [5002] })).toMatchObject({
      ok: false,
      reason: 'child-pid-reused',
    });
    expect(ownershipCheck({ table: [proc(ROOT, 100, APP_EXE, T0)], rootPid: ROOT, exeDir: APP_DIR, baselinePids: [ROOT] })).toMatchObject({
      ok: false,
      reason: 'root-pid-reused',
    });
  });

  it('тот же PID с другим exe — не наш процесс', () => {
    expect(ownershipCheck({ table: [proc(ROOT, 100, 'C:\\Other\\electron.exe')], rootPid: ROOT, exeDir: APP_DIR })).toMatchObject({
      ok: false,
      reason: 'root-exe-mismatch',
    });
  });

  it('исчезнувший корневой процесс и сбой пробы — не PASS', () => {
    expect(ownershipCheck({ table: [proc(5003, 1)], rootPid: ROOT, exeDir: APP_DIR })).toMatchObject({ ok: false, reason: 'root-missing' });
    expect(ownershipCheck({ table: [], rootPid: ROOT, exeDir: APP_DIR, probeOk: false })).toEqual({
      ok: false,
      reason: 'probe-failed',
      owned: [],
    });
  });

  it('нормализация путей и каталог exe', () => {
    expect(normalizeWinPath('F:\\Dir\\sub\\')).toBe('f:/dir/sub');
    expect(winDirname('F:\\a\\b\\electron.exe')).toBe('F:\\a\\b');
    expect(winDirname('F:/a/b/electron.exe')).toBe('F:\\a\\b');
    expect(winDirname('F:\\a\\b\\')).toBe('F:\\a\\b');
  });
});

describe('P1: живость по идентичности PID + время создания', () => {
  const identities = ids([proc(ROOT, 100, APP_EXE, T0), proc(4243, ROOT, APP_EXE, T1)]);

  it('живые, исчезнувшие и переиспользованные различаются', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0)]; // 4243 исчез
    const r = verifyOwnedIdentities({ table, identities, exeDir: APP_DIR });
    expect(r.alive).toEqual([ROOT]);
    expect(r.gone).toEqual([4243]);
    expect(r.mismatch).toEqual([]);
  });

  it('PID жив, но время создания другое — это чужой процесс', () => {
    const table = [proc(ROOT, 100, APP_EXE, '2026-10-29T23:00:00.0000000Z')];
    const r = verifyOwnedIdentities({ table, identities, exeDir: APP_DIR });
    expect(r.mismatch).toEqual([ROOT]);
    expect(r.alive).toEqual([]);
  });

  it('корень исчез, но потомок остался живым — он всё равно виден', () => {
    const table = [proc(4243, ROOT, APP_EXE, T1)];
    const r = verifyOwnedIdentities({ table, identities, exeDir: APP_DIR });
    expect(r.alive).toEqual([4243]);
    expect(r.gone).toEqual([ROOT]);
  });

  it('сбой пробы — не «всё чисто», а неизвестность', () => {
    const r = verifyOwnedIdentities({ table: [], identities, exeDir: APP_DIR, probeOk: false });
    expect(r.ok).toBe(false);
    expect(r.alive).toEqual([]);
    expect(r.unknown).toEqual([ROOT, 4243]);
  });
});

describe('P1: порядок завершения — потомки перед родителем', () => {
  it('глубина определяет порядок', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(1001, ROOT, APP_EXE, T1), proc(1002, 1001, APP_EXE, T2)];
    const order = killOrder(ids([proc(ROOT, 100, APP_EXE, T0), proc(1001, ROOT, APP_EXE, T1), proc(1002, 1001, APP_EXE, T2)]), table);
    expect(order.map((i: { pid: number }) => i.pid)).toEqual([1002, 1001, ROOT]);
  });

  it('при равной глубине порядок детерминирован', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(2002, ROOT, APP_EXE, T1), proc(2001, ROOT, APP_EXE, T1)];
    const order = killOrder(ids([proc(ROOT, 100, APP_EXE, T0), proc(2002, ROOT, APP_EXE, T1), proc(2001, ROOT, APP_EXE, T1)]), table);
    expect(order.map((i: { pid: number }) => i.pid)).toEqual([2001, 2002, ROOT]);
  });
});

describe('P1: killProven — проверки, порядок, отказ', () => {
  const list = ids([proc(1002, 1001, APP_EXE, T2), proc(1001, ROOT, APP_EXE, T1), proc(ROOT, 100, APP_EXE, T0)]);

  it('завершает в заданном порядке и подтверждает каждый kill', () => {
    const killed: number[] = [];
    const r = killProven(list, {
      verify: () => 'alive',
      kill: (i: { pid: number }) => {
        killed.push(i.pid);
        return true;
      },
      recheck: () => 'gone',
    });
    expect(killed).toEqual([1002, 1001, ROOT]);
    expect(r.killed).toEqual([1002, 1001, ROOT]);
    expect(r.failed).toEqual([]);
    expect(r.aborted).toBeNull();
  });

  it('неудачный kill не считается завершённым', () => {
    const r = killProven(list, {
      verify: () => 'alive',
      kill: (i: { pid: number }) => i.pid !== 1001,
      recheck: () => 'alive',
    });
    expect(r.killed).toEqual([]);
    expect(r.failed).toEqual([1002, 1001, ROOT]);
  });

  it('процесс, который уже завершился, попадает в skipped, а не в killed', () => {
    const r = killProven(list, { verify: () => 'gone', kill: () => true, recheck: () => 'gone' });
    expect(r.killed).toEqual([]);
    expect(r.skipped).toEqual([1002, 1001, ROOT]);
  });

  it('сбой проверки перед kill прекращает завершение', () => {
    let killed = 0;
    const r = killProven(list, {
      verify: () => 'probe-failed',
      kill: () => {
        killed += 1;
        return true;
      },
      recheck: () => 'gone',
    });
    expect(killed).toBe(0);
    expect(r.aborted).toBe('verify-probe-failed');
  });

  it('переиспользованный PID (mismatch) не завершается', () => {
    let killed = 0;
    const r = killProven(list, {
      verify: () => 'ambiguous',
      kill: () => {
        killed += 1;
        return true;
      },
      recheck: () => 'gone',
    });
    expect(killed).toBe(0);
    expect(r.aborted).toBe('verify-ambiguous');
  });

  it('kill-команда не содержит «глушения» ошибок', () => {
    const s = killScript(1234);
    expect(s).toContain('Stop-Process -Id 1234');
    expect(s).toContain('-ErrorAction Stop');
    expect(s).not.toContain('SilentlyContinue');
  });
});

describe('P2: безопасная работа с PowerShell', () => {
  it('апостроф удваивается, спецсимволы не исполняются', () => {
    expect(psQuote("C:\\O'Brien\\electron.exe")).toBe("'C:\\O''Brien\\electron.exe'");
    expect(psQuote('C:\\a b\\c$(x);d')).toBe("'C:\\a b\\c$(x);d'");
    expect(psQuote('')).toBe("''");
  });

  it('скрипт передаётся как UTF-16LE base64 и не содержит сырых кавычек', () => {
    const script = launchScript({ exe: "C:\\O'Brien\\e.exe", appPath: 'C:\\Program Files\\app', cwd: "C:\\O'Brien" });
    expect(script).toContain("'C:\\O''Brien\\e.exe'");
    const encoded = encodePowerShell(script);
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script);
    expect(encoded).not.toContain("'");
  });

  it('путь с пробелами и апострофом не ломает разбор запуска', () => {
    expect(parseStartOutput(`STARTED 5150|${TEMP_ROOT}\\${USER_DATA_PREFIX}abcd1234`)).toEqual({
      rootPid: 5150,
      userData: `${TEMP_ROOT}\\${USER_DATA_PREFIX}abcd1234`,
    });
  });

  it('проверка каталога профиля разбирается', () => {
    expect(parseUserDataVerification(`PATH ${TEMP_ROOT}|2026-10-29T10:00:00.0000000Z|${USER_DATA_PREFIX}abcd1234`)).toEqual({
      parent: TEMP_ROOT,
      createdAt: '2026-10-29T10:00:00.0000000Z',
      name: `${USER_DATA_PREFIX}abcd1234`,
    });
    expect(parseUserDataVerification('')).toBeNull();
  });

  it('доверенный temp-корень разбирается', () => {
    expect(parseTempRoot(`TEMP [${TEMP_ROOT}]`)).toBe(TEMP_ROOT);
    expect(parseTempRoot('TEMP []')).toBeNull();
  });
});

describe('P2: каталог профиля удаляется только по доказательству', () => {
  const good = `${TEMP_ROOT}\\${USER_DATA_PREFIX}abcd1234`;

  it('свой каталог в доверенном temp — можно удалять', () => {
    expect(isOwnedSmokeDir(good, TEMP_ROOT)).toBe(true);
    expect(isOwnedSmokeDir(`${TEMP_ROOT}/${USER_DATA_PREFIX}abcd1234/`, TEMP_ROOT)).toBe(true);
  });

  it('чужой путь, чужой родитель и переходы вверх отклоняются', () => {
    expect(isOwnedSmokeDir(good, undefined)).toBe(false);
    expect(isOwnedSmokeDir(good, 'C:\\Windows')).toBe(false);
    expect(isOwnedSmokeDir('C:\\Users\\real\\AppData\\Roaming\\pi-wsl-desktop', TEMP_ROOT)).toBe(false);
    expect(isOwnedSmokeDir(`${TEMP_ROOT}\\${USER_DATA_PREFIX}abcd\\..\\..\\Windows`, TEMP_ROOT)).toBe(false);
    expect(isOwnedSmokeDir(`${TEMP_ROOT}\\other-dir`, TEMP_ROOT)).toBe(false);
    expect(isOwnedSmokeDir(`${USER_DATA_PREFIX}`, TEMP_ROOT)).toBe(false);
    expect(isOwnedSmokeDir(`${TEMP_ROOT}\\${USER_DATA_PREFIX}!evil*`, TEMP_ROOT)).toBe(false);
    expect(isOwnedSmokeDir(null, TEMP_ROOT)).toBe(false);
  });

  it('удаление подтверждается проверкой, что каталога больше нет', () => {
    const okRunner = () => ({ ok: true, out: 'REMOVED', error: null });
    expect(removeUserData(good, { tempRoot: TEMP_ROOT, runner: okRunner })).toBe(true);
    const stillThere = () => ({ ok: true, out: 'STILL-THERE', error: null });
    expect(removeUserData(good, { tempRoot: TEMP_ROOT, runner: stillThere })).toBe(false);
    const failed = () => ({ ok: false, out: '', error: 'boom' });
    expect(removeUserData(good, { tempRoot: TEMP_ROOT, runner: failed })).toBe(false);
  });

  it('подменённый путь не удаляется вообще (команда не вызывается)', () => {
    let called = 0;
    const runner = () => {
      called += 1;
      return { ok: true, out: 'REMOVED', error: null };
    };
    expect(removeUserData('C:\\Users\\real\\AppData\\Roaming\\pi-wsl-desktop', { tempRoot: TEMP_ROOT, runner })).toBe(false);
    expect(called).toBe(0);
  });
});

describe('P1: вердикт учитывает очистку, а не пустой список killed', () => {
  const owned = { ok: true, reason: null, owned: [ROOT], identities: ids([proc(ROOT, 100, APP_EXE, T0)]) };
  const clean = { ok: true, inconclusive: false, killed: [ROOT], skipped: [], failed: [], order: [ROOT], identities: owned.identities };

  it('PASS только при окне, владении и подтверждённой очистке', () => {
    expect(
      smokeVerdict({ probeOk: true, ownership: owned, cleanup: clean, visible: true, titleMatched: true }),
    ).toEqual({ pass: true, status: 'PASS', reasons: [] });
  });

  it('пустой killed при inconclusive — не PASS', () => {
    const bad = { ok: false, inconclusive: true, killed: [], skipped: [], failed: [], order: [ROOT], identities: owned.identities };
    expect(smokeVerdict({ probeOk: true, ownership: owned, cleanup: bad, visible: true, titleMatched: true })).toMatchObject({
      pass: false,
      status: 'INCONCLUSIVE',
      reasons: ['cleanup-inconclusive'],
    });
  });

  it('неудачная очистка при доказанном владении — FAIL', () => {
    const bad = { ok: false, inconclusive: false, killed: [], skipped: [], failed: [ROOT], order: [ROOT], identities: owned.identities };
    expect(smokeVerdict({ probeOk: true, ownership: owned, cleanup: bad, visible: true, titleMatched: true })).toMatchObject({
      pass: false,
      status: 'FAIL',
      reasons: ['cleanup-failed'],
    });
  });

  it('оставшийся собственный процесс — FAIL', () => {
    expect(
      smokeVerdict({ probeOk: true, ownership: owned, cleanup: clean, visible: true, titleMatched: true, leftoverOwned: [7] }),
    ).toMatchObject({ pass: false, reasons: ['owned-processes-left'] });
  });

  it('переиспользованный PID (чужой процесс) — INCONCLUSIVE, не PASS', () => {
    expect(
      smokeVerdict({ probeOk: true, ownership: owned, cleanup: clean, visible: true, titleMatched: true, mismatchOwned: [9] }),
    ).toMatchObject({ pass: false, status: 'INCONCLUSIVE', reasons: ['owned-identity-mismatch'] });
  });

  it('без окна или с неверным заголовком — FAIL', () => {
    expect(smokeVerdict({ probeOk: true, ownership: owned, cleanup: clean, visible: false, titleMatched: false })).toMatchObject({
      pass: false,
      reasons: ['no-visible-window', 'title-mismatch'],
    });
    expect(smokeVerdict({ probeOk: true, ownership: owned, cleanup: clean, visible: true, titleMatched: false })).toMatchObject({
      pass: false,
      reasons: ['title-mismatch'],
    });
  });

  it('очистка не запускалась — не PASS', () => {
    expect(smokeVerdict({ probeOk: true, ownership: owned, cleanup: null, visible: true, titleMatched: true })).toMatchObject({
      pass: false,
      reasons: ['cleanup-not-run'],
    });
  });

  it('сбой пробы или владения — INCONCLUSIVE', () => {
    expect(smokeVerdict({ probeOk: false, ownership: owned, cleanup: clean, visible: true, titleMatched: true })).toMatchObject({
      status: 'INCONCLUSIVE',
    });
    expect(
      smokeVerdict({ probeOk: true, ownership: { ok: false, reason: 'root-missing', owned: [] }, cleanup: clean, visible: true, titleMatched: true }),
    ).toMatchObject({ status: 'INCONCLUSIVE' });
  });
});

describe('P2: отчёт и аргументы', () => {
  it('отчёт по умолчанию вне репозитория', () => {
    const a = parseSmokeArgs([], '/repo');
    expect(a.out.startsWith('/repo')).toBe(false);
    expect(a.expectTitle).toBe(DEFAULT_EXPECT_TITLE);
  });

  it('--out принимается только явно', () => {
    expect(parseSmokeArgs(['--out', '/tmp/x.json']).out).toBe('/tmp/x.json');
  });

  it('неудачный запуск не выдаёт PID', () => {
    expect(launchApp({ exe: 'C:\\e.exe', appPath: 'C:\\a', cwd: 'C:\\a' }, () => ({ ok: false, out: '', error: 'no-ps' }))).toMatchObject({
      ok: false,
      rootPid: null,
      error: 'no-ps',
    });
  });

  it('успешный запуск возвращает Windows PID', () => {
    const r = launchApp({ exe: 'C:\\e.exe', appPath: 'C:\\a', cwd: 'C:\\a' }, () => ({
      ok: true,
      out: `STARTED 777|${TEMP_ROOT}\\${USER_DATA_PREFIX}z`,
      error: null,
    }));
    expect(r).toMatchObject({ ok: true, rootPid: 777 });
  });

  it('окна отчёта ограничены своими процессами', () => {
    const windows = [
      { pid: ROOT, visible: true, title: 'Pi WSL Desktop' },
      { pid: 9001, visible: true, title: 'Other app' },
    ];
    expect(ownedVisibleWindows(windows, [ROOT])).toHaveLength(1);
    expect(ownedWindows(windows, [ROOT])).toEqual([{ pid: ROOT, visible: true, title: 'Pi WSL Desktop' }]);
  });
});

describe('P2: сбой пробы процессов', () => {
  it('пустая таблица — сбой, а не «нет процессов»', () => {
    expect(probeProcessTable(() => ({ ok: true, out: '', error: null }))).toMatchObject({
      probeOk: false,
      error: 'empty-process-table',
    });
  });

  it('ненулевой код возврата PowerShell — сбой пробы', () => {
    const r = probeProcessTable(() => ({ ok: false, out: '', error: 'exit 1' }));
    expect(r.probeOk).toBe(false);
    expect(r.table).toEqual([]);
  });
});

// --- интеграционные сценарии runSmoke на синтетической модели процессов ---

describe('R08: интеграционные сценарии очистки', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-r08-test-'));
  const outPath = () => path.join(outDir, `out-${Math.random().toString(16).slice(2)}`, 'report.json');
  const TEMP = TEMP_ROOT;

  /**
   * Модель процессов: до launch в таблице только системный PowerShell и чужие
   * Electron-приложения; наши PID появляются при запуске (иначе они попали бы
   * в baseline и владение стало бы недоказуемым).
   */
  function world({ children = [] as number[], foreign = [] as number[] } = {}) {
    const alive = new Map<number, string>();
    const table = () => [
      proc(100, 1, 'C:/Windows/powershell.exe', T0),
      ...foreign.map((pid) => proc(pid, 5555, 'C:/Other/electron.exe', T0)),
      ...[...alive.entries()].map(([pid, created]) => proc(pid, pid === ROOT ? 100 : ROOT, APP_EXE, created)),
    ];
    const start = () => {
      alive.set(ROOT, T0);
      for (const pid of children) alive.set(pid, T1);
    };
    return { alive, children, table, start, probe: () => ({ probeOk: true, table: table(), error: null }) };
  }

  const psFor = (w: ReturnType<typeof world>, opts: { killFails?: boolean; enumThrows?: boolean } = {}) => (script: string) => {
    if (script.includes('EnumWindows')) {
      if (opts.enumThrows) throw new Error('EnumWindows failed');
      return { ok: true, out: 'WIN 4242|True|Pi WSL Desktop', error: null };
    }
    if (script.includes('Stop-Process -Id ')) {
      const pid = Number(/Stop-Process -Id (\d+)/.exec(script)?.[1]);
      if (opts.killFails) return { ok: false, out: '', error: 'stop-failed' };
      w.alive.delete(pid);
      return { ok: true, out: 'KILLED', error: null };
    }
    if (script.includes('Remove-Item')) {
      return { ok: true, out: 'REMOVED', error: null };
    }
    return { ok: true, out: '', error: null };
  };

  type SmokeDeps = NonNullable<Parameters<typeof runSmoke>[1]>;
  const deps = (w: ReturnType<typeof world>, opts: { killFails?: boolean; enumThrows?: boolean } = {}): SmokeDeps => ({
    fs: fakeFs(),
    ps: psFor(w, opts),
    probe: () => w.probe(),
    launch: () => {
      w.start();
      return { ok: true, rootPid: ROOT, userData: `${TEMP}\\${USER_DATA_PREFIX}abcd1234`, error: null };
    },
    verifyUserData: () => `PATH ${TEMP}|${T0}|${USER_DATA_PREFIX}abcd1234`,
    env: {},
    cwd: '/tmp',
  });

  it('(e) видимое окно + корректная очистка → PASS', async () => {
    const w = world({ children: [4243] });
    const r = await runSmoke({ exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE }, deps(w));
    expect(r.status).toBe('PASS');
    expect(r.cleanup?.order).toEqual([4243, ROOT]);
    expect(r.cleanup?.killed).toEqual([4243, ROOT]);
    expect(r.leftoverOwned).toEqual([]);
    expect(r.userDataRemoved).toBe(true);
  });

  it('(a) корень завершён, дочерний продолжает жить → не PASS', async () => {
    // Модель: kill корня удаляет только корень, потомок «залипает».
    const w = world({ children: [4243] });
    const sticky = { ...deps(w) };
    sticky.ps = (script: string) => {
      if (script.includes('EnumWindows')) return { ok: true, out: 'WIN 4242|True|Pi WSL Desktop', error: null };
      if (script.includes('Stop-Process -Id ')) {
        const pid = Number(/Stop-Process -Id (\d+)/.exec(script)?.[1]);
        if (pid !== 4243) w.alive.delete(pid); // потомок остаётся жив
        return { ok: true, out: 'KILLED', error: null };
      }
      return { ok: true, out: '', error: null };
    };
    const r = await runSmoke({ exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE }, sticky);
    expect(r.pass).toBe(false);
    expect(r.leftoverOwned).toContain(4243);
    expect(r.reasons).toContain('owned-processes-left');
  });

  it('(b) последняя проверка PID падает → INCONCLUSIVE, без PASS', async () => {
    const w = world({ children: [] });
    let probes = 0;
    const d = deps(w);
    d.probe = (): { probeOk: boolean; table: ReturnType<typeof proc>[]; error: string | null } => {
      probes += 1;
      if (probes > 3) return { probeOk: false, table: [], error: 'cim-broken' };
      return w.probe();
    };
    const r = await runSmoke({ exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE }, d);
    expect(r.pass).toBe(false);
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.userDataRemoved).toBe(false);
    expect(r.userDataPreserved).toBe(true);
  });

  it('(c) kill возвращает ошибку → FAIL, профиль не удаляется', async () => {
    const w = world({ children: [4243] });
    const r = await runSmoke(
      { exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE },
      deps(w, { killFails: true }),
    );
    expect(r.cleanup?.ok).toBe(false);
    expect(r.cleanup?.failed.length).toBeGreaterThan(0);
    expect(r.pass).toBe(false);
    expect(r.userDataRemoved).toBe(false);
  });

  it('(d) параллельный посторонний Electron переживает прогон', async () => {
    const w = world({ children: [], foreign: [9001, 9002] });
    const r = await runSmoke({ exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE }, deps(w));
    expect(r.cleanup?.killed).toEqual([ROOT]);
    expect(r.cleanup?.killed).not.toContain(9001);
    expect(w.alive.has(9001)).toBe(false); // их вообще не было в модели как «наши»
    const foreignStillAlive = w.table().filter((p: { pid: number }) => p.pid === 9001 || p.pid === 9002);
    expect(foreignStillAlive).toHaveLength(2);
    expect(r.pass).toBe(true);
  });

  it('исключение после доказанного владения всё равно очищает процессы', async () => {
    const w = world({ children: [4243] });
    const r = await runSmoke(
      { exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE },
      deps(w, { enumThrows: true }),
    );
    expect(r.cleanup?.ok).toBe(true);
    expect(r.cleanup?.killed).toEqual([4243, ROOT]);
    expect(r.pass).toBe(false);
  });

  it('сбой пробы ДО старта не запускает приложение', async () => {
    let spawned = false;
    const r = await runSmoke(
      { exe: APP_EXE, out: outPath(), timeoutMs: 300, expectTitle: DEFAULT_EXPECT_TITLE },
      {
        ...deps(world()),
        probe: () => ({ probeOk: false, table: [], error: 'powershell missing' }),
        launch: () => {
          spawned = true;
          return { ok: true, rootPid: ROOT, userData: null, error: null };
        },
      },
    );
    expect(spawned).toBe(false);
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.reasons).toContain('probe-failed-before-launch');
  });

  it('подменённый userData не удаляется и профиль сохраняется', async () => {
    const w = world({ children: [] });
    const d = deps(w);
    d.launch = () => {
      w.start();
      return { ok: true, rootPid: ROOT, userData: 'C:\\Users\\placeholder\\AppData\\Roaming\\pi-wsl-desktop', error: null };
    };
    d.verifyUserData = () => `PATH C:\\Users\\placeholder\\AppData\\Roaming|${T0}|pi-wsl-desktop`;
    const r = await runSmoke({ exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE }, d);
    expect(r.userDataVerified).toBe(false);
    expect(r.userDataRemoved).toBe(false);
    expect(r.userDataPreserved).toBe(true);
  });
});
