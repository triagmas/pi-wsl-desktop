/**
 * M2 runtime acceptance — fail-closed safety guards (Issue #12).
 *
 * Used by the acceptance harness before touching a real Pi process:
 *  - session-root isolation against the user's real session store;
 *  - fixture write containment;
 *  - explicit owner consent for paid model calls (STOP-GATE 1).
 *
 * No product/runtime code imports this module; it belongs to the
 * acceptance harness only.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Explicit owner authorization required before any paid model call. */
export interface PaidCallConsent {
  grantedBy: string;
  provider: string;
  maxCalls: number;
  budgetAmount: number;
  budgetCurrency: string;
  grantedAt: string;
  scope: string;
}

function canonical(p: string): string {
  // Resolve the deepest existing ancestor through realpath so symlinked
  // directories are canonicalized even when the leaf does not exist yet.
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      const r = realpathSync(cur);
      return rest.length === 0 ? r : path.join(r, ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p); // filesystem root exhausted
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Rejects any test root that equals, contains or is contained in a real
 * user session root (after canonical resolution, so symlinked test roots
 * are caught too). Fail closed: an empty roots list is a configuration
 * error, not a free pass.
 */
export function assertIsolatedSessionRoot(testRoot: string, realRoots: string[]): void {
  if (!Array.isArray(realRoots) || realRoots.length === 0) {
    throw new Error(
      'isolation guard: no real session roots supplied — refusing to run (fail closed)',
    );
  }
  if (typeof testRoot !== 'string' || testRoot.length === 0) {
    throw new Error('isolation guard: empty test session root — refusing to run (fail closed)');
  }
  const test = canonical(testRoot);
  for (const raw of realRoots) {
    const real = canonical(raw);
    if (isInside(test, real) || isInside(real, test)) {
      throw new Error(
        `isolation guard: test session root "${test}" overlaps real session root "${real}" — refusing to run`,
      );
    }
  }
}

/**
 * Rejects write targets that escape the designated fixture root, including
 * `..` traversal and symlinked directories resolving outside the root.
 */
export function assertWriteInsideFixture(fixtureRoot: string, target: string): void {
  const root = canonical(fixtureRoot);
  const file = canonical(target);
  if (!isInside(file, root)) {
    throw new Error(`fixture guard: write target "${file}" is outside fixture root "${root}"`);
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * STOP-GATE 1: paid model calls require a complete, explicit consent
 * object. Absent, partial, or inconsistent consent is rejected — never
 * inferred or defaulted.
 */
export function assertPaidCallConsent(
  consent: unknown,
  opts: { expectedProvider?: string; requiredCalls?: number } = {},
): asserts consent is PaidCallConsent {
  const reject = (detail: string): never => {
    throw new Error(`paid-call consent: ${detail}`);
  };
  if (typeof consent !== 'object' || consent === null) {
    reject('absent consent — STOP-GATE 1 forbids paid model calls');
  }
  const c = consent as Record<string, unknown>;
  if (!isNonEmptyString(c.grantedBy)) reject('grantedBy missing');
  if (!isNonEmptyString(c.provider)) reject('provider missing');
  if (!Number.isInteger(c.maxCalls) || (c.maxCalls as number) <= 0) reject('maxCalls must be a positive integer');
  if (typeof c.budgetAmount !== 'number' || !(c.budgetAmount > 0)) reject('budgetAmount must be positive');
  if (!isNonEmptyString(c.budgetCurrency)) reject('budgetCurrency missing');
  if (!isNonEmptyString(c.grantedAt) || Number.isNaN(Date.parse(c.grantedAt))) reject('grantedAt must be a valid timestamp');
  if (!isNonEmptyString(c.scope)) reject('scope missing');
  if (opts.requiredCalls !== undefined && (c.maxCalls as number) < opts.requiredCalls) {
    reject(`maxCalls ${String(c.maxCalls)} below requiredCalls ${String(opts.requiredCalls)}`);
  }
  if (opts.expectedProvider !== undefined && c.provider !== opts.expectedProvider) {
    reject(`provider "${String(c.provider)}" does not match expected provider`);
  }
}
