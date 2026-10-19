/**
 * Electron main process.
 *
 * Security posture (Issue #2 B1): contextIsolation on, sandbox on,
 * nodeIntegration off, no renderer-driven command execution, navigation and
 * window.open denied, CSP delivered via the document head.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { WslConnection } from './connection';
import { registerIpc } from './ipc';
import { loadSettings, saveSettings } from './settings';
import { DEFAULT_WSL_PATH } from './wsl';

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
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
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

let connection: WslConnection | null = null;

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  const settings = loadSettings(userData);

  const timeoutOverride = Number(process.env.PI_WS_DESKTOP_TIMEOUT_MS) || undefined;
  connection = new WslConnection({
    // __dirname is dist/main → sibling dist/bridge bundle inside this install.
    bridgeWinPath: path.join(__dirname, '..', 'bridge', 'bridge.cjs'),
    wslPath: process.env.PI_WS_DESKTOP_WSL_PATH || DEFAULT_WSL_PATH,
    ...(settings.distro ? { distro: settings.distro } : {}),
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

  registerIpc(
    ipcMain,
    connection,
    (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
      }
    },
    {
      onDistroChange: (distro) => {
        try {
          saveSettings(userData, { distro });
        } catch {
          // persistence is best-effort; the live connection is unaffected
        }
      },
    },
  );

  createWindow();
  connection.start();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  connection?.close();
});
