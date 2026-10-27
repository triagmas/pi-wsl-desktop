#!/usr/bin/env node
/**
 * Offline pre-flight for a Pi session JSONL file.
 *
 * USE IT FOR THE F1-B SCRATCH SESSION: create the session with the official Pi
 * `new_session` command, then validate the resulting file here BEFORE any
 * prompt is sent. Do not reuse a copied historical fixture.
 *
 *   node scripts/validate-session.mjs <file.jsonl> [more.jsonl ...]
 *
 * Exit codes: 0 = all files structurally valid, 1 = at least one rejected,
 * 2 = usage error. No Pi, bridge or provider process is contacted.
 */
import { readFileSync } from 'node:fs';
import { assertValidSessionJsonl } from './lib/sessionShape.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/validate-session.mjs <file.jsonl> [...]');
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  try {
    const raw = readFileSync(file, 'utf8');
    const { lines, messages } = assertValidSessionJsonl(raw, file);
    console.log(`OK   ${file} (${lines} lines, ${messages} messages)`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${file}\n     ${err instanceof Error ? err.message : String(err)}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
