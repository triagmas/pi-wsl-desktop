# M4 R01 — Windows Installer & Release Packaging (Implementation Plan)

> **For agentic workers:** executed natively in-session (owner-supplied task); one independent final review. Steps use checkbox syntax.

**Goal:** Reproducible Windows installer (NSIS) for the existing Electron/React/WSL app that uses the user's ALREADY-INSTALLED Pi inside WSL — no second Pi copy, no auto-update, no servers.

**Architecture:** `electron-builder@26.15.3` (devDependency only, `--publish never`) produces an unsigned NSIS installer from the existing esbuild/Vite `dist/`. App code enters asar; the bridge bundle ships via `extraResources` (WSL must read it as a real file). One production-path fix in the Electron main (`resolveBridgeWinPath`). User data stays in `%APPDATA%\pi-wsl-desktop` — outside the install dir; uninstall keeps it.

**Tech Stack:** electron-builder 26.15.3 (NSIS target), existing esbuild/Vite build, Vitest, GitHub-hosted Windows runner.

**Spec:** Issue #16 (M4 R01) + owner task PI_DESKTOP_M4_R01; design rationale in `docs/release/m4-r01-packaging.md`.

## Global Constraints

- App version: `1.0.0-rc.1` — 1.0.0 must NOT be declared released before final M4 acceptance.
- No second Pi installation; no copying of Pi models/sessions/config into Windows. Installer ships ONLY the desktop app.
- `deleteAppDataOnUninstall: false`, `perMachine: false`, no custom NSIS scripts/hooks — install/update/uninstall must never touch `~/.pi`, WSL distros, `$HOME/.pi-desktop/module-state.json` or user projects.
- No auto-update, no differential packages, no network services (`publish: never`).
- No permanent repo copies on C:/E:; build caches stay in WSL home; artifacts inside the checkout (`release/`, gitignored).
- Linux CI job unchanged (no regressions); Windows CI gains packaging + verification + packaged smoke.
- TDD: RED before GREEN for every production change; config files are the TDD exception (covered by contract tests instead).

## Review Focus (most likely to bite)

1. Packaged main resolving bridge/preload/renderer paths from asar or dev-relative paths → app boots but bridge spawn fails. Test: `resolveBridgeWinPath` contract (Task 2) + packaged smoke (Task 5).
2. Uninstaller or update wiping user data. Tests: release contract asserts `deleteAppDataOnUninstall:false`, `perMachine:false`, no NSIS custom scripts (Task 1); design doc lifecycle.
3. Installer shipping dev junk (node_modules, tests, fixtures/secrets). Test: contract asserts `files` allowlist starts from `dist/**`+package.json and excludes are implicit (Task 1) + `verify-release.mjs` inspects asar listing in CI (Task 4).
4. Version drift: package.json vs installer artifact vs docs. Test: contract pins `1.0.0-rc.1`; verify-release checks artifact name contains the version (Tasks 1/4).
5. Missing/incorrect third-party notices. Test: notices contract covers every production dependency (Task 3).

---

### Task 1: Release contract (electron-builder config + version)
**Files:** Create `tests/unit/releaseContract.test.ts`; Modify `package.json` (version `1.0.0-rc.1`, devDep `electron-builder@26.15.3` exact, `"build"` config block).
**Steps:** RED contract tests (config fields, lifecycle invariants, license file present) → add `build` block + version → GREEN → `npm i -D electron-builder@26.15.3` (lockfile) → audit note → commit.

### Task 2: Production bridge path (packaged vs dev)
**Files:** Create `src/main/paths.ts`, `tests/unit/mainPaths.test.ts`; Modify `src/main/index.ts:51`.
**Steps:** RED (`resolveBridgeWinPath(true, resDir, dir)` → `resDir/bridge/index.cjs`; `(false, …)` → sibling) → GREEN → wire in index.ts → full unit suite → commit.

### Task 3: Third-party notices
**Files:** Create `THIRD_PARTY_NOTICES.md`, `tests/unit/thirdPartyNotices.test.ts`.
**Steps:** RED (every key of `package.json.dependencies` must appear with name+version-range in notices) → write notices (react, react-dom, zod — MIT) → GREEN → commit.

### Task 4: Installer build + contents verification
**Files:** Create `scripts/verify-release.mjs`; Modify `.gitignore` (`release/`).
**Steps:** Local cross-build attempt `npx electron-builder --win nsis --publish never` (Linux host; if blocked → documented NOT RUN, CI authoritative) → verify script (installer exists+version in name, `win-unpacked/<app>.exe`, `resources/bridge/index.cjs`, asar contains `dist/main/index.cjs` + `dist/renderer/index.html` via `@electron/asar`) → run against real artifacts → commit.

### Task 5: Packaged smoke (no dev server, fail-closed without WSL)
**Files:** Create `scripts/packaged-smoke.mjs`.
**Steps:** Launch `win-unpacked/<app>.exe` with `PI_WS_DESKTOP_SMOKE_REPORT` + bogus `PI_WS_DESKTOP_WSL_PATH`; poll sink for terminal `error` snapshot (`WSL_UNAVAILABLE`) within 90 s; assert no crash (process exits 0/absent only after report) → local NOT RUN (win binary, no Windows host here) → CI authoritative → commit.

### Task 6: CI packaging job
**Files:** Modify `.github/workflows/product-ci.yml` (Windows job: packaging step, verify, packaged smoke, upload-artifact, timeout 25→40).
**Steps:** Add steps after build; Linux job untouched → push → watch both workflows → commit/push.

### Task 7: Design doc + ROADMAP + PR/Issue sync
**Files:** Create `docs/release/m4-r01-packaging.md`; Modify `ROADMAP.md`.
**Steps:** Document mechanism choice (alternatives rejected), lifecycle install/update/uninstall/rollback, data guarantees, reproducibility limits, NOT RUN list → ROADMAP M4 R01 section → push, open PR, sync Issue #16.

### Task 8: Independent review + final report
Read `pi-desktop-review`; dispatch reviewer (`gpt-6.1-sol`, fresh context) on the full delta; fix findings in scope; final report with verdict.

## Self-review
Coverage: installer (1/4), packaging correctness (2/4), production paths (2), data isolation (1+docs), update/uninstall/rollback (1+docs), versioning (1/4), licenses (3), full stack + CI + smoke + review (5/6/8). Types: `resolveBridgeWinPath(isPackaged: boolean, resourcesPath: string, mainDirname: string): string` used consistently.
