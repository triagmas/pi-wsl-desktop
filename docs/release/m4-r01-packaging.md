# M4 R01 — Windows Release Packaging: design & lifecycle

Scope: Issue #16 (M4 R01). This document justifies the packaging mechanism,
pins the install/update/uninstall lifecycle and the user-data guarantees,
and lists exactly what was and was NOT verified.

## Mechanism choice: electron-builder 26.15.3 (NSIS, x64, unsigned)

| Option | Verdict |
|---|---|
| **electron-builder + NSIS** (chosen) | De-facto standard, unsigned NSIS supported out of the box on standard runners and cross-builds from Linux (with wine for resource editing); declarative config auditable by unit tests; per-user install without elevation (the assisted installer would offer a per-machine mode — rejected). |
| electron-forge | No first-party NSIS maker; Squirrel.Windows implies an auto-update model and .NET tooling — violates "no auto-update / no servers" for R01. |
| Hand-written NSIS + @electron/packager | Maximal manual surface for exactly the guarantees R01 must not get wrong (data preservation, upgrades); rejected as the non-minimal path. |
| Plain zip | Not an installer (fails Issue #16's install lifecycle requirement). |

**Version:** `electron-builder@26.15.3` pinned EXACT in `devDependencies`.
**Security/build impact:** build-time-only dependency; the installer ships an
asar that provably contains no `node_modules` (see
`scripts/verify-release.mjs` → "asar contains NO raw node_modules").
`npm audit --omit=dev` (runtime): **0 vulnerabilities**; full-tree audit:
8 moderate, all in the build/dev tree, none shipped. No native modules
(`npmRebuild: false`), so no compiler toolchain is required on user machines.

## What the installer contains

- `Pi WSL Desktop.exe` + Electron runtime (win-unpacked, asar-packed).
- `resources/app.asar` — bundled main/preload/renderer (esbuild + Vite output
  of the SAME `npm run build` used in dev).
- `resources/bridge/index.cjs` — the WSL bridge as a REAL file
  (extraResources). WSL reads it via a Windows path; a file inside asar is
  not addressable that way, hence `resolveBridgeWinPath()` in
  `src/main/paths.ts` switches on `app.isPackaged`.
- NSIS helpers (`elevate.exe`, uninstaller). No custom NSIS scripts — the
  release contract test forbids `customScript`/`include`.

**NOT included:** node_modules, sources, tests, fixtures, signing keys,
Pi itself. The app talks to the user's EXISTING Pi installation inside WSL
exactly as the dev build does. No second Pi copy is installed.

`resources/app-update.yml` is written by electron-builder defaults (GitHub
provider metadata). The app does NOT bundle `electron-updater` and performs
no network updates; the file is inert. Disclosed here for the security review.

## Lifecycle & data guarantees (Issue #16)

- **Install** (one-click, `oneClick: true` + `perMachine: false`): always
  per-user, NO elevation and NO directory choice in the UI — the default
  install dir is fixed to `%LOCALAPPDATA%\Programs\pi-wsl-desktop`
  (package name; exe `Pi WSL Desktop.exe`).
  **`/D=` override — CLOSED (owner decision: variant B, security closure):**
  a minimal allow-listed NSIS guard (`build/nsis-guard.nsh`, the single
  sanctioned `nsis.include`) enforces ownership at both ends of the
  lifecycle while the standard electron-builder templates stay untouched:
  - `customInit` runs in `.onInit` AFTER `initMultiUser` (the final
    `$INSTDIR`, including any trailing `/D=` argument, is known) and BEFORE
    any extraction — an existing non-empty directory without the ownership
    marker is rejected (silent: non-zero exit; interactive: stop message).
    Empty/non-existent directories and upgrades of our own installs
    (marker present) stay allowed.
  - `customInstall` writes the marker `.pi-desktop-install-marker`
    (`APP_ID` + `VERSION`) after extraction on every install/upgrade.
  - `customUnInstall` quits BEFORE any deletion when the marker is missing
    (tampered/broken state) — the uninstaller never recursively deletes a
    directory it cannot prove it owns.
  Directory entries are matched by EXACT full-string comparison against
  `.` and `..` only — any other name (including one-character names such
  as `a`, which a length-based shortcut would have skipped — review P1,
  RED-proven on the real installer) makes the directory foreign.
  The guard is contract-pinned by `tests/unit/nsisGuardContract.test.ts`
  (hook definitions plus a STRICT statement allow-list applied after
  comment stripping: statements outside the sanctioned set — Exec, Delete,
  WriteRegDWORD, nsExec, wsl, taskkill, ... — and non-marker FileOpen
  paths are rejected, with mutation fixtures proving it) and proven
  end-to-end by CI: a refused `/D=` install exits 2 with foreign sentinels
  byte-identical and the previous install untouched; single-character
  foreign entries are refused too; a tampered uninstall keeps the dir and
  files (fail-safe). Known minor quirk (disclosed): a SECOND uninstall run
  on the same install tree can leave the emptied folder behind — files and
  data are still removed; strict full-removal assertions apply to every
  first-run uninstall. User data lives in `%APPDATA%\pi-wsl-desktop`
  (Electron `userData`) — outside the install dir by construction. Settings
  (`settings.json`, `module-state.json`) are never written by the installer.
- **Update**: run the new installer over the old one (same `appId`
  `io.pi-desktop.wsl`); files are replaced, `userData` is not versioned into
  the install dir. No automatic transactional rollback is claimed: if a
  partial update breaks the installation, recovery is reinstalling the
  archived previous `PiWSLDesktop-<v>-setup.exe` (CI retains artifacts 14
  days; the owner must archive artifacts for rollback). Downgrade = install
  the older artifact the same way.
- **Uninstall** (Add/Remove Programs): removes the program directory and
  shortcuts only. `deleteAppDataOnUninstall: false` — user data survives;
  WSL, `~/.pi` and user projects are outside the uninstaller's reach in
  every standard scenario (no directory choice in the UI; ownership guard
  refuses non-owned directories before any deletion — see the `/D=`
  closure above).
- **Verified synthetically in CI** (`scripts/packaged-lifecycle.mjs`):
  silent install → upgrade → tampered-uninstall fail-safe → uninstall →
  refused malicious `/D=` against the real NSIS artifacts, with byte-exact
  sentinel files inside the real userData dir AND in a foreign target dir
  proving user-data and third-party preservation on every step.
- Never performed by our application code: `wsl --unregister`,
  `wsl --shutdown`, stopping WSL/Pi/distro processes, writes into the
  user's Pi home. The standard NSIS installer/uninstaller (upstream
  electron-builder templates) may stop the running desktop app itself
  during update/uninstall using its upstream detection — it makes no
  strict file-ownership guarantees, and this release does not patch the
  upstream template; it never targets third-party processes by design.

