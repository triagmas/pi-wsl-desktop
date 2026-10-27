/**
 * RED gate for the M1 Sessions & Chat bridge contract (SPECIFICATION §4.1).
 *
 * These schemas are OUR bridge contract — names like `listSessions` are not
 * claims about literal Pi RPC commands (the bridge maps them onto the
 * installed Pi 1.3.0 API discovered during research).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  M1_METHODS,
  ALL_METHODS,
  ProjectInfoSchema,
  SessionInfoSchema,
  ReadSessionParamsSchema,
  ReadSessionResultSchema,
  SendPromptParamsSchema,
  SendPromptResultSchema,
  OpenSessionResultSchema,
  ChatEventSchema,
  SessionHeaderSchema,
  ModelInfoSchema,
  GetAvailableModelsResultSchema,
  SetModelParamsSchema,
  SetModelResultSchema,
  GetThinkingLevelsResultSchema,
  SetThinkingLevelParamsSchema,
  SetThinkingLevelResultSchema,
} from '../../src/shared/m1Protocol';
import { mapUnknownMethod } from '../../src/shared/protocol';
import { isAllowedRendererMethod } from '../../src/shared/whitelist';

describe('M1 method allowlist', () => {
  it('declares exactly the SPEC §4.1 bridge methods', () => {
    // closeSession is a documented extension beyond the SPEC §4.1 minimum:
    // RESOURCE_BUSY needs an explicit user-driven escape hatch (lifecycle
    // necessity; no auto-close — write boundary stays explicit).
    expect([...M1_METHODS].sort()).toEqual(
      [
        'closeSession',
        'getAvailableModels',
        'getState',
        'getThinkingLevels',
        'interrupt',
        'listProjects',
        'listSessions',
        'openSession',
        'readSession',
        'searchSessions',
        'setModel',
        'setThinkingLevel',
        'sendPrompt',
        'subscribeEvents',
      ].sort(),
    );
  });

  it('ALL_METHODS = M0 ∪ M1 and the protocol boundary accepts them', () => {
    expect(ALL_METHODS).toContain('health');
    expect(ALL_METHODS).toContain('listSessions');
    for (const method of ALL_METHODS) {
      expect(mapUnknownMethod(method)).toBeNull();
    }
    expect(mapUnknownMethod('deleteSession')).not.toBeNull();
  });

  it('renderer whitelist covers M1 (write boundary is enforced by bridge policy, not by denial)', () => {
    for (const method of M1_METHODS) {
      expect(isAllowedRendererMethod(method)).toBe(true);
    }
    expect(isAllowedRendererMethod('exec')).toBe(false);
    expect(isAllowedRendererMethod('__proto__')).toBe(false);
    expect(isAllowedRendererMethod('listSessions ')).toBe(false);
  });
});

describe('project and session schemas', () => {
  it('accepts a well-formed project record', () => {
    const project = { id: 'p1', path: '/home/user/repo', sessionCount: 3, lastActivityAt: '2026-10-19T00:00:00.000Z' };
    expect(ProjectInfoSchema.parse(project)).toEqual(project);
    expect(ProjectInfoSchema.parse({ ...project, lastActivityAt: null }).lastActivityAt).toBeNull();
  });

  it('rejects a project with a relative path or negative counts', () => {
    expect(ProjectInfoSchema.safeParse({ id: 'p', path: 'relative/x', sessionCount: 0, lastActivityAt: null }).success).toBe(false);
    expect(ProjectInfoSchema.safeParse({ id: 'p', path: '/x', sessionCount: -1, lastActivityAt: null }).success).toBe(false);
  });

  it('requires session provenance, availability and active-write diagnostics', () => {
    const session = {
      id: '01a153aa-c11c-728d-ad52-1c1cff70d227',
      file: '/home/user/.pi/agent/sessions/--home-user-repo--/s.jsonl',
      root: '/home/user/.pi/agent/sessions',
      projectId: 'p1',
      projectPath: '/home/user/repo',
      name: 'refactor auth',
      createdAt: '2026-10-19T00:00:00.000Z',
      updatedAt: '2026-10-19T01:00:00.000Z',
      sizeBytes: 1024,
      version: 3,
      availability: 'ok',
      activeWrite: false,
      diagnostics: null,
    };
    expect(SessionInfoSchema.parse(session)).toEqual(session);
    expect(SessionInfoSchema.safeParse({ ...session, availability: 'writing' }).success).toBe(false);
    expect(SessionInfoSchema.safeParse({ ...session, activeWrite: 'yes' }).success).toBe(false);
    expect(SessionInfoSchema.safeParse({ ...session, diagnostics: 42 }).success).toBe(false);
  });

  it('exposes diagnostic availability states for unreadable/corrupt/empty files', () => {
    for (const availability of ['ok', 'unreadable', 'corrupt', 'empty'] as const) {
      expect(
        SessionInfoSchema.safeParse({
          id: 'x', file: '/a/b.jsonl', root: '/a', projectId: 'p', projectPath: '/p',
          name: null, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
          sizeBytes: 1, version: 1, availability, activeWrite: false, diagnostics: 'line 1: invalid json',
        }).success,
      ).toBe(true);
    }
  });
});

describe('readSession contract', () => {
  it('accepts cursor pagination params with bounded limits', () => {
    expect(ReadSessionParamsSchema.safeParse({ file: '/a/b.jsonl' }).success).toBe(true);
    expect(ReadSessionParamsSchema.safeParse({ file: '/a/b.jsonl', sinceEntryId: 'ab12', limit: 500 }).success).toBe(true);
    expect(ReadSessionParamsSchema.safeParse({ file: '/a/b.jsonl', limit: 0 }).success).toBe(false);
    expect(ReadSessionParamsSchema.safeParse({ file: '/a/b.jsonl', limit: 501 }).success).toBe(false);
    expect(ReadSessionParamsSchema.safeParse({ file: '/a/b.jsonl', branch: 'all' }).success).toBe(true);
    expect(ReadSessionParamsSchema.safeParse({ file: '/a/b.jsonl', branch: 'everything' }).success).toBe(false);
  });

  it('result carries header, entries, leaf, next cursor, partial trailing and bounded diagnostics', () => {
    const result = {
      header: { type: 'session', version: 3, id: 'uuid-1', cwd: '/home/user/repo', timestamp: '2026-10-19T00:00:00.000Z', parentSession: null },
      entries: [
        { type: 'message', id: 'a1', parentId: null, timestamp: '2026-10-19T00:00:01.000Z', raw: { type: 'message' } },
        { type: 'weird_future_entry', id: 'a2', parentId: 'a1', timestamp: null, raw: { type: 'weird_future_entry' } },
      ],
      leafId: 'a2',
      nextCursor: 'a2',
      truncated: true,
      partialTrailing: false,
      diagnostics: [{ line: 7, error: 'invalid json' }],
      availability: 'ok',
    };
    const parsed = ReadSessionResultSchema.parse(result);
    expect(parsed.entries).toHaveLength(2);
    // Unknown future entry types must survive as opaque raw entries.
    expect(parsed.entries[1].raw).toEqual({ type: 'weird_future_entry' });
    expect(parsed.partialTrailing).toBe(false);
    expect(parsed.diagnostics[0].line).toBe(7);
  });

  it('rejects results without the no-mutation observability fields', () => {
    expect(ReadSessionResultSchema.safeParse({ header: null, entries: [], leafId: null }).success).toBe(false);
  });

  it('parses session headers of every documented version including legacy v1', () => {
    expect(SessionHeaderSchema.parse({ type: 'session', version: 1, id: 'u', timestamp: 'T', cwd: '/x' }).version).toBe(1);
    expect(SessionHeaderSchema.safeParse({ type: 'session', version: 4, id: 'u', timestamp: 'T', cwd: '/x' }).success).toBe(false);
  });
});

describe('chat contract', () => {
  it('sendPrompt accepts an explicit streaming behavior and returns the documented disposition', () => {
    expect(SendPromptParamsSchema.safeParse({ message: 'hi' }).success).toBe(true);
    expect(SendPromptParamsSchema.safeParse({ message: 'hi', streamingBehavior: 'steer' }).success).toBe(true);
    expect(SendPromptParamsSchema.safeParse({ message: '' }).success).toBe(false);
    expect(SendPromptParamsSchema.safeParse({ message: 'hi', streamingBehavior: 'shout' }).success).toBe(false);
    expect(SendPromptResultSchema.parse({ disposition: 'started' }).disposition).toBe('started');
    expect(SendPromptResultSchema.safeParse({ disposition: 'done' }).success).toBe(false);
  });

  it('openSession result mirrors the Pi get_state shape we verified (no sessionFile with --no-session)', () => {
    const state = {
      sessionId: '01a153aa-c11c-728d-ad52-1c1cff70d227',
      sessionFile: null,
      isStreaming: false,
      isCompacting: false,
      messageCount: 0,
      model: null,
      thinkingLevel: 'high',
    };
    expect(OpenSessionResultSchema.parse({ state })).toEqual({ state });
    // state must be nullable while no chat session is open
    expect(OpenSessionResultSchema.safeParse({ state: null }).success).toBe(true);
  });

  it('chat events are a closed discriminated union: pi-forwarded events and bridge lifecycle', () => {
    expect(ChatEventSchema.parse({ kind: 'pi', name: 'message_update', data: { assistantMessageEvent: { type: 'text_delta', delta: 'x' } } }).kind).toBe('pi');
    expect(ChatEventSchema.parse({ kind: 'opened', state: null }).kind).toBe('opened');
    expect(ChatEventSchema.parse({ kind: 'closed', code: 'DISCONNECTED', message: 'pipe closed' }).kind).toBe('closed');
    expect(ChatEventSchema.safeParse({ kind: 'pi' }).success).toBe(false); // name required
    expect(ChatEventSchema.safeParse({ kind: 'surprise' }).success).toBe(false);
  });
});

describe('schema export sanity', () => {
  it('all exported schemas are zod schemas', () => {
    for (const s of [ProjectInfoSchema, SessionInfoSchema, ChatEventSchema]) {
      expect(s).toBeInstanceOf(z.ZodType);
    }
  });
});

describe('UI21-F2 model catalog & selector contract', () => {
  const state = {
    sessionId: 's1',
    sessionFile: '/f.jsonl',
    isStreaming: false,
    isCompacting: false,
    messageCount: 2,
    model: { id: 'm1', name: 'Model One', provider: 'prov-a' },
    thinkingLevel: 'off',
  };

  it('a model record keeps only Pi metadata and never credentials', () => {
    const parsed = ModelInfoSchema.parse({
      provider: 'prov-a',
      id: 'm1',
      name: 'Model One',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: ['text', 'image'],
    });
    expect(parsed).toMatchObject({ provider: 'prov-a', id: 'm1', name: 'Model One' });
    // apiKey/token style fields cannot survive parsing
    expect('apiKey' in parsed).toBe(false);
  });

  it('rejects models without provider/id/name — no anonymous entries', () => {
    expect(() => ModelInfoSchema.parse({ id: 'm1', name: 'x' })).toThrow();
    expect(() => ModelInfoSchema.parse({ provider: 'p', name: 'x' })).toThrow();
    expect(() => ModelInfoSchema.parse({ provider: 'p', id: 'm1' })).toThrow();
  });

  it('an empty configured catalog is a valid answer (never an error, never a default)', () => {
    expect(GetAvailableModelsResultSchema.parse({ models: [] })).toEqual({ models: [] });
  });

  it('setModel requires an explicit provider AND model id', () => {
    expect(SetModelParamsSchema.parse({ provider: 'prov-a', modelId: 'm1' })).toEqual({ provider: 'prov-a', modelId: 'm1' });
    expect(() => SetModelParamsSchema.parse({ modelId: 'm1' })).toThrow();
    expect(() => SetModelParamsSchema.parse({ provider: 'prov-a' })).toThrow();
    expect(() => SetModelParamsSchema.parse({ provider: '', modelId: 'm1' })).toThrow();
  });

  it('setModel result is the fresh Pi state (authoritative), not an echo of the request', () => {
    expect(SetModelResultSchema.parse({ state })).toEqual({ state });
    expect(SetModelResultSchema.parse({ state: null })).toEqual({ state: null });
  });

  it('thinking levels come from Pi for the selected model; current is nullable', () => {
    expect(GetThinkingLevelsResultSchema.parse({ levels: ['off', 'high'], current: 'off' })).toEqual({
      levels: ['off', 'high'],
      current: 'off',
    });
    expect(GetThinkingLevelsResultSchema.parse({ levels: [], current: null })).toEqual({ levels: [], current: null });
  });

  it('setThinkingLevel takes exactly one level string', () => {
    expect(SetThinkingLevelParamsSchema.parse({ level: 'high' })).toEqual({ level: 'high' });
    expect(() => SetThinkingLevelParamsSchema.parse({ level: '' })).toThrow();
    expect(() => SetThinkingLevelParamsSchema.parse({})).toThrow();
  });

  it('setThinkingLevel result is the fresh Pi state', () => {
    expect(SetThinkingLevelResultSchema.parse({ state })).toEqual({ state });
  });
});
