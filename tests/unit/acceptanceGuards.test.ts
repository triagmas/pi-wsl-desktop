/**
 * M2 runtime acceptance — safety guards (Issue #12, plan Task 1 step 2).
 *
 * These guards are the fail-closed gates the acceptance harness must run
 * before any Pi interaction:
 *  - the isolated session root must not be (contain, be contained in, or
 *    equal) any real user session root;
 *  - harness writes must stay inside the designated fixture root;
 *  - paid model calls require an explicit, complete owner consent object
 *    (STOP-GATE 1) — absent or partial consent is rejected, never inferred.
 *
 * RED first: written and run before scripts/lib/acceptanceGuards.ts exists.
 */
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertIsolatedSessionRoot,
  assertPaidCallConsent,
  assertWriteInsideFixture,
  type PaidCallConsent,
} from '../../scripts/lib/acceptanceGuards';

describe('assertIsolatedSessionRoot', () => {
  const real = '/home/user/.pi/agent/sessions';

  it('rejects a test root equal to a real session root', () => {
    expect(() => assertIsolatedSessionRoot(real, [real])).toThrow(/real session root/i);
  });

  it('rejects a test root inside a real session root', () => {
    expect(() => assertIsolatedSessionRoot(path.join(real, 'proj'), [real])).toThrow(
      /real session root/i,
    );
  });

  it('rejects a real root nested inside the test root', () => {
    expect(() => assertIsolatedSessionRoot('/ws/test', ['/ws/test/real'])).toThrow(
      /real session root/i,
    );
  });

  it('accepts a sibling with a shared string prefix but no path overlap', () => {
    expect(() => assertIsolatedSessionRoot('/ws/sessions-evil', ['/ws/sessions'])).not.toThrow();
  });

  it('accepts disjoint roots', () => {
    expect(() => assertIsolatedSessionRoot('/ws/acceptance/sessions', [real])).not.toThrow();
  });

  it('rejects a test root whose symlink resolves into a real session root', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'acceptance-guard-'));
    const realDir = path.join(base, 'real');
    const link = path.join(base, 'link');
    mkdirSync(realDir, { recursive: true });
    symlinkSync(realDir, link, 'dir');
    expect(() => assertIsolatedSessionRoot(link, [realDir])).toThrow(/real session root/i);
    // and the canonical (realpath) form passes
    expect(() => assertIsolatedSessionRoot(realpathSync(link), ['/elsewhere'])).not.toThrow();
  });

  it('rejects an empty or missing roots argument (fail closed)', () => {
    expect(() => assertIsolatedSessionRoot('/ws/test', [])).toThrow(/real session root/i);
  });
});

describe('assertWriteInsideFixture', () => {
  it('accepts a target inside the fixture root', () => {
    expect(() => assertWriteInsideFixture('/fx', '/fx/sessions/new.jsonl')).not.toThrow();
  });

  it('rejects a target outside the fixture root', () => {
    expect(() => assertWriteInsideFixture('/fx', '/elsewhere/new.jsonl')).toThrow(/outside/i);
  });

  it('rejects a parent-directory escape', () => {
    expect(() => assertWriteInsideFixture('/fx', '/fx/../escape.jsonl')).toThrow(/outside/i);
  });

  it('rejects a symlinked directory escaping the fixture root', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'acceptance-guard-'));
    const fixture = path.join(base, 'fixture');
    const outside = path.join(base, 'outside');
    mkdirSync(fixture, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, path.join(fixture, 'sub'), 'dir');
    expect(() =>
      assertWriteInsideFixture(fixture, path.join(fixture, 'sub', 'new.jsonl')),
    ).toThrow(/outside/i);
  });
});

describe('assertPaidCallConsent', () => {
  const valid: PaidCallConsent = {
    grantedBy: 'owner',
    provider: 'test-provider',
    maxCalls: 6,
    budgetAmount: 1,
    budgetCurrency: 'USD',
    grantedAt: '2026-10-21T00:00:00.000Z',
    scope: 'issue-12-acceptance',
  };

  it('rejects absent consent (STOP-GATE 1)', () => {
    expect(() => assertPaidCallConsent(undefined, {})).toThrow(/consent/i);
  });

  it('rejects a partial consent object', () => {
    expect(() => assertPaidCallConsent({ maxCalls: 6 }, {})).toThrow(/consent/i);
  });

  it('rejects zero or negative maxCalls', () => {
    expect(() => assertPaidCallConsent({ ...valid, maxCalls: 0 }, {})).toThrow(/consent/i);
    expect(() => assertPaidCallConsent({ ...valid, maxCalls: -1 }, {})).toThrow(/consent/i);
  });

  it('rejects a non-positive budget', () => {
    expect(() => assertPaidCallConsent({ ...valid, budgetAmount: 0 }, {})).toThrow(/consent/i);
  });

  it('rejects maxCalls below the required call count', () => {
    expect(() => assertPaidCallConsent(valid, { requiredCalls: 7 })).toThrow(/maxCalls/i);
  });

  it('rejects a provider mismatch', () => {
    expect(() =>
      assertPaidCallConsent(valid, { expectedProvider: 'other-provider' }),
    ).toThrow(/provider/i);
  });

  it('accepts complete consent meeting the requirement', () => {
    expect(() => assertPaidCallConsent(valid, { requiredCalls: 6 })).not.toThrow();
    expect(() => assertPaidCallConsent(valid, {})).not.toThrow();
  });
});
