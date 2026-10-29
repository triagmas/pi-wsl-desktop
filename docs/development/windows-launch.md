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

## Чего это не проверяет

Запуск приложения не подтверждает генерацию модели и не является визуальной
приёмкой. Скриншоты и Visual ACCEPT — отдельные шаги.
