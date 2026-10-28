/**
 * M1 Sessions & Chat — Bridge contract schemas (SPECIFICATION §4.1).
 *
 * Method names (`listSessions`, `readSession`, `sendPrompt`, …) are OUR
 * bridge contract, not literal Pi RPC command names: the bridge translates
 * them to the installed Pi's verified API (`get_state`, `switch_session`,
 * `prompt`, `abort`, file-based indexing, …).
 *
 * Design rules encoded here:
 * - Session files are READ-ONLY data: readSession results expose enough
 *   observability (diagnostics, partialTrailing, availability) to prove the
 *   reader never had to modify anything.
 * - Forward compatibility: unknown future entry types survive as opaque
 *   `{type, raw}` records instead of failing the whole read.
 * - The write boundary is explicit: openSession/sendPrompt/interrupt carry
 *   user intent; the bridge re-checks CLI/GUI concurrency before acting.
 */
import { z } from 'zod';
import { ALL_ERROR_CODES, ALL_METHODS, M1_METHODS, PROTOCOL_VERSION } from './codes';

export { M1_METHODS, ALL_METHODS };
export type { M1Method } from './codes';

/* ------------------------------------------------------------------ */
/* Projects & sessions                                                 */
/* ------------------------------------------------------------------ */

export const SessionHeaderSchema = z.object({
  type: z.literal('session'),
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  cwd: z.string().min(1),
  parentSession: z.string().nullish(),
});
export type SessionHeaderT = z.infer<typeof SessionHeaderSchema>;

export const ProjectInfoSchema = z.object({
  id: z.string().min(1),
  path: z.string().startsWith('/'),
  sessionCount: z.number().int().min(0),
  lastActivityAt: z.string().nullable(),
});
export type ProjectInfoT = z.infer<typeof ProjectInfoSchema>;

export const SessionAvailabilitySchema = z.enum(['ok', 'unreadable', 'corrupt', 'empty']);

export const SessionInfoSchema = z.object({
  /** Session UUID from the file header (fallback: file stem for broken headers). */
  id: z.string().min(1),
  file: z.string().min(1),
  /** Session root directory this file was indexed from. */
  root: z.string().min(1),
  projectId: z.string().min(1),
  projectPath: z.string().min(1),
  /** Display name from `session_info` when present. */
  name: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string(),
  sizeBytes: z.number().int().min(0),
  version: z.number().int().min(1),
  availability: SessionAvailabilitySchema,
  /** True when the file was modified within ACTIVE_WRITE_WINDOW_MS (possible live CLI). */
  activeWrite: z.boolean(),
  diagnostics: z.string().nullable(),
});
export type SessionInfoT = z.infer<typeof SessionInfoSchema>;

/* ------------------------------------------------------------------ */
/* readSession                                                         */
/* ------------------------------------------------------------------ */

