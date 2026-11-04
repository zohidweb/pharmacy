# Сканирование камерой (PR 4): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** у пяти полей, которые принимают скан, появляется кнопка «Камера». Окно с видео задней камеры распознаёт
EAN-13, EAN-8, UPC-A, Code 128 и QR и отдаёт первый код тому же обработчику, что и USB-сканер.

**Architecture:**
- Распознавание (ADR-0025):
  - встроенный `BarcodeDetector`, если он знает все пять форматов;
  - иначе ponyfill `barcode-detector` на `zxing-wasm`, загружаемый `import()` только при открытии окна.
- `.wasm` — копия из пакета в `apps/web/public/vendor/` (git-ignored, имя с версией). Она входит в `out/`, и Service
  Worker её предкэширует.
- Камера и цикл распознавания — хук `useCameraScan` в `shared/lib/camera-scan`. Кнопка и окно — `shared/ui`: их
  импортируют и `features` (подбор товара кассы, поиск строки документа, форма товара), и `pages` (возврат,
  инвентаризация).
- Proxy (поправка ADR-0012 в ADR-0025): сниппет `static-files` принимает значения `Permissions-Policy` и `script-src`.
  `app.` и офлайн-профиль web получают `camera=(self)` и `'wasm-unsafe-eval'`, `admin.` — прежние значения.

**Tech Stack:** Next.js 16 static export (Turbopack), React, use-intl, `libs/ui` (`Dialog`, `IconButton`, `Alert`,
`TextField.endAdornment`). Новые зависимости — `barcode-detector` 3.2.3 и `zxing-wasm` 3.1.6 (ADR-0025). Caddy 2.11.

**Spec:** `docs/superpowers/specs/2026-11-03-pos-store-ideas-design.md`, раздел 7 (D31–D35) и разделы 11–13; утверждена
2026-11-03. **ADR:** ADR-0025 (новый, proposed) с поправкой ADR-0012 — в этом PR. Код пишется только после принятия
ADR-0025 архитектором.

## Уточнения спецификации при планировании

| № | Что нашлось | Решение | Цена ошибки |
|---|---|---|---|
| R1 | D31: кнопка «Камера». В ките нет иконки `camera`, а `lucide-static`, из которого копировались иконки, не установлен | Иконка `scan-barcode`, подпись (`aria-label`) — «Камера» | Нет |
| R2 | D34: `.wasm` со своего origin. Сборка web — Turbopack, ассеты пакетов через `new URL(…, import.meta.url)` в проекте не используются | Скрипт `tools/scripts/zxing-wasm.mjs` копирует `zxing_reader.wasm` в `apps/web/public/vendor/zxing_reader-<версия>.wasm` и сверяет SHA-256 с `ZXING_WASM_SHA256`. Запускается перед `next build`, `next dev` (цели `dev`, `dev-api`); `*.wasm` в `public/vendor` — в `.gitignore` | Ещё один шаг сборки |
| R3 | D34: «работа без сети» | Service Worker предкэширует весь `out/` (`build-sw.mjs`), чанк библиотеки и `.wasm` попадают туда сами | Около 410 КБ трафика на каждую установку SW |
| R4 | D32: «первый верный код» | Первый непустой `rawValue` одного из пяти форматов. Контрольные цифры EAN, UPC и Code 128 и коррекция ошибок QR отсеивают ложные чтения, двойного чтения нет | Редкое ложное чтение уходит обработчику, тот отвечает «не найден» |
| R5 | D33: «уход со страницы». Скрытая вкладка камеру не освобождает | Окно закрывается и поток останавливается при `visibilitychange` → `hidden`, при `pagehide` и при размонтировании | Кассир открывает окно заново |
| R6 | D31: на кассе сканируют и QR чека | Код QR уходит тому же обработчику: «Товар со штрихкодом … не найден», как у 2D USB-сканера | Нет |
| R7 | D31: карточка товара. Поле принимает только 8–14 цифр | Код камеры проходит проверки `addCode` (формат, повтор). Неверный код (например, QR) ставится в поле и показывает ошибку поля | Нет |
| R8 | Когда кнопка доступна | Кнопка показывается и доступна при тех же условиях, что `enabled` хука USB-сканера этого места | Нет |
| R9 | Частота распознавания на слабых планшетах | Одно `detect()` за раз, следующий кадр — через 100 мс после ответа (не больше 10 кадров в секунду) | Чтение чуть медленнее |
| R10 | Форматы по местам | Везде все пять (D32), решает обработчик | Нет |
| R11 | D35: «разделить общий сниппет» | `(static-files)` получает `{args[0]}` — значение `Permissions-Policy` и `{args[1]}` — источники `script-src`; `(static)` передаёт их дальше. Офлайн-профиль — значения web | Нет |
| R12 | Лицензии ADR-0025, п. 8 | `apps/web/THIRD_PARTY_NOTICES.md`, а для браузера — `apps/web/public/vendor/LICENSES-zxing.txt` (в git). В файле тексты MIT `barcode-detector` и `zxing-wasm` (из пакетов) и Apache-2.0 zxing-cpp (из репозитория zxing-cpp на коммите `ZXING_CPP_COMMIT`) | Нет |
| R13 | Встроенный распознаватель | `getSupportedFormats()` должен содержать все пять форматов, иначе ponyfill | Нет |
| R14 | Во встроенном браузере нет камеры | Живая проверка подменяет `getUserMedia` и `enumerateDevices` потоком `canvas.captureStream()` с кодами, нарисованными своими `BarcodeSvg` и `QrSvg`. Реальные устройства — проверка QA (раздел 13 спецификации) | Особенности устройств (фокус, фонарик) проявятся на пилоте |

