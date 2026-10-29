/**
 * UI26 R07 (P1, P2) — воспроизводимый Windows GUI smoke.
 *
 * Проверяет именно ВИДИМОЕ нативное окно (Win32 `EnumWindows` +
 * `IsWindowVisible`), а не «сборка прошла» и не «статус-колбэк renderer».
 *
 * Безопасность процессов (R07):
 *  - собственными считаются ТОЛЬКО процессы, доказавшие принадлежность:
 *    корневой PID, который вернул `spawn`, его потомки по `ParentProcessId`,
 *    с тем же каталогом исполняемого файла, временем создания не раньше
 *    корневого и отсутствующие в baseline;
 *  - «новый electron.exe в системе» НЕ является доказательством владения;
 *  - при сбое PowerShell или любой неоднозначности (PID из baseline, нет
 *    корневого процесса, чужой exe) — `INCONCLUSIVE`, и не завершается
 *    НИ ОДИН процесс;
 *  - все операции после запуска обёрнуты в `try/finally`, очистка выполняется
 *    и при исключении;
 *  - PASS требует видимое окно с ожидаемым заголовком И отсутствие
 *    собственных оставшихся процессов.
 *
 * Данные и изоляция:
 *  - запуск идёт через PowerShell (`Start-Process -PassThru`): только так
 *    известен WINDOWS-PID для проверки владения, и только так применяется
 *    переменная окружения — WSL не передаёт произвольные env в Windows-процесс
 *    без `WSLENV` (в R06 из-за этого приложение стартовало с РЕАЛЬНЫМ профилем);
 *  - `PI_WS_DESKTOP_USER_DATA_DIR` → одноразовый каталог `pi-gui-smoke-*`
 *    в Windows-temp; после прогона удаляется только он;
 *  - ноль model calls: ни одного промпта не отправляется;
 *  - приложение при старте поднимает обычный `conn.start()`, поэтому
 *    read-only обнаружение Pi возможно — изоляция userData НЕ означает, что
 *    Pi-история не читается (см. docs/development/windows-launch.md);
 *  - отчёт по умолчанию пишется ВНЕ репозитория (временный каталог); путь
 *    задаётся `--out` явно;
 *  - в JSON попадают только собственные окна и пути самого прогона.
 *
 * CI: не запускается (Windows GUI требует живого рабочего стола) — `NOT RUN in CI`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveWinElectron, posixPathToWindows, windowsPathToPosix } from './start-win.mjs';
import { verifyElectronDist, explainFailure } from './check-electron-dist.mjs';

export const DEFAULT_EXPECT_TITLE = 'Pi WSL Desktop';
export const USER_DATA_PREFIX = 'pi-gui-smoke-';
const PS = path.join('/mnt/c/Windows/System32/WindowsPowerShell/v1.0', 'powershell.exe');

/** Разбор вывода `WIN <pid>|<visible>|<title>` в структуры. */
export function parseWindows(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('WIN '))
    .map((line) => line.slice(4))
    .map((body) => {
      const [pid, visible, ...rest] = body.split('|');
      return { pid: Number(pid), visible: visible === 'True', title: rest.join('|') };
    })
    .filter((w) => Number.isFinite(w.pid));
}

/** Разбор вывода `PROC <pid>|<ppid>|<exe>|<created>` в структуры. */
export function parseProcessTable(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('PROC '))
    .map((line) => line.slice(5))
    .map((body) => {
      const [pid, parentPid, exe, created] = body.split('|');
      return { pid: Number(pid), parentPid: Number(parentPid), exe: exe ?? '', createdAt: created ?? '' };
    })
    .filter((p) => Number.isFinite(p.pid) && Number.isFinite(p.parentPid));
}

