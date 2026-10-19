import { describe, expect, it } from 'vitest';
import { isAllowedRendererMethod } from '../../src/shared/whitelist';

describe('renderer method whitelist', () => {
  it('allows exactly the M0 read-only methods', () => {
    for (const method of ['health', 'getRuntimeInfo', 'getCapabilities', 'ping']) {
      expect(isAllowedRendererMethod(method)).toBe(true);
    }
  });

  it('rejects execution, write and prototype-pollution style methods', () => {
    for (const method of ['exec', 'writeFile', 'eval', 'constructor', '__proto__', '', 'HEALTH', 'health ']) {
      expect(isAllowedRendererMethod(method)).toBe(false);
    }
  });
});
