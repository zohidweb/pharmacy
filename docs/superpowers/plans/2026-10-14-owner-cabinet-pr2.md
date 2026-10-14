# Кабинет владельца, PR 2: отчёты — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** экран «Отчёты» `apps/web` работает с API: восемь отчётов по макету и новая сводка ПКУ, прибыль точки за
вычетом списаний и инвентаризации, количества в упаковках и штуках.

**Architecture:** `GET /reports/{kind}` в модуле `reports` (создан в PR 1) собирает таблицу из данных доменов через
их экспорты: `pos` — `SalesFigures` (продажи, себестоимость, кассиры, продажи ПКУ), `returns` — `ReturnFigures`
(возвраты и себестоимость возвращённого), `inventory` — новый `StockFigures` (потери по движениям, движение товара,
остатки на дату, сводка ПКУ), `purchasing` — `SupplierDues` (долги на сегодня). Названия точек, товаров, категорий,
сотрудников и поставщиков — join к справочным таблицам (E17). Миграции нет.

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), RLS через `tenantTransaction`; Next.js static export,
TanStack Query, use-intl; Jest (только существующие наборы).

**Spec:** `docs/superpowers/specs/2026-10-14-owner-cabinet-design.md` — PR 2: E1 (периоды отчётов до 366 дней), E3,
E18, E19, раздел 5.3, 6.5, 7, 8 «PR 2», 11.

## Global Constraints

- Тесты отложены до MVP: новые автотесты не пишутся; существующие наборы (`api`, `api:integration`, `shared-*`,
  `web`, `web-e2e`) остаются зелёными — запускать и `npx nx test api` (урок PR 1). Проверка API и экрана — живая:
  curl-скрипт `oc_reports.sh` в scratchpad сессии (на `pos_setup.sh`) и браузер (`api-oc-4210` + `web-partial-4210`).
- Nx на Windows: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, `--parallel=1`; Jest — `--testPathPatterns`;
  типы — `npx tsc -b <tsconfig> --force`; `api-oc-4210` раздаёт `dist` — перезапуск после сборки.
- Ветка `feature/owner-cabinet-reports` от свежего `origin/main`; коммиты `git commit --no-gpg-sign`, в конце
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; не коммитить `package.json`, `apps/web/next-env.d.ts`,
  `.claude/launch.json`, `.claude/agent-memory/`.
- Период отчёта: `from`, `to` (YYYY-MM-DD, обе даты включительно, бизнес-даты сети), `from` ≤ `to` ≤ сегодня, не
  длиннее 366 дней — иначе 422 `validation_failed` (`range`); `storeId` вне охвата — 403 `store_not_in_scope`; без
  `storeId` — все точки охвата (PIN-сессия — точка терминала).
- Деньги — integer дирамы; `marginPercent` = прибыль / (выручка + возвраты) × 100 с одним десятичным, `null` при
  нулевом знаменателе. Количества колонок типа `pieces` — штуки; строка несёт `piecesPerPack` (не колонка).
- Колонки денег по себестоимости (в таблице 5.3 спецификации — в скобках) без `finance:view-cost` отсутствуют в
  `columns`, в строках и в итоге.
- Итог — последняя строка таблицы `total`, первая текстовая ячейка — `'total'` (так рендерит экран).
- Отменённое проведение не учитывается: движение `reversal` относится к виду исходного движения на свою дату (документ,
  проведённый и отменённый в периоде, даёт ноль).

## Review Focus

1. Выручка точки в «Продажах по точкам» (`revenue` + `returns`) за период равна выручке главной за тот же
   «Свой период» (Задача 3, curl: оба запроса на одном сценарии).
2. Строки «Движения товара» и «ПКУ: сводка» сходятся: `opening` + приход/расход = `closing`, а `closing` на `to` =
   остаток экрана остатков (Задача 3, curl: сумма колонок и `GET /stock`).
3. Списание, проведённое и отменённое в периоде, и излишек инвентаризации: прибыль меняется только на недостачу минус
   излишек; в «Потерях» нет отменённого списания и нет излишков (Задача 3, curl).
