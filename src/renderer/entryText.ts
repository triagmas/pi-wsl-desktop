/** Extract display text from an AgentMessage (string or content blocks). */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; text?: unknown; toolName?: unknown; name?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      // thinking/toolCall blocks are surfaced via the tools list, not text
    }
  }
  return parts.join('\n');
}

/** Stable UI key + display payload for one session entry. */
export function entryView(entry: { id?: string | null; type: string; raw: unknown }, index: number): {
  key: string;
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'other';
  text: string;
} {
  const raw = entry.raw as { message?: { role?: unknown; content?: unknown; toolName?: unknown } };
  if (entry.type === 'message' && raw.message) {
    const role = raw.message.role;
    const text = messageText(raw.message.content);
    if (role === 'user') return { key: entry.id ?? `i${index}`, kind: 'user', text };
    if (role === 'assistant') return { key: entry.id ?? `i${index}`, kind: 'assistant', text };
    if (role === 'system') return { key: entry.id ?? `i${index}`, kind: 'system', text };
    if (role === 'toolResult') {
      const name = typeof raw.message.toolName === 'string' ? raw.message.toolName : 'tool';
      return { key: entry.id ?? `i${index}`, kind: 'tool', text: `${name}: ${text}` };
    }
    return { key: entry.id ?? `i${index}`, kind: 'other', text };
  }
  if (entry.type === 'session_info') {
    const name = (entry.raw as { name?: unknown }).name;
    return { key: entry.id ?? `i${index}`, kind: 'other', text: typeof name === 'string' ? `Имя: ${name}` : '' };
  }
  return { key: entry.id ?? `i${index}`, kind: 'other', text: `[${entry.type}]` };
}
