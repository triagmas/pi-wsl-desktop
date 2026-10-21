# M3 Module System — First Product Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working module registration in Pi Desktop Lite: versioned manifest + capability check, registry with enable/disable, a registered tab rendered through one generic contract (no core patch per module), graceful handling of incompatible version / malformed manifest / module render error, and one built-in demo module proving the whole cycle.

**Architecture:** The module contract is a node-free Zod schema (`src/shared/m3Protocol.ts`) parsed fail-closed into `enabled | disabled | invalid | incompatible` entries. A pure renderer-side registry (`src/renderer/modules/registry.ts`) never throws; `App.tsx` renders module tabs through one generic `ModuleTabView` wrapped in a `ModuleErrorBoundary`, plus a core `ModulesView` for toggling. Modules are declarative data only — no third-party JS is executed (SPECIFICATION §5).

**Tech Stack:** TypeScript + Zod, React 18, Vitest (contract/unit/UI), Playwright + Electron (E2E).

**Spec:** `SPECIFICATION.md` §5 (module manifest fields: id, version, apiVersion, UI entry points, capabilities, dependencies, params; dynamic untrusted JS not required for 1.0), `PRODUCT.md` §3.4 (new modules add tabs/panels/actions via published contract; no core change for an ordinary feature), `ROADMAP.md` M3 checklist, GitHub Issue #10.

## Global Constraints

- Work only in `/mnt/f/_hermes/CODE/pi-wsl-desktop`, branch `feat/m3-module-system-r01`, existing Draft PR #11 (base `aba63af`). No merge, no Draft removal, no touching `main`, no returning to PR #13.
- No `~/.pi` writes, no model prompts, no paid benchmarks, no Pi settings/session changes, no package installs, no Subagents profile changes.
- TDD Red→Green on every task; during implementation run only affected test files; the FULL regression stack exactly once after the package is ready (re-run only after a fix that affects results).
- Exactly ONE independent review of the finished delta; no per-task reviewers.
- Repository is PUBLIC: no local system details, provider/model identifiers, tokens, or session content in committed files or GitHub (grep `xiaomi|mimo-v2|token-plan` must stay 0).
- ROADMAP.md must be synchronized in this PR (Repository Contract gate); `[x]` only after owner-level acceptance — annotated evidence + journal row now.
- Token efficiency: affected tests during development; concise context reads; report savings `NOT MEASURED`.

## Review Focus

- A malformed module (non-object, missing id, bad version string) registered alongside a valid one must leave the valid module's tab working and list the bad one diagnostically — pin in `moduleRegistry` + UI tests.
- `apiVersion` mismatch (e.g. 2) must produce `incompatible` state, no tab, visible reason — pin in contract + registry + UI tests.
- A React render error inside a module tab must show a fallback with a working "disable" escape, app stays alive — pin with a throwing child in `ModuleErrorBoundary` UI test.
- Enable/disable must only affect valid entries and must remove/restore the tab without touching core views — pin in unit + UI + E2E tests.
- Registering a second module with a duplicate id must fail-closed for the duplicate only, never clobber the first — pin in unit test.

---

### Task 1: Module manifest contract (Zod) + compatibility check

**Files:**
- Create: `src/shared/m3Protocol.ts`
- Test: `tests/contract/m3Protocol.test.ts`

**Interfaces:**
- Produces: `MODULE_API_VERSION = 1`; `MODULE_CAPABILITIES = ['sessions','runtime','resources','notifications','settings']` (SPEC §5 service list); `ModuleManifestSchema` / types `ModuleManifest`, `ModuleTab`, `ModuleBlock` (discriminated union `text | kv | list`); `parseModuleManifest(raw: unknown): { ok: true; manifest: ModuleManifest } | { ok: false; stage: 'manifest' | 'compatibility'; errors: string[] }`.

