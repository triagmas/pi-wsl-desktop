/**
 * UI26 R07 (P1, P2) — безопасность ownership и жизненный цикл Windows GUI smoke.
 *
 * Все проверки — на синтетических таблицах процессов: живой Windows не нужен.
 * Ключевой инвариант: «новый electron.exe» НЕ является доказательством владения,
 * а при неоднозначности не завершается ни один процесс.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  killProven,
  runSmoke,
  cleanupPlan,
  defaultOutPath,
  isOwnedSmokeDir,
  launchApp,
  launchScript,
  parseStartOutput,
  normalizeWinPath,
  winDirname,
  ownedVisibleWindows,
  ownedWindows,
  ownershipCheck,
  parseProcessTable,
  parseSmokeArgs,
  parseWindows,
  probeProcessTable,
  processTableScript,
  smokeVerdict,
  USER_DATA_PREFIX,
  DEFAULT_EXPECT_TITLE,
} from '../../scripts/win-gui-smoke.mjs';

const ROOT = 4242;
const APP_DIR = 'C:\\Apps\\win-electron';
const APP_EXE = `${APP_DIR}\\electron.exe`;
const T0 = '2026-10-29T10:00:00.0000000Z';
const T1 = '2026-10-29T10:00:01.0000000Z';

const proc = (pid: number, parentPid: number, exe = APP_EXE, createdAt = T1) => ({ pid, parentPid, exe, createdAt });

describe('разбор вывода процессов и окон', () => {
  it('таблица процессов разбирается в структуры', () => {
    const out = [
      `PROC ${ROOT}|100|${APP_EXE}|${T0}`,
      `PROC 4243|${ROOT}|${APP_EXE}|${T1}`,
      'noise line',
    ].join('\n');
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
    expect(s).toContain('Win32_Process');
    expect(s).toContain('ParentProcessId');
    expect(s).toContain('CreationDate');
    expect(s).toContain('ExecutablePath');
  });
});

describe('P1: принадлежность процессов доказывается, а не угадывается', () => {
  it('корневой PID из spawn и его потомки — свои', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(4243, ROOT), proc(4244, 4243)];
    const r = ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR });
    expect(r.ok).toBe(true);
    expect(r.owned.sort()).toEqual([ROOT, 4243, 4244].sort());
  });

  it('посторонний Electron (другая ветка процессов) не становится своим', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(9001, 7777), proc(9002, 9001)];
    const r = ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR });
    expect(r.ok).toBe(true);
    expect(r.owned).toEqual([ROOT]);
  });

  it('потомок с другим каталогом exe не считается своим', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(5000, ROOT, 'C:\\Other\\electron.exe')];
    expect(ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR }).owned).toEqual([ROOT]);
  });

  it('PID родителя, переиспользованный чужим процессом, даёт INCONCLUSIVE', () => {
    // Потомок «создан раньше» родителя — значит PID переиспользован.
    const table = [proc(ROOT, 100, APP_EXE, T1), proc(5001, ROOT, APP_EXE, T0)];
    const r = ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('child-created-before-root');
    expect(r.owned).toEqual([]);
  });

  it('PID из baseline в роли потомка даёт INCONCLUSIVE', () => {
    const table = [proc(ROOT, 100, APP_EXE, T0), proc(5002, ROOT, APP_EXE, T1)];
    const r = ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR, baselinePids: [5002] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('child-pid-reused');
  });

  it('корневой PID из baseline (переиспользование) даёт INCONCLUSIVE', () => {
    expect(ownershipCheck({ table: [proc(ROOT, 100, APP_EXE, T0)], rootPid: ROOT, exeDir: APP_DIR, baselinePids: [ROOT] })).toMatchObject(
      { ok: false, reason: 'root-pid-reused' },
    );
  });

  it('тот же PID, но другой exe — не наш процесс', () => {
    const r = ownershipCheck({ table: [proc(ROOT, 100, 'C:\\Other\\electron.exe')], rootPid: ROOT, exeDir: APP_DIR });
    expect(r).toMatchObject({ ok: false, reason: 'root-exe-mismatch', owned: [] });
  });

  it('исчезнувший корневой процесс — не ошибка владения, но и не PASS', () => {
    expect(ownershipCheck({ table: [proc(5003, 1)], rootPid: ROOT, exeDir: APP_DIR })).toMatchObject({
      ok: false,
      reason: 'root-missing',
    });
  });

  it('сбой PowerShell даёт probe-failed и пустой набор', () => {
    expect(ownershipCheck({ table: [], rootPid: ROOT, exeDir: APP_DIR, probeOk: false })).toEqual({
      ok: false,
      reason: 'probe-failed',
      owned: [],
    });
  });

  it('каталог exe приводится к Windows-форме', () => {
    expect(winDirname('F:\\a\\b\\electron.exe')).toBe('F:\\a\\b');
    expect(winDirname('F:/a/b/electron.exe')).toBe('F:\\a\\b');
    expect(winDirname('F:\\a\\b\\')).toBe('F:\\a\\b');
  });

  it('нормализация путей не зависит от регистра и разделителей', () => {
    expect(normalizeWinPath('F:\\Dir\\sub\\')).toBe('f:/dir/sub');
    expect(normalizeWinPath('f:/Dir/sub')).toBe('f:/dir/sub');
  });
});

describe('P1: параллельный чужой Electron переживает прогон', () => {
  // Симуляция: два независимых Electron запущены одновременно.
  const foreign = [proc(8001, 5555, 'C:\\Program Files\\Other\\electron.exe', T0), proc(8002, 8001, 'C:\\Program Files\\Other\\electron.exe', T1)];
  const ours = [proc(ROOT, 100, APP_EXE, T0), proc(4243, ROOT)];

  it('план очистки содержит только наши PID', () => {
    const table = [...ours, ...foreign];
    const ownership = ownershipCheck({ table, rootPid: ROOT, exeDir: APP_DIR });
    const plan = cleanupPlan({ ownership });
    expect(plan.kill.sort()).toEqual([ROOT, 4243].sort());
    expect(plan.kill).not.toContain(8001);
    expect(plan.kill).not.toContain(8002);
  });

  it('чужой процесс не попадает и в окна отчёта', () => {
    const windows = [
      { pid: ROOT, visible: true, title: 'Pi WSL Desktop' },
      { pid: 8001, visible: true, title: 'Other app' },
    ];
    expect(ownedVisibleWindows(windows, [ROOT])).toEqual([{ pid: ROOT, visible: true, title: 'Pi WSL Desktop' }]);
    expect(ownedWindows(windows, [ROOT])).toEqual([{ pid: ROOT, visible: true, title: 'Pi WSL Desktop' }]);
  });
});

describe('P1: при неоднозначности не завершается никто', () => {
  it('недоказанное владение — пустой план очистки', () => {
    const plan = cleanupPlan({ ownership: { ok: false, reason: 'probe-failed', owned: [] } });
    expect(plan).toMatchObject({ kill: [], inconclusive: true });
  });

  it('сбой пробы отменяет завершение даже при «успешном» владении', () => {
    const plan = cleanupPlan({ ownership: { ok: true, reason: null, owned: [1, 2] }, probeOk: false });
    expect(plan.kill).toEqual([]);
    expect(plan.inconclusive).toBe(true);
  });

  it('доказанное владение разрешает завершать ровно свои PID', () => {
    const plan = cleanupPlan({ ownership: { ok: true, reason: null, owned: [3, 4] } });
    expect(plan).toMatchObject({ kill: [3, 4], inconclusive: false });
  });
});

describe('P1: kill только после повторной проверки', () => {
  it('неподтверждённый PID не завершается', () => {
    const killed = killProven([1, 2, 3], { verify: (pid) => pid === 2, kill: () => {} });
    expect(killed).toEqual([2]);
  });

  it('подтверждённые PID завершаются по одному', () => {
    const seen: number[] = [];
    const killed = killProven([7, 8], { verify: () => true, kill: (pid) => seen.push(pid) });
    expect(killed).toEqual([7, 8]);
    expect(seen).toEqual([7, 8]);
  });

  it('при отказе проверки не завершается никто', () => {
    const seen: number[] = [];
    expect(killProven([4, 5], { verify: () => false, kill: (pid) => seen.push(pid) })).toEqual([]);
    expect(seen).toEqual([]);
  });
});

describe('P2: вердикт требует окна, владения и отсутствия остатков', () => {
  const owned = { ok: true, reason: null, owned: [ROOT] };

  it('PASS только при всех условиях', () => {
    expect(smokeVerdict({ probeOk: true, ownership: owned, visible: true, titleMatched: true, leftoverOwned: [] })).toEqual({
      pass: true,
      status: 'PASS',
      reasons: [],
    });
  });

  it('без видимого окна — FAIL', () => {
    expect(smokeVerdict({ probeOk: true, ownership: owned, visible: false, titleMatched: false, leftoverOwned: [] })).toMatchObject({
      pass: false,
      status: 'FAIL',
      reasons: ['no-visible-window', 'title-mismatch'],
    });
  });

  it('неверный заголовок — FAIL', () => {
    expect(smokeVerdict({ probeOk: true, ownership: owned, visible: true, titleMatched: false })).toMatchObject({
      pass: false,
      reasons: ['title-mismatch'],
    });
  });

  it('собственные оставшиеся процессы — FAIL', () => {
    expect(
      smokeVerdict({ probeOk: true, ownership: owned, visible: true, titleMatched: true, leftoverOwned: [7] }),
    ).toMatchObject({ pass: false, reasons: ['owned-processes-left'] });
  });

  it('сбой пробы или владения — INCONCLUSIVE, а не PASS', () => {
    expect(smokeVerdict({ probeOk: false, ownership: { ok: false, reason: 'probe-failed', owned: [] }, visible: true, titleMatched: true })).toMatchObject({
      pass: false,
      status: 'INCONCLUSIVE',
    });
    expect(
      smokeVerdict({ probeOk: true, ownership: { ok: false, reason: 'child-pid-reused', owned: [] }, visible: true, titleMatched: true }),
    ).toMatchObject({ pass: false, status: 'INCONCLUSIVE' });
  });
});

describe('P2: отчёт и временные каталоги', () => {
  it('отчёт по умолчанию вне репозитория', () => {
    const out = defaultOutPath('/tmp', 1234);
    expect(out).toBe(`/tmp/${USER_DATA_PREFIX}1234/report.json`);
    expect(out).not.toContain('pi-wsl-desktop');
  });

  it('аргументы по умолчанию не пишут в checkout', () => {
    const a = parseSmokeArgs([], '/repo');
    expect(a.out.startsWith('/repo')).toBe(false);
    expect(a.out).toMatch(new RegExp(`${USER_DATA_PREFIX}\\d+/report\\.json$`));
    expect(a.expectTitle).toBe(DEFAULT_EXPECT_TITLE);
    expect(a.timeoutMs).toBe(30000);
  });

  it('--out принимается только явно', () => {
    expect(parseSmokeArgs(['--out', '/tmp/x.json']).out).toBe('/tmp/x.json');
  });

  it('удаляется только собственный одноразовый каталог', () => {
    expect(isOwnedSmokeDir(`C:\\Temp\\${USER_DATA_PREFIX}abc123`)).toBe(true);
    expect(isOwnedSmokeDir(`/tmp/${USER_DATA_PREFIX}abc123/`)).toBe(true);
    expect(isOwnedSmokeDir('C:\\Users\\real\\AppData\\Roaming\\pi-wsl-desktop')).toBe(false);
    expect(isOwnedSmokeDir('/tmp/other-dir')).toBe(false);
    expect(isOwnedSmokeDir(`/tmp/${USER_DATA_PREFIX}x/../etc`)).toBe(false);
    expect(isOwnedSmokeDir(`${USER_DATA_PREFIX}`)).toBe(false);
    expect(isOwnedSmokeDir(null)).toBe(false);
  });
});

describe('P1: запуск через PowerShell (Windows PID + env без WSLENV)', () => {
  it('скрипт запуска создаёт одноразовый userData и печатает PID', () => {
    const script = launchScript({ exe: 'C:\\Apps\\electron.exe', appPath: 'C:\\app', cwd: 'C:\\app' });
    expect(script).toContain('PI_WS_DESKTOP_USER_DATA_DIR');
    expect(script).toContain('Start-Process');
    expect(script).toContain('-PassThru');
    expect(script).toContain('STARTED');
    expect(script).toContain(USER_DATA_PREFIX);
  });

  it('вывод запуска разбирается в PID и каталог', () => {
    expect(parseStartOutput('noise\nSTARTED 1234|C:\\Temp\\pi-gui-smoke-abcd')).toEqual({
      rootPid: 1234,
      userData: 'C:\\Temp\\pi-gui-smoke-abcd',
    });
    expect(parseStartOutput('STARTED notapid|x')).toBeNull();
    expect(parseStartOutput('')).toBeNull();
  });

  it('неудачный запуск не выдаёт PID', () => {
    const r = launchApp({ exe: 'C:\\e.exe', appPath: 'C:\\a', cwd: 'C:\\a' }, () => ({ ok: false, out: '', error: 'no-ps' }));
    expect(r).toMatchObject({ ok: false, rootPid: null, error: 'no-ps' });
  });

  it('успешный запуск возвращает Windows PID', () => {
    const r = launchApp({ exe: 'C:\\e.exe', appPath: 'C:\\a', cwd: 'C:\\a' }, () => ({
      ok: true,
      out: 'STARTED 777|C:\\Temp\\pi-gui-smoke-z',
      error: null,
    }));
    expect(r).toMatchObject({ ok: true, rootPid: 777 });
  });
});

describe('P2: сбой пробы процессов', () => {
  it('пустая таблица считается сбоем, а не «нет процессов»', () => {
    const r = probeProcessTable(() => ({ ok: true, out: '', error: null }));
    expect(r).toMatchObject({ probeOk: false, error: 'empty-process-table' });
  });

  it('ненулевой код возврата PowerShell — сбой пробы', () => {
    const r = probeProcessTable(() => ({ ok: false, out: '', error: 'exit 1' }));
    expect(r.probeOk).toBe(false);
    expect(r.table).toEqual([]);
  });

  it('успешная проба возвращает таблицу', () => {
    const r = probeProcessTable(() => ({ ok: true, out: `PROC 1|0|${APP_EXE}|${T0}`, error: null }));
    expect(r.probeOk).toBe(true);
    expect(r.table).toHaveLength(1);
  });
});


describe('P1: try/finally — очистка при исключении', () => {
  const tmpTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gui-smoke-test-'));
  const snapshot = (rows: ReturnType<typeof proc>[]) => ({ probeOk: true, table: rows, error: null });
  const outPath = () => path.join(tmpTmp, `out-${Math.random().toString(16).slice(2)}`, 'report.json');
  // Каталог поставки в тестах не существует, поэтому подменяем только чтение
  // списка файлов (проверка маркеров остаётся настоящей).
  const fakeFs = () =>
    ({
      ...fs,
      readdirSync: () => ['electron.exe', 'resources.pak', 'icudtl.dat', 'snapshot_blob.bin', 'ffmpeg.dll', 'd3dcompiler_47.dll', 'vulkan-1.dll', 'vk_swiftshader.dll'],
    }) as unknown as typeof fs;

  it('исключение после доказанного владения всё равно завершает свои процессы', async () => {
    const calls: string[] = [];
    // До старта приложения его нет в таблице процессов — иначе PID попал бы
    // в baseline и владение стало бы недоказуемым (что тоже покрыто тестами).
    const alive = new Set<number>();
    // Реалистичная модель: таблица отражает живые процессы, kill меняет её.
    const probe = () => snapshot([proc(100, 1, 'C:/Windows/powershell.exe', T0), ...(alive.has(ROOT) ? [proc(ROOT, 100, APP_EXE, T0)] : [])]);
    const result = await runSmoke(
      { exe: APP_EXE, out: outPath(), timeoutMs: 600, expectTitle: DEFAULT_EXPECT_TITLE },
      {
        fs: fakeFs(),
        ps: (script: string) => {
          calls.push(script);
          if (script.includes('EnumWindows')) throw new Error('EnumWindows failed');
          if (script.includes('Stop-Process')) alive.delete(ROOT);
          return { ok: true, out: '', error: null };
        },
        probe,
        launch: () => {
          alive.add(ROOT);
          return { ok: true, rootPid: ROOT, userData: 'C:\\Temp\\pi-gui-smoke-abc123', error: null };
        },
        env: {},
        cwd: '/tmp',
      },
    );
    expect(calls.some((c) => c.includes(`Stop-Process -Id ${ROOT}`))).toBe(true);
    expect(result.cleanup?.killed).toEqual([ROOT]);
    expect(result.leftoverOwned).toEqual([]);
    expect(result.pass).toBe(false);
  });

  it('исключение до доказательства владения не завершает никого', async () => {
    const calls: string[] = [];
    let step = 0;
    const probe = () => {
      step += 1;
      if (step === 1) return snapshot([proc(100, 1, 'C:/Windows/powershell.exe', T0)]);
      return { probeOk: false, table: [], error: 'cim-broken' };
    };
    const result = await runSmoke(
      { exe: APP_EXE, out: outPath(), timeoutMs: 300, expectTitle: DEFAULT_EXPECT_TITLE },
      {
        fs: fakeFs(),
        ps: (script) => {
          calls.push(script);
          return { ok: true, out: '', error: null };
        },
        probe,
        launch: () => ({ ok: true, rootPid: ROOT, userData: 'C:\\Temp\\pi-gui-smoke-abc123', error: null }),
        env: {},
        cwd: '/tmp',
      },
    );
    expect(calls.filter((c) => c.includes('Stop-Process'))).toEqual([]);
    expect(result.cleanup?.inconclusive).toBe(true);
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.pass).toBe(false);
  });

  it('сбой пробы ДО старта не запускает приложение', async () => {
    let spawned = false;
    const result = await runSmoke(
      { exe: APP_EXE, out: outPath(), timeoutMs: 300, expectTitle: DEFAULT_EXPECT_TITLE },
      {
        fs: fakeFs(),
        ps: () => ({ ok: false, out: '', error: 'powershell missing' }),
        probe: () => ({ probeOk: false, table: [], error: 'powershell missing' }),
        launch: () => {
          spawned = true;
          return { ok: true, rootPid: ROOT, userData: 'C:\\Temp\\pi-gui-smoke-abc123', error: null };
        },
        env: {},
        cwd: '/tmp',
      },
    );
    expect(spawned).toBe(false);
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.reasons).toContain('probe-failed-before-launch');
  });

  it('отчёт по умолчанию не попадает в репозиторий и удаляется только свой tmp', async () => {
    const out = outPath();
    const result = await runSmoke(
      { exe: APP_EXE, out, timeoutMs: 200, expectTitle: DEFAULT_EXPECT_TITLE },
      {
        fs: fakeFs(),
        ps: () => ({ ok: true, out: '', error: null }),
        probe: () => snapshot([proc(100, 1, 'C:\\Windows\\powershell.exe', T0)]),
        launch: () => ({ ok: true, rootPid: ROOT, userData: 'C:\\Temp\\pi-gui-smoke-abc123', error: null }),
        env: {},
        cwd: '/tmp',
      },
    );
    expect(result.pass).toBe(false);
    expect(fs.existsSync(out)).toBe(true);
    // userData принадлежит прогону и удаляется через PowerShell; отчёт — на месте.
    expect(result.userData).toMatch(new RegExp(`${USER_DATA_PREFIX}[a-z0-9]+$`));
    expect(result.userDataRemoved).toBe(true);
  });
});
