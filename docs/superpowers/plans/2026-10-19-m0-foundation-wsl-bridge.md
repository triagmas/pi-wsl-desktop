# M0 Foundation & WSL Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one coherent PR that proves the transport: a minimal secure Electron/React Windows shell connected to exactly one persistent, typed-protocol WSL Bridge running inside the user's existing Ubuntu, with robust WSL/Pi discovery — read-only, no second Pi config, free public CI.

**Architecture:** Electron main process owns a `WslConnection` (discovery → spawn `wsl.exe -d <distro> --exec <node> <bridge>` → NDJSON stdio protocol with request IDs, timeouts, cancel, backoff reconnect). The Bridge is a single long-lived Node process inside WSL exposing a Zod-validated, versioned, read-only allowlist (`health`, `getRuntimeInfo`, `getCapabilities`, `ping`). Renderer runs sandboxed/context-isolated and talks only through a whitelisted preload bridge; state renders as connecting/ready/error+retry.

**Tech Stack:** TypeScript 5.9.3 · Electron 44 (devDep) · React 19 + Vite 8 · Vitest 5 (+ RTL, jsdom, Zod 4) · Playwright 1.64 (Electron) · esbuild (main/preload/bundle) · ESLint 10 flat + typescript-eslint 8 · GitHub Actions free runners.

**Spec:** `SPECIFICATION.md` (§2 transport, §7 error codes, §8 test gates) + `AGENTS.md` + Issue #2 (DoD) — binding authority.

## Global Constraints

- Working tree ONLY `/mnt/f/_hermes/CODE/pi-wsl-desktop`; branch `m0/foundation-wsl-bridge` off accepted `main` (`877a573`); one big PR; **no merge**.
- Never write to `~/.pi/`, sessions, auth, settings of the real Pi; bridge methods are read-only allowlist; no HTTP/WebSocket listener anywhere.
- Electron: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, no renderer command execution; IPC whitelisted in preload AND main.
- Protocol: `PROTOCOL_VERSION=1`, NDJSON on bridge stdout, diagnostics on stderr only, `MAX_FRAME_BYTES=1048576`, request IDs on every frame, error codes at least those in SPEC §7.
- Discovery: no login/interactive shells, no `bash -ilc`, every `wsl.exe` call has a timeout + stdin `ignore`, kill on expiry; `wsl.exe -l -q` output decoded UTF-16LE-aware (real fixture).
- Allowlist: `health`, `getRuntimeInfo`, `getCapabilities`, `ping`; test-only `__test_slow` behind env `PI_WS_DESKTOP_BRIDGE_TEST_MODE=1` (never in production allowlist).
- CI: only `ubuntu-latest` / `windows-latest`, `permissions: contents: read`, pinned action SHAs, `timeout-minutes`, `concurrency.cancel-in-progress`, no secrets/artifacts.
- TDD: every behavioral unit shows a recorded RED before GREEN; configs are the only untested files (explicitly ordered by handoff).
- ROADMAP.md updated in same PR; `[x]` only for accepted (merged) results; M0 subitems get evidence annotations, not `[x]`, until ACCEPT + owner merge.
- Public repo hygiene: no real paths/home dirs/secrets in committed files or CI logs; fixtures only.

## Review Focus

(inputs the spec implies but that basic happy-path tests miss — each gets its test in the owning task)

1. Non-ASCII distro names in UTF-16LE `wsl.exe` output + BOM/CRLF variants → Task 4 parser test with `iconv`-built fixture incl. `Ubuntu中文`.
2. Paths with spaces / special chars in distro name, node path, bridge path → Task 8 arg-array (no shell string) test via fake-wsl argv recording.
3. Concurrent responses interleaving on bridge stdout (torn frames) → Task 6 two-concurrent-requests test asserting two complete frames.
4. Orphaned bridge on quit / client hang → Task 7 `close()` kills child and rejects pending.
5. Renderer invoking forbidden IPC methods (`exec`, arbitrary write) → Task 8 whitelist test (preload + main both reject) and Task 9 RTL test of rejected call.

---

