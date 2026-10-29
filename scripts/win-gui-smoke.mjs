/**
 * UI26 R08 — воспроизводимый Windows GUI smoke.
 *
 * Проверяет именно ВИДИМОЕ нативное окно (Win32 `EnumWindows` +
 * `IsWindowVisible`), а не «сборка прошла» и не «статус-колбэк renderer».
 *
 * Безопасность процессов:
 *  - собственными считаются ТОЛЬКО процессы, доказавшие принадлежность:
 *    корневой PID от запуска, его потомки по `ParentProcessId` с тем же
 *    каталогом `ExecutablePath`, временем создания не раньше корневого и
 *    отсутствующие в baseline-снимке;
 *  - «новый electron.exe в системе» владением не является;
 *  - идентичность фиксируется парой PID + время создания, поэтому проверка
 *    живости не зависит от того, жив ли ещё корневой процесс;
 *  - завершение идёт от потомков к родителю, с повторной проверкой
 *    идентичности перед каждым PID; несовпадение → прекращаем завершение;
 *  - после очистки проверяется живость ВСЕХ изначально доказанных процессов,
 *    а не только тех, по которым вызывался kill;
 *  - PASS невозможен, если очистка не подтверждена; при любой неоднозначности
 *    статус `INCONCLUSIVE`/`FAIL` и ни один посторонний процесс не трогается.
 *
 * Данные и изоляция:
 *  - запуск идёт через PowerShell (UTF-16LE `-EncodedCommand`), значения
 *    подставляются в кавычки безопасно: апострофы, пробелы и спецсимволы в
 *    Windows-путях не ломают команду и не позволяют инъекцию;
 *  - `PI_WS_DESKTOP_USER_DATA_DIR` → одноразовый каталог `pi-gui-smoke-*`
 *    в Windows-temp; каталог удаляется только если доказано, что он создан
 *    этим прогоном, и все доказанно свои процессы уже завершены;
 *  - ноль model calls; приложение поднимает обычный `conn.start()`, поэтому
 *    read-only обнаружение Pi возможно — изоляция userData этого не отменяет;
 *  - отчёт по умолчанию пишется вне репозитория; в JSON попадают только
 *    собственные окна и пути самого прогона.
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

/**
 * Безопасная подстановка строки в PowerShell-код: одинарные кавычки
 * удваиваются, поэтому апострофы, пробелы и `$`/`;` внутри значений не
 * исполняются. Вместе с `-EncodedCommand` это исключает инъекцию.
 */
export function psQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

/** PowerShell `-EncodedCommand` принимает UTF-16LE в base64. */
export function encodePowerShell(script) {
  return Buffer.from(String(script ?? ''), 'utf16le').toString('base64');
}

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
 * неоднозначность делает результат `ok: false` (fail-closed).
 */
export function ownershipCheck({ table, rootPid, exeDir, baselinePids = [], probeOk = true }) {
  if (!probeOk) return { ok: false, reason: 'probe-failed', owned: [] };
  const root = (table ?? []).find((p) => p.pid === Number(rootPid));
  if (!root) return { ok: false, reason: 'root-missing', owned: [] };
  if (!isInDir(root.exe, exeDir)) return { ok: false, reason: 'root-exe-mismatch', owned: [] };
  const baseline = new Set(baselinePids.map(Number));
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
  return { ok: true, reason: null, owned, identities: identitiesOf(table, owned) };
}

/**
 * Идентичность процессов: PID + время создания. Живость проверяется по этой
 * паре, поэтому она не зависит от существования корневого процесса.
 */
export function identitiesOf(table, pids) {
  const set = new Set(pids.map(Number));
  return (table ?? [])
    .filter((p) => set.has(p.pid))
    .map((p) => ({ pid: p.pid, createdAt: p.createdAt, exe: p.exe }));
}

