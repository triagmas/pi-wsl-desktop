/**
 * Renderer-side parsing of a bridge error string (`{CODE}: message`).
 *
 * UI26 R01: extracted from m1api so pure renderer state modules and node-side
 * unit tests can use it without pulling in the DOM-dependent `api.ts`.
 */
const IPC_WRAPPER = /^(?:Error invoking remote method '[^']*':\s*)?(?:Error:\s*)?/;

export function stripIpcWrapper(raw: string): string {
  let text = raw.trim();
  for (let i = 0; i < 4; i += 1) {
    const m = IPC_WRAPPER.exec(text);
    if (!m || m[0].length === 0) break;
    text = text.slice(m[0].length).trim();
  }
  return text;
}

/** Parse an IPC-rethrown error `{CODE}: message` into a structured value. */
export function parseBridgeError(err: unknown): { code: string; message: string } {
  // Production path: ipc.ts prefixes `{CODE}: message` (Error props do not
  // survive Electron serialization). Structured callers may attach `.code`.
  const raw = err instanceof Error ? err.message : String(err);
  const text = stripIpcWrapper(raw);
  const attached = (err as { code?: unknown } | null)?.code;
  if (typeof attached === 'string' && attached.length > 0) {
    // Текст мог быть помечен ДРУГИМ кодом (например `UNKNOWN:` из bridge) —
    // структурный `.code` всё равно главнее, но его префикс в тексте лишний.
    const stripped = text.replace(new RegExp(`^([A-Z][A-Z0-9_]{2,}):\\s*`), '');
    return { code: attached, message: stripped || text };
  }
  const m = /^([A-Z][A-Z0-9_]{2,}):(?:\s|$)/.exec(text);
  if (m) return { code: m[1], message: text.slice(m[0].length) || text };
  return { code: 'UNKNOWN', message: text };
}