export const ReadSessionParamsSchema = z.object({
  file: z.string().min(1),
  /** Cursor: return entries strictly AFTER this entry id (append order). */
  /** Cursor: return entries strictly AFTER this entry id (append order).
   * Also accepts the positional form `L<lineNo>` for id-less (legacy/corrupt)
   * pages; real Pi entry ids are UUIDs, so the forms cannot collide in
   * practice (review round 4: documented shadowing rule). */
  sinceEntryId: z.string().min(1).optional(),
  /** UI21 F1-B R03: cursor for BACKWARD paging — entries strictly BEFORE it.
   * Omitted together with `direction:'backward'` → the file tail (newest). */
  beforeEntryId: z.string().min(1).optional(),
  /** UI21 F1-B R03: page direction. `forward` (default) keeps the historic
   * earliest-first cursor; `backward` serves the newest entries first so a
   * reopened session shows what the user just wrote. */
  direction: z.enum(['forward', 'backward']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  branch: z.enum(['active', 'all']).optional(),
});
export type ReadSessionParamsT = z.infer<typeof ReadSessionParamsSchema>;

export const SessionEntrySchema = z.object({
  type: z.string().min(1),
  id: z.string().nullish(),
  parentId: z.string().nullish(),
  timestamp: z.string().nullish(),
  /** The original parsed JSONL record, preserved verbatim. */
  raw: z.unknown(),
});
export type SessionEntryT = z.infer<typeof SessionEntrySchema>;

export const ReadDiagnosticSchema = z.object({
  line: z.number().int().min(1),
  error: z.string().min(1),
});
export type ReadDiagnosticT = z.infer<typeof ReadDiagnosticSchema>;

/** One bound for per-read parse diagnostics (sessionReader) and for the
 * diagnostics accumulated across pagination pages (renderer mergeHistoryPage). */
export const MAX_READ_DIAGNOSTICS = 100;

/**
 * UI21 F1-B R03 (P1): hard budget for ONE readSession result.
 *
 * The page limit is counted in ENTRIES, but a session entry carries the raw Pi
 * record (tool output, long answer). 100 such entries encoded to ~1.1 MiB and
 * exceeded `MAX_FRAME_BYTES` (1 MiB) — the bridge's frame encoder threw and the
 * process EXITED, so a long session could not be opened at all. The reader now
 * trims the page to this budget, the same fail-closed shape `listModules` uses.
 */
export const MAX_READ_RESULT_BYTES = 786_432; // 768 KiB

/** Per-entry framing overhead reserved while packing a page (type/id/raw keys). */
export const READ_ENTRY_OVERHEAD_BYTES = 96;

export const ReadSessionResultSchema = z.object({
  header: SessionHeaderSchema.nullable(),
  entries: z.array(SessionEntrySchema),
  leafId: z.string().nullable(),
  nextCursor: z.string().nullable(),
  /** UI21 F1-B R03: cursor for the OLDER page of this window (backward paging). */
  prevCursor: z.string().nullable().optional(),
  /** UI21 F1-B R03: true when nothing older than the page exists (no dead end). */
  atStart: z.boolean().optional(),
  truncated: z.boolean(),
  /** True when the file ended mid-record (concurrent append in progress). */
  partialTrailing: z.boolean(),
  /** Bounded per-line parse diagnostics (corrupt lines are skipped, not fatal). */
  diagnostics: z.array(ReadDiagnosticSchema),
  availability: SessionAvailabilitySchema,
});
export type ReadSessionResultT = z.infer<typeof ReadSessionResultSchema>;

/* ------------------------------------------------------------------ */
/* searchSessions                                                      */
/* ------------------------------------------------------------------ */

export const ListSessionsParamsSchema = z.object({
  projectId: z.string().optional(),
});
export const ListProjectsResultSchema = z.object({
  projects: z.array(ProjectInfoSchema),
  diagnostics: z.array(z.string()),
});
export const ListSessionsResultSchema = z.object({
  sessions: z.array(SessionInfoSchema),
  diagnostics: z.array(z.string()),
});
export const CloseSessionResultSchema = z.object({
  closed: z.boolean(),
});

export const SearchParamsSchema = z.object({
  query: z.string().min(1),
  projectId: z.string().optional(),
  /** Content search is opt-in: metadata is the default scope (SPEC §4.1). */
  includeContent: z.boolean().optional(),
});
export type SearchParamsT = z.infer<typeof SearchParamsSchema>;

export const SearchMatchSchema = z.object({
  sessionId: z.string(),
  file: z.string(),
  projectId: z.string(),
  field: z.enum(['name', 'cwd', 'path', 'content']),
  line: z.number().int().min(1).nullable(),
  snippet: z.string().nullable(),
});

export const SearchResultSchema = z.object({
  matches: z.array(SearchMatchSchema),
  truncated: z.boolean(),
});
export type SearchResultT = z.infer<typeof SearchResultSchema>;

/* ------------------------------------------------------------------ */
/* Chat: Pi RPC state, prompt, events                                  */
/* ------------------------------------------------------------------ */

/** Mapped shape of Pi RPC `get_state` (verified against installed Pi 1.3.0). */
export const RpcStateSchema = z.object({
  sessionId: z.string().nullable(),
  /** Absent/null with --no-session (verified in the isolated handshake). */
  sessionFile: z.string().nullable(),
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  messageCount: z.number().int().min(0),
  model: z.object({ id: z.string(), name: z.string(), provider: z.string() }).nullable(),
  thinkingLevel: z.string().nullable(),
});
export type RpcStateT = z.infer<typeof RpcStateSchema>;

export const OpenSessionParamsSchema = z.object({
  file: z.string().min(1),
});

export const OpenSessionResultSchema = z.object({
  state: RpcStateSchema.nullable(),
});
export type OpenSessionResultT = z.infer<typeof OpenSessionResultSchema>;

/**
 * UI21-F2: model catalog & selection contract.
 *
 * Source of truth is the installed Pi (`get_available_models` / `get_state`):
 * this app never ships a static model list, defaults or provider IDs. `ModelInfo`
 * is a deliberately small, credential-free projection of Pi's model record —
 * fields the app does not use are dropped by the schema, so nothing
 * secret-adjacent can travel over IPC.
 */
export const ModelInfoSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.string()).optional(),
});
export type ModelInfoT = z.infer<typeof ModelInfoSchema>;