/** Глубина процесса относительно корня (для порядка завершения). */
function depthOf(pid, parentOf, guard = 0) {
  if (guard > 32) return 0;
  const parent = parentOf.get(pid);
  if (parent === undefined || parent === null || parent === pid) return 0;
  return 1 + depthOf(parent, parentOf, guard + 1);
}

/**
 * Порядок завершения: сначала самые глубокие потомки, корень — последним.
 * Детерминированно при равной глубине (по возрастанию PID).
 */
export function killOrder(identities, table = []) {
  const parentOf = new Map((table ?? []).map((p) => [p.pid, p.parentPid]));
  return [...identities]
    .map((id) => ({ id, depth: depthOf(id.pid, parentOf) }))
    .sort((a, b) => b.depth - a.depth || a.id.pid - b.id.pid)
    .map((x) => x.id);
}

/**
 * Живость изначально доказанных процессов.
 *
 * `alive`   — идентичность подтверждена (PID + время создания + каталог exe);
 * `gone`    — процесса нет (успешное завершение);
 * `mismatch`— PID существует, но идентичность другая (переиспользование):
 *             это НЕ наш процесс, трогать его нельзя.
 */
export function verifyOwnedIdentities({ table, identities, exeDir, probeOk = true }) {
  if (!probeOk) return { ok: false, reason: 'probe-failed', alive: [], gone: [], mismatch: [], unknown: identities.map((i) => i.pid) };
  const byPid = new Map((table ?? []).map((p) => [p.pid, p]));
  const alive = [];
  const gone = [];
  const mismatch = [];
  for (const id of identities ?? []) {
    const cur = byPid.get(id.pid);
    if (!cur) {
      gone.push(id.pid);
      continue;
    }
    const sameTime = String(cur.createdAt ?? '') === String(id.createdAt ?? '');
    if (sameTime && isInDir(cur.exe, exeDir)) alive.push(id.pid);
    else mismatch.push(id.pid);
  }
  return { ok: true, reason: null, alive, gone, mismatch, unknown: [] };
}

/**
 * Завершение по порядку «потомки → родитель» с проверками:
 *  - перед каждым PID идентичность перепроверяется;
 *  - `gone` — процесс уже завершён (не ошибка);
 *  - `mismatch`/сбой пробы — прекращаем завершение (fail-closed);
 *  - после kill живость проверяется заново; неудача фиксируется как failed.
 */
export function killProven(ordered, { verify, kill, recheck }) {
  const killed = [];
  const skipped = [];
  const failed = [];
  let aborted = null;
  for (const identity of ordered) {
    const pid = Number(identity.pid);
    const state = verify(identity);
    if (state === 'gone') {
      skipped.push(pid);
      continue;
    }
    if (state !== 'alive') {
      aborted = `verify-${state}`;
      break;
    }
    if (!kill(identity)) {
      failed.push(pid);
      continue;
    }
    const after = recheck(identity);
    if (after === 'gone') killed.push(pid);
    else failed.push(pid);
  }
  return { killed, skipped, failed, aborted };
}

/** Команда завершения одного доказанного процесса (без «глушения» ошибок). */
export function killScript(pid) {
  return `Stop-Process -Id ${Number(pid)} -Force -ErrorAction Stop; 'KILLED'`;
}

/** Завершение только доказанно своих PID (по одному, с проверкой результата). */
export function killOwned(owned, runner = ps) {
  const killed = [];
  for (const pid of owned) {
    const r = runner(killScript(pid));
    if (r.ok && /KILLED/.test(String(r.out ?? ''))) killed.push(Number(pid));
  }
  return killed;
}

/** PowerShell-скрипт перечисления окон. Ownership-фильтр делается в JS. */
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
 *  - `spawn` возвращает PID linux-стороны interop, а не Windows PID;
 *  - WSL не передаёт произвольные переменные окружения в Windows-процесс без
 *    `WSLENV`, поэтому `PI_WS_DESKTOP_USER_DATA_DIR` терялся.
 * Все значения подставляются через `psQuote` (апострофы удваиваются).
 */