/** Нормализация пути для сравнения каталогов (регистр, разделители). */
export function normalizeWinPath(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Каталог в Windows-форме: сравнение идёт с `ExecutablePath` из CIM. */
export function winDirname(p) {
  const raw = String(p ?? '').replace(/\//g, '\\');
  if (raw === '') return '';
  const hadTrailingSep = /\\$/.test(raw);
  const norm = raw.replace(/\\+$/, '');
  if (hadTrailingSep) return norm; // уже каталог
  const idx = norm.lastIndexOf('\\');
  return idx <= 0 ? norm : norm.slice(0, idx);
}

const isInDir = (exe, dir) => {
  const e = normalizeWinPath(exe);
  const d = normalizeWinPath(dir);
  return e !== '' && d !== '' && (e === d || e.startsWith(`${d}/`));
};

/** Окна, принадлежащие нашим процессам (используется и для отчёта). */
export function ownedWindows(windows, ownedPids) {
  const owned = new Set(ownedPids.map(Number));
  return windows.filter((w) => owned.has(w.pid));
}

/** Только видимые окна собственных процессов. */
export function ownedVisibleWindows(windows, ownedPids) {
  const owned = new Set(ownedPids.map(Number));
  return windows.filter((w) => owned.has(w.pid) && w.visible);
}

/**
 * Доказательство принадлежности процессов.
 *
 * `owned` — корневой PID плюс потомки, прошедшие ВСЕ проверки. Любая
 * неоднозначность делает результат `ok: false` (fail-closed): в этом случае
 * вызывающая сторона обязана не завершать ничего.
 */
export function ownershipCheck({ table, rootPid, exeDir, baselinePids = [], probeOk = true }) {
  if (!probeOk) return { ok: false, reason: 'probe-failed', owned: [] };
  const root = (table ?? []).find((p) => p.pid === Number(rootPid));
  if (!root) return { ok: false, reason: 'root-missing', owned: [] };
  if (!isInDir(root.exe, exeDir)) return { ok: false, reason: 'root-exe-mismatch', owned: [] };
  const baseline = new Set(baselinePids.map(Number));
  // PID переиспользован чужим процессом — принадлежность недоказуема.
  if (baseline.has(root.pid)) return { ok: false, reason: 'root-pid-reused', owned: [] };

  const rootTime = Date.parse(root.createdAt);
  const owned = [root.pid];
  const queue = [root.pid];
  let ambiguous = null;
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const cand of table) {
      if (cand.parentPid !== parent || owned.includes(cand.pid)) continue;
      if (!isInDir(cand.exe, exeDir)) continue; // чужой бинарник — не наш потомок
      const t = Date.parse(cand.createdAt);
      // Потомок не может быть создан раньше родителя: PID переиспользован.
      if (!Number.isFinite(t) || !Number.isFinite(rootTime) || t < rootTime) {
        ambiguous = ambiguous ?? 'child-created-before-root';
        continue;
      }
      if (baseline.has(cand.pid)) {
        ambiguous = ambiguous ?? 'child-pid-reused';
        continue;
      }
      owned.push(cand.pid);
      queue.push(cand.pid);
    }
  }
  if (ambiguous) return { ok: false, reason: ambiguous, owned: [] };
  return { ok: true, reason: null, owned };
}

/**
 * План очистки: завершать можно только доказанно свои процессы. При любом
 * сомнении — никого не завершаем и сообщаем об этом.
 */
export function cleanupPlan({ ownership, probeOk = true }) {
  if (!probeOk || !ownership?.ok) {
    return { kill: [], inconclusive: true, note: 'принадлежность не доказана — процессы не завершаются' };
  }
  return { kill: [...ownership.owned], inconclusive: false, note: null };
}

/**
 * Итоговый вердикт. PASS — только видимое окно с нужным заголовком, доказанное
 * владение и отсутствие собственных оставшихся процессов.
 */
export function smokeVerdict({ probeOk, ownership, visible, titleMatched, leftoverOwned = [] }) {
  const reasons = [];
  if (!probeOk) reasons.push('probe-failed');
  if (!ownership?.ok) reasons.push(`ownership-${ownership?.reason ?? 'unknown'}`);
  if (!visible) reasons.push('no-visible-window');
  if (!titleMatched) reasons.push('title-mismatch');
  if (leftoverOwned.length > 0) reasons.push('owned-processes-left');
  const pass = reasons.length === 0;
  return {
    pass,
    status: pass ? 'PASS' : probeOk && ownership?.ok ? 'FAIL' : 'INCONCLUSIVE',
    reasons,
  };
}

