/**
 * UI26 R06: воспроизводимый агентский Windows GUI smoke.
 *
 * Проверяет именно ВИДИМОЕ нативное окно (Win32 `EnumWindows` +
 * `IsWindowVisible`), а не «сборка прошла» и не «статус-колбэк renderer».
 *
 * Безопасность:
 *  - запускается только явно указанный win32-Electron (или найденный
 *    `artifacts/win-electron/`), платформенная проверка обязательна;
 *  - `PI_WS_DESKTOP_USER_DATA_DIR` указывает в throwaway-каталог, реальный
 *    профиль приложения не используется; профиль Pi и JSONL не читаются;
 *  - ноль model calls: ни одного промпта не отправляется;
 *  - ownership: до старта снимается список PID, завершаются ТОЛЬКО процессы,
 *    появившиеся после старта (и только если их PID попал в окна приложения);
 *  - результат пишется в JSON-файл вне репозитория.
 *
 * CI: не запускается (Windows GUI требует живого рабочего стола); см.
 * docs/development/windows-launch.md — «NOT RUN in CI».
 *
 * Использование:
 *   node scripts/win-gui-smoke.mjs --exe "F:\\path\\electron.exe" [--out report.json]
 *   node scripts/win-gui-smoke.mjs --out report.json          # найдёт artifacts/win-electron
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveWinElectron, posixPathToWindows, windowsPathToPosix } from './start-win.mjs';
import { verifyElectronDist, explainFailure } from './check-electron-dist.mjs';

export const DEFAULT_EXPECT_TITLE = 'Pi WSL Desktop';
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

/**
 * Окна, принадлежащие нашим процессам. Используется и для матчинга, и для
 * отчёта: в JSON не должны попадать заголовки чужих окон рабочего стола.
 */
export function ownedWindows(windows, ownedPids) {
  const owned = new Set(ownedPids.map(Number));
  return windows.filter((w) => owned.has(w.pid));
}

/** Только окна, порождённые нашими процессами (ownership) и видимые. */
export function ownedVisibleWindows(windows, ownedPids) {
  const owned = new Set(ownedPids.map(Number));
  return windows.filter((w) => owned.has(w.pid) && w.visible);
}

/** PID-ы, появившиеся после старта (baseline diff). */
export function newPids(before, after) {
  const seen = new Set(before.map(Number));
  return after.map(Number).filter((p) => !seen.has(p));
}

/**
 * PowerShell-скрипт перечисления окон. `pids` документирует контракт вызова
 * (ownership-фильтр делается в JS по уже полученному списку), сам скрипт
 * возвращает все окна — так заголовки не теряются при гонках PID-ов.
 */
export function windowScript(pids = []) {
  void pids;
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

function ps(script, timeout = 40000) {
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout });
  return (r.stdout ?? '').trim();
}

const electronPids = () =>
  ps(`Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object { $_.ProcessId }`)
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);

/** Разбор аргументов CLI (чистая функция). */
export function parseSmokeArgs(argv, cwd = process.cwd()) {
  const out = { exe: null, out: path.join(cwd, 'win-gui-smoke.json'), timeoutMs: 30000, expectTitle: DEFAULT_EXPECT_TITLE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exe') out.exe = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (argv[i] === '--expect-title') out.expectTitle = argv[++i];
  }
  return out;
}

export async function runSmoke({ exe, out, timeoutMs, expectTitle }, deps = {}) {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  // `--exe` может быть windows-путём (владелец копирует из PowerShell) —
  // для проверки существования и чтения каталога приводим его к локальной форме.
  const localExe = exe ? windowsPathToPosix(exe) : null;
  const found = localExe
    ? { exe: localExe, dist: path.dirname(localExe), fromEnv: true }
    : resolveWinElectron(env, cwd, fs.existsSync);
  if (!found) throw new Error('Не найдена Windows-сборка Electron');
  const check = verifyElectronDist('win32', fs.readdirSync(found.dist));
  if (!check.ok) throw new Error(explainFailure(check, found.dist));

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gui-smoke-'));
  const before = (deps.listPids ?? electronPids)();
  const child = (deps.spawn ?? spawn)(found.exe, [posixPathToWindows(cwd)], {
    cwd,
    stdio: 'ignore',
    env: { ...env, PI_WS_DESKTOP_USER_DATA_DIR: posixPathToWindows(userData) },
  });
  const result = {
    exe: found.exe,
    userData,
    startedAt: new Date().toISOString(),
    expectedTitle: expectTitle,
    baselinePids: before,
    windows: [],
    visible: false,
    ownedPids: [],
    elapsedMs: null,
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const all = (deps.listPids ?? electronPids)();
    const owned = newPids(before, all);
    result.ownedPids = owned;
    if (owned.length === 0) continue;
    const windows = parseWindows((deps.enumerate ?? ((pids) => ps(windowScript(pids))))(owned));
    const visible = ownedVisibleWindows(windows, owned);
    if (visible.length > 0) {
      // В отчёт попадают только собственные окна: чужие заголовки рабочего
      // стола не сохраняются (приватность).
      result.windows = ownedWindows(windows, owned);
      result.visible = true;
      result.matchedTitle = visible.some((w) => w.title === expectTitle);
      result.elapsedMs = timeoutMs - (deadline - Date.now());
      break;
    }
  }
  // Завершаем только собственные процессы.
  for (const pid of result.ownedPids) ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`, 15000);
  child.kill?.('SIGTERM');
  result.leftoverPids = (deps.listPids ?? electronPids)().filter((p) => result.ownedPids.includes(p));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const args = parseSmokeArgs(process.argv.slice(2));
  const result = await runSmoke(args);
  console.log(
    JSON.stringify({ visible: result.visible, matchedTitle: result.matchedTitle, windows: result.windows, elapsedMs: result.elapsedMs }, null, 1),
  );
  if (!result.visible || !result.matchedTitle) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
