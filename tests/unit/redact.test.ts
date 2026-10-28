/**
 * UI21 R02: single, tested redaction boundary for user-visible error text.
 *
 * SCOPE — conservative best-effort, not a claim to catch every secret format:
 *  - provider key shapes with their real separators (sk-, ghp_, github_pat_, …)
 *  - HTTP auth schemes (Bearer/Basic/Token …)
 *  - key/value credentials, including JSON/quoted and camelCase forms
 *    (`{"api_key":"…"}`, `"apiKey": "…"`, `accessToken: …`, `password=…`)
 *  - filesystem paths (best-effort)
 *  - long letter+digit identifiers of unknown shape
 * It is applied to ERROR text only — never to normal assistant answers or the
 * user's own prompt.
 */
import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../src/shared/redact';

const LEAKS: Array<[string, string]> = [
  ['payload key sk-', 'abcdef'],
  ['payload key ghp_', 'abcdef123456'],
  ['payload key github_pat_', 'abcdef0123456789'],
];

describe('redactSecrets — provider shapes', () => {
  it.each(LEAKS)('%s is fully removed', (_label, tail) => {
    const input = `failed with sk-${tail} / ghp_${tail} / github_pat_${tail}`;
    const out = redactSecrets(input);
    expect(out).not.toContain(`sk-${tail}`);
    expect(out).not.toContain(`ghp_${tail}`);
    expect(out).not.toContain(`github_pat_${tail}`);
  });

  it('removes Bearer credentials', () => {
    const out = redactSecrets('Authorization: Bearer syntheticCredential123');
    expect(out).not.toContain('syntheticCredential123');
    expect(out).toContain('[redacted]');
  });

  it('removes quoted JSON credentials, snake_case and camelCase', () => {
    const cases = [
      '{"api_key":"syntheticSecret123"}',
      '{"apiKey": "syntheticSecret123"}',
      '{"data":{"accessToken":"syntheticSecret123"}}',
      "{'client_secret': 'syntheticSecret123'}",
      'api_key = syntheticSecret123',
      'password: syntheticSecret123',
    ];
    for (const c of cases) {
      const out = redactSecrets(c);
      expect(out, c).not.toContain('syntheticSecret123');
    }
  });

  it('redacts Windows and POSIX paths', () => {
    const out = redactSecrets('open C:/Users/triag/AppData/Local/x.txt and /home/triag/.pi/agent/auth.json');
    expect(out).not.toContain('C:/Users');
    expect(out).not.toContain('/home/triag');
    expect(out).toContain('[path]');
  });

  it('keeps ordinary error text readable and bounded', () => {
    const out = redactSecrets("Cannot read properties of undefined (reading 'length')");
    expect(out).toBe("Cannot read properties of undefined (reading 'length')");
    const long = redactSecrets('x'.repeat(1000));
    expect(long.length).toBeLessThanOrEqual(301);
    expect(long.endsWith('…')).toBe(true);
  });

  it('falls back to a readable phrase for empty/non-string input', () => {
    expect(redactSecrets('')).toMatch(/ошибк/i);
    expect(redactSecrets(undefined)).toMatch(/ошибк/i);
    expect(redactSecrets(42)).toMatch(/ошибк/i);
  });

  it('strips control characters so error text cannot forge layout', () => {
    const out = redactSecrets('bad\u0000\u001b[31mvalue\u0007');
    const hasControl = [...out].some((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code <= 8 || (code >= 11 && code <= 31) || code === 127;
    });
    expect(hasControl).toBe(false);
  });
});
