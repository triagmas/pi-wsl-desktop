/**
 * Pure connection state machine for the Desktop → WSL Bridge lifecycle.
 *
 * Guarantees: no phase can persist without an escape — `connecting` always
 * resolves via READY/CONNECT_TIMEOUT, auto-retries are capped at
 * maxAutoAttempts and then fall back to a manual-retry error state.
 */

export type ConnPhase = 'idle' | 'discovering' | 'connecting' | 'ready' | 'backoff' | 'error';

export interface ConnError {
  code: string;
  message: string;
}

export type ConnEvent =
  | { type: 'DISCOVER_START' }
  | { type: 'DISCOVER_OK' }
  | { type: 'DISCOVER_FAIL'; retryable?: boolean; error?: ConnError }
  | { type: 'SPAWNED' }
  | { type: 'READY' }
  | { type: 'PI_GATE_FAIL'; error: ConnError }
  | { type: 'LOST'; retryable?: boolean }
  | { type: 'CONNECT_TIMEOUT' }
  | { type: 'BACKOFF_DONE' }
  | { type: 'RETRY_MANUAL' }
  | { type: 'FATAL'; code: string; message: string };

export interface ConnSnapshot {
  phase: ConnPhase;
  attempt: number;
  lastError?: ConnError;
}

export interface StateConfig {
  maxAutoAttempts: number;
}

export function initialState(): ConnSnapshot {
  return { phase: 'idle', attempt: 0 };
}

function failed(s: ConnSnapshot, e: ConnEvent, error: ConnError, cfg: StateConfig): ConnSnapshot {
  const retryable = 'retryable' in e ? e.retryable !== false : true;
  const attempt = s.attempt + 1;
  if (!retryable || attempt >= cfg.maxAutoAttempts) {
    return { phase: 'error', attempt, lastError: error };
  }
  return { phase: 'backoff', attempt, lastError: error };
}

export function reduce(s: ConnSnapshot, e: ConnEvent, cfg: StateConfig): ConnSnapshot {
  switch (e.type) {
    case 'DISCOVER_START':
      if (s.phase === 'discovering') return s;
      return { phase: 'discovering', attempt: s.attempt, ...(s.lastError ? { lastError: s.lastError } : {}) };
    case 'DISCOVER_OK':
    case 'SPAWNED':
      return s.phase === 'discovering' || s.phase === 'connecting'
        ? { phase: 'connecting', attempt: s.attempt }
        : s;
    case 'READY':
      return s.phase === 'connecting' ? { phase: 'ready', attempt: 0 } : s;
    case 'DISCOVER_FAIL':
      if (s.phase !== 'discovering') return s;
      return failed(
        s,
        e,
        e.error ?? { code: 'WSL_UNAVAILABLE', message: 'WSL discovery failed' },
        cfg,
      );
    case 'LOST':
      if (s.phase !== 'ready' && s.phase !== 'connecting') return s;
      return failed(s, e, { code: 'DISCONNECTED', message: 'Bridge connection lost' }, cfg);
    case 'CONNECT_TIMEOUT':
      if (s.phase !== 'connecting') return s;
      return failed(s, e, { code: 'BRIDGE_TIMEOUT', message: 'Bridge did not become ready in time' }, cfg);
    case 'BACKOFF_DONE':
      return s.phase === 'backoff' ? { phase: 'discovering', attempt: s.attempt } : s;
    case 'PI_GATE_FAIL':
      // Ready-gate failures (PI_NOT_FOUND / PI_INCOMPATIBLE …) are not
      // transient: no auto-retry loop — land in error with the diagnostic
      // code; RETRY_MANUAL below re-runs the whole cycle on user demand.
      if (s.phase !== 'connecting') return s;
      return { phase: 'error', attempt: s.attempt, lastError: e.error };
    case 'RETRY_MANUAL':
      return { phase: 'discovering', attempt: 0 };
    case 'FATAL':
      return { phase: 'error', attempt: s.attempt, lastError: { code: e.code, message: e.message } };
  }
}
