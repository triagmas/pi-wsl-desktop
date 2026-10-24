/**
 * R03 review P1-5 — the always-mounted history feed must be file-scoped:
 * a file switch resets result/error/loading, and a response that resolves
 * AFTER a newer request (or for a retired file) must never be applied.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHistoryFeed } from '../../src/renderer/historyFeed';
import type { DesktopApi } from '../../src/renderer/api';

interface Deferred {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
function defer(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function page(text: string): unknown {
  return {
    header: null,
    entries: [{ type: 'message', id: 'x', raw: { message: { role: 'user', content: text, timestamp: 1 } } }],
    leafId: null,
    nextCursor: null,
    truncated: false,
    partialTrailing: false,
    diagnostics: [],
    availability: 'ok',
  };
}

describe('useHistoryFeed — file scope and stale responses (review P1-5)', () => {
  it('ignores a stale response for a retired file and shows the current file', async () => {
    const slowA = defer();
    const fastB = defer();
    const api = {
      request: vi.fn(async (_m: string, p: { file?: string }) => (p.file === '/a.jsonl' ? slowA.promise : fastB.promise)),
    } as unknown as DesktopApi;

    const { result, rerender } = renderHook(({ file }) => useHistoryFeed(api, file), {
      initialProps: { file: '/a.jsonl' },
    });
    // A's request must actually be IN FLIGHT before the switch — otherwise
    // file-scoped cleanup cancels its timer and the test proves nothing
    // (review MINOR: `loading` alone is the initial value too).
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('readSession', expect.objectContaining({ file: '/a.jsonl' })),
    );
    // …the user switches to B before A answers
    rerender({ file: '/b.jsonl' });
    await act(async () => {
      fastB.resolve(page('ответ B'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(JSON.stringify(result.current.result?.entries)).toContain('ответ B');

    // The retired A finally resolves — it must NOT overwrite B. Flush the
    // whole microtask chain deterministically (no arbitrary wall-clock wait).
    await act(async () => {
      slowA.resolve(page('ответ A'));
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(JSON.stringify(result.current.result?.entries)).toContain('ответ B');
    expect(JSON.stringify(result.current.result?.entries)).not.toContain('ответ A');
  });

  it('a file switch clears a previous file error immediately', async () => {
    const failA = defer();
    const okB = defer();
    const api = {
      request: vi.fn(async (_m: string, p: { file?: string }) => (p.file === '/a.jsonl' ? failA.promise : okB.promise)),
    } as unknown as DesktopApi;

    const { result, rerender } = renderHook(({ file }) => useHistoryFeed(api, file), {
      initialProps: { file: '/a.jsonl' },
    });
    // wait until A's request is actually in flight (catch handler attached)
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('readSession', expect.objectContaining({ file: '/a.jsonl' })),
    );
    await act(async () => {
      failA.reject({ code: 'BOOM', message: 'read failed' });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ file: '/b.jsonl' });
    // The stale error must not present itself as B's state while B loads.
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();

    await act(async () => {
      okB.resolve(page('B ok'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.error).toBeNull();
  });
});
