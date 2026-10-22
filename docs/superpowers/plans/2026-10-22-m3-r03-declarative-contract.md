# M3 R03 — декларативный контракт: panel, actions, capabilities, версии зависимостей

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** расширить декларативный контракт модулей так, чтобы панели, действия и зависимости были управляемы явно, а объявленные capabilities давались только реально доступные.

**Architecture:** контракт в `src/shared/m3Protocol.ts` (Zod, node-free) → чистый реестр `src/renderer/modules/registry.ts` (fail-closed) → общий рендер в `src/renderer/ModuleTabView.tsx` / `ModulesView.tsx`. Никаких новых IPC, загрузчиков произвольного JS или правок ядра на модуль.

**Tech Stack:** TypeScript, Zod, Vitest (unit/contract/UI), React Testing Library, Playwright/Electron.

**Spec:** `SPECIFICATION.md` §5 (модуль объявляет id/version/apiVersion/UI/capabilities/dependencies/params; ядро даёт `sessions|runtime|resources|notifications|settings`; произвольный JS не обязателен для 1.0), `PRODUCT.md` §3.4 (панели, действия через опубликованный контракт), GitHub Issue #10.

## Global Constraints
- Работа только в `/mnt/f/_hermes/CODE/pi-wsl-desktop`, ветка `feat/m3-module-system-r01`, PR #11. Без merge, force-push и изменений `main`.
- Не менять `~/.pi`, провайдеры, API-ключи, расширения Pi, пользовательские сессии.
- Никаких model-call/prompts при тестах Desktop; фикстуры синтетические.
- Обратная совместимость: существующие манифесты R01/R02 (без `actions`, с `dependencies: string[]`) обязаны парситься без изменений.
- Публичный GitHub: без секретов, приватных путей, provider-идентификаторов.

## Review Focus
- Объявление capability ≠ выданное разрешение: модуль с capability, которой ядро не предлагает, обязан стать `incompatible` и не получить UI.
- Неизвестная операция действия должна отказываться fail-closed в видимую ошибку, а не пробрасываться в dispatch или молча исчезать.
- Обратная совместимость старых манифестов (string-зависимости, отсутствие `actions`) — регрессия контрактных тестов R01/R02.
- Панель не должна дублировать вкладку по `tabKey`/React-key и не должна рендериться для `disabled/blocked/invalid/incompatible`.
- Проверка версии зависимости: диапазон, которого нет в реестре, и диапазон, неудовлетворённый версией провайдера — оба fail-closed.

---

### Task 1: Контракт — operations whitelist, actions, версии зависимостей

**Files:**
- Modify: `src/shared/m3Protocol.ts`
- Test: `tests/contract/m3Protocol.test.ts`

**Interfaces:**
- Produces: `MODULE_OPERATIONS` (as const, явно разрешённые операции), `ModuleOperation`, `ModuleActionSchema`/`ModuleAction`, `ModuleDependencySchema` = `{ id, range }`, `dependencies` принимает и строку, и объект; `satisfiesSemverRange(version: string, range: string): boolean`.

- [ ] **Step 1: RED** — контрактные тесты: (a) манифест с `actions: [{id,title,operation:'openTab'}]` парсится; (b) `operation:'dropDatabase'` → ошибка `manifest`; (c) `dependencies: ['demo']` (строка, R01-формат) парсится как раньше; (d) `dependencies: [{id:'demo',range:'^1.0.0'}]` парсится; (e) `{id:'demo',range:'nonsense'}` → ошибка; (f) `satisfiesSemverRange('1.2.3','^1.0.0')===true`, `('2.0.0','^1.0.0')===false`, `('1.2.3','1.2.3')===true`, `('1.2.4','1.2.3')===false`.
- [ ] **Step 2: run** → ожидается FAIL (нет `MODULE_OPERATIONS`, нет `satisfiesSemverRange`).
- [ ] **Step 3: implement** — `MODULE_OPERATIONS = ['openTab','openPanel','refresh','copyText'] as const`; `ModuleActionSchema = z.object({id: slug, title: 1..80, operation: z.enum(MODULE_OPERATIONS)})`; `ModuleDependencySchema = z.object({id: ModuleIdSchema, range: z.string().min(1).max(64)})`; `dependencies: z.array(z.union([ModuleIdSchema, ModuleDependencySchema])).default([])`; `satisfiesSemverRange` поддерживает `*`, `X.Y.Z`, `^X.Y.Z`.
- [ ] **Step 4: run** → ожидается PASS, регрессия всего контрактного файла.
- [ ] **Step 5: commit.**