## Global Constraints

- Тесты отложены до MVP: без TDD и новых автотестов, существующие наборы остаются зелёными. Тестовый долг — в описании
  PR.
- Полный `npm run check` запускает пользователь. Здесь — проверки задач и живые прогоны.
- Работа — в `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/pilot-camera-scan` (от `feature/pilot-wholesale`;
  после слияния PR 3 — подтянуть `origin/main`). Основную папку не трогать.
- До задачи 1 — отдельным коммитом, после слов архитектора: строка в `APPROVAL.md`, статус ADR-0025 `accepted` и статус
  поправки ADR-0012.
- Коммиты — `--no-gpg-sign`, Conventional Commits, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Зависимости — точно `barcode-detector@3.2.3` и `zxing-wasm@3.1.6`, только для `apps/web`, других новых нет. Импорт —
  только `barcode-detector/ponyfill`, только динамический.
- Кадры камеры не сохраняются и не отправляются. Сетевых запросов, кроме `.wasm` и чанка со своего origin, у окна нет.
- Новые тексты — в RU и TJ одновременно (`messages.spec.ts` сверяет ключи); таджикские — на проверку носителю.
- Только токены `--ph-*` и утилиты Tailwind из них; без hex, `px`, inline-стилей. Сенсорные цели — не меньше
  `--ph-size-touch-min`.
- Prettier — только на файлах, уже отформатированных на `main`.

## Review Focus

1. Поток гаснет всегда: «Закрыть», Esc, после кода, через 60 с, при скрытой вкладке, при переходе на другой маршрут. У
   каждой дорожки потока `readyState === 'ended'`. Задача 2, шаг 5, и задача 4, шаг 3.
2. Отказ в разрешении, нет камеры, камера занята другим приложением. Текст и «Ещё раз», без необработанных отказов
   промисов в консоли. Задача 2, шаг 5.
3. Окно камеры поверх окна: редакторы документов, «Найденный товар» инвентаризации, «Завести товар» с формой товара.
   Esc закрывает только камеру, код уходит обработчику своего поля, кнопка в форме возврата не отправляет форму.
   Задача 3, шаг 5.
4. Заголовки как в проде:
   - `.wasm` компилируется под CSP хоста `app.` и грузится со своего origin, запросов к jsDelivr нет;
   - у `admin.` остаётся `camera=()`.

   Задача 1, шаг 6, и задача 4, шаг 3.
5. Без сети: после установки Service Worker окно открывается и распознаёт код при выключенной сети. Задача 4, шаг 3.

---

### Task 1: Сборка и proxy — зависимости, `.wasm` в статике, предсжатие, заголовки

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `tools/scripts/zxing-wasm.mjs`, `apps/web/public/vendor/LICENSES-zxing.txt`, `apps/web/THIRD_PARTY_NOTICES.md`
- Modify: `apps/web/package.json` (цели `dev`, `dev-api`, `build`), `.gitignore`
- Modify: `tools/scripts/precompress.mjs`
- Modify: `docker/proxy/Caddyfile`, `docker/proxy/profiles/offline.caddy`

**Interfaces:**
- Produces:
  - файл `/vendor/zxing_reader-3.1.6.wasm` в `next dev` и в `apps/web/out`;
  - `node tools/scripts/zxing-wasm.mjs <каталог public>` — путь от корня репозитория, как у `build-sw.mjs`. Скрипт
    копирует файл, удаляет прежние `zxing_reader-*.wasm` каталога и падает (код 1), если SHA-256 не равен
    `ZXING_WASM_SHA256`.