export function launchScript({ exe, appPath, cwd }) {
  return `
$dir = Join-Path $env:TEMP ("${USER_DATA_PREFIX}" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
$env:PI_WS_DESKTOP_USER_DATA_DIR = $dir
$p = Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${psQuote(appPath)} -WorkingDirectory ${psQuote(cwd)} -PassThru -ErrorAction Stop
"STARTED $($p.Id)|$dir"
`;
}

/** Скрипт проверки, что каталог профиля создан этим прогоном. */
export function verifyUserDataScript(dir) {
  return `
$d = Get-Item -LiteralPath ${psQuote(dir)} -Force -ErrorAction Stop
"PATH $($d.Parent.FullName)|$($d.CreationTimeUtc.ToString('o'))|$($d.Name)"
`;
}

/** Разбор вывода проверки каталога профиля. */
export function parseUserDataVerification(stdout) {
  const line = String(stdout ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('PATH '));
  if (!line) return null;
  const [parent, created, name] = line.slice(5).split('|');
  if (!parent || !name) return null;
  return { parent, createdAt: created ?? '', name };
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

/**
 * Удалять разрешено только каталог, который доказано создан этим прогоном:
 * имя с нашим префиксом, родитель — доверенный temp-корень, без переходов
 * вверх. Значение приходит из вывода запуска, но проверяется полностью —
 * подмена пути не проходит.
 */
export function isOwnedSmokeDir(dir, tempRoot) {
  if (!dir) return false;
  const norm = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = norm.split('/');
  if (parts.includes('..') || parts.includes('.')) return false;
  const base = parts.pop() ?? '';
  const parent = parts.join('/');
  if (!base.startsWith(USER_DATA_PREFIX) || base.length <= USER_DATA_PREFIX.length) return false;
  if (!/^[A-Za-z0-9]+$/.test(base.slice(USER_DATA_PREFIX.length))) return false;
  if (!tempRoot) return false;
  return normalizeWinPath(parent) === normalizeWinPath(tempRoot);
}

/** Удаление каталога профиля с проверкой родителя и результата. */
export function removeUserData(dir, { tempRoot, runner = ps } = {}) {
  if (!isOwnedSmokeDir(dir, tempRoot)) return false;
  const r = runner(
    `Remove-Item -LiteralPath ${psQuote(dir)} -Recurse -Force -ErrorAction Stop; if (Test-Path -LiteralPath ${psQuote(dir)}) { 'STILL-THERE' } else { 'REMOVED' }`,
  );
  return r.ok && /REMOVED/.test(String(r.out ?? ''));
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

/** Скрипт получения Windows-temp (нужен как доверенный корень профиля). */
export function tempRootScript() {
  return `"TEMP [$env:TEMP]"`;
}

/** Разбор доверенного temp-корня. */
export function parseTempRoot(stdout) {
  const line = String(stdout ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('TEMP '));
  if (!line) return null;
  const value = line.slice(5).trim().replace(/^\[|\]$/g, '');
  return value === '' ? null : value;
}

function ps(script, timeout = 40000) {
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)], {
    encoding: 'utf8',
    timeout,
  });
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
 * Итоговый вердикт. PASS требует ВСЕХ условий, включая подтверждённую
 * очистку: пустой список `killed` сам по себе ничего не доказывает.
 */