### Task 2: Реестр — панели, реальные capabilities, версии зависимостей

**Files:**
- Modify: `src/renderer/modules/registry.ts`
- Test: `tests/unit/moduleRegistry.test.ts`

**Interfaces:**
- Consumes: `ModuleAction`, `ModuleDependencySchema`-выход, `satisfiesSemverRange`.
- Produces: `HOST_CAPABILITIES: readonly ModuleCapability[]` (что ядро реально предлагает), `resolveCapabilities(declared, available): {granted, missing}`, `modulePanels(entries): ModuleTab[]` (kind `'panel'`, tabKey `${id}/${ui.id}`), `moduleActions(entry): ModuleAction[]`; `ModuleEntry.actions: ModuleAction[]`; причина ошибки формата `capability "X" is not provided by the host` и `dependency "id" requires <range>, found <version>`.

- [ ] **Step 1: RED** — unit: (a) объявление `notifications`, которого нет в available → `incompatible`, вкладок/панелей нет, ошибка про host; (b) все capabilities доступны → `enabled`, granted = declared; (c) `modulePanels` отдаёт только `kind==='panel'` и только `enabled`, с `tabKey` `${id}/${ui.id}`; вкладки при этом не дублируются; (d) зависимость с неудовлетворённым диапазоном → `blocked` с версией провайдера в ошибке; (e) зависимость `^1.0.0` при провайдере `1.4.0` → блокировки нет; (f) actions модуля читаются из манифеста.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** — нормализация `dependencies` к `{id,range}`; capability-проверка до/при регистрации (fail-closed); `modulePanels`; хранение `actions` в `ModuleEntry`.
- [ ] **Step 4: run** → PASS + регрессия unit/contract.
- [ ] **Step 5: commit.**

### Task 3: UI — панели и действия через общий контракт

**Files:**
- Modify: `src/renderer/App.tsx`, `src/renderer/ModulesView.tsx`, `src/renderer/ModuleTabView.tsx` (или новый `ModulePanelView.tsx`)
- Test: `tests/ui/m3Modules.test.tsx`

- [ ] **Step 1: RED** — UI: (a) модуль с `kind:'panel'` показывает панель в разделе «Модули» (или отдельной области) с `data-testid="module-panel-<id>/<uiid>"`; (b) панель отключённого модуля исчезает; (c) действия модуля дают кнопки `data-testid="module-action-<id>/<actionId>"`; (d) клик по действию `openTab`/`refresh` не бросает и не роняет приложение; (e) модуль с недоступной capability не получает ни вкладки, ни панели.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** — `modulePanels()` в раздел «Модули» (или под навигацией), рендер через общий блочный контракт + `ModuleErrorBoundary`; действия кнопками с dispatcher, который принимает только `MODULE_OPERATIONS`; неизвестная операция → видимая ошибка, без throw.
- [ ] **Step 4: run** → PASS + регрессия UI.
- [ ] **Step 5: commit.**

### Task 4: Полная верификация и ревью

- [ ] typecheck / lint / полный Vitest (Linux Node) / build / CI на финальном HEAD.
- [ ] Один независимый fresh-context review (thinking high); Critical/Important — закрыть до приёмки.
- [ ] Синхронизация ROADMAP (без `[x]` до решения владельца) + отчёт в PR #11.
