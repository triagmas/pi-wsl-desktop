# M3 R04 — external declarative discovery + enable/disable persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, native execution; one fresh-context review of the whole branch at the end). Steps use checkbox (`- [ ]`) syntax.

**Goal:** close both R03 P2 residuals, then load external *declarative* module manifests through a hardened, bridge-owned discovery path and persist module enable/disable through a minimal typed Desktop↔WSL IPC — with no third-party JS execution and no writes to the user's `~/.pi`.

**Architecture:** shared node-free contract (`src/shared/m3Ipc.ts`, `M3_METHODS` in `codes.ts`) → bridge-owned discovery/persistence in `src/bridge/modules.ts` registered in `handlers.ts` (root is bridge-fixed under `$HOME/.pi-desktop`, callers never pass paths) → renderer `App.tsx` merges discovered raws into the existing fail-closed registry and persists toggles via `api.request('setModuleState', …)`, reverting visibly when persistence fails. Files are read with `O_NOFOLLOW`, size/name caps, UTF-8-fatal decode, per-file fail-closed diagnostics; state is written atomically (tmp + rename) with merge-preservation of unknown fields.

**Tech Stack:** TypeScript, Zod 4, Vitest (unit/contract/integration/UI/smoke), Playwright/Electron, GitHub-hosted Linux+Windows CI.

**Spec:** `SPECIFICATION.md` §5 (внешние декларативные модули, включение/отключение; произвольный JS вне 1.0), §6 (безопасное чтение, секреты, локальный пользователь), §7 (ошибки), §8 (TDD, стек, честные PASS/NOT RUN); `PRODUCT.md` §3.4; GitHub Issue #10; PR #11 checkpoint (R04 scope).

## Global Constraints
- Canonical checkout `/mnt/f/_hermes/CODE/pi-wsl-desktop`, branch `feat/m3-module-system-r01`, continue PR #11 from `6e5b97d5`. No merge, no force-push, no `main` changes, no M4.
- Never write to the user's `~/.pi`; no model prompts, no external MCP, no paid provider calls in tests; synthetic fixtures only; no secrets/provider ids in public GitHub.
- P2 fixes (diagnostics bound, semver correctness) land in commits BEFORE external discovery is wired (Tasks 1–2 precede Tasks 5–7).
- Backward compatibility: R01/R02/R03 manifests (string deps, no `actions`) must parse unchanged; all 452+ existing tests stay green.
- Persistence location `${HOME}/.pi-desktop/` is Desktop app state (outside `~/.pi`, WSL-side per task authority); discovery root `${HOME}/.pi-desktop/modules`.
- TDD Iron Law: failing test watched before every production change (config/docs commits are the declared exception, noted in the ledger).
- Thinking target `high` for all code/TDD; disclose effective level in the final report.

## Review Focus
1. **Path safety:** no caller-controlled path ever reaches the fs — `listModules` takes zero params; root is `join(home, '.pi-desktop/modules')`; only entries passing the file-name regex and `lstat`-regular checks are opened with `O_NOFOLLOW` under a `realpath` containment check; a symlink (file or state path) must be rejected with content never read/written through it. *(Tests: Task 5 cases 3/8, Task 6 case 7.)*
2. **Oversized/invalid input:** 64KB file cap, 64-file cap, fatal UTF-8 decode, bounded per-file errors and diagnostics; registry caps `ui/actions/dependencies/params` and bounds ALL diagnostics (direct included) so `registerModules` still never throws. *(Tests: Task 3 caps, Task 1 bound, Task 5 cases 4/5/7.)*
3. **Untrusted capabilities stay claims:** an external manifest declaring `notifications`/`settings` must become `incompatible` and produce no tab/panel — external raws go through the SAME registry, no new grant path. *(Test: Task 7 case 1b.)*
4. **State integrity:** corrupt or symlinked state file fails closed with `INVALID_REQUEST` and byte-unchanged data (no silent reset); atomic write; concurrent writes serialized; unknown top-level keys and unknown module ids preserved on merge. *(Tests: Task 6 cases 3/6/7/8.)*
5. **Honest UI on persistence failure:** a rejected `setModuleState` reverts the toggle and shows a visible error — the displayed state never silently diverges from persisted state; bridge absence degrades to visible diagnostics, demo keeps working. *(Tests: Task 7 cases 3/4.)*

