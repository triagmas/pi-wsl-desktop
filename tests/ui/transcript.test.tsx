/**
 * UI21 R07: единый transcript — сохранённые сообщения Pi JSONL (read-only)
 * плюс живые события текущего чата. Чистые функции: без записи в файл,
 * без сетевых вызовов, без мутаций входных данных.
 */
import { describe, expect, it } from 'vitest';
import { mergeTranscript, toChatEntries } from '../../src/renderer/transcript';
import type { ChatEntry } from '../../src/renderer/useChat';

const entry = (raw: unknown, index: number): Parameters<typeof toChatEntries>[0][number] => ({
  id: `id${index}`,
  type: (raw as { type?: string }).type ?? 'message',
  raw,
});

describe('transcript: saved Pi messages → chat entries', () => {
  it('maps user, assistant and toolResult messages with their own kinds', () => {
    const rows = [
      entry({ type: 'message', message: { role: 'user', content: 'старый вопрос' } }, 0),
      entry({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'старый ответ' }] } }, 1),
      entry({ type: 'message', message: { role: 'toolResult', toolName: 'bash', content: 'ok' } }, 2),
    ];
    const out = toChatEntries(rows);
    expect(out.map((e) => e.kind)).toEqual(['user', 'assistant', 'tool']);
    expect(out[0].text).toBe('старый вопрос');
    expect(out[1].text).toBe('старый ответ');
    expect(out[2].text).toBe('bash: ok');
  });

  it('keeps a stored failed run as an error entry instead of a blank bubble', () => {
    const out = toChatEntries([
      entry(
        {
          type: 'message',
          message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'error', errorMessage: 'quota' },
        },
        0,
      ),
    ]);
    expect(out[0].error).toBe('quota');
  });

  it('skips non-conversation rows that carry no message', () => {
    const out = toChatEntries([
      entry({ type: 'session', version: 3 }, 0),
      entry({ type: 'model_change', provider: 'p', modelId: 'm' }, 1),
      entry({ type: 'message', message: { role: 'user', content: 'живой' } }, 2),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('живой');
  });
});

describe('transcript: history + live merge', () => {
  const history: ChatEntry[] = [
    { key: 'a', kind: 'user', text: 'старый вопрос' },
    { key: 'e1', kind: 'assistant', text: 'старый ответ' },
  ];
  const live: ChatEntry[] = [
    { key: 'e0', kind: 'user', text: 'новый вопрос' },
    { key: 'e1', kind: 'assistant', text: 'новый ответ' },
  ];

  it('keeps chronology: saved messages first, live turns after them', () => {
    const out = mergeTranscript(history, live);
    expect(out.map((e) => e.text)).toEqual([
      'старый вопрос',
      'старый ответ',
      'новый вопрос',
      'новый ответ',
    ]);
  });

  it('keeps keys unique even when history and live share the same raw key', () => {
    const keys = mergeTranscript(history, live).map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never mutates its inputs', () => {
    const h = [...history];
    const l = [...live];
    mergeTranscript(history, live);
    expect(history).toEqual(h);
    expect(live).toEqual(l);
  });

  it('handles either side being empty', () => {
    expect(mergeTranscript([], live)).toHaveLength(2);
    expect(mergeTranscript(history, [])).toHaveLength(2);
    expect(mergeTranscript([], [])).toEqual([]);
  });
});