- [ ] **Step 1: Зависимости.** `npm install --save-exact barcode-detector@3.2.3 zxing-wasm@3.1.6`. В lock прибавились
  только они, `type-fest` и `@types/emscripten`.
- [ ] **Step 2: Скрипт копии.**
  - `zxing-wasm.mjs` берёт `ZXING_WASM_VERSION` и `ZXING_WASM_SHA256` из `zxing-wasm/reader`, а файл — из
    `zxing-wasm/reader/zxing_reader.wasm` (`createRequire(...).resolve`).
  - Цели web: `node ../../tools/scripts/zxing-wasm.mjs apps/web/public && next dev …` (`dev`, `dev-api`) и
    `… && next build && node ../../tools/scripts/build-sw.mjs apps/web/out`.
  - Входы `build`: `{workspaceRoot}/tools/scripts/zxing-wasm.mjs`, `externalDependencies` `zxing-wasm`.
  - В `.gitignore` — `apps/web/public/vendor/*.wasm`.
- [ ] **Step 3: Лицензии** по R12. Apache-2.0 zxing-cpp — из `LICENSE` репозитория zxing-cpp (WebFetch raw на коммите
  `ZXING_CPP_COMMIT`), без правок.
- [ ] **Step 4: Предсжатие.** `.wasm` — в `COMPRESSIBLE` `precompress.mjs`.
- [ ] **Step 5: Caddy** по R11:
  ```caddyfile
  Content-Security-Policy "default-src 'self'; script-src {args[1]}; style-src …"
  Permissions-Policy "{args[0]}"
  ```
  - `web-site` и `offline.caddy`: `import static "camera=(self), microphone=(), geolocation=()" "'self' 'unsafe-inline' 'wasm-unsafe-eval'"`;
  - `admin-site`: `import static-files "camera=(), microphone=(), geolocation=()" "'self' 'unsafe-inline'"`;
  - заголовки `public-site` не меняются.

  Комментарий у сниппета ссылается на ADR-0025.
- [ ] **Step 6: Проверка.**
  - `node tools/scripts/zxing-wasm.mjs apps/web/public` создаёт файл, повторный запуск оставляет тот же. SHA-256 копии
    совпадает с `ZXING_WASM_SHA256` — сверить выводом `sha256sum`.
  - `caddy validate` в `caddy:2.11.7-alpine` для `cloud`+`redirect`, `cloud`+`site`, `local`, `offline`
    (`--adapter caddyfile`, переменные — по образцу плана `2026-10-29-public-site-web.md`, задача про proxy, шаг 4).
    Ожидается `Valid configuration`.
  - `caddy adapt` для `local`: у хоста web — `camera=(self)` и `'wasm-unsafe-eval'`, у admin — `camera=()` и
    `script-src 'self' 'unsafe-inline'`.
- [ ] **Step 7: Commit** — `build(web): the zxing reader wasm in the static files, camera and wasm allowed on the web host`.

### Task 2: Окно камеры и первое место — возврат по QR чека

