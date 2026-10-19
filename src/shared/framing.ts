/**
 * Bounded NDJSON line assembler.
 *
 * Splits a byte stream into lines on LF (0x0a) only — never on Unicode line
 * separators U+2028/U+2029, which are legal inside JSON strings (see Pi RPC
 * docs). Strips an optional trailing CR. Enforces a byte cap per line: an
 * over-long line flushes the assembler (overflow=true) so a hostile or
 * corrupted stream cannot exhaust memory; the next push starts clean.
 */

export interface PushResult {
  lines: string[];
  overflow: boolean;
}

const LF = 0x0a;
const CR = 0x0d;
const EMPTY = new Uint8Array(0);
const decoder = new TextDecoder('utf-8');

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export class LineAssembler {
  private pending: Uint8Array = EMPTY;

  constructor(private readonly maxLineBytes = 1_048_576) {}

  push(chunk: Uint8Array): PushResult {
    const merged = this.pending.length === 0 ? chunk : concat(this.pending, chunk);
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i] !== LF) continue;
      const lineEnd = i > start && merged[i - 1] === CR ? i - 1 : i;
      if (lineEnd - start > this.maxLineBytes) return this.overflow();
      if (lineEnd > start) lines.push(decoder.decode(merged.subarray(start, lineEnd)));
      start = i + 1;
    }
    const tailLen = merged.length - start;
    if (tailLen > this.maxLineBytes) return this.overflow();
    this.pending = tailLen === 0 ? EMPTY : merged.slice(start);
    return { lines, overflow: false };
  }

  reset(): void {
    this.pending = EMPTY;
  }

  private overflow(): PushResult {
    this.pending = EMPTY;
    return { lines: [], overflow: true };
  }
}