/** Отчёт по умолчанию — вне репозитория, в одноразовом каталоге системного tmp. */
export function defaultOutPath(tmpDir = os.tmpdir(), now = Date.now()) {
  return path.join(tmpDir, `${USER_DATA_PREFIX}${now}`, 'report.json');
}

/**
 * Удалять разрешено только собственный одноразовый каталог: имя с нашим
 * префиксом, без переходов вверх. Каталог создаёт сам harness, значение не
 * приходит из аргументов пользователя.
 */
export function isOwnedSmokeDir(dir) {
  if (!dir) return false;
  const norm = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm.split('/').includes('..')) return false;
  const base = norm.split('/').pop() ?? '';
  return base.startsWith(USER_DATA_PREFIX) && base.length > USER_DATA_PREFIX.length;
}

/**
 * PowerShell-скрипт перечисления окон. Возвращает все окна: ownership-фильтр
 * делается в JS по доказанному набору PID.
 */
export function windowScript() {
  return `
$sig = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WSmoke {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> All() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      int n = GetWindowTextLength(h);
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity);
      r.Add(pid + "|" + IsWindowVisible(h) + "|" + (n == 0 ? "" : sb.ToString()));
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
Add-Type -TypeDefinition $sig
[WSmoke]::All() | ForEach-Object { "WIN $_" }
`;
}

/**
 * Скрипт запуска приложения.
 *
 * Почему через PowerShell, а не `spawn` из WSL:
 *  - `spawn` возвращает PID linux-стороны interop, а не Windows PID, поэтому
 *    проверить владение по CIM невозможно;
 *  - WSL не передаёт произвольные переменные окружения в Windows-процесс без
 *    `WSLENV`, поэтому `PI_WS_DESKTOP_USER_DATA_DIR` терялся и приложение
 *    стартовало с РЕАЛЬНЫМ профилем. Здесь переменная выставляется в самой
 *    PowerShell-сессии, и дочерний процесс её наследует.
 */
export function launchScript({ exe, appPath, cwd }) {
  return `
$dir = Join-Path $env:TEMP ("pi-gui-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $dir | Out-Null
$env:PI_WS_DESKTOP_USER_DATA_DIR = $dir
$p = Start-Process -FilePath '${exe}' -ArgumentList '${appPath}' -WorkingDirectory '${cwd}' -PassThru
"STARTED $($p.Id)|$dir"
`;
}

/** Разбор вывода запуска: `STARTED <pid>|<userData>`. */
export function parseStartOutput(stdout) {
  const line = String(stdout ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('STARTED '));
  if (!line) return null;
  const [pidRaw, ...rest] = line.slice(8).split('|');
  const rootPid = Number(pidRaw);
  if (!Number.isFinite(rootPid) || rootPid <= 0) return null;
  return { rootPid, userData: rest.join('|').trim() };
}

/** Запуск приложения с одноразовым userData в Windows-temp. */
export function launchApp({ exe, appPath, cwd }, runner = ps) {
  const r = runner(launchScript({ exe, appPath, cwd }));
  if (!r.ok) return { ok: false, rootPid: null, userData: null, error: r.error ?? 'launch-failed' };
  const parsed = parseStartOutput(r.out);
  if (!parsed) return { ok: false, rootPid: null, userData: null, error: 'start-not-confirmed' };
  return { ok: true, ...parsed, error: null };
}

/** Удаляется только каталог, созданный этим прогоном (по префиксу). */
export function removeUserData(dir, runner = ps) {
  if (!isOwnedSmokeDir(dir)) return false;
  const r = runner(`Remove-Item -LiteralPath '${dir}' -Recurse -Force -ErrorAction SilentlyContinue; 'OK'`);
  return r.ok;
}

/** PowerShell-скрипт снимка таблицы процессов (PID, родитель, exe, создание). */
export function processTableScript() {
  return `
Get-CimInstance Win32_Process | ForEach-Object {
  $created = ''
  if ($_.CreationDate) { $created = $_.CreationDate.ToString('o') }
  "PROC $($_.ProcessId)|$($_.ParentProcessId)|$($_.ExecutablePath)|$created"
}
`;
}

