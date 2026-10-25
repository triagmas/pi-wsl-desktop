# Plan: UI21 Phase D1 — Isolated Design Lab (owner process correction)

Owner instruction: Issue #21 comment `6384439455` (2026-10-24). Design-first, functional
integration later. PR #23 stays OPEN and merge-BLOCKED. Deliverable NOW = D1 only.

Branch: `design-lab-d1` (from `origin/main` @ `53dc9c0`). NOT PR #23 branch, NOT main.

## Scope (D1 only)

1. Dev-only preview entrypoint `design-lab/` (index.html, main.tsx, fixtures.ts,
   capture.mjs, fonts.conf, README.md) + `npm run design` (Vite dev server, browser,
   localhost) — no Electron, no Pi, no WSL bridge, no model calls, no user `~/.pi`,
   no real IPC.
2. Reusable presentational layer that Desktop will render later (NOT a parallel mock):
   - `src/renderer/ui/{AppFrame,TitleBar,Sidebar,ChatView,DetailsPanel,ResourcesScreen,
     SettingsScreen,StatusBar,TerminalPane}.tsx` — pure props in, JSX out.
   - `src/renderer/design/{layout,components,typography}.css` + `theme-{dark,light}.ts`
     (already stubbed) — all colors via `--pw-*` tokens from `shared/design/presets`
     (immutable Issue §1 palettes), geometry via CSS custom properties.
3. Deterministic fixture props for: navigation/projects/sessions, populated chat with
   Markdown + tool/step cards, Settings (5 themes, 8 typography zones), resource rows,
   static terminal lines, static statusbar strings — all labeled DEMO/fixture, no real
   Pi data, no writes.
4. Six reference states rendered 1:1 from Issue #21 comment `6344296243`
   (`/tmp/d1/refs/ref{1..6}.png`, all inspected — no BLOCKED_REFERENCE):
   | ref | state |
   |---|---|
   | 1 | dark, chat, collapsed rail (+tooltip), details panel, no terminal |
   | 2 | dark, chat, expanded sidebar, no details |
   | 3 | dark, Resources/Skills, expanded sidebar |
   | 4 | light, chat, expanded sidebar |
   | 5 | dark, chat, rail + details + terminal under composer + statusbar |
   | 6 | light, Resources/Skills, expanded sidebar |
5. Capture screenshots from the Design Lab (Playwright chromium, dev tool wired ONLY
   into `design-lab/capture.mjs`, not CI/tests): 6 states × viewport sets
   1586×992 (reference-native, labeled), 1440×900 (baseline), 1280×800, 1024×768.
   Honest labels — no fake resolutions.
6. Comparison document `docs/ui/design-lab-comparison.md`: reference vs actual
   side-by-side per state, measured geometry table, explicit "still visually off" list.
7. Report in Issue #21: run command, file paths, preview URL, screenshot artifacts,
   stop point for OWNER visual acceptance (D2 loop). NO merge. NO new infrastructure.

## Geometry extracted from references (ref px @ 1586×992)

- Titlebar (inline variant, ref2/3/4/6): h=62+1px border, wordmark x26, breadcrumb,
  window controls right (x1426..1559).
- Titlebar (split variant, ref1/5): h=50+1, then toolbar row h=63 (rail toggle x16..69,
  breadcrumb x259.., actions, details header x1155..).
- Rail: w=70 (icon rows y: 141,196,252 top; 758,815,872 bottom; dot 932).
- Sidebar: w=356 (border x356). newchat (24,67)-(333,119) h52; search (24,136)-(332,185)
  h49; ПРОЕКТЫ y218; project row y262; active session row x≈16..340 y305..355 r8;
  sessions y365/421 icon x78 text x120; projects Личный/Заметки y478/534 icon x35
  text x74; divider ~y709; nav y736/789/844 icon x36 text x81; connection dot y917,
  "Ubuntu · WSL" y943.