**Files:**
- Create: `apps/web/src/shared/lib/camera-scan/{index,detector,use-camera-available,use-camera-scan}.ts`
- Create: `apps/web/src/shared/ui/{CameraScanButton,CameraScanDialog}.tsx`; Modify: `apps/web/src/shared/ui/index.ts`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/core.json` (группа `camera`)
- Modify: `apps/web/src/pages/returns/ui/ReturnsPage.tsx`

**Interfaces:**
- Consumes: `/vendor/zxing_reader-<ZXING_WASM_VERSION>.wasm` (задача 1).
- Produces:
  - `CAMERA_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'qr_code'] as const`;
  - `interface CodeDetector { detect(video: HTMLVideoElement): Promise<string | null> }`;
    `loadCodeDetector(): Promise<CodeDetector>` — один промис на вкладку (R13);
  - `useCameraAvailable(): boolean`. Значение — `isSecureContext` и устройство `videoinput` в
    `navigator.mediaDevices.enumerateDevices()`; обновляется по `devicechange`. Пока ответа нет — `false`;
  - `useCameraScan({ active, onCode }: { active: boolean; onCode: (code: string) => void }): CameraScanState`, где
    `CameraScanState = { status: 'starting' | 'scanning' | 'denied' | 'no_camera' | 'busy' | 'timeout' | 'failed';
    videoRef: RefObject<HTMLVideoElement | null>; torch: { available: boolean; on: boolean; toggle(): void };
    retry(): void }`;
  - `CameraScanButton({ onScan, disabled }: { onScan: (code: string) => void; disabled?: boolean })` — ничего не
    рисует без камеры;
  - `CameraScanDialog({ open, onClose, onScan }: { open: boolean; onClose(): void; onScan(code: string): void })`;
  - ключи `camera.{open, title, hint, starting, denied, noCamera, busy, timeout, failed, retry, torchOn, torchOff, close}`.

- [ ] **Step 1: Распознаватель.** `detector.ts`:
  - есть встроенный и знает все форматы — он;
  - иначе `await import('barcode-detector/ponyfill')`, затем `prepareZXingModule({ overrides: { locateFile: (path,
    prefix) => path.endsWith('.wasm') ? `/vendor/zxing_reader-${ZXING_WASM_VERSION}.wasm` : prefix + path } })`;
  - `new BarcodeDetector({ formats: [...CAMERA_FORMATS] })`; `detect` возвращает `rawValue.trim()` первого результата
    или `null`.

  Тип встроенного — `import type` из ponyfill.
- [ ] **Step 2: Поток.** `use-camera-scan.ts`, пока `active`:
  - `getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })` → `video.srcObject`, `play()`;
  - цикл по R9; первый код — остановка потока, `navigator.vibrate?.(80)`, `onCode(code)`;
  - таймер 60 с — `timeout` и остановка;
  - ошибки: `NotAllowedError` / `SecurityError` → `denied`; `NotFoundError` / `OverconstrainedError` → `no_camera`;
    `NotReadableError` → `busy`; ошибка загрузки распознавателя и прочие → `failed`;
  - фонарик — если `track.getCapabilities?.().torch`; `toggle` → `applyConstraints({ advanced: [{ torch }] })`;
  - остановка — `getTracks().forEach(t => t.stop())` при `active = false`, размонтировании и `pagehide`;
  - `retry()` запускает всё заново.
- [ ] **Step 3: Окно и кнопка.**
  - `Dialog` `size="md"`, `title` — `camera.title`, `closeLabel` — `camera.close`.
  - Внутри: `<video playsInline muted>` во всю ширину (`aspect-video`, `object-cover`) и рамка поверх — прямоугольник
    с рамкой токена `--ph-color-primary`, `aria-hidden`.
  - Под видео — `camera.hint` или `Alert` состояния: `denied` объясняет, как разрешить камеру (значок камеры в адресной
    строке → «Разрешить»). При `denied`, `busy`, `timeout`, `failed` — кнопка «Ещё раз».
  - Фонарик — `IconButton` с `aria-pressed`.
  - `visibilitychange` → `hidden` закрывает окно (R5).
  - Кнопка — `IconButton icon="scan-barcode" label={t('camera.open')} type="button"` (R1); код окна передаётся `onScan`,
    окно закрывается.
- [ ] **Step 4: Возврат.** Колбэк хука сканера становится `handleScan(code)`. Его получают и `useBarcodeScanner`, и
  `<CameraScanButton onScan={handleScan} disabled={!online} />` в `endAdornment` поля номера чека.
- [ ] **Step 5: Проверка.**
  - `npx tsc -p apps/web/tsconfig.json --noEmit`, `npx nx run-many -t lint fsd -p web`, `npx nx test web`
    (`messages.spec.ts`).
  - Живой прогон на моках (`ui-web-mocks`, localhost:4212). `getUserMedia` и `enumerateDevices` подменены по R14.
  - QR id чека из окна проданного чека → возврат находит чек.
  - Отказ (`NotAllowedError`) — текст и «Ещё раз». `NotReadableError` — «занята».
  - Пустой холст 60 с — `timeout`. Дорожки `ended` после кода, «Закрыть», Esc и скрытия вкладки.
  - Встроенного распознавателя нет: в сети — запрос `/vendor/zxing_reader-3.1.6.wasm`, чанка ponyfill, и ни одного
    внешнего.
  - Кнопка не отправляет форму. TJ-тексты на месте, 1280×800 и масштаб 125 %.
- [ ] **Step 6: Commit** — `feat(web): scan a code with the tablet camera, first on the returns page`.

### Task 3: Остальные места — касса, документы, инвентаризация, карточка товара

**Files:**
- Modify: `apps/web/src/features/pos/ui/ProductPicker.tsx`, `apps/web/src/pages/pos/till/ui/PosPage.tsx`
- Modify: `apps/web/src/features/stock-document/ui/ProductSearch.tsx`
- Modify: `apps/web/src/pages/stock-counts/ui/StockCountEditor.tsx`
- Modify: `apps/web/src/features/product-form/ui/ProductForm.tsx`

**Interfaces:**
- Consumes: `CameraScanButton` (задача 2).
- Produces: `ProductPickerProps.onCameraScan?: (code: string) => void`.

- [ ] **Step 1: Касса.** Колбэк сканера в `PosPage` становится `handleScan`. `ProductPicker` рисует
  `<CameraScanButton onScan={onCameraScan} />` в `endAdornment` поиска, если проп передан. `PosPage` передаёт
  `onCameraScan={handleScan}`, когда `Boolean(index) && !locked`.
- [ ] **Step 2: Документы.** Колбэк в `ProductSearch` становится `handleScan`. Кнопка — в `endAdornment` поля,
  доступна при `!disabled && scanEnabled`. Это покрывает приход, начальные остатки, списание, возврат поставщику,
  перемещение, заявку, заказ и «Найденный товар» инвентаризации.
- [ ] **Step 3: Инвентаризация.** Колбэк в `StockCountEditor` становится `handleScan`. Кнопка — в `endAdornment` поля
  «Штрихкод или название», при `editable && found === null`.
- [ ] **Step 4: Карточка товара** (R7).
  - `codeErrorOf(value: string): string | undefined` — нынешний `codeError` для произвольного значения.
  - `addCode(value = code)`.
  - Камера: при ошибке — `setCode(value)`, иначе `addCode(value)`.
  - Кнопка — в `endAdornment` поля штрихкода, `disabled={disabled}`.
- [ ] **Step 5: Проверка.**
  - `npx tsc -p apps/web/tsconfig.json --noEmit`, `npx nx run-many -t lint fsd -p web`, `npx nx test web`.
  - Живой прогон на моках, подмена по R14, EAN-13 и Code 128 товаров моков из `BarcodeSvg`:
    - касса добавляет строку, неизвестный код и QR чека дают «не найден»;
    - строка прихода и списания из кода;
    - инвентаризация: код строки фокусирует строку, неизвестный открывает «Найденный товар». Его кнопка камеры
      работает поверх окна, Esc закрывает только камеру;
    - «Завести товар» в приходе — штрихкод камерой в форме, QR даёт ошибку поля;
    - карточка товара — добавленный код.

    USB-сканер (набор через `computer type` с Enter) работает как раньше.
- [ ] **Step 6: Commit** — `feat(web): the camera button on the till, document lines, stock counts and the product form`.

### Task 4: Документы и проверка как в проде

**Files:**
- Modify: `CLAUDE.md` (строка «Фронтенд-библиотеки»), `docs/architecture/stack.md` (та же строка)
- Modify: `docs/qa/02-granitsy-pilota.md` (раздел «Камера»)

- [ ] **Step 1: Документы.**
  - Строка «Фронтенд-библиотеки»: «распознавание штрихкода камерой — `barcode-detector` + `zxing-wasm`, только web»,
    ADR-0025.
  - QA:
    - где кнопка и почему её нет (нет камеры, не HTTPS);
    - первое разрешение и как вернуть его после отказа (Chrome, Edge, Android);
    - камера работает без сети после первой загрузки кассы;
    - пять форматов;
    - поток гаснет через 60 с;
    - камера — подмога, основной инструмент — USB-сканер.
- [ ] **Step 2: Сборка как в проде.**
  - `NEXT_PUBLIC_API_MOCKS=true npx nx run web:build --skip-nx-cache`, затем
    `node tools/scripts/precompress.mjs apps/web/out`.
  - `caddy:2.11.7-alpine` с `Caddyfile` и `profiles/`, профиль `local`, `TLS_MODE=off`, `WEB_ADDR=http://localhost:4280`,
    `out/` в `/srv/web`, порт только на `127.0.0.1`.
- [ ] **Step 3: Проверка.**
  - `curl -I`: CSP с `'wasm-unsafe-eval'` и `camera=(self)` у web; `.wasm` с `Content-Type: application/wasm` и
    `Content-Encoding: br`.
  - Во встроенном браузере на `http://localhost:4280` (localhost — защищённый контекст):
    - Service Worker установлен;
    - окно камеры с подменой по R14 распознаёт QR и EAN-13, ошибок CSP в консоли нет;
    - после перехода на другую страницу дорожки `ended`;
    - офлайн-режим вкладки (сеть отключена) — окно снова распознаёт код.
  - Контейнер остановлен.
  - Реальные устройства — Windows-планшет и Android, пять форматов, отказ в разрешении, фонарик — проверяет
    пользователь или QA по разделу 13 спецификации; в описании PR — как непроверенное здесь.
- [ ] **Step 4: Commit** — `docs: camera scanning in CLAUDE.md, stack.md and the QA guide`.
