/**
 * M2 security-review R1c — nodeFs single-shot reads must not hang on a FIFO
 * swapped in for a session/settings file (AGENTS §3.7: no unbounded blocking
 * shell/IO runs). RED first: `fsp.open(p, 'r')` without O_NONBLOCK blocks
 * forever on a writerless FIFO (this test then fails by timeout).
 * POSIX-only: FIFOs are created via mkfifo.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../src/bridge/sessions';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('nodeFs — O_NONBLOCK against FIFO swap (R1c)', () => {
  it('readHead/readTail/readRange return promptly instead of blocking', async () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'piwsd-fifo-'));
    dirs.push(d);
    const fifo = path.join(d, 'settings.json');
    execFileSync('mkfifo', [fifo]);
    const results = await Promise.all([
      nodeFs.readHead(fifo, 1024).catch((e: unknown) => `err:${(e as Error).name}`),
      nodeFs.readTail(fifo, 1024).catch((e: unknown) => `err:${(e as Error).name}`),
      nodeFs.readRange(fifo, 0, 1024).catch((e: unknown) => `err:${(e as Error).name}`),
    ]);
    expect(results).toHaveLength(3); // reaching this line at all = no hang
  }, 4_000);
});
