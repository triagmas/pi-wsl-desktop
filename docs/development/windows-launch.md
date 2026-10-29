# Запуск unpackaged приложения на Windows

## Симптом

`npm start` (или `node_modules/electron/dist/electron.exe .`) на этом checkout
завершается без окна: PowerShell возвращает управление, `electron.exe` больше не
запущен, в журнале Application нет записи об ошибке, иногда в stderr появляется
`crashpad_client_win.cc:867 not connected`.

## Причина

`node_modules/electron` заполняется под ту ОС, где выполнялся `npm install` /
`npm ci`. В checkout, установленном из WSL, каталог содержит **Linux**-сборку:

- `node_modules/electron/path.txt` → `electron` (не `electron.exe`);
- есть `chrome-sandbox`, `electron`, `libffmpeg.so`, `libvk_swiftshader.so`;
- **нет** `ffmpeg.dll`, `d3dcompiler_47.dll`, `vulkan-1.dll`,
  `vk_swiftshader.dll`.

Windows-процесс с такой поставкой завершается до `app.whenReady()`, поэтому окна
нет, а отказ выглядит как «тихий выход». Наблюдаемый код возврата без
перенаправления вывода: `-36861` (`0xFFFF7003`).

Это дефект окружения запуска, а не регрессия приложения: та же версия Electron
(win32-сборка) с тем же `dist/` открывает окно.

## Что теперь происходит

`npm start` вызывает `scripts/check-electron-dist.mjs` (хук `prestart`). Если
сборка не соответствует ОС, запуск останавливается с объяснением и командами:

```
Electron для платформы "win32" не готов: .../node_modules/electron/dist
  отсутствуют: ffmpeg.dll, d3dcompiler_47.dll, vulkan-1.dll, vk_swiftshader.dll
  найдены файлы другой платформы: linux:electron, linux:chrome-sandbox, linux:libffmpeg.so
```

Проверить вручную (ничего не запускает):

```bash
node scripts/check-electron-dist.mjs                          # текущая ОС
node scripts/check-electron-dist.mjs --platform win32 --dist <каталог>
```

## Как запустить приложение на Windows

Вариант 1 — Windows-native установка зависимостей (рекомендуется для приёмки):

```powershell
npm ci
npm start
```

Вариант 2 — явно указать win32-сборку Electron (работает и из WSL):

```powershell
$env:PI_WS_DESKTOP_ELECTRON_EXE="F:\path\to\electron.exe"
npm run start:win
```

```bash
PI_WS_DESKTOP_ELECTRON_EXE="F:\\path\\to\\electron.exe" npm run start:win
```

`start:win` проверяет платформу поставки, собирает `dist/` и запускает
приложение. Путь приложения переводится в windows-форму, поэтому запуск из WSL
тоже работает.

## Изолированный запуск (не трогает реальные данные)

```bash
PI_WS_DESKTOP_USER_DATA_DIR="F:\\tmp\\pi-wsl-desktop-ud" npm run start:win
```

Переменная перенаправляет `userData` (appearance/navigation), профиль Pi и
пользовательские JSONL не участвуют. Для проверки только интерфейса этого
достаточно: соединение с Pi остаётся обычным.

## Смешанная поставка отклоняется

`scripts/check-electron-dist.mjs` считает негодной не только «нет своих файлов»,
но и «есть файлы чужой платформы»: каталог с полным набором win32-маркеров и
одним `libffmpeg.so` — это смешанная поставка, а не Windows-сборка. Сообщение в
этом случае говорит именно о смешивании и не перечисляет «отсутствующие» файлы.
Нормальные одноплатформенные сборки (win32 на Windows, linux на Linux)
проверку проходят.

## Воспроизводимый агентский GUI smoke (не CI)

`scripts/win-gui-smoke.mjs` — минимальный репозиторный harness для проверки
ВИДИМОГО окна:

```bash
node scripts/win-gui-smoke.mjs --exe "F:\\path\\to\\electron.exe" --out /tmp/win-gui-smoke.json
node scripts/win-gui-smoke.mjs --out /tmp/win-gui-smoke.json     # найдёт artifacts/win-electron/
```

Что делает: проверяет платформу поставки, снимает baseline PID-ов electron,
запускает приложение с `PI_WS_DESKTOP_USER_DATA_DIR` в throwaway-каталоге,
опрашивает Win32 `EnumWindows`/`IsWindowVisible` только по **появившимся** PID-ам,
требует видимое окно с ожидаемым заголовком (`--expect-title`, по умолчанию
`Pi WSL Desktop`), завершает только собственные процессы и пишет JSON-отчёт
(`visible`, `matchedTitle`, `windows`, `elapsedMs`, `leftoverPids`).

Границы:
- ноль model calls: промпты не отправляются, модель не вызывается;
- реальный профиль приложения (`userData`) не используется, профиль Pi и
  пользовательские JSONL не читаются и не изменяются;
- **не запускается в CI** (нужен живой рабочий стол) — статус `NOT RUN in CI`,
  запуск выполняет агент/разработчик локально;
- packaged smoke из CI и этот dev-GUI smoke — **разные** проверки: первый
  подтверждает запуск установленного приложения, второй — видимое окно dev-сборки.

## Чего это не проверяет

Запуск приложения не подтверждает генерацию модели и не является визуальной
приёмкой. Скриншоты и Visual ACCEPT — отдельные шаги.
