# Pi WSL Desktop

> **Лёгкий Windows-клиент для существующего Pi Coding Agent внутри WSL.**
>
> Одно окно для проектов, чатов, сессий, Skills, Extensions и MCP. Без собственной реализации Pi, копирования сессий или второй конфигурации.

**Текущий статус:** M0 ([PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4)), M1 ([PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6)) и **M2 Pi Manager ([PR #8](https://github.com/triagmas/pi-wsl-desktop/pull/8)) приняты и слиты** (`main` `6107f959`). M3 Module System готовится — [Issue #10](https://github.com/triagmas/pi-wsl-desktop/issues/10); остаточные риски M2 — [Issue #9](https://github.com/triagmas/pi-wsl-desktop/issues/9). Актуальная приёмка — [ROADMAP.md](ROADMAP.md).

## Документация

| Документ | Назначение |
|:--|:--|
| 📘 **[PRODUCT.md](PRODUCT.md)** | Продукт, пользовательские сценарии, границы и этапы M0–M4 |
| 🗺️ **[ROADMAP.md](ROADMAP.md)** | **Актуальный прогресс:** чекбоксы задач, статусы, принятые PR, история выполнения |
| 🛠️ **[SPECIFICATION.md](SPECIFICATION.md)** | Архитектура, контракты Windows ↔ WSL, интеграция с Pi, критерии приёмки |
| 🤖 **[AGENTS.md](AGENTS.md)** | Правила Pi, применимые Skills, TDD, выбор усилия модели, отчёты и ревью |
| 💸 **[TOKEN_EFFICIENCY.md](docs/TOKEN_EFFICIENCY.md)** | Экономия токенов Pi: модели/effort, компактный контекст, измерения, границы безопасности |
| ⚖️ **[LICENSE](LICENSE)** | Лицензия собственного кода |

## Принцип работы

```mermaid
flowchart LR
    UI["Windows Desktop<br/>Electron + React"]
    BR["WSL Bridge<br/>постоянный процесс"]
    PI["Pi в Ubuntu<br/>RPC / SDK"]
    STATE[("Оригинальные сессии,<br/>настройки и ресурсы")]
    UI <-->|"IPC · поток событий"| BR
    BR <-->|"CLI / RPC"| PI
    PI <--> STATE
```

Windows-клиент — **интерфейс**. Исполнение Pi, Skills, Extensions и MCP остаётся **внутри выбранного WSL-дистрибутива**.

## Roadmap

| Этап | Результат |
|:--|:--|
| **M0 — Foundation & WSL Bridge** | Надёжное подключение к установленному Pi и диагностика |
| **M1 — Sessions & Chat** | История всех обнаруженных проектов, чтение и продолжение сессий |
| **M2 — Pi Manager** | Управление Skills, Extensions, MCP и настройками внутри WSL |
| **M3 — Module System** | Версионированные интерфейсы модулей и подключаемые панели |
| **M4 — Desktop 1.0** | Стабилизация, Windows-сборка, тесты, выпуск |

**Актуальные статусы каждого этапа, все выполненные задачи и доказательства:** [ROADMAP.md](ROADMAP.md). Структура этапов — в [PRODUCT.md](PRODUCT.md#7-дорожная-карта). Реализация ведётся **крупными тематическими PR**, проходит TDD, Vitest/React Testing Library/Zod, Playwright/Electron и отдельную реальную Windows+WSL-приёмку.

## Границы проекта

- **Не является** официальным приложением Pi Coding Agent.
- Не использует код `justhil/pi-app` на старте — это независимая реализация GUI; технические идеи не подразумевают копирования исходников.
- Не зависит от VoiceForge, Hermes или ChatWake.
- Не включает встроенную IDE, голосовые функции, Git Review, мобильный клиент и собственный MCP-клиент.

## Процесс разработки

**Pi** разрабатывает и применяет все доступные **релевантные Skills**, **независимый ревьюер** проверяет PR, **владелец продукта** утверждает merge. Для снижения токенов действуют [профили сложности и протокол измерений](docs/TOKEN_EFFICIENCY.md); `AGENTS.md` не меняет автоматически уровень модели. Каждый принятый результат отмечается в `ROADMAP.md` с GitHub-доказательством; несогласованный прогресс блокирует принятие PR. Авторитетные решения закрепляются в корневых MD-документах и GitHub Issues.

**Публичный GitHub:** два уровня проверки. [Repository Contract CI](.github/workflows/repository-contract.yml) — только документация и правила учёта (принят в PR #3). [Product CI](.github/workflows/product-ci.yml) — реальные `typecheck` / `lint` / Vitest (unit, contract, integration, UI) / сборка / Playwright Electron E2E на стандартных бесплатных `ubuntu-latest` и `windows-latest` без секретов. Реальный Windows+WSL smoke остаётся отдельным ручным гейтом и никогда не подменяется зелёным CI.

**M0, M1 и M2 приняты.** Оригинальные Pi-сессии остаются по месту; просмотр истории read-only, Pi RPC resume только по действию пользователя. **M2** добавил менеджер Skills, Packages/Extensions, MCP и подтверждаемые операции с резервными копиями (интеграционный smoke выполнялся только на синтетических ресурсах). Реальный write/model prompt в пользовательской `~/.pi` **NOT RUN** и требует отдельного разрешения. Для M3 см. [Issue #10](https://github.com/triagmas/pi-wsl-desktop/issues/10), для остаточных рисков M2 — [#9](https://github.com/triagmas/pi-wsl-desktop/issues/9).

---

**Технологии (план):** Windows 11 · WSL2 · Ubuntu · Node.js / TypeScript · Electron / React · Pi CLI RPC / SDK.