- Details panel: x1125..1586 w=461, border x1124. tabs y142 (Обзор x1155, Файлы x1255),
  underline y177 h4 w59; pill (1155,215)-(1301,250); h2 y275; subtitle y314;
  divider ~y346; label y391; file rows y436/486/538 (icon x1164, name x1213);
  divider ~y596; label y628; check rows y671/720; footer y907.
- Resources (ref3): content left x401; h1 y104..144; subtitle y145..175; tabs y195..254
  underline y246; search (401,278)-(879,328) w478 h50; select x880..1071; install
  (1306,277)-(1555,329) w249 h52; meta y345; rows pitch 94 from y390; icon box ~80;
  title x497; badge x1113..1199; "Подробнее" x1389..1472; "…" x1522; footer y934.
- Chat (ref2): bubble (985,101)-(1525,183) right-aligned; avatar (442,210)-(495,263) 53px;
  "Pi" x515 y229; body x540 rows 270/305; steps circles x545 w22, rows 365/415/465;
  Готово x514 y540; bullets y578; actions y705 (copy x516, retry x733);
  composer (380,811)-(1559,959) h148; placeholder y837; model chip (461,889)-(585,925);
  context x605..728; send (1497,879)-(1551,931); hint y954 x765..1112 centered.
- ref1 chat: bubble (578,147)-(1103,228); composer (90,823)-(1105,952); placeholder y850;
  model row y908; NO hint below.
- ref5: composer ≈ y607..697; grip y694..713 centered; tab bar y711..760; terminal body
  y760..942; statusbar y943..992 h~50 bg (26,28,24)≈statusBarBackgroundColor dark.
- Colors measured: dark bg (31,33,30)≈#20221F ✓; sidebar (24,26,23)≈#191C19 ✓;
  surface (41,44,39)≈#2A2E29 ✓; active row (46,55,45)≈selectedBackgroundColor ✓;
  tab underline (105,135,108)≈accentActiveColor #6A8770 ✓; light newchat (104,128,106)
  ≈light accent #65816D ✓; **dark primary buttons ≈(76,98,77)..(89,113,90) — DARKER than
  token #78957C (alpha≈0.55-0.65 over bg)** → render via tokens, report as known visual
  delta (palette change = owner decision; presets immutable + tested).

## Steps

1. ✅ Recon: all 6 refs opened & measured; presets/typography/responsive contracts read.
2. Write design CSS: `layout.css` (frame grid, variants, breakpoints ≤1100 hide details,
   ≤800 rail — mirror existing behavior), `components.css`, `typography.css`.
3. Write `src/renderer/ui/*` presentational components (pure props; no api/bridge import).
4. Write `design-lab/` entry + vite config + `npm run design` script + tsconfig.web
   include for design-lab (config change, TDD-exempt) + fonts.conf (Segoe UI from
   /mnt/c/Windows/Fonts for honest Windows-like rendering) + README (DEMO labeling).
5. Gates: `npm run typecheck`, `npm run lint`, `npm run build` (fast). NOT RUN: full
   Vitest 637, Electron E2E, installer, CI, paid prompts — per owner D1/D2 instruction.
6. Start dev server; `design-lab/capture.mjs` screenshots 6 states × 4 viewports.
7. Build side-by-side composites (PIL) → `/mnt/f/_tmp/d1-*.zip`; write
   `docs/ui/design-lab-comparison.md` (per-state deltas, honest "still off" list).
8. Commit(s) on `design-lab-d1`, push branch (no PR merge), report Issue #21, STOP —
   owner personal visual verdict gates D2.

## Out of scope / guards

- No edits to `shell/*`, `App.tsx`, `index.css`, bridge/main/preload, tests, CI.
- No merge of PR #23 or PR #20; no UI-B/PTY/metrics; no Dashboard; no real install.
- No independent subagent review for pure visual edits (owner D1/D2 explicit); visual
  acceptance = owner personally. Merge forbidden without owner approval.
