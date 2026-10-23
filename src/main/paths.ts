/**
 * M4 R01: runtime path resolution for the PACKAGED app vs a dev checkout.
 *
 * The bridge bundle must be a real filesystem file — WSL reads it through a
 * Windows path (`wsl.exe --exec node <win-path>`), which is impossible for a
 * file living inside app.asar. Packaging therefore ships it via
 * `extraResources` into `<resources>/bridge/index.cjs`, and the packaged main
 * resolves it from `process.resourcesPath`. Everything else (main, preload,
 * renderer) stays inside the asar and keeps its sibling layout.
 */
import path from 'node:path';

export function resolveBridgeWinPath(
  isPackaged: boolean,
  resourcesPath: string,
  mainDirname: string,
): string {
  if (isPackaged) {
    return path.join(resourcesPath, 'bridge', 'index.cjs');
  }
  return path.join(mainDirname, '..', 'bridge', 'index.cjs');
}
