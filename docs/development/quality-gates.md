# Quality Gates / доказательное качество кода

Статус: **Q1 Draft / NOT ACCEPTED**, координация [Issue #35](https://github.com/triagmas/pi-wsl-desktop/issues/35). Это не замена `AGENTS.md`, `SPECIFICATION.md` и `ROADMAP.md`.

## Без новых платных подписок

- Новый Q1: GitHub CodeQL для `javascript-typescript` на публичном репозитории; стандартные GitHub-hosted runners и встроенные GitHub Code Scanning alerts. Нет LLM, API-ключей, регистрации в SaaS и доступа к пользовательскому Pi.
- Существующие: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, Windows installer/packaged smoke, `prek` и Repository Contract. **Не дублировать** тестовые запуски в Q1.
- CodeRabbit/другие GitHub Apps: **не установлены этим PR**. Установка и доступ к коду требуют отдельного решения владельца. Бесплатные квоты не означают отсутствие передачи данных третьей стороне.
- Подписки/модельные лимиты Pi не используются. Реальные вызовы AI запрещены без отдельного разрешения владельца по `AGENTS.md`.

## Q1 — CodeQL (пилот)

Файл: [`.github/workflows/quality-codeql.yml`](../../.github/workflows/quality-codeql.yml).

Запуск на PR к `main`, push в `main` и вручную (`workflow_dispatch`). Право `security-events: write` требуется только этому workflow для загрузки результатов CodeQL; остальные полномочия минимальные. GitHub Actions закреплены по commit SHA. Платформозависимые Windows/WSL smoke здесь **не запускаются**.

**Перед merge** владелец/ревьюер должен проверить в настройках GitHub Code Security, что **CodeQL Default Setup** не включён параллельно с Advanced Setup: иначе анализы могут дублироваться. Доступа к этому разделу через текущий read-only GitHub-коннектор нет, статус **UNKNOWN**, а не PASS.

Проверка Q1 на GitHub:
1. Открыть Draft PR; посмотреть `Quality - CodeQL / CodeQL - JavaScript/TypeScript`, `Product CI` и `Repository Contract`.
2. Зафиксировать SHA и конкретные статусы всех jobs: PASS / FAIL / SKIP / NOT RUN. Для проблем с разрешениями на Code Scanning — не обходить их, открыть блокер.
3. Просмотреть Code Scanning findings, классифицировать новые actionable vs false positive, указать путь, строку, severity и remediation.
4. Независимый review, затем только **отдельное явное разрешение владельца** на merge. Workflow не включает auto-merge и не меняет required checks/branch protection.

## Q2 — архитектура (ещё не реализована)

Пилот `Knip` и `dependency-cruiser` в **report-only**: сначала установить фиксированные версии с обычной процедурой `npm install -D`, коммитить lockfile, измерить число реальных находок и ложных срабатываний для dynamically loaded modules. Только после согласования правил сделать blocking gate. Архитектурный критерий: renderer не должен импортировать привилегированные `main`/`bridge`/`node:` модули; контракт IPC/Preload сохраняется. Проверять также циклы; не запрещать обоснованные `shared` типы.

## Q3 — проверка качества тестов/UI (ещё не реализована)

`Stryker` только на ограниченном критичном модуле (history merge / IPC / session safety), замерить mutation score, время и flaky tests; не включать полный mutation-run в каждый PR без измерений. `Playwright` screenshot regression после утверждения эталона владельцем, с фиксированными DPI, ОС, шрифтами и состояниями. `axe-core/playwright` — accessibility, но не замена визуальной приёмки.

## Q4 — оценка Harness² (отдельный пакет, ещё не реализован)

10–15 повторяемых задач; запись `task_id`, базовый SHA, модель/provider, available Skills, токены, число tool calls, correctness, permission violations и evidence. Сравнение с baseline при **той же** модели и бюджете; запрещено выдавать self-review за независимую приёмку. Бесплатный eval-runner или promptfoo Community допустимы только после оценки стоимости внедрения. Никаких дополнительных платных API.

## Политика результата

Каждый gate обязан сообщать: **какой риск он реально покрывает**, набор файлов, baseline, measured runtime, найденные дефекты, false positives и rollback. Отсутствие проверки = `NOT RUN`, а не `PASS`. CI не подтверждает качество реального Windows+WSL интерфейса или безопасность при любых сценариях.
