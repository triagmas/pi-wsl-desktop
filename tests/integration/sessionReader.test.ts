/**
 * T3b — readSessionFile over REAL files: no-mutation proof (sha256 + mtime),
 * legacy v1/v2 fixtures (synthesized from session-format.md — the research
 * machine only has v3 files, disclosed), concurrent partial append, EACCES,
 * unicode payloads.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readSessionFile } from '../../src/bridge/sessionReader';
import { nodeFs } from '../../src/bridge/sessions';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'piwsd-read-'));
const F = (name: string): string => path.join(tmp, name);

const hdr = (v: number): string =>
  `${JSON.stringify({ type: 'session', version: v, id: `uuid-${v}`, timestamp: '2026-10-19T00:00:00.000Z', cwd: '/proj' })}\n`;

// v3 with tree + unicode + tool events
writeFileSync(
  F('v3.jsonl'),
  hdr(3) +
    `${JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: 'T', message: { role: 'user', content: 'привет 🚀 <b>html</b>', timestamp: 1 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: 'T', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }], api: 'x', provider: 'y', model: 'z', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: 2 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'r1', parentId: 'a1', timestamp: 'T', message: { role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'out' }], isError: false, timestamp: 3 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'u2', parentId: 'r1', timestamp: 'T', message: { role: 'user', content: 'стоп', timestamp: 4 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'a2', parentId: 'u2', timestamp: 'T', message: { role: 'assistant', content: [{ type: 'text', text: 'готово' }], api: 'x', provider: 'y', model: 'z', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 5 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'u3', parentId: 'a2', timestamp: 'T', message: { role: 'user', content: 'ветка', timestamp: 6 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'alt', parentId: 'r1', timestamp: 'T', message: { role: 'user', content: 'альт', timestamp: 7 } })}\n`,
);

// Legacy v1 (linear, no parentId) — synthesized from session-format.md
writeFileSync(
  F('v1.jsonl'),
  hdr(1) +
    `${JSON.stringify({ type: 'message', id: 'l1', timestamp: 'T', message: { role: 'user', content: 'old times', timestamp: 1 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'l2', timestamp: 'T', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: 'a', provider: 'p', model: 'm', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2 } })}\n`,
);

// Legacy v2 (tree, hookMessage role era)
writeFileSync(
  F('v2.jsonl'),
  hdr(2) +
    `${JSON.stringify({ type: 'message', id: 'v1', parentId: null, timestamp: 'T', message: { role: 'user', content: 'hi v2', timestamp: 1 } })}\n` +
    `${JSON.stringify({ type: 'message', id: 'v2', parentId: 'v1', timestamp: 'T', message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }], api: 'a', provider: 'p', model: 'm', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2 } })}\n`,
);

// File being appended RIGHT NOW (no trailing newline yet)
writeFileSync(F('live.jsonl'), hdr(3) + '{"type":"message","id":"half","parentId":null,"timestamp":"T","message":{"role":"user","cont');

// Dedicated unreadable fixture (v1/v2 stay readable for their own gates)
writeFileSync(F('locked.jsonl'), hdr(3) + '{"type":"message","id":"x","parentId":null,"timestamp":"T"}\n');
chmodSync(F('locked.jsonl'), 0o000);

const created: string[] = ['v3.jsonl', 'v1.jsonl', 'v2.jsonl', 'live.jsonl'];
afterAll(() => {
  try {
    chmodSync(F('locked.jsonl'), 0o644);
  } catch {
    /* best effort */
  }
});

function fingerprint(file: string): { sha: string; mtime: number; size: number } {
  return { sha: createHash('sha256').update(readFileSync(file)).digest('hex'), mtime: statSync(file).mtimeMs, size: statSync(file).size };
}

describe('readSessionFile (real files)', () => {
  it('reads a v3 tree: active branch excludes abandoned branch, tool events intact', async () => {
    const file = F('v3.jsonl');
    const before = fingerprint(file);
    const r = await readSessionFile({ fs: nodeFs, file });
    expect(r.availability).toBe('ok');
    expect(r.header?.version).toBe(3);
    expect(r.entries.map((e) => e.id)).toEqual(['u1', 'a1', 'r1', 'u2', 'a2', 'u3', 'alt']);
    // 'alt' was appended last (it points at r1) → append-order-last leaf wins
    expect(r.leafId).toBe('alt');
    const active = await readSessionFile({ fs: nodeFs, file, branch: 'active' });
    // active branch = u1→a1→r1→alt; the u2/a2/u3 line is the abandoned branch
    expect(active.entries.map((e) => e.id)).toEqual(['u1', 'a1', 'r1', 'alt']);
    const toolResult = active.entries.find((e) => e.id === 'r1');
    expect((toolResult?.raw as { message: { role: string } }).message.role).toBe('toolResult');
    const after = fingerprint(file);
    expect(after).toEqual(before); // BYTE-for-byte + mtime unchanged
  });

  it('reads legacy v1 and v2 without migration (chain reconstructed, hash+mtime untouched)', async () => {
    const v1file = F('v1.jsonl');
    const v2file = F('v2.jsonl');
    const b1 = fingerprint(v1file);
    const b2 = fingerprint(v2file);
    const v1 = await readSessionFile({ fs: nodeFs, file: v1file });
    expect(v1.availability).toBe('ok');
    expect(v1.header?.version).toBe(1);
    expect(v1.entries.map((e) => e.id)).toEqual(['l1', 'l2']);
    expect(v1.entries[1].parentId).toBe('l1');
    const v2 = await readSessionFile({ fs: nodeFs, file: v2file });
    expect(v2.header?.version).toBe(2);
    expect(v2.entries[1].parentId).toBe('v1');
    expect(fingerprint(v1file)).toEqual(b1);
    expect(fingerprint(v2file)).toEqual(b2);
  });

  it('reports a concurrently-appended partial line without consuming it', async () => {
    const file = F('live.jsonl');
    const before = fingerprint(file);
    const r = await readSessionFile({ fs: nodeFs, file });
    expect(r.partialTrailing).toBe(true);
    expect(r.entries).toEqual([]); // half a line is never parsed
    expect(fingerprint(file)).toEqual(before);
  });

  it('an unreadable file (EACCES) returns diagnostics, not a crash', async () => {
    const r = await readSessionFile({ fs: nodeFs, file: F('locked.jsonl') });
    expect(r.availability).toBe('unreadable');
    expect(r.entries).toEqual([]);
  });

  it('the reader leaves every created fixture byte-identical (global no-mutation sweep)', async () => {
    const snaps = new Map(created.map((n) => [n, fingerprint(F(n))]));
    // run the full matrix once more
    await readSessionFile({ fs: nodeFs, file: F('v3.jsonl') });
    await readSessionFile({ fs: nodeFs, file: F('v2.jsonl'), branch: 'active' });
    await readSessionFile({ fs: nodeFs, file: F('live.jsonl') });
    for (const [n, snap] of snaps) {
      expect(fingerprint(F(n))).toEqual(snap);
    }
  });
});