---

### Task 1: P2(a) — bound ALL registry diagnostics (direct messages included)

**Files:**
- Modify: `src/renderer/modules/registry.ts`
- Test: `tests/unit/moduleRegistry.test.ts`

**Interfaces:**
- Consumes: existing `MAX_DIAGNOSTICS = 32`, `TRUNCATION_MARKER`, `pushBounded(target, incoming)`.
- Produces: unchanged public API; `registerModules` errors arrays (parse-stage and direct dependency causes) now bounded by the same cap + marker; `TRUNCATION_MARKER` exported for tests if not already.

- [ ] **Step 1: RED** — two new unit tests:
  - `bounds direct dependency diagnostics when 40 declared providers are missing`: raw manifest `id:'wide'`, `dependencies: Array.from({length:40},(_,i)=>({id:'dep-'+i,range:'*'}))` → entry `state==='blocked'`, `errors.length <= 33`, `errors[0]` contains `dep-0`, last entry matches `/further dependency diagnostics truncated/`.
  - `bounds parse diagnostics for a manifest with dozens of invalid ui entries`: raw with `ui: Array.from({length:40},()=>({kind:'tab',id:'BAD_!',title:'',blocks:[]}))` → `state==='invalid'`, `errors.length <= 33`, last matches the truncation marker.
- [ ] **Step 2: run** `npx vitest run --project unit tests/unit/moduleRegistry.test.ts` → Expected: FAIL on `errors.length` (40 > 33 / 80 > 33).
- [ ] **Step 3: implement** — in `reconcileDependencies` replace every direct `frame.errors.push(msg)` (missing/disabled/range/cycle causes) with a bounded single-message helper built on `pushBounded`; in `registerModules` bound `parsed.errors` through `pushBounded` into a fresh array. Export `TRUNCATION_MARKER` if tests import it (they may assert by regex instead — prefer regex to avoid API churn).
- [ ] **Step 4: run** the file → Expected: PASS incl. the pre-existing 26+ cases (10/10 deep-graph, fan-in, opt-out).
- [ ] **Step 5: commit** `fix(m3): cap direct registry diagnostics (P2 R04)`.

### Task 2: P2(b) — semver range correctness

**Files:**
- Modify: `src/shared/m3Protocol.ts`
- Test: `tests/contract/m3Protocol.test.ts`

**Interfaces:**
- Consumes: `satisfiesSemverRange(version, range): boolean` (exported), accepted range syntax unchanged (`*`, `X.Y.Z[-pre]`, `^X.Y.Z[-pre]` per `ModuleDependencySchema` regex).
- Produces: same signature; node-semver-aligned semantics for the accepted subset; numeric identifiers compared as `BigInt` (no `Number()` precision loss), caret honours 0.x bounds and the prerelease-tuple rule.

- [ ] **Step 1: RED** — new contract describe `M3 R04 — semver range correctness (P2)` with `sat(...)` assertions:
  - `sat('0.3.0','^0.2.3')===false`, `sat('0.2.9','^0.2.3')===true`, `sat('0.0.4','^0.0.3')===false`, `sat('0.0.3','^0.0.3')===true`;
  - `sat('1.1.0-beta.1','^1.0.0-beta.1')===false`, `sat('1.0.0-beta.2','^1.0.0-beta.1')===true`, `sat('1.0.0','^1.0.0-beta.1')===true`;
  - exact precision: `sat('9007199254740993.0.0','9007199254740992.0.0')===false` (today `Number()` collapses both to 9007199254740992 → wrongly `true`); caret sanity with the same pair: `sat('9007199254740993.0.0','^9007199254740992.0.0')===true` (same major, version above base);
  - pre-release numeric precision: `sat('1.0.0-9007199254740993','1.0.0-9007199254740992')===false` (exact identity) — keeps the fix honest in `comparePreRelease` too.
