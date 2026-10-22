/**
 * Shared path helpers for the M4 R01 release scripts — kept in pure ESM so
 * the same normalization runs on the Linux dev host and the Windows CI
 * runner (asar listings use the platform separator).
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeAsarPath(entry) {
  return entry.replaceAll('\\', '/');
}

/** Repo root for a script living in <root>/scripts or <root>/scripts/lib. */
export function repoRootFrom(importMetaUrl, depth = 1) {
  let root = dirname(fileURLToPath(importMetaUrl));
  for (let i = 0; i < depth; i += 1) {
    root = dirname(root);
  }
  return root;
}