4. Без `finance:view-cost`: в «Продажах по точкам», «по категориям», «Остатках», «Долгах», «Потерях» нет колонок денег
   по себестоимости ни в `columns`, ни в строках, ни в итоге (Задача 3, curl под ролью с `reports:view`).
5. Управляющий одной точки: без `storeId` — только своя точка; чужая — 403; «Долги поставщикам» — только приходы его
   точки (Задача 3, curl).

---

### Task 1: Контракт и web на моках

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-owner.ts`
- Modify: `apps/web/src/pages/owner/reports/ui/ReportsPage.tsx`, `apps/web/src/shared/api/mocks/handlers-owner.ts`,
  `apps/web/src/shared/i18n/messages/{ru,tg}/owner.json`, `apps/web/specs/owner.spec.tsx` (если нужно)

**Interfaces:**
- Produces: `ReportKind` + `'controlled_summary'`; `ReportColumnType` + `'pieces'`; комментарий `ReportTable`: строка
  может нести `piecesPerPack: number` для колонок `pieces` и `prescriptionPurged: 1` у продажи ПКУ с очищенными данными
  рецепта. Колонки видов — по таблице 5.3 спецификации (ключи `store`, `receipts`, `revenue`, `returns`, `cost`,
  `writeOffs`, `margin`, `marginPercent`, `category`, `positions`, `retail`, `low`, `expiring`, `product`, `opening`,
  `receipt`, `transfers`, `sales`, `supplierReturns`, `stockCount`, `closing`, `supplier`, `debt`, `overdue`,
  `nextDueOn`, `cashier`, `cash`, `card`, `qr`, `nfc`, `number`, `date`, `reason`, `quantity`, `amount`, `at`,
  `batch`, `receipt`, `prescription`, `received`, `issued`).

- [ ] **Step 1: DTO** — по Interfaces; `npx tsc -b libs/shared/dto/tsconfig.lib.json --force` — Expected: 0 ошибок.
- [ ] **Step 2: экран** — чип «ПКУ: сводка» после «Журнала ПКУ»; рендер `pieces` — «N уп. M шт.» (`piecesPerPack` 1
  или остаток 0 — «N уп.», меньше упаковки — «M шт.», знак минус сохраняется); у `controlled` при
  `prescriptionPurged` — «Данные рецепта удалены по сроку»; под «Долгами поставщикам» — пометка «На сегодня: период не
  влияет» (E18).
- [ ] **Step 3: i18n RU/TJ** — `reports.kindNames.controlled_summary`, новые `reports.columns.*` (`writeOffs` —
  «Списания и недостачи», `opening`, `closing`, `supplierReturns`, `stockCount`, `nfc`, `received`, `issued`, `store`
  для ПКУ), `reports.reasons` + `customer_return_defect`, `customer_return_expired`, `stock_count`, тексты пометок шага 2.
- [ ] **Step 4: моки** — `report()` отдаёт колонки по таблице 5.3 (в т. ч. `writeOffs` в «Продажах по точкам», `nfc` у
  кассиров, новые колонки «Движения» в штуках, `store` в ПКУ) и `controlled_summary`; данные согласованы с другими
  моками как раньше.
- [ ] **Step 5: проверка** — `npx nx run-many -t lint test --parallel=1 -p shared-dto web`, `npx nx fsd web`,
  `npx tsc -b apps/web/tsconfig.json --force`. Expected: зелёное.
- [ ] **Step 6: коммит** — `feat(web): reports contract on the mocks — ПКУ summary, pieces, new columns`.

### Task 2: Данные доменов для отчётов

**Files:**
- Modify: `apps/api/src/app/pos/sales-figures.ts`, `apps/api/src/app/returns/return-figures.ts`,
  `apps/api/src/app/purchasing/supplier-dues.ts`, `apps/api/src/app/inventory/inventory.module.ts`
- Create: `apps/api/src/app/inventory/stock-figures.ts`

**Interfaces:**
- Produces (все методы — `(trx, tenantId, storeIds: readonly string[], from: string, to: string)`, если не сказано иное;
  суммы — number, дирамы; штуки — number):
  - `SalesFigures.byStore` → `{ storeId; receipts; salesMinor; costMinor }[]` (`cost_dirams` строк);
  - `SalesFigures.byCategory` → `{ categoryId; netMinor; costMinor }[]` (строка: `line_amount_dirams` −
    `discount_share_dirams`; категория — текущая у товара);
  - `SalesFigures.byCashier` → `{ cashierId; storeId; receipts; cashMinor; cardMinor; qrMinor; nfcMinor }[]` (наличные
    = оплата `cash` − `receipts.change_dirams`);
  - `SalesFigures.controlledSales` → `{ soldAt: Date; storeId; productId; lotNumber: string | null; qtyPieces;
    piecesPerPack; cashierId; receiptNumber; prescription: ControlledSaleData | null; purged: boolean }[]` — строки
    с записью `controlled_sale_records`;
  - `ReturnFigures.byStore` → `{ storeId; refundMinor; returnedCostMinor }[]` (`qty_pieces` × `cost_per_piece_dirams`
    партии строки чека), `ReturnFigures.byCategory` → `{ categoryId; refundMinor; returnedCostMinor }[]`,
    `ReturnFigures.byCashier` → `{ cashierId; storeId; refundMinor }[]` (кассир возврата);
  - `StockFigures.lossesByStore` → `{ storeId; writeOffMinor; stockCountMinor }[]` — по движениям `write_off`,
    `inventory_loss`, `inventory_gain` и их `reversal`: стоимость = −Δштук × `cost_per_piece_dirams` (потеря > 0,
    излишек уменьшает `stockCountMinor`);
  - `StockFigures.lossLines` → `{ documentId; number; date; storeId; productId; reason: string; qtyPieces;
    piecesPerPack; amountMinor }[]` — проведённые (`status = 'posted'`) списания (`write_off_reason`) и недостачи
    инвентаризаций (`reason = 'stock_count'`) по `document_date` периода, строка = документ × товар, только потери;
  - `StockFigures.movement` → `{ productId; piecesPerPack; opening; receipt; transfers; sales; supplierReturns;
    writeOffs; stockCount; closing }[]` — знаковые штуки; приход = `goods_receipt` + `opening_balance`; продажи =
    `sale` + `customer_return`; `reversal` — к виду исходного движения; товары с движением в периоде или ненулевым
    остатком на начало;
  - `StockFigures.stockAt(trx, tenantId, storeIds, date, thresholdDays)` → `{ storeId; positions; costMinor;
    retailMinor; low; expiring }[]` — остаток на конец дня `date`; розница — по текущей цене точки: штуки × цена штуки
    `piecePriceMinor` (`libs/shared/domain`, как касса: своя цена штуки или цена упаковки с шагом
    `piece_price_rounding_dirams`), без цены — 0; `low` — как E4 на дату, `expiring` —
    партии с остатком и сроком ≤ `date` + порог;
  - `StockFigures.controlledSummary` → `{ productId; storeId; piecesPerPack; opening; received; issued; closing }[]`
    — товары `is_controlled`; приход = `goods_receipt`, `opening_balance`, `transfer_in`, `customer_return`,
    `inventory_gain`; расход (положительный) = `sale`, `write_off`, `transfer_out`, `supplier_return`,
    `inventory_loss`;
  - `SupplierDues.debts(trx, tenantId, today, storeIds?)` → `{ supplierId; supplierName; debtMinor; overdueMinor;
    nextDueOn: string | null }[]` — `supplierDebt` (`libs/shared/domain`) по проведённым приходам точек, как
    `suppliers.service`.

- [ ] **Step 1: методы** — по Interfaces; `StockFigures` в `exports` модуля `inventory`.
- [ ] **Step 2: сборка** — `npx nx run-many -t build lint --parallel=1 -p api`. Expected: зелёное.
- [ ] **Step 3: SQL** — каждый новый запрос выполнить на dev-базе через `appq` на сети прошлых проверок (`EXPLAIN` для
  движений за 366 дней) — Expected: без ошибок, индексы `stock_movements_date_idx`, `receipts_store_date_idx`.
- [ ] **Step 4: коммит** — `feat(api): report figures of the POS, returns, stock and purchasing`.

### Task 3: Отчёты API

**Files:**
- Create: `apps/api/src/app/reports/{reports.controller.ts, reports.service.ts, report-builders.ts, dto/reports.dto.ts}`
- Modify: `apps/api/src/app/reports/{reports.module.ts, reports.repository.ts}`

**Interfaces:**
- Consumes: Задача 2; `ReportsRepository.context` / `activeStores` (PR 1).
- Produces: `GET /reports/:kind` (`reports:view`) → `ReportTable`; 404 `not_found` для неизвестного `kind`.

- [ ] **Step 1: DTO** — `ReportQueryDto`: `from`, `to` (`@IsCalendarDate`, обязательные), `storeId?` (UUID);
  `kind` — параметр пути, `@IsIn` списка `ReportKind` → иначе 404.
- [ ] **Step 2: сервис** — период и охват (Global Constraints), справочники имён (точки, товары на языке сотрудника,
  категории, сотрудники, поставщики) через `reports.repository`, затем сборка вида.
- [ ] **Step 3: сборщики** (`report-builders.ts`, чистые функции от данных Задачи 2 и флага `canSeeCost`) — по
  таблице 5.3 спецификации:
  - `sales_by_store`: строка на каждую аптеку охвата; `revenue` = продажи; `returns` = −возвраты; `cost` = себестоимость
    проданного − возвращённого; `writeOffs` = −(списания + недостачи − излишки); `margin` = `revenue` + `returns` −
    `cost` + `writeOffs`; итог;
  - `sales_by_category`: `revenue` = чистые строки − возвраты; `cost` = проданное − возвращённое; итог;
  - `stock`: `stockAt` на `to`; итог;
  - `movement`: строки по товару (сумма по точкам выборки), сортировка по названию, итога нет;
  - `supplier_debts`: `debts` на сегодня; итог только с правом;
  - `cashiers`: способы + `returns` (−) + `revenue`; итог;
  - `losses`: `lossLines`, новые сверху; итог — сумма `amount` (с правом);
  - `controlled`: продажи ПКУ, новые сверху; `prescription` — непустые поля рецепта через « · », `null` без данных;
  - `controlled_summary`: по товару × точке, сортировка по товару и точке.
- [ ] **Step 4: контроллер и модуль** — `ReportsController`; `ReportsModule` импортирует `PurchasingModule`.
- [ ] **Step 5: сборка** — `npx nx run-many -t build lint test --parallel=1 -p api`. Expected: зелёное.
- [ ] **Step 6: живая проверка** (`oc_reports.sh`): сценарий из двух точек:
  - продажи со скидкой;
  - возврат по желанию и брака;
  - списание, проведённое и отменённое, и ещё одно проведённое;
  - инвентаризация с недостачей и излишком;
  - перемещение A → B принятое;
  - возврат поставщику;
  - приход задним числом;
  - продажа ПКУ с рецептом.

  Ожидаемые числа посчитать в скрипте вручную и сравнить; Review Focus 1–5; период 367 дней, `to` в будущем,
  `from` > `to` — 422; `kind=foo` — 404; кассир — 403.
- [ ] **Step 7: регрессия** — `npx nx run api:integration`. Expected: зелёное.
- [ ] **Step 8: коммит** — `feat(api): owner reports — sales, profit, stock, movement, debts, cashiers, losses, ПКУ`.

### Task 4: Web на API и документы

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES`), `CLAUDE.md`

- [ ] **Step 1: маршрут** — `reports.get` в `REAL_API_ROUTES`.
- [ ] **Step 2: браузер (`partial`)** — владелец: все 9 отчётов за месяц и за выбранные даты, фильтр точки, итоги,
  «N уп. M шт.», пометка «Демо-данные» исчезла; роль без `finance:view-cost` — без колонок денег; управляющий — своя
  точка. Expected: числа как в `oc_reports.sh`, консоль без ошибок.
- [ ] **Step 3: проверка** — `npx nx run-many -t lint test --parallel=1 -p web`, `npx nx fsd web`,
  `npx nx e2e web-e2e`. Expected: зелёное.
- [ ] **Step 4: CLAUDE.md** — `web:dev-api`: «…, журнал действий, настройки сети, отчёты».
- [ ] **Step 5: коммит** — `feat(web): owner reports on the API`.