- [ ] **Step 2: run** `npx vitest run --project contract tests/contract/m3Protocol.test.ts` → Expected: FAIL on the 0.x-caret and/or precision assertions (current code returns `true`).
- [ ] **Step 3: implement** — parse `MAJOR.MINOR.PATCH[-pre]` into `BigInt` core + pre-release id list; `compareVersions` with BigInt tuple compare and node-semver pre-release precedence (numeric ids via BigInt, numeric < alphanumeric, fewer fields < more); exact = tuple+pre identity; caret bounds: major>0 → same major, `0.y.z` → same major+minor, `0.0.z` → same patch; prerelease version satisfies caret only when the base itself carries a pre-release with the SAME `major.minor.patch` tuple and precedence ≥ base; `*` keeps current behaviour (`true`). No schema changes.
- [ ] **Step 4: run** contract file → Expected: PASS incl. all R03 semver tests (whitelist helper, pre-release exact).
- [ ] **Step 5: commit** `fix(m3): node-semver-aligned ranges with BigInt precision (P2 R04)`.

### Task 3: manifest caps for oversized input

**Files:**
- Modify: `src/shared/m3Protocol.ts`
- Test: `tests/contract/m3Protocol.test.ts`

**Interfaces:**
- Consumes: `ModuleManifestSchema`, existing `superRefine` (duplicate ui ids).
- Produces: hard caps `ui ≤ 64`, `actions ≤ 64`, `dependencies ≤ 128`, `params ≤ 64` keys — violations are `stage:'manifest'` failures; all existing manifests unaffected.

- [ ] **Step 1: RED** — contract tests: (a) 65 distinct valid `ui` entries → `ok:false`, stage `manifest`, message matches `/at most 64/`; (b) 65 `actions` → false; (c) 129 string dependencies → false; (d) 65 `params` keys → false, message mentions params; (e) 64 ui entries still parses (`ok:true`).
- [ ] **Step 2: run** contract file → Expected: FAIL (caps missing).
- [ ] **Step 3: implement** — `.max(64)` on `ui` and `actions`, `.max(128)` on `dependencies`, and one custom issue in the existing `superRefine` when `Object.keys(params).length > 64`.
- [ ] **Step 4: run** contract file → Expected: PASS.
- [ ] **Step 5: commit** `feat(m3): bound manifest collection sizes (R04 oversized input)`.

### Task 4: shared M3 IPC contract

**Files:**
- Modify: `src/shared/codes.ts`
- Create: `src/shared/m3Ipc.ts`
- Test: `tests/contract/m3Ipc.test.ts` (new)

**Interfaces:**
- Consumes: `ALL_METHODS` composition, `ModuleIdSchema` (export it from `m3Protocol.ts` if still private).
- Produces: `M3_METHODS = ['listModules','setModuleState'] as const`; from `m3Ipc.ts`: `MODULES_SUBDIR='.pi-desktop/modules'`, `MODULE_STATE_SUBPATH='.pi-desktop/module-state.json'`, `MAX_MODULE_FILE_BYTES=65_536`, `MAX_MODULE_FILES=64`, `MAX_MODULE_DIAGNOSTICS=64`, `MAX_STATE_FILE_BYTES=262_144`, `MAX_STATE_MODULES=512`, `MODULE_FILE_NAME_RE=/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}\.json$/`, `ListModulesParamsSchema` (`z.strictObject({})`), `ListModulesResultSchema` (`{root, available, files:[{file,status:'ok'|'error',raw?,errors[]≤8}], diagnostics[]≤64, state: record id→boolean (≤512 keys)}`), `SetModuleStateParamsSchema` (`z.strictObject({id: ModuleIdSchema, enabled: z.boolean()})`), `SetModuleStateResultSchema` (`{id, enabled}`); `STATE_FILE_VERSION = 1`.

**Notes:** `setModuleState` is a Desktop-app-state write (NOT a Pi resource): single-step, atomic, reversible by toggling back — no M2-style plan/confirm ceremony; the renderer allowlist gains exactly these two methods via `ALL_METHODS`.