- [ ] **Step 1: RED** — write `tests/contract/m3Protocol.test.ts`: (a) valid manifest (id `demo`, version `1.0.0`, apiVersion 1, capabilities `['runtime']`, one tab with `text`/`kv`/`list` blocks, `dependencies`/`params` optional with defaults) → `ok:true`, defaults filled; (b) not-an-object → `ok:false, stage:'manifest'`; (c) missing id / id `Bad Id!` → manifest stage; (d) version `1.0` → manifest stage; (e) apiVersion `2` → `stage:'compatibility'`, errors mention apiVersion; (f) unknown capability `['teleport']` → manifest stage; (g) tab block with unknown `type:'chart'` → manifest stage; (h) empty `ui: []` → manifest stage.
- [ ] **Step 2** — Run `npx vitest run tests/contract/m3Protocol.test.ts` → Expected: FAIL (module not found).
- [ ] **Step 3** — Implement schemas + `parseModuleManifest` (safeParse → format `path: message`; then compatibility: `apiVersion !== MODULE_API_VERSION` → compatibility stage).
- [ ] **Step 4** — Run same command → Expected: PASS all cases.
- [ ] **Step 5: Commit** — `test(m3): RED → feat(m3): versioned module manifest contract with capability + apiVersion check`.

### Task 2: Module registry (register / enable / disable), pure and fail-closed

**Files:**
- Create: `src/renderer/modules/registry.ts`
- Test: `tests/unit/moduleRegistry.test.ts`

**Interfaces:**
- Consumes: `parseModuleManifest` from Task 1.
- Produces: `type ModuleState = 'enabled' | 'disabled' | 'invalid' | 'incompatible'`; `interface ModuleEntry { key: string; id: string; state: ModuleState; manifest: ModuleManifest | null; errors: string[] }`; `registerModules(raws: readonly unknown[]): ModuleEntry[]`; `setModuleEnabled(entries, id: string, enabled: boolean): ModuleEntry[]` (touches only entries whose `state` is `enabled|disabled` and `manifest.id === id`); `moduleTabs(entries): Array<{ tabKey: string; entry: ModuleEntry; tab: ModuleTab }>` where `tabKey = ${manifest.id}/${tab.id}`, only `state === 'enabled'`. `registerModules` NEVER throws: raw → `key = 'invalid-' + index` and `id = string(raw.id) if string else 'unknown'` when parse fails; duplicate successful id → second entry `invalid` with error `duplicate id`, first keeps `enabled`.
- [ ] **Step 1: RED** — `tests/unit/moduleRegistry.test.ts`: (a) one valid raw → `[enabled]` with manifest; (b) `null` raw → invalid entry, no throw, `id` is string; (c) apiVersion 2 → `incompatible`; (d) two raws with id `demo` → first `enabled`, second `invalid` + `/duplicate id/`; (e) `setModuleEnabled(..., 'demo', false)` → `disabled`; back → `enabled`; (f) toggle on an `invalid` entry id → unchanged (no accidental promotion); (g) `moduleTabs` returns tabs only for enabled entries, `tabKey` format `demo/welcome`; (h) `registerModules([])` → `[]`.
- [ ] **Step 2** — Run `npx vitest run tests/unit/moduleRegistry.test.ts` → FAIL (module not found).
- [ ] **Step 3** — Implement registry.
- [ ] **Step 4** — PASS all.
- [ ] **Step 5: Commit** — `test(m3): RED → feat(m3): fail-closed module registry with enable/disable`.

### Task 3: Renderer integration — demo module, generic tab view, error boundary, Modules view

**Files:**
- Create: `src/renderer/modules/demoModule.ts` (raw manifest data), `src/renderer/ModuleErrorBoundary.tsx`, `src/renderer/ModuleTabView.tsx`, `src/renderer/ModulesView.tsx`
- Modify: `src/renderer/App.tsx` (register demo, add core `Модули` tab + generic module tabs), `src/renderer/index.css` (module list styles only if needed)
- Test: `tests/ui/m3Modules.test.tsx`

**Interfaces:**
- Consumes: `registerModules/setModuleEnabled/moduleTabs` (Task 2), `parseModuleManifest` (Task 1).
- Produces: `AppProps` extended with `moduleDefinitions?: unknown[]` (default `[DEMO_MODULE_MANIFEST]` — the injection seam for tests); `DEMO_MODULE_MANIFEST` = id `demo`, version `1.0.0`, apiVersion 1, capabilities `['runtime','notifications']`, one tab id `welcome` titled «Демо-модуль» with text/kv/list blocks describing the registration cycle and echoing its own manifest fields; `ModuleErrorBoundary({ moduleId, onDisable?, children })` fallback testid `module-error-${moduleId}` with button «Отключить модуль» calling `onDisable`; `ModuleTabView` section testid `module-tab-${manifest.id}`, state badge testid `module-state-${manifest.id}`, generic `renderBlock` switch with `default:` → visible «неподдерживаемый блок» warning (never throw); nav buttons testid `tab-module-${tabKey}`; Modules view rows testid `module-entry-${key}`, toggles `module-toggle-${id}`, invalid/incompatible rows show `errors` text.

