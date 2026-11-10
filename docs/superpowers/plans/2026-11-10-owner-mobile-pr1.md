# Кабинет владельца на телефоне, PR 1 — основа: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** любой экран `web` открывается на телефоне от 360 px без прокрутки страницы: меню — в выдвижной панели,
отступы 16 px, диалоги на весь экран, панели верхней строки — листом, таблицы прокручиваются сами. От 768 px раскладка
не меняется. Кит получает карточки DataTable и закреплённую колонку — экраны владельца включат их в PR 2.

**Architecture:**
- Точка `tablet` = 48rem в теме кита; правила телефона — варианты `max-tablet:` поверх существующих классов. В CSS кита
  (`tokens/components.css`, `controls.css`) — директива Tailwind `@variant max-tablet`, литерал точки остаётся один.
- Токены: `--ph-page-padding-inline`, `--ph-dialog-padding`, `--ph-card-padding` — 16 px ниже `tablet`; утилиты
  `px-page`, `mx-page`.
- `libs/ui`: новые `Drawer` и `TableScroll`; `Dialog` на весь экран, `Popover` `mobileSheet`, `DataTable`
  (`mobileLayout`, `mobile`, `mobileLabel`, `stickyFirstColumn`), `Pagination` с переносом, поля 16 px.
- Оболочка: навигация меню выносится в `SidebarNav` и хук `useNavCounters`; `MobileMenu` — кнопка и `Drawer` с той же
  навигацией; верхняя строка ниже `tablet` — компактная.

