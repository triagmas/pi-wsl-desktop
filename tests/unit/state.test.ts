import { describe, expect, it } from 'vitest';
import { initialState, reduce, type ConnEvent } from '../../src/main/state';

const cfg = { maxAutoAttempts: 3 };

function walk(events: ConnEvent[]) {
  return events.reduce((s, e) => reduce(s, e, cfg), initialState());
}

describe('connection state machine', () => {
  it('starts idle', () => {
    expect(initialState()).toEqual({ phase: 'idle', attempt: 0 });
  });

  it('follows the happy path idle → discovering → connecting → ready', () => {
    const s = walk([
      { type: 'DISCOVER_START' },
      { type: 'DISCOVER_OK' },
      { type: 'SPAWNED' },
      { type: 'READY' },
    ]);
    expect(s).toEqual({ phase: 'ready', attempt: 0 });
  });

  it('crash from ready goes to backoff with attempt+1, then reconnects', () => {
    const s = walk([
      { type: 'DISCOVER_START' },
      { type: 'DISCOVER_OK' },
      { type: 'READY' },
      { type: 'LOST' },
    ]);
    expect(s.phase).toBe('backoff');
    expect(s.attempt).toBe(1);

    const s2 = reduce(s, { type: 'BACKOFF_DONE' }, cfg);
    expect(s2.phase).toBe('discovering');
    const s3 = reduce(reduce(s2, { type: 'DISCOVER_OK' }, cfg), { type: 'READY' }, cfg);
    expect(s3).toEqual({ phase: 'ready', attempt: 0 });
  });

  it('exhausts auto attempts and lands in error', () => {
    const s = walk([
      { type: 'DISCOVER_START' },
      { type: 'DISCOVER_FAIL' }, // 1
      { type: 'BACKOFF_DONE' },
      { type: 'DISCOVER_FAIL' }, // 2
      { type: 'BACKOFF_DONE' },
      { type: 'DISCOVER_FAIL' }, // 3 = maxAutoAttempts
    ]);
    expect(s.phase).toBe('error');
    expect(s.attempt).toBe(3);
    expect(s.lastError?.code).toBe('WSL_UNAVAILABLE');
  });

  it('CONNECT_TIMEOUT from connecting never hangs: goes to backoff', () => {
    const s = walk([
      { type: 'DISCOVER_START' },
      { type: 'DISCOVER_OK' },
      { type: 'CONNECT_TIMEOUT' },
    ]);
    expect(s.phase).toBe('backoff');
    expect(s.attempt).toBe(1);
  });

  it('RETRY_MANUAL from error resets the attempt counter', () => {
    const s = walk([
      { type: 'DISCOVER_START' },
      { type: 'DISCOVER_FAIL' },
      { type: 'BACKOFF_DONE' },
      { type: 'DISCOVER_FAIL' },
      { type: 'BACKOFF_DONE' },
      { type: 'DISCOVER_FAIL' },
      { type: 'RETRY_MANUAL' },
    ]);
    expect(s).toEqual({ phase: 'discovering', attempt: 0 });
  });

  it('non-retryable failures go straight to error', () => {
    const s = walk([{ type: 'DISCOVER_START' }, { type: 'DISCOVER_FAIL', retryable: false }]);
    expect(s.phase).toBe('error');
    const s2 = walk([{ type: 'DISCOVER_START' }, { type: 'DISCOVER_OK' }, { type: 'LOST', retryable: false }]);
    expect(s2.phase).toBe('error');
  });

  it('FATAL carries the error payload into the error state', () => {
    const s = walk([{ type: 'FATAL', code: 'NODE_NOT_FOUND', message: 'no node' }]);
    expect(s.phase).toBe('error');
    expect(s.lastError).toEqual({ code: 'NODE_NOT_FOUND', message: 'no node' });
  });

  it('ignores events that make no sense for the current phase', () => {
    expect(reduce(initialState(), { type: 'BACKOFF_DONE' }, cfg)).toEqual(initialState());
    expect(reduce(initialState(), { type: 'READY' }, cfg)).toEqual(initialState());
    const ready = walk([{ type: 'DISCOVER_START' }, { type: 'READY' }]);
    expect(reduce(ready, { type: 'BACKOFF_DONE' }, cfg)).toEqual(ready);
  });

  it('records lastError on LOST', () => {
    const s = walk([
      { type: 'DISCOVER_START' },
      { type: 'DISCOVER_OK' },
      { type: 'READY' },
      { type: 'LOST', retryable: true },
    ]);
    expect(s.lastError?.code).toBe('DISCONNECTED');
  });
});