- [ ] **Step 1: RED** — `tests/ui/m3Modules.test.tsx`: (1) App renders `tab-module-demo/welcome` in nav; clicking shows heading + `module-state-demo` = enabled; (2) Modules view (`tab-modules`) toggle off → demo tab gone, badge `disabled`, toggle on → back; (3) `moduleDefinitions={[valid, null]}` → invalid row with error text visible, valid tab still works, no crash; (4) `moduleDefinitions={[valid, {id:'x', version:'1.0.0', apiVersion: 99, capabilities:['runtime'], ui:[...]}]}` → row `incompatible` + no nav tab for x; (5) boundary: render `<ModuleErrorBoundary moduleId="boom" onDisable={fn}><Bomb/></ModuleErrorBoundary>` (Bomb throws; silence `console.error`) → `module-error-boom` visible, click disable → `fn` called, surrounding App content still mounted.
- [ ] **Step 2** — `npx vitest run tests/ui/m3Modules.test.tsx` → FAIL.
- [ ] **Step 3** — Implement demo module, boundary, tab view, modules view, App wiring (generic mapping over `moduleTabs`; core views untouched).
- [ ] **Step 4** — PASS; also run `npx vitest run tests/ui/App.test.tsx` (affected — App changed) → all previous green.
- [ ] **Step 5: Commit** — `feat(m3): module tab via generic contract, Modules view, demo module, render-error boundary (RED→GREEN)`.

### Task 4: E2E — demo module full cycle in a real Electron window

**Files:**
- Create: `e2e/m3.spec.ts` (mirror `e2e/app.spec.ts` launch helper, fake WSL + fake Pi env)

- [ ] **Step 1: RED** — one test: reach ready → `tab-module-demo/welcome` visible → click → demo heading + `module-tab-demo` visible → open `tab-modules` → `module-toggle-demo` click → demo tab hidden, core `tab-status` still works (click, status phase visible) → toggle back → tab returns. Note: a failing E2E here is "feature not built" only after Task 3; if Task 3 is done, write it and run — failure modes are environment/selector, fix forward.
- [ ] **Step 2** — Run `npx playwright test e2e/m3.spec.ts` → PASS (1 test).
- [ ] **Step 3: Commit** — `test(m3): E2E demo module registration cycle in real Electron`.

### Task 5: Full regression (ONCE), ROADMAP sync, push, CI

- [ ] Run the full stack once: `npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run`, `npx playwright test`. Record exact pass/fail/skip numbers.
- [ ] ROADMAP.md: M3 checklist — annotate first three items with implemented-in-PR #11 evidence (keep `[ ]` pending owner acceptance per AGENTS §5); status row M3 → 🟡 код + тесты готовы, review; journal row with numbers.
- [ ] `grep -riE 'xiaomi|mimo-v2|token-plan' ` over committed files → 0.
- [ ] Commit docs, push to `feat/m3-module-system-r01`, check GitHub Actions on PR #11 (Linux/Windows), record run results.
- [ ] Ledger + report: changed files, exact `+/-` (`git diff --stat aba63af..HEAD`).

### Task 6: ONE independent review of the finished delta → fix pass if needed → PR report

- [ ] Generate review package `git diff aba63af..HEAD` → dispatch reviewer subagent (builtin reviewer profile, `high`) with plan + Review Focus verbatim; no other reviews, no extra model calls.
- [ ] If findings: Critical/Important → ONE fix pass, each fix RED→GREEN + affected tests; re-run full stack only if the fix affects results. Minor → record as deferred.
- [ ] Post PR #11 report comment (AGENTS §7 format: files, `+/-`, test numbers, CI, review verdict, Skills inventory, ROADMAP changes, Pi resources `NOT MEASURED`), update ROADMAP journal with review verdict.
- [ ] STOP — no merge, Draft stays; report to coordinator.