## Versioning & reproducibility

- `package.json` version `1.0.0-rc.1` — the `1.0.0` release is declared only
  after the FINAL M4 acceptance (Issue #16). Artifact name pins the version:
  `PiWSLDesktop-1.0.0-rc.1-setup.exe`.
- Reproducible inputs: `package-lock.json` via `npm ci`, pinned
  `electron-builder`, Electron 44.9.0 fetched with checksum verification by
  `@electron/get`. Byte-identical binaries are NOT claimed (NSIS/PE
  timestamps, Electron upstream zips); the claim is *procedurally*
  reproducible builds from the same lockfile.

## Verification matrix (R01)

| Gate | Where | Status |
|---|---|---|
| Release contract unit tests (10) + notices (3) + paths (2) | local + CI Linux/Windows | PASS |
| Full local Vitest (unit/contract/integration/ui) | local WSL | see final report |
| Installer build + contents (`verify-release.mjs`) | local: win-unpacked 10/10 PASS (installer step needs wine on Linux — documented); CI Windows: full | CI authoritative |
| Synthetic lifecycle: install → upgrade → uninstall with sentinel user-data files | CI Windows runner (`scripts/packaged-lifecycle.mjs`) | CI authoritative |
| Packaged smoke (boots from installed files, no dev server, fails closed `WSL_UNAVAILABLE` without WSL) | CI Windows runner | CI authoritative |
| Electron Playwright E2E, Repository Contract, Linux no-regressions | CI Linux | required PASS |
| Real install/update/uninstall in the working Windows profile, real WSL+Pi from the installed app | manual | **NOT RUN (owner consent required)** — mandatory gate before declaring 1.0.0 |

## Rollback

- App-level: reinstall the previous archived installer (userData is
  version-independent).
- Change-level: this R01 lands as one PR; reverting it restores the dev-only
  build (`npm run build`/`npm start`), which is unaffected by packaging.