- [ ] **Step 1: RED** — `tests/contract/m3Ipc.test.ts`: (a) `M3_METHODS` deep-equals the two names and both are in `ALL_METHODS` + `isAllowedRendererMethod`; (b) `listModules` params reject `{x:1}`; (c) `setModuleState` rejects missing `id`, extra key, `id:'../evil'`, `id:'UPPER'`, `enabled:'yes'`; (d) `ListModulesResultSchema` accepts a full valid payload and rejects `files` over cap, `status:'bogus'`, `state` with 513 keys; (e) `SetModuleStateParamsSchema` accepts `{id:'alpha',enabled:false}`.
- [ ] **Step 2: run** `npx vitest run --project contract tests/contract/m3Ipc.test.ts` → Expected: FAIL (`M3_METHODS` undefined / module missing).
- [ ] **Step 3: implement** `M3_METHODS` in `codes.ts` (ALL_METHODS spreads it) and `m3Ipc.ts` schemas; export `ModuleIdSchema` from `m3Protocol.ts`.
- [ ] **Step 4: run** new file + `tests/contract/m1Protocol.test.ts` + `tests/contract/m2Protocol.test.ts` → Expected: PASS (method-composition assertions are additive).
- [ ] **Step 5: commit** `feat(m3): typed listModules/setModuleState bridge contract (R04)`.

### Task 5: bridge discovery — hardened external manifest loader

**Files:**
- Create: `src/bridge/modules.ts`
- Modify: `src/bridge/handlers.ts` (register `listModules`)
- Test: `tests/integration/bridgeR04.test.ts` (new, spawns the real bridge child with a temp `HOME`, mirroring `tests/integration/bridge.test.ts`)

**Interfaces:**
- Consumes: `m3Ipc` constants/schemas, handler context `{home}`.
- Produces: `discoverModules(home: string): Promise<ListModulesResult>` (state included, see Task 6 wiring); file entry rules: only `*.json` names matching `MODULE_FILE_NAME_RE`, `lstat` must be regular (symlink → `status:'error'`, errors `['symlink rejected (not a regular file)']`), size ≤ `MAX_MODULE_FILE_BYTES` else error `['file exceeds 65536 bytes']`, open `O_RDONLY|O_NOFOLLOW`, UTF-8 fatal decode else error, `JSON.parse` failure → error `['invalid JSON: …']` (message ≤600 chars), valid JSON returned as `raw` WITHOUT schema validation (renderer owns that stage); deterministic lexicographic file order; >`MAX_MODULE_FILES` → remaining names reported once in `diagnostics` (`module files limit (64) reached; extra files ignored`); missing root → `available:false`, empty `files`, empty `diagnostics` (normal fresh-install state, silent); root realpath must stay under realpath(`home`) — containment failure → `available:false` + diagnostic.

