/**
 * Electron main process.
 *
 * Security posture (Issue #2 B1): contextIsolation on, sandbox on,
 * nodeIntegration off, no renderer-driven command execution, navigation and
 * window.open denied, CSP delivered via the document head.
 */
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { WslConnection } from './connection';
import { resolveBridgeWinPath } from './paths';
import { registerIpc } from './ipc';
import { loadSettings, saveSettings } from './settings';
import { DEFAULT_WSL_PATH } from './wsl';

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    // A1: slim custom header in the renderer; the native Windows caption
    // buttons stay (overlay) so snapping/accessibility keep working.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#191C19', symbolColor: '#E7EAE3', height: 48 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // A1: no application menu (File/Edit/View/Window chrome removed); the
  // developer diagnostics it used to carry stay on explicit keys.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (input.key === 'F5' || (input.control && key === 'r')) {
      win.webContents.reload();
      event.preventDefault();
    }
  });
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

let connection: WslConnection | null = null;

// Test isolation (review P2): E2E runs must not mutate the working profile's
// appearance/settings — only an explicit env hook can redirect userData, and
// production builds never set it.
const userDataOverride = process.env.PI_WS_DESKTOP_USER_DATA_DIR;
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

app.whenReady().then(() => {
  // A1: the default File/Edit/View/Window application menu is never shown.
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  const settings = loadSettings(userData);

  const timeoutOverride = Number(process.env.PI_WS_DESKTOP_TIMEOUT_MS) || undefined;
  const maxAttemptsOverride = Number(process.env.PI_WS_DESKTOP_MAX_ATTEMPTS) || undefined;
  const backoffOverride = (process.env.PI_WS_DESKTOP_BACKOFF_MS ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const conn = new WslConnection({
    // Packaged: the bridge is a real file in <resources>/bridge (WSL cannot
    // read asar); dev checkout: sibling dist/bridge bundle (M4 R01).
    bridgeWinPath: resolveBridgeWinPath(
      app.isPackaged,
      process.resourcesPath,
      __dirname,
    ),
    wslPath: process.env.PI_WS_DESKTOP_WSL_PATH || DEFAULT_WSL_PATH,
    ...(settings.distro ? { distro: settings.distro } : {}),
    ...(maxAttemptsOverride ? { maxAutoAttempts: maxAttemptsOverride } : {}),
    ...(backoffOverride.length > 0 ? { backoffMs: backoffOverride } : {}),
    ...(timeoutOverride
      ? {
          timeouts: {
            listMs: timeoutOverride,
            probeMs: timeoutOverride,
            readyMs: timeoutOverride,
            requestMs: timeoutOverride,
          },
        }
      : {}),
  });
  connection = conn;

  const win = createWindow();
  registerIpc(
    ipcMain,
    conn,
    (channel, payload) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(channel, payload);
      }
    },
    {
      appearanceDir: userData,
      onTitleBarOverlay: (colors) => {
        try {
          win.setTitleBarOverlay({
            color: colors.backgroundColor,
            symbolColor: colors.textColor,
            height: 48,
          });
        } catch {
          // overlay is cosmetic; never let it break the window
        }
      },
      onDistroChange: (distro) => {
        try {
          saveSettings(userData, { distro });
        } catch {
          // persistence is best-effort; the live connection is unaffected
        }
      },
    },
  );

  conn.start();

  // Optional smoke-report sink (env-gated like the other test hooks):
  // appends every connection snapshot for external verification of a real
  // Windows+WSL run. Never active in normal use.
  const smokeReport = process.env.PI_WS_DESKTOP_SMOKE_REPORT;
  if (smokeReport) {
    void import('node:fs').then(({ appendFileSync }) => {
      conn.subscribe((snap) => {
        try {
          appendFileSync(
            smokeReport,
            JSON.stringify({
              t: new Date().toISOString(),
              // Native Windows PID of this process — the smoke script uses it
              // for provable ownership (WSL-side spawn pids differ).
              pid: process.pid,
              phase: snap.phase,
              attempt: snap.attempt,
              code: snap.lastError?.code ?? null,
              runtime: snap.runtime,
            }) + '\n',
            'utf8',
          );
        } catch {
          // reporting must never break the app
        }
      });
    });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  connection?.close();
});
