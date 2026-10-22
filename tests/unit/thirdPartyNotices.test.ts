/**
 * M4 R01: every production dependency must be disclosed in
 * THIRD_PARTY_NOTICES.md with its declared version range — the installer
 * documentation must never drift from package.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const notices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');

describe('third-party notices', () => {
  for (const [name, range] of Object.entries(pkg.dependencies)) {
    it(`discloses ${name}@${range}`, () => {
      expect(notices).toContain(name);
      expect(notices).toContain(range);
    });
  }
});
