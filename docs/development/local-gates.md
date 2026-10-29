# Быстрые локальные гейты (`prek`)

`prek` — оркестратор pre-commit хуков (совместим с форматом
`.pre-commit-config.yaml`). Здесь он закрывает быстрые проверки **до** push;
полный набор остаётся в CI и `prek` его не заменяет.

## Установка

```bash
uv tool install prek         # изолированно, без глобального pip
# либо разово, без установки:
uvx prek --version

prek install                 # включить git-хук pre-commit в этом checkout
```

Проверенная версия: **prek 0.5.7** (Node.js ≥ 22 и `npm` должны быть в `PATH`;
хуки используют `language: system`, поэтому ничего не скачивают при запуске).

## Что запускается

`.pre-commit-config.yaml` содержит четыре локальных хука:

| Хук | Что делает | Область |
|---|---|---|
| `eslint` | `npx eslint` по staged `*.ts`/`*.tsx` | только staged файлы |
| `typecheck` | `npm run typecheck` (оба tsconfig) | проект целиком |
| `electron-dist-platform` | сверяет локальную сборку Electron с ОС | при изменении `package.json` |
| `private-content` | ищет приватные пути, ключи и дампы сессий в staged тексте | все staged текстовые файлы |

Ни один хук не переписывает файлы: незакоммиченные правки владельца остаются
как есть, автоформатирование не выполняется.

## Ручной запуск

```bash
prek run --config .pre-commit-config.yaml --all-files     # всё дерево
prek run --config .pre-commit-config.yaml --files src/renderer/App.tsx
prek validate-config .pre-commit-config.yaml              # проверка конфигурации
```

## Быстрое против полного

- **`prek` (секунды):** lint, typecheck, платформа Electron, приватное
  содержимое.
- **CI (минуты):** Linux typecheck/lint/tests/build + Electron E2E; Windows
  typecheck/lint/unit+contract/build/installer/packaged smoke; Repository
  Contract. Эти job'ы `prek` не дублирует.

## Ограничения

`prek` — только про проверки. Он **не** подтверждает визуальную приёмку и не
заменяет нативный запуск приложения (см. `windows-launch.md`).
