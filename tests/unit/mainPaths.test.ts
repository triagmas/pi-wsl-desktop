/**
 * M4 R01: the packaged app must resolve runtime files from real filesystem
 * locations — the bridge bundle is shipped in `resources/` (outside asar,
 * because WSL reads it as a file), while the dev checkout keeps the
 * dist/main → dist/bridge sibling layout.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBridgeWinPath } from '../../src/main/paths';

describe('main production paths', () => {
  it('resolves the bridge from process.resourcesPath when packaged', () => {
    expect(resolveBridgeWinPath(true, 'C:\\App\\resources', 'C:\\App\\resources\\app.asar\\dist\\main')).toBe(
      path.join('C:\\App\\resources', 'bridge', 'index.cjs'),
    );
  });

  it('keeps the sibling dist layout in a dev checkout', () => {
    expect(resolveBridgeWinPath(false, '/ignored', '/repo/dist/main')).toBe(
      path.join('/repo/dist/main', '..', 'bridge', 'index.cjs'),
    );
  });
});
