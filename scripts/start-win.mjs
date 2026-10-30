/**
 * UI26 R05: запуск unpackaged Windows-приложения из этого checkout.
 *
 * `npm start` использует `node_modules/electron`, а он заполнен под ОС, в
 * которой выполнялся `npm ci` (здесь — WSL/Linux). Для ручного Windows-gate
 * нужен явный путь к win32-сборке Electron:
 *
 *   PI_WS_DESKTOP_ELECTRON_EXE="F:\\path\\electron.exe" npm run start:win
 *
 * Без переменной ищется `artifacts/win-electron/electron.exe` (локальная
 * распаковка, каталог вне git). Скрипт НЕ скачивает бинарники, НЕ пишет в
 * профиль Pi и НЕ трогает пользовательские сессии.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyElectronDist, explainFailure } from './check-electron-dist.mjs';

/** Куда смотреть, если переменная окружения не задана (относительно cwd). */
export const DEFAULT_CANDIDATES = [path.join('artifacts', 'win-electron', 'electron.exe')];

/**
 * Windows-путь → путь этой ОС (для запуска из WSL: `/mnt/<drive>/...`).
 * На Windows возвращается как есть. Нужно, чтобы один и тот же скрипт можно
 * было проверить и из WSL, и из PowerShell.
 */
export function windowsPathToPosix(p, platform = process.platform) {
  if (platform === 'win32') return p;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

/**
 * Обратное преобразование: локальный путь → windows-путь для аргумента
 * приложения. Без него Windows-Electron из WSL получает `/mnt/f/...` и
 * показывает диалог «Error» вместо приложения.
 */
export function posixPathToWindows(p, platform = process.platform) {
  if (platform === 'win32') return p;
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p);
  if (!m) return p;
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

/**
 * Чистое разрешение пути: env → кандидаты; возвращает {exe, dist} или null.
 *
 * `platform` — только для детерминированных тестов: рантайм всегда использует
 * `process.platform`. Раньше конверсия env-пути зависела от платформы
 * неявно, из-за чего одинаковые ожидания в тестах не выполнялись на Windows.
 */
export function resolveWinElectron(env, cwd, exists, platform = process.platform) {
  const raw = (env.PI_WS_DESKTOP_ELECTRON_EXE ?? '').trim();
  const fromEnv = raw ? windowsPathToPosix(raw, platform) : '';
  const candidates = fromEnv ? [fromEnv] : DEFAULT_CANDIDATES.map((p) => path.join(cwd, p));
  // `dist` считается по правилам целевой платформы: на нативном хосте это
  // ровно path.dirname, но при инъекции платформы результат не зависит от ОС.
  const dirname = platform === 'win32' ? path.win32.dirname : path.posix.dirname;
  for (const exe of candidates) {
    if (exists(exe)) return { exe, dist: dirname(exe), fromEnv: Boolean(fromEnv) };
  }
  return null;
}

function main() {
  const cwd = process.cwd();
  const found = resolveWinElectron(process.env, cwd, (p) => fs.existsSync(p));
  if (!found) {
    console.error(
      [
        'Не найдена Windows-сборка Electron.',
        'Укажите её явно:',
        '  PI_WS_DESKTOP_ELECTRON_EXE="F:\\\\path\\\\to\\\\electron.exe" npm run start:win',
        'или распакуйте официальный win32-архив Electron в artifacts/win-electron/.',
        '`npm start` для этого не подходит: node_modules/electron заполнен под текущую ОС.',
      ].join('\n'),
    );
    process.exit(1);
  }
  const check = verifyElectronDist('win32', fs.readdirSync(found.dist));
  if (!check.ok) {
    console.error(explainFailure(check, found.dist));
    process.exit(1);
  }
  const appPath = posixPathToWindows(cwd);
  console.log(`Запуск Windows Electron: ${found.exe} → ${appPath}`);
  const child = spawn(found.exe, [appPath], { cwd, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
