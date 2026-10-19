import { describe, expect, it } from 'vitest';
import { LineAssembler } from '../../src/shared/framing';

describe('LineAssembler', () => {
  it('joins a line split across three chunks', () => {
    const a = new LineAssembler();
    expect(a.push(new TextEncoder().encode('{"a":'))).toEqual({ lines: [], overflow: false });
    expect(a.push(new TextEncoder().encode('1}'))).toEqual({ lines: [], overflow: false });
    expect(a.push(new TextEncoder().encode('\n'))).toEqual({ lines: ['{"a":1}'], overflow: false });
  });

  it('strips CRLF terminators', () => {
    const a = new LineAssembler();
    const r = a.push(new TextEncoder().encode('one\r\ntwo\r\n'));
    expect(r).toEqual({ lines: ['one', 'two'], overflow: false });
  });

  it('returns multiple complete lines from one chunk', () => {
    const a = new LineAssembler();
    const r = a.push(new TextEncoder().encode('a\nb\nc\n'));
    expect(r).toEqual({ lines: ['a', 'b', 'c'], overflow: false });
  });

  it('does NOT split on U+2028/U+2029 inside a payload', () => {
    const a = new LineAssembler();
    const payload = '{"m":"x y z"}';
    const r = a.push(new TextEncoder().encode(`${payload}\n`));
    expect(r).toEqual({ lines: [payload], overflow: false });
  });

  it('drops empty lines', () => {
    const a = new LineAssembler();
    const r = a.push(new TextEncoder().encode('\n\nkeep\n\n'));
    expect(r).toEqual({ lines: ['keep'], overflow: false });
  });

  it('flags overflow on an over-long line and recovers after reset', () => {
    const a = new LineAssembler(16);
    const r = a.push(new TextEncoder().encode('x'.repeat(32)));
    expect(r.overflow).toBe(true);
    expect(r.lines).toEqual([]);
    // recovery: next well-formed frame parses
    const r2 = a.push(new TextEncoder().encode('ok\n'));
    expect(r2).toEqual({ lines: ['ok'], overflow: false });
  });

  it('counts bytes, not characters, for the size cap', () => {
    const a = new LineAssembler(8);
    // 6 chars but 12 UTF-8 bytes > 8-byte cap
    const text = 'привет';
    expect(text.length).toBeLessThan(8);
    const r = a.push(new TextEncoder().encode(text));
    expect(r.overflow).toBe(true);
  });

  it('reset() clears buffered partial data', () => {
    const a = new LineAssembler();
    a.push(new TextEncoder().encode('partial'));
    a.reset();
    const r = a.push(new TextEncoder().encode('fresh\n'));
    expect(r).toEqual({ lines: ['fresh'], overflow: false });
  });
});
