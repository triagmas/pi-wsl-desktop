import { z } from 'zod';

/** Bridge protocol version. Bump on any breaking frame change. */
export const PROTOCOL_VERSION = 1;

/** Hard cap for a single NDJSON frame, bytes. Oversized frames kill the connection. */
export const MAX_FRAME_BYTES = 1_048_576;

/** Read-only method allowlist for M0. No write methods exist. */
export const M0_METHODS = ['health', 'getRuntimeInfo', 'getCapabilities', 'ping'] as const;
export type M0Method = (typeof M0_METHODS)[number];

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

const RequestIdSchema = z.string().min(1).max(64);

const RequestFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('request'),
  requestId: RequestIdSchema,
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

const ResponseOkFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('response'),
  requestId: RequestIdSchema,
  status: z.literal('ok'),
  result: z.unknown(),
});

const ResponseErrorFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('response'),
  requestId: RequestIdSchema,
  status: z.literal('error'),
  error: z.object({
    code: z.enum(ALL_ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const CancelFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('cancel'),
  requestId: RequestIdSchema,
});

const EventFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('event'),
  event: z.string().min(1),
  payload: z.unknown().optional(),
});

// Plain union: the two response variants share `type: 'response'`, which zod v4
// forbids inside discriminatedUnion. Order matters only for error messages.
export const FrameSchema = z.union([
  RequestFrameSchema,
  ResponseOkFrameSchema,
  ResponseErrorFrameSchema,
  CancelFrameSchema,
  EventFrameSchema,
]);

export type RequestFrameT = z.infer<typeof RequestFrameSchema>;
export type ResponseOkFrameT = z.infer<typeof ResponseOkFrameSchema>;
export type ResponseErrorFrameT = z.infer<typeof ResponseErrorFrameSchema>;
export type CancelFrameT = z.infer<typeof CancelFrameSchema>;
export type EventFrameT = z.infer<typeof EventFrameSchema>;
export type FrameT = z.infer<typeof FrameSchema>;

export class FrameTooLargeError extends Error {
  constructor(bytes: number) {
    super(`frame of ${bytes} bytes exceeds MAX_FRAME_BYTES=${MAX_FRAME_BYTES}`);
    this.name = 'FrameTooLargeError';
  }
}

export type ParseFailure =
  | { ok: false; reason: 'invalid_json' }
  | { ok: false; reason: 'schema' }
  | { ok: false; reason: 'too_large' };

export type ParseResult = { ok: true; frame: FrameT } | ParseFailure;

/** Parse one complete NDJSON line (without terminator) into a protocol frame. */
export function parseFrameLine(line: string): ParseResult {
  if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
    return { ok: false, reason: 'too_large' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const parsed = FrameSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'schema' };
  }
  return { ok: true, frame: parsed.data };
}

/** Validate and encode a frame to JSON (no trailing newline). Throws on invalid/oversized frames. */
export function encodeFrame(frame: FrameT): string {
  const parsed = FrameSchema.safeParse(frame);
  if (!parsed.success) {
    throw new Error(`invalid frame: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  const json = JSON.stringify(parsed.data);
  if (Buffer.byteLength(json, 'utf8') > MAX_FRAME_BYTES) {
    throw new FrameTooLargeError(Buffer.byteLength(json, 'utf8'));
  }
  return json;
}

/** Return a METHOD_NOT_ALLOWED error body for methods outside the read-only allowlist. */
export function mapUnknownMethod(method: string): { code: 'METHOD_NOT_ALLOWED'; message: string } | null {
  if ((M0_METHODS as readonly string[]).includes(method)) {
    return null;
  }
  return { code: 'METHOD_NOT_ALLOWED', message: `Method not allowed: ${method}` };
}
