/**
 * M2 token measurement — deterministic synthetic task checkers (Issue #12,
 * plan Task 2 step 1).
 *
 * Three fixed, non-secret benchmark tasks with deterministic success
 * assertions. The checkers are pure functions over model replies so they
 * can be unit-tested with synthetic fixtures BEFORE any paid call:
 *  - A: status/documents — exact computed token in the reply;
 *  - B: narrow code+TDD — extracted JS snippet must satisfy fixed cases;
 *  - C: security review — every seeded issue must be named.
 *
 * RED first: written and run before scripts/lib/m2AcceptanceTasks.ts exists.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_TASKS,
  checkTaskA,
  checkTaskB,
  checkTaskC,
  expectedTokenA,
} from '../../scripts/lib/m2AcceptanceTasks';

describe('task A checker (status/documents)', () => {
  it('accepts a reply containing the exact computed token', () => {
    const r = checkTaskA('Let me count.\n\nDIFF-STAT 5 3\n');
    expect(r.ok).toBe(true);
  });

  it('rejects a wrong count even with the right shape', () => {
    expect(checkTaskA('DIFF-STAT 5 4').ok).toBe(false);
    expect(checkTaskA('DIFF-STAT 6 3').ok).toBe(false);
  });

  it('rejects a reply that only describes the answer', () => {
    expect(checkTaskA('There are five added and three removed lines.').ok).toBe(false);
  });

  it('expectedTokenA matches the fixture diff (5 added, 3 removed)', () => {
    expect(expectedTokenA).toBe('DIFF-STAT 5 3');
  });
});

describe('task B checker (narrow code + TDD)', () => {
  const goodReply = [
    'Here is the implementation:',
    '```js',
    'function chunkString(s, size) {',
    '  if (!Number.isInteger(size) || size < 1) throw new RangeError("size");',
    '  const out = [];',
    '  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));',
    '  return out;',
    '}',
    '```',
  ].join('\n');

  it('accepts a fenced implementation passing the fixed cases', () => {
    expect(checkTaskB(goodReply)).toEqual({ ok: true, detail: 'all cases pass' });
  });

  it('rejects an implementation failing a fixed case', () => {
    const bad = goodReply.replace('size < 1', 'size <= 1');
    const r = checkTaskB(bad);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/case|throw|error/i);
  });

  it('rejects a reply with no fenced code block', () => {
    expect(checkTaskB('You should loop over the string in steps of size.').ok).toBe(false);
  });

  it('rejects a snippet that does not define chunkString', () => {
    const r = checkTaskB('```js\nfunction other() { return 1; }\n```');
    expect(r.ok).toBe(false);
  });
});

describe('task C checker (security review)', () => {
  const fullReply = [
    'Issues found:',
    '1. Path traversal in the file read (untrusted name joined to base).',
    '2. The API key is passed via argv, leaking the secret to the process list.',
    '3. The write applies settings without a confirmation gate or backup.',
  ].join('\n');

  it('accepts a reply naming all three seeded issues', () => {
    expect(checkTaskC(fullReply)).toEqual({ ok: true, detail: 'all 3 seeded issues named' });
  });

  it('rejects a reply missing one seeded issue', () => {
    const r = checkTaskC(fullReply.split('\n').slice(0, 2).join('\n'));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/missing/i);
  });

  it('is case-insensitive and keyword-tolerant', () => {
    const reply = 'PATH TRAVERSAL here; secret sent through ARGS; write without CONFIRM/backup.';
    expect(checkTaskC(reply).ok).toBe(true);
  });
});

describe('ACCEPTANCE_TASKS registry', () => {
  it('exactly three tasks, classes A/B/C, each with prompt and checker', () => {
    expect(ACCEPTANCE_TASKS.map((t) => t.id)).toEqual(['A', 'B', 'C']);
    for (const t of ACCEPTANCE_TASKS) {
      expect(t.prompt.length).toBeGreaterThan(50);
      expect(typeof t.check).toBe('function');
      // prompts are synthetic and non-secret by construction
      expect(t.prompt).not.toMatch(/api[_-]?key\s*=\s*\S+/i);
    }
  });
});
