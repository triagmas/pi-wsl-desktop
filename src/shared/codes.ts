/**
 * Node-free protocol constants (shared/codes.ts):
 * imported by BOTH main/bridge and the sandboxed renderer — must never pull
 * node-only code (Buffer) into the web bundle. protocol.ts re-exports the
 * same symbols for the transport layer.
 */
/** Bridge protocol version. Bump on any breaking frame change. */
export const PROTOCOL_VERSION = 1;

/** Hard cap for a single NDJSON frame, bytes. Oversized frames kill the connection. */
export const MAX_FRAME_BYTES = 1_048_576;

/** Read-only method allowlist for M0. No write methods exist. */
export const M0_METHODS = ['health', 'getRuntimeInfo', 'getCapabilities', 'ping'] as const;
export type M0Method = (typeof M0_METHODS)[number];

/**
 * Bridge contract methods added in M1 (Sessions & Chat), SPECIFICATION §4.1.
 * These are OUR bridge names — the bridge maps them onto the installed Pi
 * RPC/SDK; they are not claims about literal Pi command names.
 * `openSession`/`sendPrompt`/`interrupt` form the explicit write boundary:
 * they are reachable only from the renderer UI on user action and are still
 * gated by bridge concurrency policy (SESSION_CONFLICT / RESOURCE_BUSY).
 */
export const M1_METHODS = [
  'listProjects',
  'listSessions',
  'readSession',
  'searchSessions',
  'openSession',
  'sendPrompt',
  'interrupt',
  'getState',
  'subscribeEvents',
  // Extension beyond the SPEC §4.1 minimum: explicit escape hatch from
  // RESOURCE_BUSY (no auto-close — the write boundary stays user-driven).
  'closeSession',
] as const;
export type M1Method = (typeof M1_METHODS)[number];

/** Every method the bridge serves (M0 read-only + M1 sessions/chat). */
export const ALL_METHODS = [...M0_METHODS, ...M1_METHODS] as const;
export type AllMethod = (typeof ALL_METHODS)[number];

/**
 * Stable error codes. The first block is mandated by SPECIFICATION.md §7;
 * the second block is generic transport/validation machinery for M0.
 */
export const ALL_ERROR_CODES = [
  'WSL_UNAVAILABLE',
  'NODE_NOT_FOUND',
  'PI_NOT_FOUND',
  'PI_INCOMPATIBLE',
  'BRIDGE_TIMEOUT',
  'SESSION_CONFLICT',
  'SESSION_NOT_FOUND',
  'UNTRUSTED_PROJECT',
  'RESOURCE_BUSY',
  'MCP_ERROR',
  'INVALID_REQUEST',
  'METHOD_NOT_ALLOWED',
  'PROTOCOL_ERROR',
  'UNSUPPORTED_VERSION',
  'CANCELLED',
  'DISCONNECTED',
  'QUEUE_FULL',
  'UNKNOWN',
] as const;
export type ErrorCode = (typeof ALL_ERROR_CODES)[number];

