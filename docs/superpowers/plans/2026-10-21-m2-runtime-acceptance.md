# Pi Thinking Task Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Preserve TDD, independent review, and owner-controlled merges.

**Goal:** Route actual Pi development work to **off / low / medium / high** by task type. Preserve MiMo 2.6 Flash **high** for code-writing, TDD, architecture and security; save effort on deterministic and light tasks.

**Architecture:** Explicit task classification at orchestration/dispatch boundaries, using Pi 1.3.0's *real* CLI/RPC/subagent controls rather than assuming `AGENTS.md` changes runtime settings. Keep project policy compact, and inspect requested/effective mapping without paid prompts. No new general orchestration framework.

**Tech Stack:** Pi CLI/RPC 1.3.0 (verify installed behavior), TypeScript, Vitest, existing process/subagent tooling, GitHub Actions.

**Spec:** [Issue #12](https://github.com/triagmas/pi-wsl-desktop/issues/12), [AGENTS.md](../../../AGENTS.md), [docs/TOKEN_EFFICIENCY.md](../../TOKEN_EFFICIENCY.md).

## Global constraints

- Only canonical worktree `F:\_hermes\CODE\pi-wsl-desktop` / `/mnt/f/_hermes/CODE/pi-wsl-desktop`; work in existing `test/m2-runtime-acceptance-r01` / [Draft PR #13](https://github.com/triagmas/pi-wsl-desktop/pull/13). Do not modify `main` or M3 PR #11.
- No user settings/auth/session modification. No provider calls or charged benchmark without specific owner approval; last 7-call request was **NOT APPROVED**.
- Session-level `/thinking`, CLI `--thinking`, and RPC commands may differ by version/provider. Do not conflate model metadata, requested level, effective state, model→provider mapping, cost, reasoning usage or prompt cache.
- Do not assume `low/medium` unsupported from brief requests or cache effects. Existing `get_state` high readbacks are **observations**, requiring mapping diagnosis; never falsify tests.
- TDD RED→GREEN, relevant Skills, full quality gates, independently reviewed code. Publish only sanitized routing metadata.

## Desired routing matrix

| task_type | Work | model_role | target_thinking |
|---|---|---|---|
| `mechanical` | status/CI/Issue, bounded git queries, exact search, mechanical commands | PRIMARY | `off` |
| `documentation` | short docs, reports, issue grooming, routine updates | PRIMARY | `low` |
| `analysis` | plan/triage, noncritical bug localization, test selection | PRIMARY | `medium` |
| `coding` | all source edits, TDD implementation, complex fixes, APIs/UI | CODING (MiMo 2.6 Flash preferred) | `high` |
| `security` | architecture, concurrency, authentication, rollback/TOCTOU | CODING/qualified specialist | `high` |
| `review` | independent acceptance of source-code changes | INDEPENDENT_REVIEW | `high` |

When a subtask's risk increases, **escalate**; never lower `coding/security/review` to `off` for budget. Coding work may use planning (`medium`) first, but the worker that writes/reviews code receives `high`.

## Review focus

1. `get_state.thinkingLevel=high` after requesting low/medium could be model level-map or version/proxy behavior, **not evidence of prompt-cache-equivalent reasoning**. Investigate `get_available_thinking_levels` if supported, model definition/overrides and exact Pi 1.3.0 flags before claiming provider mapping.
2. Two jobs in one inherited Pi process can retain the wrong level. Require an explicit level per independent job and readback where supported.
3. A `mechanical` request unexpectedly modifies a code file. Reject/reclassify before any source write; reroute to coding/high.
4. `review` cannot be completed by the original coder's own context. Require a genuinely independent reviewer/high.
5. A cache hit can dominate cost measurement. Never infer cognitive equivalence or percentage savings from a short repeated prompt; collect usage passively during ordinary work, preserving cached-input statistics separately.

---

### Task 1 — Contract and reproducible dispatch decisions

**Files:** change `AGENTS.md §5.1`, `docs/TOKEN_EFFICIENCY.md`; add focused route classification tests/implementation only if no existing Pi task-dispatch hook supports the requirement. Prefer an existing subagent/task hook over introducing infrastructure.

- [ ] **Сначала использовать готовый Pi**: проверить доступный способ указать `--thinking` в новой задаче/сессии или указать модель и effort у установленного subagent. Привести реально работающие команды/правила смены уровня для каждого класса из матрицы.
- [ ] **Не строить отдельный маршрутизатор и не создавать файлы кода**, если native Pi/extension уже передаёт уровень при запуске. Закрепить правило в `AGENTS.md` и процедуре постановки задачи; продемонстрировать на бесплатных offline readback-пробах.
- [ ] **Только если кодовая интеграция действительно требуется:** написать узкие RED-тесты для соответствия `mechanical/documentation/analysis/coding/security/review` → `off/low/medium/high/high/high`, включая запрет code/security в off; добиться GREEN минимальным изменением существующего dispatch, без нового framework.
- [ ] Задокументировать **конкретный способ** назначить уровень *до* следующей локальной Pi-задачи; отчёт о выполненном переключении не должен основываться на одной инструкции в `AGENTS.md`.

### Task 2 — Installed Pi offline parity / mapping diagnosis

**Files:** preserve `tests/smoke/m2ThinkingParity.test.ts` where already useful; update comments and tests without inventing results. Do not change actual user models/settings.

- [ ] Probe disposable Pi settings with requested `off, low, medium, high` separately; record requested level, Pi state readback, available levels (if RPC supports it), and whether a model-level mapping/override is present. No prompt, no external model-call.
- [ ] Treat current test asserting `low→high` as **environment-specific observation**. Explain whether `get_state` itself clamps (this is not caused by cached answers), and **do not** generalize the observation to provider inability or routing policy. Where available inspect provider-bound payload only with an explicitly owner-approved non-secret diagnostic mechanism, not by making paid calls.
- [ ] When the target level is unavailable or readback mismatches, return **explicit `UNSUPPORTED/MAPPING_NEEDS_REVIEW`**, never silently reroute to high while reporting success. The owner chooses a verified compatible model/mapping; no user settings modifications.
- [ ] Confirm worker/subagent handoff records `task_type/target/effective` with no secrets; add fail-closed regression tests for mismatches.
- [ ] Run isolated Windows+WSL fixture tests.

### Task 3 — Align obsolete paid benchmark harness without deleting safety work

**Files:** `tests/smoke/m2TokenMeasure.test.ts`, `scripts/lib/m2AcceptanceTasks.ts`, `tests/smoke/m2RuntimeAcceptance.test.ts`, `scripts/lib/acceptanceGuards.ts`, only where changes needed.

- [ ] Keep existing isolation and paid-consent guards and reported passing tests.
- [ ] Remove the **prescriptive** `low clamps to high, therefore only off` comment from paid runner; change it into a guarded OPTIONAL, owner-authorized measurement harness. Do not auto-run, create consent files, or request permission for 7 calls.
- [ ] Replace any route-design implication that a 6-call A/B/C comparison is required. Genuine savings stay `NOT MEASURED` until actual data, but routing success **does not depend on paid benchmarking**.

### Task 4 — Validate, update authority, independent review

- [ ] Full typecheck/lint/build/Vitest/E2E, CI Linux+Windows, native Windows+WSL synthetic smoke.
- [ ] Independent fresh-context review of actual dispatcher (correct task→level, no leaks, no secret settings edits, unsupported-level failure behavior, cache-independent evidence).
- [ ] Update PR #13 body, Issue #12, ROADMAP *without* prematurely checking user write/prompt or measured savings. Keep M3 PR #11 unchanged.
- [ ] Report RED/GREEN, exact SHA, diff +/- and PASS/FAIL/SKIP/NOT RUN. No merge or Draft removal without owner approval.

**Decision:** Original 7 paid calls are CANCELLED; no authorization to invoke an external model. **Outcome** is operational task routing, not an econometric study.
