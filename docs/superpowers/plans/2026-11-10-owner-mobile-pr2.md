# Кабинет владельца на телефоне, PR 2 — экраны владельца: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** экраны раздела 5 спецификации на телефоне от 360 px читаются без прокрутки страницы и без обрезанного
содержимого: сетки в одну колонку, фильтры друг под другом, списки — карточки, отчёт — таблица с закреплённой
колонкой. От 768 px ничего не меняется.

**Architecture:** только варианты `max-tablet:` поверх классов ПК и свойства кита из PR 1 (`mobileLayout="cards"`,
`mobile`, `mobileLabel`, `stickyFirstColumn`, `TableScroll`). Кит меняется в двух местах: карточка не выводит пустые
значения, а у `PageHeader` на телефоне заголовок переносится и действия идут отдельной строкой. Проверка — снимки ПК
(эталон PR 1) и скрипт телефона: ширина страницы и обрезанное содержимое при 360 и 375 px, масштаб 100 и 120 %.

**Tech Stack:** Next.js 16 static export, React, Tailwind CSS v4, use-intl, `libs/ui`. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-11-10-owner-mobile-design.md`, разделы 5–7 и 9 (M13–M17); утверждена 2026-11-10
вместе с поправкой ADR-0007. PR 1 слит (#116, `main` `7fa4b85c`).

## Уточнения спецификации при планировании

| № | Что нашлось | Решение | Цена ошибки |
|---|---|---|---|
| R1 | M17: «плитки — по две в ряд». У `KpiTile` значок 40 px и отступы 20 px: в половине экрана 375 px значению остаётся ≈ 71 px, а «18 420,50 с» шрифтом 24 px — ≈ 140 px | Денежные плитки дашборда — одна в ряд (`max-tablet:grid-cols-1`); плитки-счётчики перемещений — по две (`max-tablet:grid-cols-2`) | Дашборд на телефоне длиннее на две плитки |
| R2 | M13: карточка выводит подпись и пустое значение (`source` журнала — `null`, итоговые строки расходов — `''`) | Кит: колонка `field` и `title`, у которой `cell(row)` вернула `null`, `undefined`, `false` или `''`, в карточку не выводится | Нет |
| R3 | M17: «действия `PageHeader` — отдельной строкой, заголовок переносится». Сейчас `h1` — `truncate`, на 375 px «Отч…» | `PageHeader` ниже `tablet`: `max-tablet:flex-col max-tablet:items-stretch` у шапки, `max-tablet:whitespace-normal` у `h1` | Нет |
| R4 | Строки фильтров — `flex flex-wrap items-end gap-3 …` в семи местах | Каждой — `max-tablet:flex-col max-tablet:items-stretch`: поля на всю ширину, друг под другом | Нет |
| R5 | Подписи `TableScroll` у таблиц строк в трёх диалогах перемещений | Новые ключи `transfers.request.linesLabel` («Строки заявки» / «Сатрҳои дархост»), `transfers.transfer.linesLabel` и `transfers.detail.linesLabel` («Строки перемещения» / «Сатрҳои интиқол»); у таблиц настроек — существующие `settings.markups.title` и `settings.categories.title` | TJ — на ревью носителю |
| R6 | Колонка выбора остатков — заголовок «выбрать все» — чекбокс | `mobile: 'hidden'`; массовые действия (ценники, заказ) — на ПК, как в спецификации | Выбор с телефона недоступен |
| R7 | `ShiftEventLog` использует и экран смены кассы | Карточки и там: касса на телефоне не поддерживается, а от 768 px раскладка прежняя | Нет |
| R8 | `ProfilePage.tsx:88` — `col-span-4` в сетке на 4 колонки: в одной колонке он создаст неявные колонки | Вместе с `max-tablet:grid-cols-1` — `max-tablet:col-span-1` | Нет |
| R9 | Диалог выгрузки 1С (`Export1cDialog`) — вне пилота (выгрузка 1С скрыта у владельца) | Только сетка `grid-cols-3` → одна колонка; таблица сопоставления остаётся таблицей с прокруткой | Нет |
| R10 | Проверка «страница не шире экрана» не видит обрезанное внутри карточек (ревью PR 1) | Скрипт телефона ищет видимые поля, кнопки, ссылки и заголовки, вылезающие за предка с `overflow: hidden/clip`, кроме таблиц внутри областей прокрутки | Скрипт не в CI |

## Global Constraints

- Тесты отложены до MVP: без TDD и новых автотестов; существующие наборы зелёные. Тестовый долг — в описании PR.
- Полный `npm run check` запускает пользователь — в `pharmacy-minors` (проверять папку в терминале). Здесь —
  `typecheck`, `lint`, `fsd`, `test`, `build` затронутых проектов и живые проверки.
- Работа — в `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/owner-mobile-screens` (от `origin/main`
  `7fa4b85c`). Основную папку не трогать.
- Коммиты — `--no-gpg-sign`, Conventional Commits, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Только добавление вариантов `max-tablet:` и свойств кита PR 1; базовые классы ПК не меняются. Снимки ПК (39) после
  каждой задачи совпадают с эталоном `.superpowers/vr/snapshots`.
- Классы — целыми строками в исходнике; только токены `--ph-*`, без hex, `px` и произвольных значений.
- В ячейках таблиц с карточками нет постоянных `id`, `htmlFor` и `ref` (ячейка выводится дважды).
- Новые тексты — RU и TJ одновременно (`messages.spec.ts` сверяет ключи); таджикские — на проверку носителю.
- Prettier — только на файлах, уже отформатированных на `main`.

## Review Focus

1. **ПК без изменений:** снимки 13 экранов при 1280, 1024 и 768 px — 39 из 39 после каждой задачи.
2. **Обрезанное содержимое при 360 px и 120 %:** поиск остатков, строки фильтров, значения плиток, кнопки в шапках
   карточек — скрипт телефона (R10) пуст на всех экранах раздела 5. Задачи 1–4, последний шаг.
3. **Карточки с пустыми и итоговыми строками:** журнал без источника, итог расходов («Итого» и сумма), смена без
   отметок — без пустых подписей. Задачи 1, 2, 4.
4. **Действия из карточек:** «Собрать» и «Отклонить» заявки, изменение и удаление расхода, отвязка терминала, открытие
   сотрудника, роли и смены работают с телефона; скрытая копия таблицы недостижима с клавиатуры. Задачи 2–4.
5. **Диалоги с таблицами на телефоне:** заявка, сборка, приёмка перемещения, роль — тело прокручивается по вертикали,
   таблица строк — внутри своей области по горизонтали, поля количества доступны. Задача 3.

---

### Task 1: Общие правила, скрипт телефона, дашборд

**Files:**
- Modify: `libs/ui/src/lib/data/DataTable.tsx` (R2), `apps/web/src/widgets/app-shell/ui/PageHeader.tsx` (R3)
- Modify: `apps/web/src/pages/dashboard/ui/DashboardPage.tsx`
- Create: `.superpowers/vr/phone.spec.mts`, `.superpowers/vr/pw-phone.config.mts` (вне git)

**Interfaces:**
- Produces: правило R2 карточек `DataTable`; `PageHeader` на телефоне (R3); команда проверки телефона
  `npx playwright test --config .superpowers/vr/pw-phone.config.mts`.

- [ ] **Step 1: Скрипт телефона (R10).** По образцу `vr.spec.mts` (вход владельцем, `page.clock.setFixedTime`).
  - Маршруты: `/`, `/reports`, `/audit-log`, `/expenses`, `/transfers`, `/employees`, `/stock`, `/shifts`, карточка
    первой смены, `/settings`, `/profile`. Ширины 360×800 и 375×812, масштаб — `localStorage`
    `pharmacy-web-font-scale` = `100` и `120` до перехода.
  - На каждом: `document.documentElement.scrollWidth === innerWidth`; список видимых `input, select, textarea, button,
    a, h1, h2, h3, [role=status]` внутри `main`, чей прямоугольник выходит больше чем на 1 px за предка с
    `overflow-x` `hidden`/`clip` — кроме тех, что внутри `[role=region]`. Ожидание — пустой список (`expect.soft`).
  - Снимок `fullPage` при 375 px и 100 % — для просмотра, без сравнения (`page.screenshot` в `results/phone/`).
  - Первый прогон до правок — список нарушений в журнал исполнения как исходное состояние.
- [ ] **Step 2: Кит.**
  - `DataTable`, режим карточек: значение колонки `title` или `field` считается один раз (`const value =
    column.cell(row)`), и при `value === null || value === undefined || value === false || value === ''` колонка в
    карточку не выводится (R2). Таблица не меняется.
  - `PageHeader`: шапка — `+ max-tablet:flex-col max-tablet:items-stretch`, `h1` — `+ max-tablet:whitespace-normal`.
- [ ] **Step 3: Дашборд.**
  - `:72` плитки — `+ max-tablet:grid-cols-1` (R1); `:335` и `:351` — `+ max-tablet:grid-cols-1`.
  - Таблица точек `:158` — `mobileLayout="cards"`, колонка `name` — `mobile: 'title'`.
  - Действия шапки `:292` (период, даты) — `+ max-tablet:flex-col max-tablet:items-stretch`.
- [ ] **Step 4: Уведомления.** Кода нет: лист PR 1. Проверить в шаге 5 список, «Отметить все прочитанными» и
  прокрутку при 360 px и 120 %.
- [ ] **Step 5: Проверка.**
  - `npx nx run-many -t typecheck`, `npx nx run-many -t lint -p ui web`, `npx nx fsd web`,
    `npx nx run-many -t test -p ui web`, `npx nx run-many -t build -p web admin site` — зелёные.
  - Скрипт телефона: на `/` нарушений нет; на остальных — не больше исходного.
  - Снимки ПК — 39 из 39.
- [ ] **Step 6: Commit** — `feat(web): the owner dashboard on a phone; cards skip empty values, the page title wraps`.

### Task 2: Отчёты, журнал действий, расходы

**Files:**
- Modify: `apps/web/src/pages/owner/reports/ui/{ReportsPage,Export1cDialog}.tsx`
- Modify: `apps/web/src/pages/owner/audit-log/ui/AuditLogPage.tsx`
- Modify: `apps/web/src/pages/owner/expenses/ui/ExpensesPage.tsx`

**Interfaces:**
- Consumes: R2, R3 (задача 1); `stickyFirstColumn`, `mobileLayout`, `mobile` (PR 1).

- [ ] **Step 1: Отчёты.** Таблица `:282` — `stickyFirstColumn`; строка фильтров `:224` — R4; `Export1cDialog.tsx:178`
  — `+ max-tablet:grid-cols-1` (R9).
- [ ] **Step 2: Журнал действий.** Таблица `:300` — `mobileLayout="cards"`, `action` — `mobile: 'title'`, прочие —
  поля (пустой `source` скрывает R2); строка фильтров `:232` — R4.
- [ ] **Step 3: Расходы.**
  - Таблица расходов `:205` — карточки: `store` — `title` (у итоговой строки — «Итого»), `actions` — `mobile:
    'actions'`.
  - Таблица изъятий `:225` — карточки, `store` — `title`.
  - Строка месяца `:167` — R4; переключатель месяца `:168` остаётся строкой, его `h2` — `+ max-tablet:flex-1`.
- [ ] **Step 4: Проверка.**
  - Команды задачи 1, шаг 5.
  - Браузер, моки, 375 px: отчёт «Продажи по точкам» — первая колонка стоит при прокрутке, итог — последней строкой;
    журнал — карточки без строки «Источник» у записей без источника; расходы — карточка «Итого» с суммой; «Изменить» и
    «Удалить» из карточки открывают свои диалоги.
  - Скрипт телефона: на трёх экранах нарушений нет. Снимки ПК — 39 из 39.
- [ ] **Step 5: Commit** — `feat(web): reports, the audit log and expenses on a phone`.

### Task 3: Перемещения и сотрудники

**Files:**
- Modify: `apps/web/src/pages/transfers/ui/{TransfersPage,RequestDialogs,TransferDialogs}.tsx`
- Modify: `apps/web/src/pages/owner/employees/ui/{EmployeesPage,EmployeeDialog,RoleDialog}.tsx`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/stock.json` (R5)