**Tech Stack:** Next.js 16 static export, React, Tailwind CSS v4 (`@variant`, `max-*`), use-intl, `libs/ui` на нативной
платформе (`<dialog>`, Popover API). Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-11-10-owner-mobile-design.md`, разделы 2–4 и 9 (M1–M17); утверждена 2026-11-10
вместе с поправкой ADR-0007 от 2026-11-10 (APPROVAL.md).

## Уточнения спецификации при планировании

| № | Что нашлось | Решение | Цена ошибки |
|---|---|---|---|
| R1 | M2: точка `md`. Тема сайта (`apps/site/src/app/styles/site-theme.css:366`) уже задаёт `--breakpoint-md: 64rem` после темы кита, а сайт использует `Dialog` кита. С `max-md:` в ките диалог сайта переключался бы при 1024 px | Точка кита — `tablet` = 48rem, варианты `tablet:` / `max-tablet:`. Спецификация и поправка уже исправлены (только имя) | Нет |
| R2 | Скил `tailwind-patterns` (§9): компоненты кита — через `@container`, не через точки экрана | Для раскладки телефона — исключение: `Dialog`, `Drawer`, `Popover` живут в верхнем слое и зависят от экрана, а карточки `DataTable` — от того же правила «ниже 768 px», что и экраны. Исключение записывается в скил (задача 1) | Таблица в узкой колонке на ПК остаётся таблицей — так и задумано |
| R3 | Стили кита подключены `@import … layer(base)`, утилиты — слой `utilities`, он сильнее | Свойства, которые на телефоне меняет CSS кита (лист `Popover`), не должны совпадать с утилитами компонента: у `mobileSheet` ширина и предел ширины даются с префиксом `tablet:` | Нет |
| R4 | M4: «один медиазапрос» | `:root { @variant max-tablet { … } }` в `tokens/components.css`. Если сборка не превратит `@variant` в медиазапрос (проверка — задача 1, шаг 6), — литерал `@media (width < 48rem)` с комментарием «дубль `--breakpoint-tablet` из `tailwind-theme.css`» | Второй литерал точки |
| R5 | M9: «не больше 85 % экрана» | Токен `--ph-drawer-max-inline: 85vw` в `tokens/components.css` | Нет |
| R6 | M13: какие таблицы получают карточки | В PR 1 — ни одна (свойство по умолчанию `table`); экраны включают карточки в PR 2. PR 1 проверяет режим на одной таблице временно, без коммита | Нет |
| R7 | M8: значок связи. `ConnectionStatus` выводит ещё строки буфера кассы | Ниже `tablet` все тексты `ConnectionStatus` — `max-tablet:sr-only`, значок остаётся | Предупреждения буфера на телефоне видны только диктору; владелец на телефоне не продаёт |
| R8 | Проверка «от 768 px — как на `main`» | Снимки экранов скриптом Playwright в `.superpowers/vr/` рабочей копии (каталог в `.gitignore`, тесты отложены; внутри репозитория — чтобы находился `@playwright/test`): 13 маршрутов на моках при 1280×800, 1024×640 и 768×1024; эталон снимается до задачи 1, сравнение — после каждой задачи | Скрипт не попадает в CI |
| R9 | Три класса `md:` (M3) | Переименовываются в `tablet:` — начинают работать от 768 px (на ПК 4 и 3 колонки, как задумано). Это единственное ожидаемое расхождение снимков `/shifts/view` и диалога ценников | Нет |
| R10 | Карточки и сортировка | В режиме карточек кнопок сортировки нет: на телефоне действует сортировка, выбранная раньше (или по умолчанию) | Сортировку меняют на ПК |

## Global Constraints

- Тесты отложены до MVP: без TDD и новых автотестов; существующие наборы (`ui`, `web`, `admin`, `site`) остаются
  зелёными. Тестовый долг — в описании PR (раздел 9 спецификации).
- Полный `npm run check` запускает пользователь. Здесь — `typecheck` всех проектов, `lint`, `fsd`, `build` затронутых и
  живые проверки.
- Работа — в `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/owner-mobile` (от `origin/main` `c76c9c62`).
  Основную папку не трогать.
- Коммиты — `--no-gpg-sign`, Conventional Commits, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Правила телефона — только добавлением вариантов `max-tablet:` (или `tablet:` там, где базовый класс должен
  действовать только на ПК, R3). Базовые классы ПК не удаляются и не меняются, кроме замены `px-6` → `px-page`,
  `mx-6` → `mx-page` (те же 24 px от 768 px).
- Ширина экрана — только CSS: без `matchMedia` и проверок ширины в JS (статическая сборка, мигание при загрузке).
- Классы — целыми строками в исходнике (Tailwind находит их по тексту файлов): без склейки вида `'tablet:' + cls`;
  варианты с префиксом — отдельной картой `Record<…, string>`.
- На элемент `<dialog>` не ставится свойство `display` (ни `flex`, ни `grid`): закрытый `<dialog>` прячет только
  стиль браузера `display: none`, авторский `display` его перебивает. Раскладка — во внутренней обёртке.
- Только токены `--ph-*` и утилиты из них; без hex, `px`, произвольных значений и inline-стилей с визуальными
  значениями. Сырые значения — только в `tokens/*.css` и литерал точки в `tailwind-theme.css`. Сенсорные цели — не
  меньше `--ph-size-touch-min`.
- Новые тексты — RU и TJ одновременно (`messages.spec.ts` сверяет ключи); таджикские — на проверку носителю.
- Prettier — только на файлах, уже отформатированных на `main`.

## Review Focus

1. **Раскладка от 768 px не изменилась** (кроме R9): касса, склад и экраны владельца при 1280×800, 1024×640 и
   768×1024 совпадают со снимками эталона. Задачи 1–4, последний шаг проверки.
2. **Закрытые `Dialog` и `Drawer` не видны и не перехватывают нажатия** на телефоне и на ПК: после закрытия, после
   перехода по ссылке меню, при размонтировании открытого окна. Задачи 2 и 4.
3. **Меню с клавиатуры и диктором:** кнопка меню называет состояние («Меню, есть новые» при счётчиках), Tab внутри
   панели, Esc закрывает, фокус возвращается на кнопку; нажатие на фон и переход по ссылке закрывают панель. Задача 4.
4. **Верхняя строка при 360 px и масштабе шрифта 120 %:** нет прокрутки страницы, название точки обрезается
   многоточием, колокольчик и аватар на экране. Листы уведомлений, точки и пользователя — под строкой, во всю ширину
   минус 8 px с краёв, без привязки к кнопке. Задача 4.
5. **Диалог на телефоне с длинным содержимым** (диалог сотрудника, перемещения): шапка и кнопки подвала видны всегда,
   прокручивается только тело; поле в фокусе не увеличивает страницу (16 px). Задача 2.

---

### Task 1: Точка `tablet`, токены отступов, `px-page` и документы

**Files:**
- Modify: `libs/ui/src/styles/tailwind-theme.css` (точка, утилиты `page`)
- Modify: `libs/ui/src/styles/tokens/components.css` (токены, блок телефона)
- Modify: `libs/ui/src/lib/field/Field.tsx` (`controlClassName`)
- Modify: 30 страниц и виджетов с `px-6` / `mx-6` — список шага 3
- Modify: `apps/web/src/pages/shift-history/ui/ShiftCardPage.tsx:109,159`,
  `apps/web/src/features/print-price-tags/ui/PrintTagsDialog.tsx:100` (`md:` → `tablet:`)
- Modify: `docs/architecture/c4/deployment.md`, `CLAUDE.md`, `.claude/skills/ui-standards-tokens/SKILL.md`,
  `.claude/skills/tailwind-patterns/SKILL.md`, `.claude/skills/tailwind-patterns/reference/tailwind-theme-mapping.md`
  (если в ней перечислены точки)

**Interfaces:**
- Produces: варианты `tablet:` (от 48rem) и `max-tablet:` (уже 48rem); утилиты `px-page`, `mx-page`; токены
  `--ph-page-padding-inline`, `--ph-dialog-padding`, `--ph-drawer-max-inline` (значения ПК — `space-6`, `space-6`,
  `85vw`; ниже `tablet` первые два — `space-4`), `--ph-card-padding` ниже `tablet` — `space-4`.

- [ ] **Step 1: Эталон снимков (R8)** — до любых правок кода.
  - Каталог `.superpowers/vr/`: `pw.config.mts` (`testDir` — этот каталог, `use.channel: 'chrome'`,
    `baseURL: http://localhost:4212`, `expect.toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled' }`,
    `snapshotPathTemplate` внутри каталога) и `vr.spec.mts`: вход владельцем на моках (логин `firuz`, пароль — из
    `MOCK_PASSWORD` `apps/web/src/shared/api/mocks/fixtures.ts`, в чат не выводить), выбор первой точки, затем для
    каждой ширины (1280×800, 1024×640, 768×1024) — `toHaveScreenshot({ fullPage: true })` маршрутов `/`, `/reports`,
    `/audit-log`, `/expenses`, `/transfers`, `/employees`, `/stock`, `/shifts`, `/shifts/view` (первая смена списка),
    `/settings`, `/profile`, `/pos`, `/goods-receipts`.
  - Сервер — `preview_start` конфигурации `ui-web-mocks` (порт 4212, `pharmacy-minors`).
  - Запуск из корня `pharmacy-minors`: `npx playwright test --config .superpowers/vr/pw.config.mts --update-snapshots`.
    Ожидается: 39 снимков записаны. Второй прогон без `--update-snapshots` — `39 passed` (моки детерминированы в пределах
    дня; если нет — замаскировать меняющиеся места `mask` и повторить).
- [ ] **Step 2: Тема и токены.**
  - `tailwind-theme.css`, блок `@theme`: `--breakpoint-tablet: 48rem; /* 768 — below it the phone layout (ADR-0007,
    amendment 2026-11-10) */` перед `lg`; в пространстве spacing — `--spacing-page: var(--ph-page-padding-inline);`.
  - `components.css`: `--ph-page-padding-inline: var(--ph-space-6)`, `--ph-dialog-padding: var(--ph-space-6)`,
    `--ph-drawer-max-inline: 85vw`; в конце файла — `:root { @variant max-tablet { … } }` с
    `--ph-page-padding-inline`, `--ph-dialog-padding`, `--ph-card-padding` = `var(--ph-space-4)` (R4).
  - `controlClassName`: после `text-sm` — `max-tablet:text-md`.
- [ ] **Step 3: `px-page`.** Заменить `px-6` → `px-page` в обёртках страниц (`flex flex-col gap-4 px-6 pt-4…`, а также
  `px-6 pt-4` без `flex`) в файлах: `pages/{catalog/ui/CatalogPage,catalog/ui/ProductPage,dashboard/ui/DashboardPage,
  data-import/ui/DataImportPage (2),goods-receipts/ui/GoodsReceiptsPage,opening-balances/ui/OpeningBalancesPage,
  orders/ui/OrdersPage,owner/audit-log/ui/AuditLogPage,owner/employees/ui/EmployeesPage,owner/expenses/ui/ExpensesPage,
  owner/offline/ui/OfflinePage,owner/reports/ui/ReportsPage,owner/settings/ui/SettingsPage,owner/stores/ui/StoresPage,
  pos/till/ui/PosPage (2),pricing/ui/PricingPage,profile/ui/ProfilePage,returns/ui/ReturnsPage,shift/ui/ShiftPage (2),
  shift-history/ui/ShiftCardPage,shift-history/ui/ShiftHistoryPage,stock/ui/StockPage,stock-counts/ui/StockCountsPage,
  supplier-returns/ui/SupplierReturnsPage,suppliers/ui/SuppliersPage,transfers/ui/TransfersPage,
  write-offs/ui/WriteOffsPage}.tsx`, `shared/ui/StateScreen.tsx`, `widgets/app-shell/ui/{PageHeader,
  AnnouncementsBanner}.tsx`; в `PageHeader` `mx-6` → `mx-page`. `CustomerDisplayPage.tsx` не трогать (это не обёртки
  страницы). После замены `rg -n "\b(px|mx)-6\b" apps/web/src --glob '*.tsx'` находит только `CustomerDisplayPage.tsx`.
- [ ] **Step 4: Три класса `md:` → `tablet:`** (R9).
- [ ] **Step 5: Документы.**
  - `deployment.md`, «Клиентские устройства»: строка `| Телефон владельца | Браузер (Chrome на Android или Safari на
    iOS, последние 2 версии), портретная ориентация от 360 px | Только экраны кабинета владельца (ADR-0007, поправка
    2026-11-10); облачные точки; касса и склад — не на телефоне |`.
  - `CLAUDE.md`, структура проекта: `libs/ui/ … (сенсорные экраны от 10″ и телефон владельца от 360 px)`.
  - `ui-standards-tokens/SKILL.md`, строка «Экраны»: вместо «Мобильная вёрстка не цель.» — «Телефон (портрет, от 360 px)
    — только экраны кабинета владельца (ADR-0007, поправка 2026-11-10): ниже точки `tablet` (768 px) — правила
    `max-tablet:`, от 768 px раскладка не меняется.»
  - `tailwind-patterns/SKILL.md`: в примере `@theme` — `--breakpoint-tablet: 48rem;`; в §9 после правила о
    viewport-префиксах — исключение R2 и правило «телефон — `max-tablet:` поверх классов ПК; `md`/`sm` в теме кита нет,
    `md` сайта — 1024 px».
- [ ] **Step 6: Проверка.**
  - `npx nx run-many -t typecheck` — зелёный; `npx nx run-many -t lint -p ui web`, `npx nx fsd web`,
    `npx nx run-many -t build -p web admin site` — зелёные.
  - В собранном CSS `apps/web/out/_next/static/**/*.css` есть `@media (width<48rem)` (или `max-width:47.99…`) с
    `--ph-page-padding-inline` — `@variant` сработал; иначе — запасной вариант R4 и повторная сборка.
  - Браузер (моки, 4212): при 375 px у `/reports` `getComputedStyle` обёртки страницы даёт `padding-inline: 16px`, у
    поля ввода — `font-size: 16px`; при 1280 px — `24px` и `14px`.
  - Снимки (шаг 1) без `--update-snapshots`: `39 passed`, кроме `/shifts/view` (R9) — расхождение только в сетке
    реквизитов и итогов; его снимки обновить после просмотра.
- [ ] **Step 7: Commit** — `feat(ui): the tablet breakpoint, phone paddings and 16 px fields below it (ADR-0007 amendment)`.

### Task 2: Оверлеи кита — Drawer, Dialog на весь экран, лист Popover

**Files:**
- Create: `libs/ui/src/lib/overlay/Drawer.tsx`
- Modify: `libs/ui/src/lib/overlay/Dialog.tsx`, `libs/ui/src/lib/overlay/Popover.tsx`, `libs/ui/src/styles/controls.css`,
  `libs/ui/src/index.ts`

**Interfaces:**
- Consumes: `max-tablet:`, `tablet:`, `--ph-dialog-padding`, `--ph-drawer-max-inline` (задача 1).
- Produces:
  - `Drawer(props: DrawerProps)`, `DrawerProps = { open: boolean; onClose: () => void; id?: string; label: string;
    closeLabel: string; children: ReactNode }` — экспорт из `@pharmacy/ui` вместе с типом;
  - `PopoverProps.mobileSheet?: boolean` (по умолчанию `false`);
  - `Dialog` — API без изменений.

- [ ] **Step 1: Dialog.**
  - Внутренняя обёртка: `p-6` → `p-(--ph-dialog-padding)`.
  - Ниже `tablet` у `<dialog>`: `max-tablet:m-0 max-tablet:h-dvh max-tablet:w-full max-tablet:max-h-none
    max-tablet:max-w-none max-tablet:rounded-none max-tablet:overflow-hidden`. Класс размера (`sizeClass`) остаётся
    как есть: утилиты с вариантом идут в CSS после базовых, и `max-tablet:w-full` его перебивает — проверить в
    браузере, иначе карта `sizeClass` с префиксом `tablet:`.
  - Внутренняя обёртка ниже `tablet`: `max-tablet:h-full max-tablet:min-h-0` (колонка уже `flex flex-col`); обёртка
    `children` — `max-tablet:min-h-0 max-tablet:flex-1 max-tablet:overflow-y-auto`; шапка и подвал — `shrink-0`.
    Свойство `display` у самого `<dialog>` не задаётся (Global Constraints).
- [ ] **Step 2: Drawer** — по образцу `Dialog` (те же `showModal()`, `onCancel`, `onClose`, клик по фону, возврат фокуса,
  в том числе при размонтировании открытого окна; шапка файла — чек-лист ARIA APG «Dialog (Modal)»).
  - `<dialog id={id} aria-label={label}>`: `m-0 h-dvh max-h-none w-sidebar max-w-(--ph-drawer-max-inline)
    inset-y-0 start-0 border-0 border-e border-border bg-surface p-0 text-fg shadow-(--ph-dialog-shadow)
    backdrop:bg-overlay`.
  - Содержимое (только при `open`): обёртка `flex h-full min-h-0 flex-col`; строка с `IconButton` `x`
    (`closeLabel`, `variant="subtle"`) у конца; тело `min-h-0 flex-1 overflow-y-auto`.
- [ ] **Step 3: Popover `mobileSheet`.**
  - При `mobileSheet` к панели добавляется класс `ph-popover-sheet`, а ширина и предел ширины берутся из второй карты:
    `{ sm: 'tablet:w-(--ph-size-dialog-sm)', md: 'tablet:w-(--ph-size-dialog-md)' }` и
    `tablet:max-w-(--ph-dialog-max-inline)` (R3).
  - `controls.css`, после `.ph-popover`: `.ph-popover-sheet { @variant max-tablet { position-area: none;
    inset-block-start: calc(var(--ph-size-topbar) + var(--ph-space-1)); inset-block-end: auto; inset-inline:
    var(--ph-space-2); margin: 0; max-block-size: calc(100dvh - var(--ph-size-topbar) - var(--ph-space-4));
    overflow-y: auto; } }` (запасной вариант — как R4).
- [ ] **Step 4: Экспорт** `Drawer`, `type DrawerProps` из `libs/ui/src/index.ts` рядом с `Dialog`.
- [ ] **Step 5: Проверка.**
  - `npx nx run-many -t typecheck`, `npx nx lint ui`, `npx nx test ui` (существующие `overlay.spec.tsx` зелёные),
    `npx nx run-many -t build -p web admin site`.
  - Браузер, моки, 375×812: диалог сотрудника (`/employees` → «Новый сотрудник») и «Новая заявка» (`/transfers`) — на
    весь экран, шапка и подвал на месте при прокрутке тела, Esc и «Закрыть» закрывают, после закрытия
    `document.querySelector('dialog[open]')` — `null` и нажатие по странице доходит до элементов. При 1280 — как на
    эталоне.
  - `Drawer` здесь проверяется в задаче 4 (первое место использования).
  - Снимки эталона — `39 passed` (с обновлёнными в задаче 1).
- [ ] **Step 6: Commit** — `feat(ui): Drawer, full-screen dialogs and popover sheets below the tablet breakpoint`.

### Task 3: Таблицы кита — карточки, закреплённая колонка, TableScroll, Pagination

**Files:**
- Create: `libs/ui/src/lib/data/TableScroll.tsx`
- Modify: `libs/ui/src/lib/data/DataTable.tsx`, `libs/ui/src/lib/navigation/Pagination.tsx`, `libs/ui/src/index.ts`

**Interfaces:**
- Consumes: `max-tablet:`, `tablet:` (задача 1).
- Produces:
  - `TableScroll(props: TableScrollProps)`, `TableScrollProps = ({ label: string; labelledBy?: never } | { labelledBy:
    string; label?: never }) & { children: ReactNode; className?: string }` — `<div role="region" aria-label|
    aria-labelledby tabIndex={0} className="relative w-full overflow-x-auto …">`;
  - `DataTableColumn` — новые поля `mobile?: 'title' | 'field' | 'actions' | 'hidden'` (по умолчанию `field`) и
    `mobileLabel?: string`;
  - `DataTableProps` — новые `mobileLayout?: 'table' | 'cards'` (по умолчанию `table`) и `stickyFirstColumn?: boolean`.

- [ ] **Step 1: TableScroll**, и `DataTable` использует его для своей обёртки (`labelledBy` = id подписи) — разметка
  обёртки прежняя.
- [ ] **Step 2: Карточки (`mobileLayout="cards"`).**
  - С `table` разметка не меняется вовсе. С `cards` — общая обёртка `<div className={className}>`: в ней обёртка
    таблицы с `max-tablet:hidden` и список `<ul aria-label={caption}>` с `tablet:hidden m-0 list-none p-0`.
  - При `showCaption` над списком — та же подпись видимым текстом.
  - Строка → `<li>` `flex flex-col gap-2 border-t border-border px-4 py-3` + классы `rowVariant`: колонка `title` —
    `text-sm font-medium`; колонки `field` — `<dl className="m-0 flex flex-col gap-1">`, пара — строка
    `flex items-baseline justify-between gap-3`: `<dt>` `text-xs text-fg-muted` с `mobileLabel ?? (typeof header ===
    'string' ? header : null)`, `<dd>` `m-0 min-w-0 text-end text-sm wrap-anywhere` (`tabular-nums` у `numeric`); без
    подписи — значение одно, во всю ширину; колонки `actions` — `flex flex-wrap justify-end gap-2` внизу; `hidden` —
    не выводится.
  - Пустой список — `<li>{empty}</li>`. Сортировки в карточках нет (R10).
- [ ] **Step 3: `stickyFirstColumn`.** Первые `th` и `td`: `sticky start-0 z-(--ph-z-base)`; фон `th` —
  `bg-(--ph-table-header-bg)`, `td` — `bg-surface`, у строк `group` — `bg-surface-sunken`; обёртка прокрутки —
  `isolate`. Справа у закреплённой колонки — `border-e border-border`.
- [ ] **Step 4: Pagination** — `flex-wrap` у `<nav>`.
- [ ] **Step 5: Экспорт** `TableScroll`, `type TableScrollProps`.
- [ ] **Step 6: Проверка.**
  - `npx nx run-many -t typecheck`, `npx nx lint ui`, `npx nx test ui` (`data.spec.tsx`, `navigation.spec.tsx`
    зелёные), `npx nx run-many -t build -p web admin site`.
  - Временно, без коммита (R6): `mobileLayout="cards"` и `mobile: 'title'` у колонки сотрудника в журнале действий
    (`AuditLogPage`), `stickyFirstColumn` у таблицы отчёта (`ReportsPage`). Моки, 375: журнал — карточки, Tab проходит
    только видимые элементы, диктор (дерево доступности `read_page`) не видит скрытую таблицу; отчёт — первая колонка
    стоит при горизонтальной прокрутке. При 1280 — обе таблицы как на эталоне. Затем `git checkout` обоих файлов.
  - Снимки эталона — `39 passed`.
- [ ] **Step 7: Commit** — `feat(ui): DataTable cards and a sticky first column below the tablet breakpoint, TableScroll`.

### Task 4: Оболочка — меню в панели, компактная верхняя строка

**Files:**
- Create: `apps/web/src/widgets/app-shell/model/use-nav-counters.ts`, `apps/web/src/widgets/app-shell/ui/SidebarNav.tsx`,
  `apps/web/src/widgets/app-shell/ui/MobileMenu.tsx`
- Modify: `apps/web/src/widgets/app-shell/ui/{Sidebar,AppShell,StoreSwitcher,UserMenu,NotificationsBell,
  ConnectionStatus}.tsx`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/core.json` (`shell`)