function ps(script, timeout = 40000) {
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), error: r.error ? String(r.error.message ?? r.error) : null };
}

/** Разбор аргументов CLI (чистая функция). */
export function parseSmokeArgs(argv, cwd = process.cwd()) {
  void cwd;
  const out = { exe: null, out: defaultOutPath(), timeoutMs: 30000, expectTitle: DEFAULT_EXPECT_TITLE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exe') out.exe = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (argv[i] === '--expect-title') out.expectTitle = argv[++i];
  }
  return out;
}

/** Снимок таблицы процессов; `probeOk` отражает успех PowerShell/CIM. */
export function probeProcessTable(runner = ps) {
  const r = runner(processTableScript());
  if (!r.ok) return { probeOk: false, table: [], error: r.error ?? 'powershell-exit-nonzero' };
  const table = parseProcessTable(r.out);
  if (table.length === 0) return { probeOk: false, table: [], error: 'empty-process-table' };
  return { probeOk: true, table, error: null };
}

/**
 * Завершение с ПОВТОРНОЙ проверкой каждого PID непосредственно перед kill:
 * если свежая проба не подтвердила принадлежность — процесс не трогаем.
 */
export function killProven(owned, { verify, kill }) {
  const killed = [];
  for (const pid of owned) {
    if (!verify(pid)) continue;
    kill(pid);
    killed.push(Number(pid));
  }
  return killed;
}

/** Завершение только доказанно своих PID (никаких «всех новых electron.exe»). */
export function killOwned(owned, runner = ps) {
  const killed = [];
  for (const pid of owned) {
    const r = runner(`Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue; 'OK'`);
    if (r.ok) killed.push(Number(pid));
  }
  return killed;
}