export function smokeVerdict({
  probeOk,
  ownership,
  cleanup,
  visible,
  titleMatched,
  leftoverOwned = [],
  aliveOwned = [],
  mismatchOwned = [],
}) {
  const reasons = [];
  if (!probeOk) reasons.push('probe-failed');
  if (!ownership?.ok) reasons.push(`ownership-${ownership?.reason ?? 'unknown'}`);
  if (!visible) reasons.push('no-visible-window');
  if (!titleMatched) reasons.push('title-mismatch');
  if (cleanup && cleanup.ok === false) {
    reasons.push(cleanup.inconclusive ? 'cleanup-inconclusive' : 'cleanup-failed');
  }
  if (!cleanup) reasons.push('cleanup-not-run');
  if (leftoverOwned.length > 0) reasons.push('owned-processes-left');
  if (aliveOwned.length > 0) reasons.push('owned-processes-alive');
  if (mismatchOwned.length > 0) reasons.push('owned-identity-mismatch');
  const pass = reasons.length === 0;
  const inconclusive =
    !probeOk ||
    !ownership?.ok ||
    Boolean(cleanup && cleanup.inconclusive) ||
    mismatchOwned.length > 0 ||
    reasons.includes('cleanup-not-run') ||
    reasons.includes('cleanup-inconclusive');
  return { pass, status: pass ? 'PASS' : inconclusive ? 'INCONCLUSIVE' : 'FAIL', reasons };
}

/** Отчёт по умолчанию — вне репозитория, в одноразовом каталоге системного tmp. */
export function defaultOutPath(tmpDir = os.tmpdir(), now = Date.now()) {
  return path.join(tmpDir, `${USER_DATA_PREFIX}${now}`, 'report.json');
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

  // PRE-FLIGHT: без таблицы процессов владение недоказуемо — ничего не запускаем.
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
  const tempRoot = parseTempRoot(run(tempRootScript()).out);

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
    userDataVerified: false,
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
  // Идентичности, доказанные в момент успешной проверки владения.
  let proven = { ok: false, reason: 'not-checked', owned: [], identities: [] };
  let probeOk = true;
  let userDataOk = false;
  // Доверенный temp-корень: из PowerShell, а при недоступности — из проверки
  // самого каталога профиля (родитель, подтверждённый `Get-Item`).
  let trustedTempRoot = tempRoot ?? null;
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
    report.rootPid = launch.rootPid;
    report.userData = launch.userData;
    // Доказательство создания каталога: родитель = доверенный temp, создан
    // после старта, имя соответствует нашему префиксу.
    // Зависимость возвращает СЫРОЙ вывод проверки (как и настоящий PowerShell),
    // разбор всегда один и тот же.
    const rawUserData = (deps.verifyUserData ?? ((d) => run(verifyUserDataScript(d)).out))(launch.userData);
    const check2 = parseUserDataVerification(rawUserData);
    if (check2) trustedTempRoot = trustedTempRoot ?? check2.parent;
    userDataOk = Boolean(check2) && isOwnedSmokeDir(launch.userData, trustedTempRoot);
    report.userDataVerified = userDataOk;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const snap = explorer(run);
      probeOk = snap.probeOk;
      if (!snap.probeOk) {
        report.probeError = snap.error;
        break;
      }
      proven = ownershipCheck({ table: snap.table, rootPid: launch.rootPid, exeDir, baselinePids });
      report.ownedPids = proven.owned;
      report.ownershipReason = proven.reason;
      if (!proven.ok) break; // неоднозначность: дальше только отчёт
      const windows = parseWindows(run(windowScript()).out);
      const visible = ownedVisibleWindows(windows, proven.owned);
      if (visible.length > 0) {
        report.windows = ownedWindows(windows, proven.owned);
        report.visible = true;
        report.titleMatched = visible.some((w) => w.title === expectTitle);
        report.elapsedMs = timeoutMs - (deadline - Date.now());
        break;
      }
    }
  } catch (err) {
    report.error = String(err instanceof Error ? err.message : err);
  } finally {
    report.cleanup = await cleanupOwned({ proven, explorer, run, exeDir, probeOk });
    // Живость ВСЕХ изначально доказанных процессов (не только killed).
    if (report.cleanup.identities.length === 0) {
      report.leftoverOwned = [];
    } else {
      const after = explorer(run);
      const live = verifyOwnedIdentities({
        table: after.table,
        identities: report.cleanup.identities,
        exeDir,
        probeOk: after.probeOk,
      });
      report.aliveOwned = live.alive;
      report.mismatchOwned = live.mismatch;
      // Живые — оставшиеся процессы; при сбое пробы считаем оставшимися всех
      // (fail-closed), а не «всё чисто».
      report.leftoverOwned = after.probeOk ? live.alive : report.cleanup.identities.map((i) => i.pid);
    }
    // Удаляем профиль только при доказанном создании и завершённых процессах.
    const canRemove =
      userDataOk &&
      report.cleanup.ok === true &&
      report.leftoverOwned.length === 0;
    report.userDataRemoved = canRemove
      ? removeUserData(report.userData, { tempRoot: trustedTempRoot, runner: run })
      : false;
    report.userDataPreserved = !report.userDataRemoved;
  }
  const verdict = smokeVerdict({
    probeOk,
    ownership: proven,
    cleanup: report.cleanup,
    visible: report.visible,
    titleMatched: report.titleMatched,
    leftoverOwned: report.leftoverOwned ?? [],
    aliveOwned: report.aliveOwned ?? [],
    mismatchOwned: report.mismatchOwned ?? [],
  });
  report.status = verdict.status;
  report.pass = verdict.pass;
  report.reasons = verdict.reasons;
  writeReport(out, report, deps);
  return report;
}