**Interfaces:**
- Consumes: `Drawer`, `Popover.mobileSheet` (задача 2); `tablet:`, `max-tablet:` (задача 1).
- Produces:
  - `useNavCounters(): { counters: NavCounters | undefined; storeId: string | null }` — запрос и обновление из
    нынешнего `Sidebar` без изменений (ключ `[...navCountersKey, storeId]`, интервал, пауза на кассе, обновление после
    ухода из кассы);
  - `SidebarNav({ counters, storeId, onNavigate }: { counters: NavCounters | undefined; storeId: string | null;
    onNavigate?: () => void })` — разделы и пункты нынешнего `Sidebar` (без `<nav>`); `onNavigate` вызывается при
    нажатии на ссылку;
  - `hasNavAttention(session, counters): boolean` — есть ли у видимых пунктов счётчик больше нуля (в `SidebarNav.tsx`
    или `config/navigation.ts`);
  - `MobileMenu()` — кнопка и панель; ключи `shell.menu` («Меню» / «Меню»), `shell.menuAttention` («Меню, есть новые» /
    «Меню, навҳо ҳастанд»), `shell.closeMenu` («Закрыть меню» / «Пӯшидани меню»).

- [ ] **Step 1: Вынести навигацию.** `useNavCounters` и `SidebarNav` из `Sidebar`; `Sidebar` = `<nav aria-label>` с
  прежними классами + `max-tablet:hidden`, внутри `SidebarNav`.