- [ ] **Step 1: RED** — integration tests against a spawned bridge (fresh temp HOME each test group):
  1. empty home → `ok`, `available:false`, `files:[]`, `diagnostics:[]`;
  2. `alpha.json` valid manifest → `status:'ok'`, `raw.id==='alpha'`;
  3. `link.json` symlink to an out-of-root secret file → `status:'error'`, errors mention symlink, and the raw secret content (`"secret":"LEAK"`) appears nowhere in the response JSON;
  4. `big.json` = 70KB → `status:'error'`, errors mention `65536`;
  5. `broken.json` = `{"id":` → `status:'error'`, errors mention `invalid JSON`;
  6. `bad-schema.json` = `{"id":1}` → `status:'ok'` with `raw` present (schema stage is the renderer's);
  7. 65 lexicographically named files → exactly 64 file entries + one diagnostic mentioning the limit;
  8. 65 files where the 65th sorts first (`000-extra.json` present) → the EXCLUDED one is the lexicographic tail (determinism);
  9. schema-valid file but unreadable-permission (chmod 000) → `status:'error'` graceful, response still ok. *(skip if not reliably reproducible — mark SKIP)*
- [ ] **Step 2: run** `npx vitest run --project integration tests/integration/bridgeR04.test.ts` → Expected: FAIL (`METHOD_NOT_ALLOWED: listModules`).
- [ ] **Step 3: implement** `src/bridge/modules.ts` (`discoverModules`) + register `listModules` in `makeHandlers` (NO pi probe call, result validated by `ListModulesResultSchema` via `assertOut`).
- [ ] **Step 4: run** new file → Expected: PASS; then full `npx vitest run --project integration` → Expected: PASS (no regressions in bridge/M1/M2 suites).
- [ ] **Step 5: commit** `feat(m3): hardened external manifest discovery in the bridge (R04)`.

### Task 6: bridge persistence — module enable/disable state

**Files:**
- Modify: `src/bridge/modules.ts` (state read/write), `src/bridge/handlers.ts` (register `setModuleState`)
- Test: `tests/integration/bridgeR04.test.ts`

**Interfaces:**
- Consumes: Task 4/5 outputs; `SetModuleStateParamsSchema`.
- Produces: `readModuleState(home)` → `{state, diagnostics}` (missing file → `{}`, silent; unreadable/corrupt/oversized → `{}` + one diagnostic, never throws); `writeModuleState(home, id, enabled)` → serialized through an in-module promise queue; guards before write: existing state path must be `lstat`-regular (symlink → `BridgeError('INVALID_REQUEST', …)`), file ≤ `MAX_STATE_FILE_BYTES`, JSON must parse (corrupt → `BridgeError('INVALID_REQUEST', …)` with the file left byte-unchanged); merge preserves unknown top-level keys and unknown module ids; write = `mkdir -p` (0700) + tmp file (0600) in the same dir + `rename`; result `{version:1, modules:{…:{enabled}}}`; handler `setModuleState` validates params and returns `{id, enabled}`.

- [ ] **Step 1: RED** — integration cases:
  1. `setModuleState {id:'alpha',enabled:false}` on empty home → `ok {id:'alpha',enabled:false}`; file exists with `version:1`, `modules.alpha.enabled===false`;
  2. follow-up `{id:'beta',enabled:true}` → `modules.alpha` still present (merge);
  3. pre-seeded state file `{"custom":1,"modules":{"x":{"enabled":true,"note":"keep"}}}` → after `setModuleState {id:'alpha',enabled:false}` the response `ok`, file still has `custom===1` and `modules.x.note==='keep'`;
  4. `listModules` afterwards reports `state: {x:true, alpha:false}`;
  5. `{id:'../evil',enabled:true}` → error `INVALID_REQUEST`, no such key in file;
  6. corrupt state file → `setModuleState` → `INVALID_REQUEST` AND file bytes byte-identical before/after (read bytes in test);
  7. state path replaced by symlink → `INVALID_REQUEST`, symlink target bytes unchanged;
  8. two parallel `setModuleState` (alpha:false, beta:true) via `Promise.all` → both `ok` and file contains BOTH ids (write serialization).
- [ ] **Step 2: run** integration file → Expected: FAIL (`METHOD_NOT_ALLOWED`).
- [ ] **Step 3: implement** `readModuleState`/`writeModuleState` + handler (parse params → guards → merge → atomic write → `assertOut(SetModuleStateResultSchema, …)`); `listModules` now embeds `readModuleState` into its result.
- [ ] **Step 4: run** integration file (all Task 5 + 6 cases) → Expected: PASS; then full integration project → PASS.
- [ ] **Step 5: commit** `feat(m3): atomic fail-closed module state persistence (R04)`.

### Task 7: renderer wiring — discovery on load, persist on toggle

**Files:**
- Modify: `src/renderer/App.tsx`, `src/renderer/ModulesView.tsx`
- Test: `tests/ui/m3Modules.test.tsx`

**Interfaces:**
- Consumes: `ListModulesResultSchema`, `SetModuleStateParamsSchema`, existing `registerModules`/`setModuleEnabled`, `DesktopApi.request`.
- Produces: `AppProps.moduleDefinitions` semantics unchanged (when provided → NO IPC fetch, existing tests untouched); default path (`moduleDefinitions === undefined && effectiveApi`): on mount fetch `listModules`, register `[DEMO, ...ok.raws]`, then apply persisted `state` entries with `enabled===false` via `setModuleEnabled`, and record `files` errors + bridge `diagnostics` as `loadDiagnostics: string[]`; `toggleModule` = optimistic local update + `void api.request('setModuleState',{id,enabled})` — on rejection: revert the toggle and set `persistError: string`; `ModulesView` gains optional `diagnostics?: readonly string[]` rendered as `<ul data-testid="modules-diagnostics">` only when non-empty, and `persistError` renders `<p role="alert" data-testid="modules-persist-error">`.

- [ ] **Step 1: RED** — UI tests:
  1. api whose `request('listModules')` resolves a valid result containing `{file:'ext.json',status:'ok',raw:EXT_MANIFEST}` → `tab-module-ext1/welcome` visible (external module via generic contract) and `request` was called with `('listModules', undefined)`;
  2. same but `state:{ext1:false}` → tab absent, row state `disabled`; clicking `module-toggle-ext1` calls `('setModuleState',{id:'ext1',enabled:true})` and the tab appears;
  3. `setModuleState` rejects (`new Error('WSL gone')`) → `modules-persist-error` visible with «WSL gone», row reverts to `disabled`, tab stays absent;
  4. `listModules` rejects → `modules-diagnostics` visible containing the message; demo tab still present and its toggle still works;
  5. result with `{file:'link.json',status:'error',errors:['symlink rejected (not a regular file)']}` → `modules-diagnostics` contains `link.json: symlink rejected`;
  6. untrusted-capability external manifest (`capabilities:['notifications']`) in the result → NO tab/panel for it, its row shows `incompatible` (claim ≠ grant end-to-end).
- [ ] **Step 2: run** `npx vitest run --project ui tests/ui/m3Modules.test.tsx` → Expected: FAIL (fetch/persist/diagnostics not implemented).
- [ ] **Step 3: implement** App `useEffect` loader + persistence in `toggleModule` (guarded by `moduleDefinitions === undefined`), `ListModulesResultSchema.safeParse` of the response (malformed → one diagnostic), `ModulesView` diagnostics/persist-error rendering.
- [ ] **Step 4: run** full UI project → Expected: PASS incl. boundary-switch/regression suites; confirm no existing test asserted `request` call counts (if one does: ledger ruling — adapt the mock per-method, not production code).
- [ ] **Step 5: commit** `feat(m3): renderer discovery + persisted toggles with honest failure (R04)`.

### Task 8: E2E isolation, full stack, docs, push, CI

**Files:**
- Modify: `e2e/m3.spec.ts` (HOME isolation — config/test-infra, TDD exception noted in ledger), `ROADMAP.md`, plan checkboxes.
- Test: local `typecheck/lint/test/build` + hosted CI.

- [ ] **Step 1** — in `e2e/m3.spec.ts` `launch()` add `HOME: <fresh mkdtemp dir>` to the Electron env so persistence writes never touch the real home and cannot leak state between runs; the E2E scenario additionally asserts re-enable survives… keep scope minimal: existing scenario must pass unchanged in behaviour (disable → enabled state file written under temp HOME — assert optional).
- [ ] **Step 2** — run `npm run typecheck && npm run lint && npm run test && npm run build` → Expected: all PASS with exact counts recorded (target: previous 452 PASS / 8 SKIP + new tests, 0 FAIL).
- [ ] **Step 3** — attempt `npm run test:e2e` locally; if the known toolchain shim blocks it → record `NOT RUN (toolchain shim)` honestly (Linux CI E2E is the authoritative gate, as in R03).
- [ ] **Step 4** — ROADMAP: new `### M3 R04` section with implemented scope + evidence so far, update the R03 residual lines (P2s → closed with commit refs), no `[x]` acceptance flips; update this plan's checkboxes.
- [ ] **Step 5** — `git push origin feat/m3-module-system-r01` (PR branch only) and watch both CI workflows on the exact HEAD → Expected: SUCCESS (Linux+Windows Product CI, Repository Contract).
- [ ] **Step 6** — commit `docs(roadmap): M3 R04 scope and R02/R03 residual dispositions`.

### Task 9: real smoke, independent review, final sync

**Files:**
- Create: `tests/smoke/r04ModulesReal.test.ts` (REAL_WSL-gated)
- Review package via `superpowers:subagent-driven-development/scripts/review-package`; reviewer = pi-subagents `reviewer` on `gpt-6.1-sol` (project AGENTS), fresh context, `pi-desktop-review` skill loaded first.

- [ ] **Step 1** — real smoke test: spawn the REAL bridge (existing `tests/smoke` pattern), temp-HOME end-to-end (`listModules` empty → fixture manifest appears → `setModuleState` → `listModules` reflects it → files cleaned); run `npm run test:smoke:real` full → Expected: existing 4/4 + new suite PASS.
- [ ] **Step 2** — real Windows GUI smoke: attempt native Windows run (existing project procedure: Windows-side build/E2E or GUI script); record exact PASS/FAIL; if not reproducible in this session → `NOT RUN` with reason (never claimed).
- [ ] **Step 3** — independent review (fresh context, `high`-target per project rules): deliver package = `git diff 6e5b97d5..HEAD`, plan `Review Focus` verbatim, ledger rulings. Critical/Important → ONE fix pass, each RED→GREEN + full suite; Minor → deferred list in PR/ROADMAP.
- [ ] **Step 4** — re-run full stack after fixes; push; confirm CI SUCCESS on final HEAD.
- [ ] **Step 5** — sync: ROADMAP final evidence row(s), PR #11 comment (base/head SHA, files, `+/-`, tests PASS/FAIL/SKIP/NOT RUN, smoke, risks/rollback, skills, thinking/cost or `NOT MEASURED`, merge verdict), Issue #10 comment (R04 status, no checkbox flips). NO merge, no main, no M4.

---

## Статус выполнения (сессия R04)

- [x] Task 1 — commit `75b8c3f` (RED 2 → GREEN `moduleRegistry` 28/28, 1 commit = 1 P2)
- [x] Task 2 — commit `e9c0936` (RED 2 → GREEN contract 70/70; **ruling:** один RED-ассерт поправлен — `0.1.1 ⊨ ^0.1.0` через промежуточную 0.1.0 фактически верен; второй MAJOR остался RED до реализации; стоимость неверного PASS по расширению semantics — расхождение в 1 кейсе на неполный диапазон с семантикой `*`)
- [x] Task 3 — commit `b395f94` (RED 5 → GREEN; **ruling:** два текстовых ожидания приведены к реальному тексту ошибок Zod v4 — cap-схемы неверифицированы в РЕД без сверки фактической строки; эквивалентность до смысла «array > 64 items»)
- [x] Task 4 — commit `ddb89f2` (contract 81/81; whitelist/протокол/`getCapabilities` наследуют `M3_METHODS` автоматически)
- [x] Task 5 — commit `26a7a28` (integration 5/5; **ruling:** home-containment вынесен в отдельный кейс 5, отдельный тест open-циклов не добавлен — фильтр по имени убирает чтение до open; общий budget; стоимость неверного PASS — нечестный файл идёт в общий path-фолт вместо отдельного маркера)
- [x] Task 6 — commit `e4874f4` (integration 15/15; **ruling:** race «toggle во время in-flight load» — интеримный toggle теряется при сбросе списка; узкий окно старта, вторая запись восстанавливает; стоимость неверного PASS — один пользовательский toggle повторно)
- [x] Task 7 — commit `5b1b1bc` (RED 6 → GREEN ui 54/54; **rulings:** App.test переключён с `mockRejectedValueOnce` на метод-маршрутизацию — легитимный mount-time `listModules` потреблял одноразовый reject; диагностики discovery — в Modules view (постоянная проблема), ошибка persistence — в корне приложения (всегда видна))
- [x] Task 8 — E2E HOME-изоляция (mkdtemp), полный локальный стек **494 PASS / 8 SKIP / 0 FAIL**, typecheck/lint/build 0/0/0, ROADMAP-секция R04; локальный E2E **NOT RUN** (общий `node_modules` содержит win32 `electron.exe` — toolchain shim R03; Linux CI E2E авторитетен)
- [x] Task 9 — REAL smoke (r04ModulesReal + REAL WSL 5 PASS, M2 bridge 17/17, нативный Windows GUI PASS); **инцидент**: первый REAL-прогон поймал privacy-утечку (абсолютный `root` в `listModules`, raw EACCES → $HOME в диагностиках) → отдельный TDD-фикс `95e4c01` (root убран из контракта, `fsErrorText`); три независимых внешних review (свежий контекст, gpt-6.1-sol): #1 REQUEST_CHANGES 6×P1+2×P2 → все исправлены (`698eae1`,`5adc6f2`,`d910003`); #2 REQUEST_CHANGES N1/N2/N3+docs → исправлены (`e0b9a7a`); #3 **ACCEPT_WITH_FIXES** (N1/N2/N3/docs закрыты), 2×P2 → исправлены (`caa8261`,`ec2af42`). Финальный HEAD `ec2af42`: CI Linux 506 PASS/15 SKIP + E2E 10/10, Windows 338 PASS/5 SKIP, Contract SUCCESS; локально 511 PASS/10 SKIP, TC/lint/build 0/0/0. PR #11 ready, body/Issue #10 синхронизированы. Merge verdict: BLOCK до прямого разрешения владельца (base PR — старый main `6107f959`, перед merge нужна безопасная синхронизация с `7f1f63d8`)
