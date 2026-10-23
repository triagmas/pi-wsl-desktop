/**
 * M4 R01: release tooling must produce identical checks on every host —
 * @electron/asar lists entries with the PLATFORM path separator (backslash
 * on the Windows CI runner), so all assertions must normalize first.
 */
import { describe, expect, it } from 'vitest';
import { normalizeAsarPath } from '../../scripts/lib/releasePaths.mjs';

describe('normalizeAsarPath', () => {
  it('keeps posix paths', () => {
    expect(normalizeAsarPath('/dist/main/index.cjs')).toBe('/dist/main/index.cjs');
  });

  it('converts win32 backslash listings to posix', () => {
    expect(normalizeAsarPath('\\dist\\main\\index.cjs')).toBe('/dist/main/index.cjs');
    expect(normalizeAsarPath('C:\\resources\\bridge\\index.cjs')).toBe('C:/resources/bridge/index.cjs');
  });
});