export const GetAvailableModelsResultSchema = z.object({
  models: z.array(ModelInfoSchema),
});
export type GetAvailableModelsResultT = z.infer<typeof GetAvailableModelsResultSchema>;

export const SetModelParamsSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type SetModelParamsT = z.infer<typeof SetModelParamsSchema>;

export const SetModelResultSchema = z.object({
  /** Fresh `get_state` after the switch — the display follows Pi, not the request. */
  state: RpcStateSchema.nullable(),
});
export type SetModelResultT = z.infer<typeof SetModelResultSchema>;

export const GetThinkingLevelsResultSchema = z.object({
  levels: z.array(z.string()),
  current: z.string().nullable(),
});
export type GetThinkingLevelsResultT = z.infer<typeof GetThinkingLevelsResultSchema>;

export const SetThinkingLevelParamsSchema = z.object({
  level: z.string().min(1),
});
export type SetThinkingLevelParamsT = z.infer<typeof SetThinkingLevelParamsSchema>;

export const SetThinkingLevelResultSchema = z.object({
  state: RpcStateSchema.nullable(),
});
export type SetThinkingLevelResultT = z.infer<typeof SetThinkingLevelResultSchema>;

export const SendPromptParamsSchema = z.object({
  message: z.string().min(1).max(100_000),
  /** Required by Pi when the agent is already streaming (verified docs). */
  streamingBehavior: z.enum(['steer', 'followUp']).optional(),
});
export type SendPromptParamsT = z.infer<typeof SendPromptParamsSchema>;

export const SendPromptResultSchema = z.object({
  disposition: z.enum(['started', 'queued', 'handled']),
});

export const GetStateResultSchema = z.object({
  state: RpcStateSchema.nullable(),
});

export const SubscribeParamsSchema = z.object({
  topic: z.literal('chat'),
});

export const InterruptResultSchema = z.object({
  interrupted: z.boolean(),
});

/**
 * Chat events pushed over the bridge event frame (`type: 'event'`,
 * `event: 'chat'`) after `subscribeEvents`.
 * - `pi` forwards one installed-Pi session event verbatim (`name` from the
 *   verified json.md event table; consumers must tolerate unknown names).
 * - `opened`/`closed` are bridge lifecycle markers.
 */
export const ChatEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pi'), name: z.string().min(1), data: z.unknown() }),
  z.object({ kind: z.literal('opened'), state: RpcStateSchema.nullable() }),
  z.object({
    kind: z.literal('closed'),
    code: z.enum(ALL_ERROR_CODES),
    message: z.string(),
  }),
]);
export type ChatEventT = z.infer<typeof ChatEventSchema>;

/** Contract version of the M1 surface (tied to bridge PROTOCOL_VERSION). */
export const M1_CONTRACT_VERSION = PROTOCOL_VERSION;
