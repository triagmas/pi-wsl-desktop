---
name: pi-desktop-review
description: Independently review a Pi WSL Desktop Lite PR or source change for product scope, security, TDD evidence, CI and Windows+WSL acceptance. Use before owner merge authorization or when asked to assess a PR.
---

# Pi Desktop — независимое ревью

1. Читай текущие Issue/PR, `AGENTS.md`, `PRODUCT.md`, `SPECIFICATION.md`, base/head SHA, реальный diff и изменённые тесты. Не считай описание PR независимым доказательством. Review должен выполнять агент с **новым контекстом**, отдельно от исполнителя.
2. Проверь scope продукта и инварианты Pi↔WSL, доверие ресурсов, отсутствие переноса истории/конфигураций, безопасность процессов и секретов. Для каждого риска укажи конкретный путь/строку, сценарий и тяжесть `BLOCKER / IMPORTANT / MINOR`.
3. Сверь TDD RED→GREEN: какой тест падал до фикса, негативные кейсы, отсутствие ложных PASS. Проверь реальный HEAD против CI run SHA; старый CI не засчитывать за новые commits.
4. Проверь typecheck/lint/build/Vitest/E2E и Linux/Windows hosted CI в том объёме, который требует уровень ([V/F/B/R](../../../docs/development/quality-gates.md#fast-development-уровень-qa-выбирается-до-начала-работы)) и точка входа: на pre-merge/release — полный релевантный набор + отдельный Windows+WSL smoke; на локальном пакете — адресные проверки, а что не проводилось — `NOT RUN`, без выдуманных чисел и без требования полного прогона ради формальности.
5. Проверь `ROADMAP.md`, ссылку на Issue, признаки owner approval, соблюдение consent на model call/real writes; считай полный diff `+/-` строк, включая число при merge.
6. Итог: `ACCEPT`, `CHANGES REQUIRED` или `BLOCKED`. Укажи HEAD, найденные проблемы, evidence, оставшиеся риски и конкретный следующий шаг. **Review не выполняет merge и не заменяет разрешение владельца.**

Для review/security всегда target thinking `high` и компетентная независимая модель. Не проводить несколько одинаковых ревью ради формы; повторять после существенной дельты.