**Interfaces:**
- Consumes: `TableScroll` (PR 1), R2 (задача 1).
- Produces: ключи R5.

- [ ] **Step 1: Страница перемещений.**
  - Плитки `:241` — `+ max-tablet:grid-cols-2` (R1).
  - Заявки `:260` — карточки: `number` — `title`, `actions` — `mobile: 'actions'`.
  - Перемещения `:292` — карточки: `number` — `title`.
- [ ] **Step 2: Диалоги перемещений.**
  - `RequestDialogs.tsx:207`, `TransferDialogs.tsx:303` — `+ max-tablet:grid-cols-1`; шаги `TransferDialogs.tsx:785` —
    `+ max-tablet:grid-cols-1`.
  - Таблицы строк `RequestDialogs.tsx:273`, `TransferDialogs.tsx:392` и `:818` — в `TableScroll` с `label` из R5.
- [ ] **Step 3: Сотрудники.**
  - Сотрудники `:214` — карточки: `name` — `title`. Роли `:345` — карточки: `name` — `title`. Терминалы `:450` —
    карточки: `device` — `title`, `actions` — `mobile: 'actions'`.
  - Действия шапки карточки сотрудников `:147` — `+ max-tablet:w-full max-tablet:flex-col max-tablet:items-stretch`.
  - `EmployeeDialog.tsx:250` и `:358` — `+ max-tablet:grid-cols-1`; журнал сотрудника `:453` — карточки, `action` —
    `title`.
  - `RoleDialog.tsx:177` — `+ max-tablet:grid-cols-1`; матрица прав уже прокручивается.
