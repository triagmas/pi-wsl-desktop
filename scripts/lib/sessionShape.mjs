/**
 * Structural validator for Pi session JSONL records.
 *
 * WHY: a scratch fixture that stored `assistant.content` as a plain string is
 * valid enough to survive Pi's history load yet fatal inside pi-ai's token
 * estimator (`estimate.js` dereferences `block.name.length` on string
 * characters), which fails the prompt *before* any provider request.
 *
 * SCOPE (deliberate, do not overstate):
 *  - This is an OFFLINE data check. It never talks to Pi or a provider.
 *  - `tests/unit/sessionFixtures.test.ts` runs it over the TRACKED fixtures in
 *    `tests/fixtures/sessions/**` during unit tests. That is a repository
 *    guard, NOT a runtime pre-send gate for arbitrary sessions.
 *  - A real F1-B scratch session must first be created through the official Pi
 *    `new_session` command, then inspected separately with
 *    `node scripts/validate-session.mjs <file>` before any prompt is sent.
 *    A copied historical JSONL is never a substitute for that step.
 */

const ASSISTANT_BLOCK_TYPES = new Set(['text', 'thinking', 'toolCall']);

/**
 * Validate one JSONL session file's text; throws with a precise label at the
 * first malformed record. Returns the number of message entries inspected.
 * @param {string} raw
 * @param {string} [label]
 * @returns {{ lines: number, messages: number }}
 */
export function assertValidSessionJsonl(raw, label = 'session') {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) throw new Error(`${label}: empty session file`);
  let messages = 0;
  for (const [i, line] of lines.entries()) {
    const where = `${label} line ${i + 1}`;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    if (!entry || entry.type !== 'message') continue;
    messages += 1;
    const message = entry.message;
    if (!message || typeof message !== 'object') throw new Error(`${where}: type=message without message object`);
    const { role, content } = message;
    if (role === 'assistant') {
      if (!Array.isArray(content)) {
        throw new Error(
          `${where}: assistant.content must be blocks[] (got ${typeof content}) — string content crashes Pi's token estimator before any provider call`,
        );
      }
      for (const [bi, block] of content.entries()) {
        const at = `${where} block ${bi}`;
        const type = block?.type;
        if (typeof type !== 'string' || !ASSISTANT_BLOCK_TYPES.has(type)) {
          throw new Error(`${at}: unknown assistant block type ${JSON.stringify(type)}`);
        }
        if (type === 'text' && typeof block.text !== 'string') throw new Error(`${at}: text block without string text`);
        if (type === 'thinking' && typeof block.thinking !== 'string') {
          throw new Error(`${at}: thinking block without string thinking`);
        }
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
      for (const [bi, block] of content.entries()) {
        if (block?.type === 'text' && typeof block.text !== 'string') {
          throw new Error(`${where} block ${bi}: text block without string text`);
        }
      }
    }
  }
  return { lines: lines.length, messages };
}
