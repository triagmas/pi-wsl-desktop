/**
 * Repository guard for TRACKED session fixtures (offline, no Pi involved).
 *
 * Why: F1-B failed because a scratch fixture stored `assistant.content` as a
 * string — accepted by Pi's history load, fatal inside pi-ai's token estimator
 * (`estimate.js` dereferences `block.name.length` on string characters) before
 * any provider request.
 *
 * SCOPE — read before trusting this as a safety net:
 *  - This test validates only the files committed under
 *    `tests/fixtures/sessions/**`, and only when the unit project runs.
 *  - It is NOT a runtime pre-send gate for arbitrary or temporary sessions
 *    (`artifacts/**` is gitignored and never seen here).
 *  - For the F1-B retest, the scratch session must be produced by the official
 *    Pi `new_session` command and then validated explicitly, offline, with
 *    `node scripts/validate-session.mjs <file.jsonl>` before any prompt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertValidSessionJsonl } from '../../scripts/lib/sessionShape.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sessions');

function collectJsonl(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectJsonl(full));
    else if (name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

const line = (o: unknown) => `${JSON.stringify(o)}\n`;

describe('tracked session fixtures — offline structural guard', () => {
  const files = collectJsonl(ROOT);

  it('at least one tracked session fixture exists', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const label = path.relative(ROOT, file);
    it(`valid Pi message blocks: ${label}`, () => {
      const { messages } = assertValidSessionJsonl(readFileSync(file, 'utf8'), label);
      expect(messages).toBeGreaterThan(0);
    });
  }

  describe('rejects the malformed classes this guard exists for', () => {
    it('F1-B class: assistant content stored as a string', () => {
      expect(() =>
        assertValidSessionJsonl(
          line({ type: 'session' }) + line({ type: 'message', message: { role: 'assistant', content: 'plain string reply' } }),
          'string-content',
        ),
      ).toThrow(/assistant\.content must be blocks\[\]/);
    });

    it('a text block without its text field', () => {
      expect(() =>
        assertValidSessionJsonl(line({ type: 'message', message: { role: 'assistant', content: [{ type: 'text' }] } }), 'textless'),
      ).toThrow(/text block without string text/);
    });

    it('an unknown block type in assistant content', () => {
      expect(() =>
        assertValidSessionJsonl(line({ type: 'message', message: { role: 'assistant', content: [{ type: 'widget' }] } }), 'unknown-type'),
      ).toThrow(/unknown assistant block type/);
    });

    it('a valid scratch-session shape passes (official new_session form)', () => {
      const raw =
        line({ type: 'session' }) +
        line({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }) +
        line({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }], stopReason: 'stop' } });
      expect(assertValidSessionJsonl(raw, 'clean')).toEqual({ lines: 3, messages: 2 });
    });
  });
});
