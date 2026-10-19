import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../../src/main/settings';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'piwsd-settings-'));
}

describe('settings store (userData JSON)', () => {
  it('returns defaults when the file does not exist', () => {
    expect(loadSettings(tmpDir())).toEqual({});
  });

  it('returns defaults when the file is corrupt JSON (no throw)', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'settings.json'), '{not json');
    expect(loadSettings(dir)).toEqual({});
  });

  it('returns defaults when the file is valid JSON but not an object', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'settings.json'), '["array"]');
    expect(loadSettings(dir)).toEqual({});
  });

  it('round-trips a saved setting', () => {
    const dir = tmpDir();
    const saved = saveSettings(dir, { distro: 'Ubuntu' });
    expect(saved).toEqual({ distro: 'Ubuntu' });
    expect(loadSettings(dir)).toEqual({ distro: 'Ubuntu' });
  });

  it('merges patches and preserves unknown keys (forward compatibility)', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ distro: 'A', futureKey: 42 }));
    const merged = saveSettings(dir, { distro: 'B' });
    expect(merged).toEqual({ distro: 'B', futureKey: 42 });
    expect(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'))).toEqual({
      distro: 'B',
      futureKey: 42,
    });
  });

  it('leaves no temporary file residue after save', () => {
    const dir = tmpDir();
    saveSettings(dir, { distro: 'X' });
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });
});
