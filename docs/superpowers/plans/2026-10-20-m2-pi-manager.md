# План: M2 — Pi Resource Manager (Pi WSL Desktop)

**Issue:** [#7](https://github.com/triagmas/pi-wsl-desktop/issues/7) · **PR:** [#8](https://github.com/triagmas/pi-wsl-desktop/pull/8) (Draft, продолжаем) · **Ветка:** `feat/m2-pi-manager-r01` · **Base:** `main 6b3b9c0` (M1 merged)

**Authority:** установленная Pi 1.3.0 — `pi --help`, `pi list/install/remove/update/mcp --help`, её же доки `docs/{packages,mcp,skills,settings,extensions}.md`. Не выдумывать API.

## Предусловия (выполнены / в работе)
- P2#2/P2#3 (symlink/readTail) уже в ветке с RED→GREEN и зелёным CI; **независимое security-review** — диспатч (класс C), его находки закрываются до T1 (см. R1).
- Нативные смоуки: `scripts/m2-bridge-smoke.mjs` (WSL, синтетический корень) — PASS 11/11; `scripts/windows-smoke.mjs` — PASS.

## Ключевые решения (по докам 1.3.0)
- **Пакеты:** `settings.packages` (string|object с фильтрами ресурсов), scopes user (`~/.pi/agent/settings.json`) / project (`.pi/settings.json`, после trust); CLI `pi list` (read-only вывод «User packages: source → path»), `pi install <src> [-l]`, `pi remove`, `pi update [--extensions|--extension <src>|…]`.
- **Skills:** discovery — `settings.skills`, `~/.agents/skills/`, `.agents/skills/` (ancestors до repo root), conventional `skills/` + `pi.skills` манифеста пакета; `SKILL.md` + frontmatter (`description`, `disable-model-invocation`); коллизии имён = первая + warning; включение/выключение — `skills` array (`+path`/`-path`/`!glob`), `enableSkillCommands`.
- **MCP:** конфиги `~/.pi/agent/mcp.json` + `.pi/mcp.json` (после trust, project переопределяет по имени); **`pi mcp list` КОННЕКТИТСЯ к серверам (спавнит child-процессы) — в менеджере по умолчанию ТОЛЬКО парсинг конфигов; запуск `pi mcp list`/`login/logout/add/remove` — отдельно подтверждённая операция**; креды (`mcp-auth.json`) не читать/не показывать; диагностика — схема-ошибки конфига, bounded tail `mcp.log` (только level/счётчики).
- **builtin:** `builtin:mcp|llama.cpp|codemode|tool-search`, отключение `-builtin:<name>` в `extensions`.
- **Записи:** двухфазные — `previewResourceOp` (command + файл-изменения + backup-путь) → `applyResourceOp{planId, confirm}`; backup/rollback; **без подтверждения владельца в реальные `~/.pi` НЕ пишем** — все тесты/смоуки на изолированных HOME/фикстурах; секреты (env/headers/tokens в mcp add) не логируются и не возвращаются в UI-отчёты.
- **Паритет CLI:** интеграционный тест «менеджер == `pi list` на том же изолированном HOME»; write-паритет — `pi install ./local` (offline, fixture HOME).

## Задачи (TDD: RED → GREEN, коммит на задачу)
- **R1** — закрытие находок security-review P2#2/P2#3 (если есть): RED-регрессия → фикс → GREEN; угроза `openSession` TOCTOU: lstat-проверка перед spawn + честная документация residual race.
- **T1** `src/shared/m2Protocol.ts` — Zod-схемы: `SkillInfoT`, `PackageInfoT`, `McpServerInfoT`, `ResourceOpPlanT`; методы `listSkills/listPackages/listMcpServers/previewResourceOp/applyResourceOp` + whitelist-расширение. RED: contract-тест.
- **T2** `src/bridge/resources/skills.ts` — discovery (settings/skills, `.agents/skills` ancestors, пакетные conventional-пути), frontmatter-парсер, состояния (presence/source/declared/disabled/`disable-model-invocation`), коллизии, diagnostics. Unit + fixture-integration (вкл./выкл. через `-path` в fixture settings).
- **T3** `src/bridge/resources/packages.ts` — settings.packages (user/project), резолв install-путей (npm/git/local), presence, filters, builtin extensions отдельным списком. Unit + **CLI-parity integration**: менеджер против реального `pi list` на изолированном HOME (+ `pi install ./fixture` → список растёт, settings только в fixture).
- **T4** `src/bridge/resources/mcp.ts` — парс mcp.json (user+project), валидация имён/полей, builtin-mcp state, redacted-diagnostics (mcp-log tail уровни), **никаких коннектов**. Unit (fixtures: валидный/битый/переопределение/секретные поля — redaction).
- **T5** `src/bridge/resources/ops.ts` — двухфазный plan/apply/rollback: backup settings/mcp.json → CLI `pi install/remove/update/mcp add/remove` (env-hook `PI_WS_DESKTOP_PI`) → verify → rollback-восстановление. Unit (fake spawn) + integration (реальный `pi install ./local` в fixture HOME, offline) + negative (reject без confirm, plan-истёк, backup-восстановление).
- **T6** `src/bridge/handlers.ts` — wiring + env-hook `PI_WS_DESKTOP_AGENT_HOME` (изоляция ресурсов в тестах/E2E), недоступный/битый каталог → fail-closed диагностика. Bridge-integration.
- **T7** preload/ipc whitelist (read + write-методы с осознанным комментарием) · renderer `ResourcesView` (вкладки Skills/Extensions/MCP, detail, confirm-модалка с точной командой и backup/rollback), `App`-таб Ресурсы. UI-тесты (inert-контент, redaction, отклонённый confirm не пишет).
- **T8** E2E: ресурсная вкладка на fixture agent-home (env-hook), write-цикл с подтверждением на fixture, отказ без подтверждения. + M0/M1-регрессия.
- **T9** приёмочные прогоны: полный Vitest, typecheck/lint/build, E2E, GitHub CI; **реальные Windows+WSL smoke**: `m2-bridge-smoke` (расширенный: skills/mcp/pack inventory на синтетическом agent-home, sha256/mtime) + `windows-smoke.mjs` + read-only инвентарь РЕАЛЬНОЙ машины (только счётчики/пути, без секретов).
- **T10** ROADMAP (M2-пункты с числами, чекбоксы `[ ]` до ACCEPT) + тело PR #8 (не снимать Draft) + отчёт по шаблону AGENTS §7.

## Приёмка
- 7 TDD-гейтов Issue #7 (inventory/scope/provenance/status · write confirmation · safety/rollback · CLI parity · no real writes without consent · tests · real smoke).
- Merge не выполнять; Draft до independent ACCEPT; write-упражнение против реального `~/.pi` — только отдельное разрешение владельца (NOT RUN).

## Appendendum (round 9): backups lifecycle — N5 minimal contract

- **Расположение:** `<agentDir>/pi-ws-desktop-backups` — собственные снапшоты `settings.json`/`mcp.json` (могут содержать env-токены MCP → каталог чувствителен).
- **Permissions:** каталог `0700`, файлы `0600` (best-effort chmod; на Windows mode-биты не авторитетны — контракт ACL-семантики, раскрыто).
- **Retention:** на каждом входе (preview/rollback) — prune только файлов, которые (а) **не ссылается** ни одна живая preview/applied-запись и (б) старше **7 дней** (mtime). Конфликтный rollback **сохраняет** запись → его restore point защищён от prune (до eviction ledger-cap + retention).
- **Границы:** prune строго внутри каталога backups — пользовательские settings/sessions не трогаются.
- **Referenced vs side-снапшоты (уточнение после review):** только `backupPath`-копии, на которые ссылается живая preview/applied-запись, защищены от prune. Side-снапшоты `.preunlink`/`.prerestore` в запись не включаются и живут **по retention (7 дней)** — в т.ч. единственная копия post-apply байтов (`.prerestore`) после чистого rollback и копия rival-байтов (`.preunlink`) после unlink-rollback. Для конфликтного rollback запись сохраняется → её `backupPath`-restore point защищён.
- **Production-задел (Issue #9, все 5 тем):** (1) glob-verify — `verified:true` только при однозначном подтверждении + GUI «неопределённо»; (2) `pi --session` path-TOCTOU; (3) OAuth вне GUI; (4) fd-based/locked writes (закрытие остаточных окон); (5) production-lifecycle backups: шифрование каталога (env-секреты в копиях), UI-браузер восстановлений, защищённый user-decision flow сверх ledger-cap.