/**
 * Очистка: порядок «потомки → родитель», повторная проверка идентичности
 * перед каждым PID, подтверждение завершения после каждого kill.
 */
async function cleanupOwned({ proven, explorer, run, exeDir, probeOk }) {
  const identities = proven.identities ?? [];
  const base = {
    identities,
    order: [],
    killed: [],
    skipped: [],
    failed: [],
    inconclusive: false,
    ok: false,
    note: null,
  };
  if (!probeOk || !proven.ok) {
    return { ...base, inconclusive: true, note: 'принадлежность не доказана — процессы не завершаются' };
  }
  const snap = explorer(run);
  if (!snap.probeOk) {
    return { ...base, inconclusive: true, note: 'проба перед очисткой не удалась' };
  }
  // Порядок и живость строятся по СВЕЖЕМУ снимку, но идентичность берётся из
  // доказанного набора (PID + время создания), поэтому исчезнувший корень не
  // мешает завершить оставшихся потомков.
  const ordered = killOrder(identities, snap.table);
  const order = ordered.map((i) => i.pid);
  const verify = (identity) => {
    const now = explorer(run);
    if (!now.probeOk) return 'probe-failed';
    const v = verifyOwnedIdentities({ table: now.table, identities: [identity], exeDir });
    if (v.alive.length === 1) return 'alive';
    if (v.gone.length === 1) return 'gone';
    return 'ambiguous';
  };
  const recheck = (identity) => {
    const now = explorer(run);
    if (!now.probeOk) return 'probe-failed';
    const v = verifyOwnedIdentities({ table: now.table, identities: [identity], exeDir });
    return v.gone.length === 1 ? 'gone' : 'alive';
  };
  const res = killProven(ordered, {
    verify,
    kill: (identity) => run(killScript(identity.pid)).ok,
    recheck,
  });
  const incomplete = res.failed.length > 0 || res.aborted !== null || res.skipped.length > 0;
  return {
    ...base,
    order,
    killed: res.killed,
    skipped: res.skipped,
    failed: res.failed,
    inconclusive: res.aborted !== null,
    ok: !incomplete && res.killed.length === order.length,
    note: res.aborted ? `прекращено: ${res.aborted}` : incomplete ? 'завершены не все процессы' : null,
  };
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
    JSON.stringify({ status: report.status, reasons: report.reasons, windows: report.windows, elapsedMs: report.elapsedMs }, null, 1),
  );
  if (!report.pass) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
