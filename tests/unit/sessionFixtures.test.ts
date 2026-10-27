/**
 * UI21-F1-C offline gate: tracked session fixtures must be structurally valid
 * Pi session data BEFORE any test run or prompt ever consumes them.
 *
 * Why: F1-B failed because a scratch fixture stored `assistant.content` as a
 * string — valid enough to survive pi's history load, but fatal inside
 * pi-ai's token estimator (`estimate.js` dereferences `block.name.length` on
 * string characters). This test rejects that whole malformed class offline,
 * for every tracked JSONL session, and self-checks the validator against
 * known-bad payloads so the gate itself cannot rot.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sessions');
const ASSISTANT_BLOCK_TYPES = new Set(['text', 'thinking', 'toolCall']);

function collectJsonl(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectJsonl(full));
    else if (name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** Throws with a precise label on the first malformed record found. */
function assertValidSessionJsonl(raw: string, label: string): void {
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  expect(lines.length, `${label}: empty session file`).toBeGreaterThan(0);
  for (const [i, line] of lines.entries()) {
    const where = `${label} line ${i + 1}`;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    if (entry.type !== 'message') continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) throw new Error(`${where}: type=message without message object`);
    const role = message.role;
    const content = message.content;
    if (role === 'assistant') {
      if (!Array.isArray(content)) {
        throw new Error(
          `${where}: assistant.content must be blocks[] (got ${typeof content}) — string content crashes pi's token estimator before any provider call`,
        );
      }
      for (const [bi, block] of (content as Record<string, unknown>[]).entries()) {
        const at = `${where} block ${bi}`;
        const type = block?.type;
        if (typeof type !== 'string' || !ASSISTANT_BLOCK_TYPES.has(type)) {
          throw new Error(`${at}: unknown assistant block type ${JSON.stringify(type)}`);
        }
        if (type === 'text' && typeof block.text !== 'string') throw new Error(`${at}: text block without string text`);
        if (type === 'thinking' && typeof block.thinking !== 'string') throw new Error(`${at}: thinking block without string thinking`);
        if (type === 'toolCall') {
          if (typeof block.name !== 'string') throw new Error(`${at}: toolCall block without string name`);
          if (typeof block.arguments !== 'object' || block.arguments === null || Array.isArray(block.arguments)) {
            throw new Error(`${at}: toolCall block without object arguments`);
          }
        }
      }
      continue;
    }
    if (content !== undefined && typeof content !== 'string' && !Array.isArray(content)) {
      throw new Error(`${where}: role ${String(role)} has unusable content of type ${typeof content}`);
    }
    if (Array.isArray(content)) {
      for (const [bi, block] of (content as Record<string, unknown>[]).entries()) {
        if (block?.type === 'text' && typeof block.text !== 'string') {
          throw new Error(`${where} block ${bi}: text block without string text`);
        }
      }
    }
  }
}

describe('tracked session fixtures — offline validity gate', () => {
  const files = collectJsonl(ROOT);

  it('at least one tracked session fixture exists', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const label = path.relative(ROOT, file);
    it(`valid Pi message blocks: ${label}`, () => {
      assertValidSessionJsonl(readFileSync(file, 'utf8'), label);
    });
  }

  describe('the gate rejects the malformed classes it exists for', () => {
    const line = (o: unknown) => `${JSON.stringify(o)}\n`;

    it('rejects F1-B class: assistant content stored as a string', () => {
      expect(() =>
        assertValidSessionJsonl(
          line({ type: 'session' }) + line({ type: 'message', message: { role: 'assistant', content: 'plain string reply' } }),
          'string-content',
        ),
      ).toThrow(/assistant\.content must be blocks\[\]/);
    });

    it('rejects a text block without its text field', () => {
      expect(() =>
        assertValidSessionJsonl(line({ type: 'message', message: { role: 'assistant', content: [{ type: 'text' }] } }), 'textless'),
      ).toThrow(/text block without string text/);
    });

    it('rejects an unknown block type in assistant content', () => {
      expect(() =>
        assertValidSessionJsonl(line({ type: 'message', message: { role: 'assistant', content: [{ type: 'widget' }] } }), 'unknown-type'),
      ).toThrow(/unknown assistant block type/);
    });
  });
});
