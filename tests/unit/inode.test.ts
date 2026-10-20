/**
 * M2 security-review R1a — dev/ino revalidation before Pi spawn (P2#2
 * residual TOCTOU narrowing). RED first: `inodeMatches` did not exist, and
 * the openSession comment overstated what canonicalization protects.
 */
import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inodeMatches } from '../../src/bridge/sessions';

const dirs: string[] = [];
const tmp = (label: string): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), `piwsd-${label}-`));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('inodeMatches — dev/ino recheck before spawning Pi (R1a)', () => {
  it('accepts the untouched canonical path', async () => {
    const dir = tmp('ino');
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, '{"type":"session"}\n');
    const handle = await fsp.open(f, 'r');
    try {
      expect(await inodeMatches(handle, f)).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('rejects after a rename-swap replaces the canonical file', async () => {
    const dir = tmp('ino-swap');
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, 'original\n');
    const handle = await fsp.open(f, 'r');
    try {
      renameSync(f, path.join(dir, 's.jsonl.bak'));
      writeFileSync(f, 'replacement\n');
      expect(await inodeMatches(handle, f)).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('rejects when the canonical path becomes a symlink to another file', async () => {
    const dir = tmp('ino-link');
    const f = path.join(dir, 's.jsonl');
    const other = path.join(dir, 'other.jsonl');
    writeFileSync(f, 'original\n');
    writeFileSync(other, 'outside\n');
    const handle = await fsp.open(f, 'r');
    try {
      rmSync(f);
      symlinkSync(other, f);
      expect(await inodeMatches(handle, f)).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('treats a vanished path as changed (fail closed)', async () => {
    const dir = tmp('ino-gone');
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, 'original\n');
    const handle = await fsp.open(f, 'r');
    try {
      rmSync(f);
      expect(await inodeMatches(handle, f)).toBe(false);
    } finally {
      await handle.close();
    }
  });
});
