/**
 * UI26 R05 — тихий отказ Windows-запуска больше не должен быть загадкой.
 *
 * Наблюдаемый дефект (owner report): `npm start` / `electron.exe .` на
 * Windows-checkout не даёт окна и завершается без ошибки. Причина: в
 * `node_modules/electron/dist` лежит сборка ДРУГОЙ ОС (здесь — Linux из WSL),
 * поэтому Windows-процесс умирает до `app.whenReady()`.
 */
import { describe, expect, it } from 'vitest';
import { verifyElectronDist, explainFailure, parseArgs, PLATFORM_MARKERS } from '../../scripts/check-electron-dist.mjs';
import { resolveWinElectron, windowsPathToPosix, posixPathToWindows } from '../../scripts/start-win.mjs';

const WIN_FILES = [
  'electron.exe',
  'ffmpeg.dll',
  'd3dcompiler_47.dll',
  'vulkan-1.dll',
  'vk_swiftshader.dll',
  'resources.pak',
  'icudtl.dat',
  'snapshot_blob.bin',
  'version',
  'locales',
  'resources',
];

const LINUX_FILES = [
  'electron',
  'chrome-sandbox',
  'libffmpeg.so',
  'libvk_swiftshader.so',
  'libvulkan.so.1',
  'resources.pak',
  'icudtl.dat',
  'snapshot_blob.bin',
  'version',
  'locales',
  'resources',
];