### Task 1: Toolchain scaffold (config — explicitly ordered, no TDD)

**Files:** Create `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `scripts/build.mjs`, `src/renderer/index.html`, `.gitignore` (+`.superpowers/`, `artifacts/`), placeholder `src/renderer/App.tsx`, `src/renderer/main.tsx`.

**Interfaces:** `npm run typecheck | lint | test | test:unit | test:contract | test:ui | test:integration | test:e2e | build | start`.

- [ ] Step 1: `npm init -y`-equivalent package.json with pinned ranges (TS 5.9.3 — typescript-eslint peer `<6.1.0`); `npm install -D` full stack; lockfile committed.
- [ ] Step 2: tsconfigs (node: main/preload/bridge/shared+tests, `strict`; web: renderer DOM), eslint flat config, vitest config with projects `unit|contract|integration` (node) and `ui` (jsdom), playwright config (electron, no browser projects), esbuild+vite build script, rootless `src/renderer/index.html`.
- [ ] Step 3: Run `npm run typecheck && npm run lint && npx vitest run && npm run build` → baseline green (empty suites OK for scaffold, 0 fail).

### Task 2: Protocol contract (Zod) — contract tests first

**Files:** Create `src/shared/protocol.ts`, `tests/contract/protocol.test.ts`.

**Interfaces:**
- Consumes: nothing.
- Produces: `PROTOCOL_VERSION = 1`, `MAX_FRAME_BYTES = 1048576`, `M0_METHODS` (const tuple), `ALL_ERROR_CODES` (SPEC §7 set + `INVALID_REQUEST`, `METHOD_NOT_ALLOWED`, `PROTOCOL_ERROR`, `UNSUPPORTED_VERSION`, `CANCELLED`, `DISCONNECTED`, `QUEUE_FULL`, `UNKNOWN`), Zod `RequestFrame`, `ResponseFrame` (ok|error), `CancelFrame`, `EventFrame`, types `RequestFrameT` etc., `encodeFrame(f): string` (throws `FrameTooLargeError`), `parseFrameLine(line): {ok:true,frame}|{ok:false,reason:'invalid_json'|'schema'|'too_large'}`, `mapUnknownMethod(method): error|null`.

- [ ] Step 1: Write failing contract tests: valid request accepted; missing `requestId` rejected; `v:2` rejected (unsupported version detectable); error response accepts every `ALL_ERROR_CODES` entry and rejects `"BOOM"`; invalid JSON line → `invalid_json`; >MAX_FRAME_BYTES line → `too_large`; `encodeFrame` throws on oversize; `mapUnknownMethod('exec')` → `METHOD_NOT_ALLOWED`, `'health'` → null.
- [ ] Step 2: Run `npx vitest run --project contract` → expect RED (module not found / failing assertions); record output.
- [ ] Step 3: Implement `protocol.ts` minimal to pass.
- [ ] Step 4: Run contract project → GREEN; commit `feat(protocol): versioned zod bridge contract`.

### Task 3: NDJSON line assembler

**Files:** Create `src/main/framing.ts`, `tests/unit/framing.test.ts`.

**Interfaces:** Produces `class LineAssembler { constructor(maxLineBytes?: number); push(chunk: Uint8Array): {lines: string[]; overflow: boolean}; reset(): void }`.

- [ ] Step 1: Failing tests: chunk split mid-line across 3 pushes yields one line; CRLF stripped; two lines in one chunk; U+2028/U+2029 inside payload NOT split; empty lines dropped; line exceeding max → `overflow:true` and assembler reset (subsequent frames parse).
- [ ] Step 2: Run unit → RED recorded.
- [ ] Step 3: Implement assembler.
- [ ] Step 4: unit → GREEN; commit `feat(framing): bounded ndjson line assembler`.

### Task 4: WSL output decoding + Windows↔WSL path conversion

**Files:** Create `src/main/wslParse.ts`, `tests/fixtures/wsl-list-quiet-utf16.bin` (real capture), `tests/fixtures/wsl-list-quiet-utf16-bom-cjk.bin` (synthetic), `tests/unit/wslParse.test.ts`.

**Interfaces:** Produces `decodeWslOutput(buf: Uint8Array): string` (BOM strip; NUL-detect → UTF-16LE else UTF-8), `parseDistroList(out: string): string[]` (CRLF/LF, trim, drop empties), `windowsPathToWslPath(winPath: string, mountRoot?: string): string | null` (`F:\a\b`→`/mnt/f/a/b`, `F:/a`, `F:`→`/mnt/f`, `\\wsl$\Ubuntu\home\u`→`/home/u`, relative → null).

- [ ] Step 1: Capture real `wsl.exe -l -q` bytes to fixture; failing tests incl. Review-Focus case (UTF-16LE BOM + CRLF + `Ubuntu中文`) and path table + null cases.
- [ ] Step 2: unit → RED recorded.
- [ ] Step 3: Implement `wslParse.ts`.
- [ ] Step 4: unit → GREEN; commit.

### Task 5: Connection state machine

**Files:** Create `src/main/state.ts`, `tests/unit/state.test.ts`.

**Interfaces:** Produces `type ConnPhase = 'idle'|'discovering'|'connecting'|'ready'|'backoff'|'error'`, `type ConnEvent = {type:'DISCOVER_START'|'DISCOVER_OK'|'DISCOVER_FAIL'|'SPAWNED'|'READY'|'LOST'|'CONNECT_TIMEOUT'|'BACKOFF_DONE'|'RETRY_MANUAL'|'FATAL', error?}`, `type ConnSnapshot = {phase, attempt, lastError?, distro?}`, `initialState()`, `reduce(s, e, cfg): ConnSnapshot` with `cfg = {maxAutoAttempts:number, ...}`.

- [ ] Step 1: Failing tests: happy path idle→discovering→connecting→ready; crash from ready → backoff(attempt+1) → BACKOFF_DONE → discovering; exhausting `maxAutoAttempts` → error (auto retries stop); `CONNECT_TIMEOUT` from connecting → backoff (never stuck); `RETRY_MANUAL` from error resets attempt; fatal error → error immediately.
- [ ] Step 2: unit → RED.
- [ ] Step 3: Implement reducer.
- [ ] Step 4: unit → GREEN; commit.

### Task 6: Bridge server (runs inside WSL)

**Files:** Create `src/bridge/index.ts`, `src/bridge/probe.ts`, `src/bridge/handlers.ts`, `tests/integration/bridge.test.ts`, `tests/helpers/build.ts` (esbuild fixture builder).

**Interfaces:**
- Consumes: Task 2 frame types, `LineAssembler` (shared impl — bridge imports `src/main/framing.ts` or moved to `src/shared/framing.ts`; decision: **move to `src/shared/framing.ts`** in this task, unit test path updated).
- Produces: bridge entry `main()`; `probePi(env, spawnFn): Promise<{path, version, rpcSupported}|PI_NOT_FOUND>`; handlers map; `ready` event frame emitted first; serialized stdout writes; per-request `AbortController` + `timeoutMs` (default 10000, cap 60000); stdin EOF → exit 0; overflow → `protocol_error` event + exit 2.

- [ ] Step 1: Failing integration tests (spawn real `node` on esbuild bundle): `health` ok + matching requestId + `ready` event first; unknown method → `METHOD_NOT_ALLOWED`; invalid JSON line → `protocol_error` event then next request still served; unsupported `v` → `UNSUPPORTED_VERSION` error frame; stderr carries logs while stdout stays pure JSON (assert every stdout line parses); oversize stdin line → exit 2; `__test_slow` without env → `METHOD_NOT_ALLOWED`, with env → cancel returns `CANCELLED`, timeout returns `BRIDGE_TIMEOUT`; two concurrent requests → two complete frames (Review Focus 3); handlers never touch FS: `HOME=tmpdir` fixture unchanged after run (no-mutation proof).
- [ ] Step 2: integration → RED.
- [ ] Step 3: Implement bridge (move framing to shared).
- [ ] Step 4: integration + unit → GREEN; commit.

### Task 7: Bridge client + connection orchestration (fake WSL fixtures)

**Files:** Create `src/main/bridgeClient.ts`, `src/main/discovery.ts`, `src/main/wsl.ts`, `src/main/connection.ts`, `tests/fixtures/fake-wsl` (+modes), `tests/integration/client.test.ts`, `tests/integration/connection.test.ts`.

**Interfaces:**
- Consumes: Task 2 frames, Task 3/shared framing, Task 4 parsers, Task 5 reducer, Task 6 protocol behavior.
- Produces: `class BridgeClient { connect(); close(); request(method, params, opts?): Promise<unknown>; cancel(requestId); on('state'|'event'|'lost', cb) }` with injectable `spawn`/timers; `listDistros({wslPath, timeoutMs})`, `probeNode({wslPath, distro, timeoutMs})` (static sh probe: `$PI_WS_DESKTOP_NODE` → `command -v node` → `~/.local/bin/node` → `/usr/local/bin/node` → `/usr/bin/node`, emits one JSON line), `startBridge({wslPath, distro, nodePath, bridgeWinPath, timeoutMs})` (arg arrays, no shell); `class WslConnection { start(); retry(); selectDistro(d); request(); snapshot(); subscribe(cb) }` driving reducer + client + discovery with backoff timer.

- [ ] Step 1: Failing integration tests: fake-wsl `list` (UTF-16) → `['Ubuntu','Ubuntu中文']`; fake-wsl `hang` → discovery rejects within timeout (process killed); fake-wsl `crash` on spawn → LOST → backoff → second attempt; client vs fake bridge: request timeout → `BRIDGE_TIMEOUT` + cancel frame sent (fake records); bridge exit mid-request → pending rejected `DISCONNECTED`, subscriber got lost; oversize output line → client destroys connection; `close()` → child exits, pending rejected (Review Focus 4); connection end-to-end via fake-wsl probe+bridge modes → snapshot ready with fixture runtime info; argv recording: distro/node/bridge with spaces passed as separate args (Review Focus 2); no shell string used (`/bin/sh -c` only for static probe body).
- [ ] Step 2: integration → RED.
- [ ] Step 3: Implement client/discovery/wsl/connection.
- [ ] Step 4: integration + unit → GREEN; commit.

### Task 8: Electron shell: main, preload, IPC, settings

**Files:** Create `src/main/index.ts`, `src/main/ipc.ts`, `src/main/settings.ts`, `src/preload/index.ts`, `tests/unit/settings.test.ts`, `tests/unit/ipcWhitelist.test.ts`.

**Interfaces:**
- Consumes: `WslConnection`.
- Produces: `createWindow()` with exact security flags + navigation/open guards + CSP meta in html; `isAllowedRendererMethod(m): boolean` (Task 2 allowlist) used in preload AND ipc handler; preload API `window.piDesktop = {request, getStatus, retry, listDistros, selectDistro, onStateChange}`; `loadSettings(dir)/saveSettings(dir, patch)` (userData JSON, corrupt→defaults, atomic tmp+rename).

- [ ] Step 1: Failing unit tests: whitelist accepts 4 methods, rejects `exec`/`writeFile`/unknown; settings defaults on missing file; corrupt JSON → defaults (no throw); save→load roundtrip; atomic write leaves no `.tmp` residue.
- [ ] Step 2: unit → RED.
- [ ] Step 3: Implement settings/whitelist/ipc/preload/window (thin main; no behavior beyond flags).
- [ ] Step 4: unit → GREEN; commit.

### Task 9: React renderer UI (RTL)

**Files:** Create `src/renderer/App.tsx`, `src/renderer/api.ts`, `src/renderer/components/StatusPanel.tsx`, `src/renderer/useConnection.ts`, `tests/ui/App.test.tsx`.

**Interfaces:** Consumes preload `piDesktop` (injectable mock). Renders: phase-driven panel — connecting (spinner + step label), ready (distro, node, pi versions, uptime, protocol), error (code + message + `Повторить` button), distro `<select>` when distros present.

- [ ] Step 1: Failing RTL tests: connecting state renders step text; stuck-discovering with timers advanced → error state appears (no infinite spinner); ready renders `Pi <version>` + node version; error shows code and clicking `Повторить` calls `retry` (mock); distro change calls `selectDistro`; forbidden method promise rejection surfaces as error text, not crash.
- [ ] Step 2: ui → RED.
- [ ] Step 3: Implement renderer.
- [ ] Step 4: ui → GREEN; commit.

### Task 10: Playwright Electron E2E

**Files:** Create `e2e/app.spec.ts`, adjust `playwright.config.ts`, env hooks in `src/main/index.ts` (`PI_WS_DESKTOP_WSL_PATH`, `PI_WS_DESKTOP_TIMEOUT_MS` for tests only).

**Interfaces:** `_electron.launch({ args: [dist/main/index.cjs] })`.

- [ ] Step 1: Failing E2E: window opens; renderer has no `process`/`require` (contextIsolation proof); with fake-wsl env → reaches ready + shows fixture Pi version; error path env (nonexistent wsl path) → error state + retry clickable (covers CI where real wsl.exe absent).
- [ ] Step 2: `npm run test:e2e` → RED recorded (no app yet).
- [ ] Step 3: wire env hooks, implement spec.
- [ ] Step 4: E2E → GREEN locally (WSLg); commit.

### Task 11: CI on free runners

**Files:** Create `.github/workflows/product-ci.yml`; keep `repository-contract.yml` untouched.

- [ ] Step 1: workflow: `pull_request`+`push:main`, `permissions: contents: read`, concurrency cancel, pinned SHAs (resolve real SHAs via `gh api`), job `linux` (ubuntu-latest, node 22, `npm ci` → typecheck → lint → `vitest run` → build → `xvfb-run -a npm run test:e2e`), job `windows` (windows-latest, `npm ci` → typecheck → lint → `vitest run --project unit` → build). No secrets, no artifacts, `timeout-minutes`.
- [ ] Step 2: Validate YAML locally (python yaml parse) + confirm actions SHAs exist via `gh api`; commit `ci: product gates on standard runners`.

### Task 12: Real WSL smoke (local, env-gated) + Windows GUI smoke attempt

**Files:** Create `tests/smoke/realWsl.test.ts`, `scripts/windows-smoke.mjs`.

**Interfaces:** `REAL_WSL=1 npx vitest run tests/smoke` — real `wsl.exe -l -q`, real probe (`~/.local/bin`), real bridge, `health`+`getRuntimeInfo` (expect Pi 1.3.0, rpcSupported) + metadata no-mutation snapshot of `~/.pi/agent/{settings.json,trust.json,auth.json}` before/after.

- [ ] Step 1: Run smoke locally → record PASS/FAIL (this is the real-WSL evidence for the PR).
- [ ] Step 2: Windows GUI smoke: build win32 Electron binary into `artifacts/` (gitignored), launch app on Windows via interop with `PI_WS_DESKTOP_SMOKE_REPORT` file, read back report → PASS; if blocked (download/launch/display) → record NOT RUN with exact reason. No Windows installer, no system changes.

### Task 13: Docs, ROADMAP sync, PR

**Files:** Modify `ROADMAP.md`, `README.md` (status line), `.gitignore` if needed.

- [ ] Step 1: ROADMAP: Bootstrap row → ✅ accepted (PR #3 merged) + both org checkboxes `[x]` (merged = accepted evidence); M0 row → 🟡 на ревью (PR #N); M0 checkboxes stay `[ ]` with evidence annotations «выполнено в PR #N, ожидает ACCEPT» (ruling: rule 3 forbids `[x]` on open PR); journal rows for PR #3 merge + M0 submission.
- [ ] Step 2: Full suite green (typecheck, lint, vitest all projects, build, e2e), capture exact numbers; `git diff --stat` totals.
- [ ] Step 3: Whole-branch review via fresh-context subagent (`review-package` + code-reviewer brief); fix Critical/Important with RED→GREEN one pass.
- [ ] Step 4: Push branch, open PR with AGENTS §7 report (files, +/-, test matrix, smoke status, skills inventory, risks, rollback). **No merge.**
