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

    // MIT redistribution requires the copyright + permission notice itself,
    // not just a table row — the shipped text must match the installed
    // package's LICENSE verbatim (at least its copyright line).
    it(`carries the full MIT license text of ${name}`, () => {
      const license = readFileSync(path.join(root, 'node_modules', name, 'LICENSE'), 'utf8');
      const copyright = license.split('\n').find((l) => l.startsWith('Copyright'))!;
      expect(copyright.length).toBeGreaterThan(0);
      expect(notices).toContain(copyright);
      expect(notices).toContain('Permission is hereby granted, free of charge');
    });
  }
});