describe('проверка платформы локальной поставки Electron', () => {
  it('полная win32-сборка проходит', () => {
    expect(verifyElectronDist('win32', WIN_FILES)).toEqual({ ok: true, platform: 'win32', missing: [], foreign: [] });
  });

  it('полная linux-сборка проходит как linux', () => {
    expect(verifyElectronDist('linux', LINUX_FILES).ok).toBe(true);
  });

  it('linux-сборка НЕ проходит как win32 и показывает чужие маркеры', () => {
    const r = verifyElectronDist('win32', LINUX_FILES);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('ffmpeg.dll');
    expect(r.missing).toContain('electron.exe');
    expect(r.foreign).toContain('linux:electron');
    expect(r.foreign).toContain('linux:libffmpeg.so');
  });

  it('win32-сборка не выдаётся за linux (обратная ошибка тоже видна)', () => {
    const r = verifyElectronDist('linux', WIN_FILES);
    expect(r.ok).toBe(false);
    expect(r.foreign).toContain('win32:electron.exe');
  });

  it('отсутствие обязательных ресурсов ловится даже при верной платформе', () => {
    const r = verifyElectronDist('win32', WIN_FILES.filter((f) => f !== 'resources.pak'));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['resources.pak']);
  });

  it('смешанный каталог отклоняется, даже если все win32-маркеры на месте', () => {
    // UI26 R06 (P2): достаточно одного файла другой платформы — это не «сборка
    // Windows с лишним файлом», а невалидная поставка.
    const mixed = [...WIN_FILES, 'libffmpeg.so', 'chrome-sandbox'];
    const r = verifyElectronDist('win32', mixed);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.foreign).toContain('linux:libffmpeg.so');
    expect(r.foreign).toContain('linux:chrome-sandbox');
  });

  it('смешанный каталог объясняется как смешанная поставка', () => {
    const msg = explainFailure(verifyElectronDist('win32', [...WIN_FILES, 'libffmpeg.so']), '/repo/dist');
    expect(msg).toContain('смешанная поставка');
    expect(msg).not.toContain('отсутствуют:');
    expect(msg).toContain('PI_WS_DESKTOP_ELECTRON_EXE');
  });

  it('маркеры платформ не пересекаются по именам файлов', () => {
    const all = Object.values(PLATFORM_MARKERS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('объяснение отказа', () => {
  it('называет отсутствующие файлы, чужую платформу и два пути решения', () => {
    const msg = explainFailure(verifyElectronDist('win32', LINUX_FILES), '/repo/node_modules/electron/dist');
    expect(msg).toContain('ffmpeg.dll');
    expect(msg).toContain('сборкой ДРУГОЙ ОС');
    expect(msg).toContain('npm ci');
    expect(msg).toContain('PI_WS_DESKTOP_ELECTRON_EXE');
    expect(msg).toContain('--platform win32 --dist');
  });

  it('не содержит приватных путей и идентификаторов провайдеров', () => {
    const msg = explainFailure(verifyElectronDist('win32', LINUX_FILES), '/repo/dist');
    // Гейт приватности не должен сам содержать приватных строк: собираем
    // проверочное выражение из фрагментов, как и сам скрипт.
    const forbidden = new RegExp(['/ho' + 'me/', 'cliproxy' + 'api', 'ke' + 'nari'].join('|'));
    expect(msg).not.toMatch(forbidden);
  });
});

describe('разбор аргументов проверки', () => {
  it('по умолчанию берёт платформу и путь по умолчанию', () => {
    expect(parseArgs([], { platform: 'win32', dist: '/d' })).toEqual({ platform: 'win32', dist: '/d' });
  });

  it('переопределяется флагами', () => {
    expect(parseArgs(['--platform', 'win32', '--dist', '/x'], { platform: 'linux', dist: '/d' })).toEqual({
      platform: 'win32',
      dist: '/x',
    });
  });
});

describe('поиск Windows-сборки для start:win', () => {
  const exists = (present: string[]) => (p: string) => present.includes(p.replace(/\\/g, '/'));

  it('явная переменная окружения имеет приоритет', () => {
    const found = resolveWinElectron({ PI_WS_DESKTOP_ELECTRON_EXE: 'F:/win/electron.exe' }, '/repo', exists(['/mnt/f/win/electron.exe']));
    expect(found).toMatchObject({ fromEnv: true });
    expect(found?.exe).toBe('/mnt/f/win/electron.exe');
  });

  it('без переменной берётся локальная распаковка artifacts/win-electron', () => {
    const found = resolveWinElectron({}, '/repo', exists(['/repo/artifacts/win-electron/electron.exe']));
    expect(found?.exe.replace(/\\/g, '/')).toBe('/repo/artifacts/win-electron/electron.exe');
    expect(found?.fromEnv).toBe(false);
  });

  it('если ничего нет — null (скрипт объясняет, что делать)', () => {
    expect(resolveWinElectron({}, '/repo', () => false)).toBeNull();
  });
});

describe('путь к Windows-сборке из WSL', () => {
  it('windows-путь переводится в /mnt/<drive>/ для проверки существования', () => {
    expect(windowsPathToPosix('F:\\repo\\artifacts\\win-electron\\electron.exe', 'linux')).toBe(
      '/mnt/f/repo/artifacts/win-electron/electron.exe',
    );
  });

  it('на Windows путь не меняется', () => {
    expect(windowsPathToPosix('F:\\x\\electron.exe', 'win32')).toBe('F:\\x\\electron.exe');
  });

  it('переменная окружения с windows-путём находится из WSL', () => {
    const found = resolveWinElectron({ PI_WS_DESKTOP_ELECTRON_EXE: 'F:\\x\\electron.exe' }, '/repo', (p) => p === '/mnt/f/x/electron.exe');
    expect(found?.fromEnv).toBe(true);
    expect(found?.exe).toBe('/mnt/f/x/electron.exe');
  });
});

describe('аргумент приложения для Windows-Electron из WSL', () => {
  it('локальный путь проекта переводится в windows-путь', () => {
    expect(posixPathToWindows('/mnt/f/repo/app', 'linux')).toBe('F:\\repo\\app');
  });

  it('на Windows путь остаётся локальным', () => {
    expect(posixPathToWindows('F:\\proj', 'win32')).toBe('F:\\proj');
  });

  it('посторонний путь не искажается', () => {
    expect(posixPathToWindows('/tmp/x', 'linux')).toBe('/tmp/x');
  });
});