- [ ] **Step 4: Тексты** R5 в `ru/stock.json` и `tg/stock.json`.
- [ ] **Step 5: Проверка.**
  - Команды задачи 1, шаг 5.
  - Браузер, моки, 375 px:
    - заявка — «Отклонить» из карточки открывает диалог отказа; «Собрать» открывает сборку на весь экран, таблица
      строк прокручивается вбок внутри себя, поле количества и выбор партии доступны;
    - приёмка перемещения — таблица в области прокрутки, поле «Принято» вводится;
    - сотрудник из карточки открывает диалог в одну колонку, «Заблокировать» в подвале; роль — матрица прокручивается;
      «Отвязать» терминал работает из карточки.
  - Скрипт телефона: на двух экранах нарушений нет. Снимки ПК — 39 из 39.
- [ ] **Step 6: Commit** — `feat(web): transfers and employees on a phone`.

### Task 4: Остатки, смены, настройки, профиль, раздел QA

**Files:**
- Modify: `apps/web/src/pages/stock/ui/StockPage.tsx`
- Modify: `apps/web/src/pages/shift-history/ui/{ShiftHistoryPage,ShiftCardPage}.tsx`,
  `apps/web/src/entities/shift/ui/ShiftSummary.tsx`, `apps/web/src/features/force-close-shift/ui/ForceCloseShiftButton.tsx`
