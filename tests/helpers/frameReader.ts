import type { Readable } from 'node:stream';
import { LineAssembler } from '../../src/shared/framing';
import { parseFrameLine, type FrameT } from '../../src/shared/protocol';

export interface RawFrame {
  raw: string;
  frame: FrameT | null;
}

/** Collects every decoded frame from a child stdout for assertions. */
export class FrameReader {
  readonly frames: RawFrame[] = [];

  constructor(stream: Readable) {
    const asm = new LineAssembler();
    stream.on('data', (chunk: Buffer) => {
      const { lines } = asm.push(chunk);
      for (const line of lines) {
        const parsed = parseFrameLine(line);
        this.frames.push({ raw: line, frame: parsed.ok ? parsed.frame : null });
      }
    });
  }

  async waitFor(predicate: (f: RawFrame) => boolean, ms = 3000): Promise<RawFrame> {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.frames.find(predicate);
      if (hit) return hit;
      if (Date.now() > deadline) {
        throw new Error(
          `waitFor timed out after ${ms}ms; frames seen: ${JSON.stringify(this.frames.map((f) => f.raw))}`,
        );
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  waitForEvent(event: string): Promise<RawFrame> {
    return this.waitFor((f) => f.frame?.type === 'event' && f.frame.event === event);
  }

  waitForResponse(requestId: string): Promise<RawFrame> {
    return this.waitFor((f) => f.frame?.type === 'response' && f.frame.requestId === requestId);
  }
}
