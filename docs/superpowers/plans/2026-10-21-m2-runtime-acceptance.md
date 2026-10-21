# M2 Remaining Acceptance Gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three still-open M2 conditional gates with real, isolated Pi runtime evidence, controlled token-cost comparison, and explicitly approved thinking-setting verification.

**Architecture:** Keep the functional M3 Module System work in [Draft PR #11](https://github.com/triagmas/pi-wsl-desktop/pull/11) separate. This scope is a bounded test/acceptance package: use existing WSL bridge and Pi RPC/SDK with a disposable session root, compile local private measurement records, and update the M2 ROADMAP after accepted evidence. Do not depend on proprietary model/provider identifiers in GitHub.

**Tech Stack:** Pi **installed version as measured** (M2 earlier found 1.3.0), WSL Ubuntu, Node.js/TypeScript, Vitest/Playwright, Electron, Pi RPC/SDK, GitHub Actions.

**Spec:** [Issue #12](https://github.com/triagmas/pi-wsl-desktop/issues/12), [ROADMAP M2](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md), [TOKEN_EFFICIENCY](../TOKEN_EFFICIENCY.md).

## Global Constraints

- Canonical checkout **only** `F:\_hermes\CODE\pi-wsl-desktop` or WSL `/mnt/f/_hermes/CODE/pi-wsl-desktop`; preserve local edits, avoid second clone/worktrees or any C:/E: development copy.
- Work in `test/m2-runtime-acceptance-r01`, sourced from merged M2 main SHA `6107f959`. No merge, no Draft removal before owner approval; one linked PR for Issue #12. Coordinate ROADMAP edits with concurrent M3 Draft #11.
- No real-user Pi session mutation, no reading/copying/publishing `auth.json`, session content, private model identity or credentials. Testing uses a disposable Pi session store and tightly restricted environment.
- **STOP-GATE 1:** Before **any** external provider/model-call, obtain explicit owner authorization with provider, count and spending cap. Never infer a budget.
- **STOP-GATE 2:** Before touching real `~/.pi/agent/settings.json`, obtain a separate concrete approval of key/value, byte-exact private backup and rollback. No implicit provider/model switch.
- Preserve applicable Skills, TDD RED→GREEN, full CI and native Windows+WSL smoke. Measure usage in private local outputs; public GitHub stores only sanitized aggregates and test pass/fail.

## Review Focus

- A normal Pi process has its OS user's authority: changed `cwd` or `HOME` alone is not a sandbox. Enforce isolation or prove file permissions prevent reaching existing sessions.
- Installed Pi may differ from current upstream docs. Use actual CLI help/settings and wire schema as authority; never guess command options.
- Cache effects, provider retries and duplicate prompts can distort expense comparisons. Capture each separately.
- A changed session-level `/thinking` does not prove a changed *default* for new sessions; verify both independently.
- Cleanup may delete the last needed test/recovery artifact. Keep sample fixtures, hashes and any user config backup until rollback validated, then erase safely.

---

### Task 1: Real Pi smoke harness (no external call until approval)

**Files:** Prefer existing `scripts/m2-bridge-smoke.mjs` and `tests/integration/bridgeM1.test.ts` patterns; add a *focused new acceptance harness/test* only when necessary, not an all-purpose runner. Synthetic fixtures and metrics must not be committed.

- [ ] Step 1: inspect exact installed Pi version, supported `--session-dir`/RPC/SDK and provider readiness *without viewing secrets*. Create a freshly isolated test session path under the canonical F: workspace; validate no path points into real sessions. Save original real-user tree timestamps/hashes without reading session text.
- [ ] Step 2: create focused RED safety tests for accidental real session path, absent consent and write reaching outside fixture; verify RED for deliberately invalid fixture configuration and GREEN when rejected correctly.
- [ ] Step 3: run installed Pi RPC handshake and ordinary read-only session events (no model call). Obtain proof of synthetic session isolation; compile smoke on actual Windows+WSL.
- [ ] Step 4: **STOP if no owner authorization for provider calls.** With a bounded permission, send one neutral, short prompt through actual Pi, verify completion events and new synthetic JSONL session write; assert original user files untouched and session written only at agreed test root.
- [ ] Step 5: record PASS/FAIL/NOT RUN, prompt-count, anonymized usage, unexpected side effects, and provider billing status; clean temporary secrets/session data only after evidence is safely captured.

### Task 2: Controlled token-cost comparison

**Files:** Follow `docs/TOKEN_EFFICIENCY.md`; add a non-secret acceptance worksheet (table or JSON fixture schema) if needed. Keep measured raw user data private.

- [ ] Step 1: choose exactly three deterministic synthetic A/B/C tasks, success assertions and permitted thinking levels using installed Pi; preserve baseline/target task comparability.
- [ ] Step 2: record pre-run usage and current model/effort with `/session` or equivalent **before each fresh session**.
- [ ] Step 3: **STOP without owner-approved model call budget.** Run baseline and conservative candidate for each class (at least 6 bounded calls total if fully authorized). Do not claim savings from fewer tokens in one message if acceptance/retries increase.
- [ ] Step 4: collect measured `input/output/cache_read/cache_write` where exposed, local reported `cost`, API count, attempts, acceptance, quality/test correctness; distinguish cache/warmup and possible subscription-versus-provider billing. Report `NOT MEASURED` fields for missing telemetry, never invent zeros.
- [ ] Step 5: calculate cost per *accepted task*, differences and limitations; recommend per-class effort or maintain baseline if measurement does not support change.

### Task 3: Thinking-setting change with proof and rollback

**Files:** Do not commit actual `settings.json`; implement small isolated test harness only if absent.

- [ ] Step 1: inspect active effective `defaultThinkingLevel`, `modelThinkingLevels` and actual supported levels *privately and read-only*.
- [ ] Step 2: in disposable Pi settings/session only, change temporary thinking level, verify readback and new-session startup, then restore it; negative test for unsupported value and concurrent settings modification.
- [ ] Step 3: **STOP before touching real user defaults.** Present measured Task 2 comparison and proposed **exact key/value** to owner; accept explicit change approval or `NO CHANGE APPROVED`. Do not silently set `low` for security-critical work.
- [ ] Step 4: if approved, create protected byte-exact private backup, guard against concurrency, atomically update only the approved key, start fresh installed Pi session to verify, restore on failure and verify rollback. Do not modify default provider/model or auth.
- [ ] Step 5: record actual result (`CHANGED+VERIFIED` / `NO CHANGE APPROVED` / `BLOCKED`) and sanitized evidence; never mark a user change as done if only a synthetic test ran.

### Task 4: Full verification and GitHub handoff

- [ ] Step 1: run focused TDD and real smoke, then full existing typecheck/lint/build/Vitest/E2E, hosted Linux/Windows Product CI and Repository Contract.
- [ ] Step 2: independent fresh-context security review at exact code HEAD: verify no user-session mutation, provider budget guard, schema/API parity, settings atomic update and rollback, no private GitHub data.
- [ ] Step 3: update ROADMAP three conditional checkboxes **individually** only for accepted completed evidence; keep the token policy line honest. Do not touch unrelated M3 completion flags. Ensure PR/Issue descriptions include actual counts, +/- and redacted results.
- [ ] Step 4: stop, publish review verdict, changed-file list, CI links, all PASS/FAIL/SKIP/NOT RUN and final SHA. Owner separately decides merge; no automatic merge.