- Modify: `apps/web/src/pages/owner/settings/ui/{SettingsPage,CategoriesCard}.tsx`
- Modify: `apps/web/src/pages/profile/ui/ProfilePage.tsx`
- Modify: `docs/qa/01-zapusk-do-pervogo-cheka.md` (раздел 11), `docs/qa/README.md` (если перечисляет разделы)

**Interfaces:**
- Consumes: R2, R4 (задача 1); `TableScroll`, `mobileLayout`, `mobile` (PR 1).

- [ ] **Step 1: Остатки.**
  - Основная таблица `:605` — карточки: `product` — `title`, `select` — `mobile: 'hidden'` (R6).
  - «К заказу» `:577` — карточки, `product` — `title`.
  - Строка фильтров `:458` — R4; обёртка поиска `:485` — `+ max-tablet:min-w-0`.
- [ ] **Step 2: Смены.**
  - История `:214` — карточки, `number` — `title`; строка фильтров `:169` — R4.
  - Карточка смены: реквизиты `:109` — `+ max-tablet:grid-cols-1`.
  - `ShiftEventLog` (`ShiftSummary.tsx:140`) — карточки, `kind` — `title` (R7); `ShiftTotals` (`:43`) — таблица как есть.
  - `ForceCloseShiftButton.tsx:196` и `:214` — `+ max-tablet:grid-cols-1`.
- [ ] **Step 3: Настройки.** Сетки `SettingsPage.tsx:168, 210, 233, 273, 347, 365, 527, 578` —
  `+ max-tablet:grid-cols-1`; таблица наценок `:443` — в `TableScroll` (`label` — `t('markups.title')`); таблица
  категорий `CategoriesCard.tsx:78` — в `TableScroll` (`label` — `t('categories.title')`).
- [ ] **Step 4: Профиль.** `:81` — `+ max-tablet:grid-cols-1`, `:88` — `+ max-tablet:col-span-1` (R8); `:490` —
  `+ max-tablet:grid-cols-1`; терминалы `:413` — карточки, `device` — `title`, `actions` — `mobile: 'actions'`.
- [ ] **Step 5: Раздел QA** «11. Кабинет владельца на телефоне»: экраны раздела 5 спецификации; как проверять (Chrome
  DevTools, режим устройства 360×800 и 375×812, масштаб шрифта 100 и 120 % в меню; на настоящих Android (Chrome) и
  iPhone (Safari) — после выкладки); что считать дефектом (прокрутка страницы вбок, обрезанное поле или кнопка,
  недоступное действие); что задумано (касса, приход, инвентаризация и документы на телефоне — раскладка ПК; массовые
  действия остатков — только на ПК; от 768 px — боковое меню).
- [ ] **Step 6: Проверка.**
  - Команды задачи 1, шаг 5.
  - Браузер, моки, 375 px: остатки — карточки без чекбоксов, поиск на всю ширину; смена — открывается из карточки
    истории, реквизиты в колонку, журнал карточками, Z-отчёт прокручивается внутри себя; настройки — поля в колонку,
    таблицы в областях прокрутки, поле наценки вводится; профиль — смена пароля и PIN друг под другом, «Отвязать» из
    карточки.
  - Скрипт телефона: на всех 11 маршрутах при 360 и 375 px, 100 и 120 % — `scrollWidth === innerWidth` и пустой
    список обрезанного. Снимки ПК — 39 из 39.
  - Снимки 375 px всех экранов — пользователю.
- [ ] **Step 7: Commit** — `feat(web): stock, shifts, settings and profile on a phone; the QA section for phones`.