- [ ] **Step 2: MobileMenu.**
  - Обёртка `tablet:hidden`; `IconButton icon="menu"`, `variant="surface"`, `indicator={hasNavAttention(…)}`,
    `label` — `shell.menuAttention` или `shell.menu`, `aria-expanded`, `aria-controls` = id панели.
  - `Drawer` (`label` — `shell.navLabel`, `closeLabel` — `shell.closeMenu`): `<nav aria-label>` с `SidebarNav`
    (`onNavigate` закрывает) и внизу `FontScaleControl` (`border-t border-border pt-4`). Панель закрывается и при
    смене `usePathname()`.
- [ ] **Step 3: Верхняя строка (`AppShell`, режим не `fullscreen`).**
  - `header`: + `max-tablet:gap-2 max-tablet:px-3`; первым — `MobileMenu`; название продукта — + `max-tablet:hidden`;
    `FontScaleControl` — в обёртке `max-tablet:hidden`.
  - `StoreSwitcher`: у кнопки и метки — `max-tablet:min-w-0 max-tablet:shrink`; `Popover` — `mobileSheet`.
  - `UserMenu`: колонка имени и роли — `max-tablet:hidden`; `Popover` — `mobileSheet`.
  - `NotificationsBell`: `Popover` — `mobileSheet`.
  - `ConnectionStatus`: тексты — `max-tablet:sr-only` (R7).
  - Режим кассы `fullscreen` не меняется.
- [ ] **Step 4: Тексты** RU и TJ (ключи — Interfaces).
- [ ] **Step 5: Проверка.**
  - `npx nx run-many -t typecheck`, `npx nx lint web`, `npx nx fsd web`, `npx nx test web` (в том числе
    `messages.spec.ts`), `npx nx build web`.
  - Браузер, моки, 360×800 и 375×812, масштаб шрифта 100 % и 120 %: `document.documentElement.scrollWidth ===
    innerWidth` на `/`, `/reports`, `/employees`, `/stock`, `/pos`; меню: открыть, Tab по пунктам, Esc — фокус на кнопке;
    открыть, нажать «Отчёты» — переход, панель закрыта, `dialog[open]` нет; нажатие на фон закрывает; точка на кнопке
    при счётчике (на моках у «Остатки» — 1), переход по этому пункту ведёт на его фильтр; листы уведомлений, точки и
    пользователя — под строкой, во всю ширину минус 8 px.
  - Снимки эталона при 1280, 1024, 768 — `39 passed`.
  - Скриншот 375 px дашборда с открытым меню и без — пользователю.
- [ ] **Step 6: Commit** — `feat(web): the menu in a drawer and a compact top bar below the tablet breakpoint`.