export async function runSmoke({ exe, out, timeoutMs, expectTitle }, deps = {}) {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const run = deps.ps ?? ps;
  const fsImpl = deps.fs ?? fs;
  const explorer = deps.probe ?? ((r) => probeProcessTable(r));
  const localExe = exe ? windowsPathToPosix(exe) : null;
  const found = localExe
    ? { exe: localExe, dist: path.dirname(localExe), fromEnv: true }
    : resolveWinElectron(env, cwd, fs.existsSync);
  if (!found) throw new Error('Не найдена Windows-сборка Electron');
  const check = verifyElectronDist('win32', fsImpl.readdirSync(found.dist));
  if (!check.ok) throw new Error(explainFailure(check, found.dist));

  // PRE-FLIGHT: если таблицу процессов получить нельзя, НЕ запускаем ничего
  // (иначе владение будет недоказуемо и завершать процессы нельзя).
  const before = explorer(run);
  if (!before.probeOk) {
    const report = {
      status: 'INCONCLUSIVE',
      pass: false,
      reasons: ['probe-failed-before-launch'],
      probeError: before.error,
      exe: found.exe,
      startedAt: new Date().toISOString(),
    };
    writeReport(out, report, deps);
    return report;
  }

  const baselinePids = before.table.map((p) => p.pid);
  // Сравнение идёт с `ExecutablePath` из CIM, то есть в Windows-форме.
  const winExe = /^[A-Za-z]:[\\/]/.test(exe ?? '') ? exe : posixPathToWindows(found.exe);
  const exeDir = winDirname(winExe);
  const report = {
    status: 'INCONCLUSIVE',
    pass: false,
    reasons: [],
    exe: found.exe,
    userData: null,
    startedAt: new Date().toISOString(),
    expectedTitle: expectTitle,
    baselineProcessCount: baselinePids.length,
    windows: [],
    visible: false,
    titleMatched: false,
    ownedPids: [],
    elapsedMs: null,
    cleanup: null,
  };
  let child = null;
  let ownership = { ok: false, reason: 'not-checked', owned: [] };
  let probeOk = true;
  try {
    const launch = (deps.launch ?? ((opts) => launchApp(opts, run)))({
      exe: posixPathToWindows(found.exe),
      appPath: posixPathToWindows(cwd),
      cwd: posixPathToWindows(cwd),
    });
    if (!launch.ok) {
      report.launchError = launch.error;
      report.reasons = ['launch-failed'];
      writeReport(out, report, deps);
      return report;
    }
    child = { pid: launch.rootPid, kill() {} };
    report.rootPid = launch.rootPid;
    report.userData = launch.userData;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const snap = explorer(run);
      probeOk = snap.probeOk;
      if (!snap.probeOk) {
        report.probeError = snap.error;
        break;
      }
      ownership = ownershipCheck({
        table: snap.table,
        rootPid: child.pid,
        exeDir,
        baselinePids,
      });
      report.ownedPids = ownership.owned;
      report.ownershipReason = ownership.reason;
      if (!ownership.ok) break; // неоднозначность: дальше только отчёт
      const windows = parseWindows(run(windowScript()).out);
      const visible = ownedVisibleWindows(windows, ownership.owned);
      if (visible.length > 0) {
        report.windows = ownedWindows(windows, ownership.owned);
        report.visible = true;
        report.titleMatched = visible.some((w) => w.title === expectTitle);
        report.elapsedMs = timeoutMs - (deadline - Date.now());
        break;
      }
    }
  } catch (err) {
    report.error = String(err instanceof Error ? err.message : err);
  } finally {
    // Очистка при любом исходе: перепроверяем принадлежность и завершаем
    // только доказанно свои процессы.
    const plan = cleanupPlan({ ownership, probeOk });
    if (plan.inconclusive) {
      report.cleanup = { killed: [], inconclusive: true, note: plan.note, rootPid: report.rootPid ?? null };
    } else {
      const recheck = explorer(run);
      const still = recheck.probeOk
        ? ownershipCheck({ table: recheck.table, rootPid: child?.pid, exeDir, baselinePids })
        : { ok: false, reason: 'probe-failed', owned: [] };
      const killable = still.ok ? plan.kill.filter((p) => still.owned.includes(p)) : [];
      const verifyPid = (pid) => {
        const snap = explorer(run);
        if (!snap.probeOk) return false;
        const fresh = ownershipCheck({ table: snap.table, rootPid: child?.pid, exeDir, baselinePids });
        return fresh.ok && fresh.owned.includes(Number(pid));
      };
      const killed = killProven(killable, { verify: verifyPid, kill: (pid) => killOwned([pid], run) });
      report.cleanup = { killed, inconclusive: !still.ok, note: still.ok ? null : 'повторная проверка не удалась' };
    }
    // Проверяем, что собственных процессов не осталось. Если проверить
    // нельзя — считаем оставшимися (fail-closed), а не «всё чисто».
    const killed = report.cleanup.killed ?? [];
    if (killed.length > 0) {
      const after = explorer(run);
      report.leftoverOwned = after.probeOk
        ? killed.filter((p) => after.table.some((x) => x.pid === p))
        : killed;
    } else {
      report.leftoverOwned = [];
    }
    // Удаляем только собственный одноразовый каталог (создан этим прогоном).
    report.userDataRemoved = removeUserData(report.userData, run);
  }
  const verdict = smokeVerdict({
    probeOk,
    ownership,
    visible: report.visible,
    titleMatched: report.titleMatched,
    leftoverOwned: report.leftoverOwned ?? [],
  });
  report.status = verdict.status;
  report.pass = verdict.pass;
  report.reasons = verdict.reasons;
  writeReport(out, report, deps);
  return report;
}

function writeReport(out, report, deps = {}) {
  const fsImpl = deps.fs ?? fs;
  fsImpl.mkdirSync(path.dirname(out), { recursive: true });
  fsImpl.writeFileSync(out, JSON.stringify(report, null, 2));
}

async function main() {
  const args = parseSmokeArgs(process.argv.slice(2));
  const report = await runSmoke(args);
  console.log(
    JSON.stringify(
      { status: report.status, reasons: report.reasons, windows: report.windows, elapsedMs: report.elapsedMs },
      null,
      1,
    ),
  );
  if (!report.pass) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
