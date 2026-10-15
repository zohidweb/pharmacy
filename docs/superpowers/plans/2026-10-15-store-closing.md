# Закрытие точки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** владелец закрывает точку с API. Весь товар уходит перемещениями по 500 строк, точка «закрывается», пока товар в пути, и закрывается после приёмки последнего перемещения. Закрытие можно отменить, пока ничего не принято. Пустая точка закрывается сразу.

**Architecture:**
- Модуль `stores` получает сервис `StoreClosingService` и три маршрута. Чужие факты он берёт через экспорты:
  - `inventory` — новый `StoreClosingTransfers`: блокеры, остатки, отправка, отзыв перемещений закрытия;
  - `pos` — открытые смены, `purchasing` — заказы и долги;
  - `terminals` — отзыв терминалов, `pricing` — отвязка скидочных правил.
- Приёмка перемещения сообщает о себе через новый порт `TransferAcceptance` модуля `inventory`. Модуль `stores` регистрирует слушателя: тот закрывает точку в транзакции приёмки, а отзыв сессий терминалов выполняет после коммита.
- Охват сотрудников сохраняет закрытые точки. Отчёты берут закрытые точки за периоды до их закрытия.

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), node-pg-migrate (SQL, только Up), RLS через `tenantTransaction`; Next.js static export, TanStack Query, use-intl, `@pharmacy/ui`; Jest (только существующие наборы).

**Spec:** `docs/superpowers/specs/2026-10-15-store-closing-design.md` — решения Z1–Z6, E1–E15, разделы 4–11.

## Global Constraints

**Тесты.**
- Новых автотестов нет (правило «тесты до MVP»). Существующие наборы остаются зелёными: `shared-*`, `api`, `api:integration`, `web`, `web-e2e`, обязательно и `npx nx test api`.
- Проверка живая: curl-скрипт `sc_closing.sh` в scratchpad (на `pos_setup.sh`) и браузер (`api-oc-4210` + `web-partial-4210`).

**Окружение Windows.**
- Nx: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, `--parallel=1`.
- `api-oc-4210` раздаёт `dist`: после сборки — перезапуск.
- Типы библиотек в `dist`: после правки контракта — `npx tsc -b libs/shared/dto/tsconfig.lib.json libs/shared/domain/tsconfig.lib.json --force`.
- Скрипты с кавычками пишутся инструментом Write.

**Git.**
- Ветка `feature/store-closing` без upstream: `git switch -c feature/store-closing --no-track origin/main`; проверка `git rev-parse --abbrev-ref feature/store-closing@{u}` должна выдать ошибку.
- Коммиты — `git commit --no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Не коммитить `package.json`, `apps/web/next-env.d.ts`, `.claude/launch.json`, `.claude/agent-memory/`.

**Права и точка.**
- Права: `stores:delete` на все три маршрута; закрытие и отмена — ещё и свежий вход (`@RequireFreshAuth`; в web — `withFreshAuth`).
- Точка закрытия — в охвате сотрудника (вне — 403 `store_not_in_scope`). Закрыть можно только `status = 'active'`, `mode = 'online'`:
  - офлайн и `offline_pending` → 409 `offline_store_read_only`;
  - `closing` → 409 `store_closing`;
  - `closed` → 409 `store_closed`.
- Последняя точка сети в статусе `active` (любого режима) → 409 `last_store`.

**Получатель.**
- Нужен, только если у точки есть товар.
- Это другая точка сети, `active` и `online`, аптека или склад, охват не проверяется. Иначе 422 `validation_failed` (`receiverStoreId`, `invalid`).
- У пустой точки `receiverStoreId` игнорируется (может быть `null`).

**Блокеры (E7).** Любой ненулевой → 409 `store_not_closable` с `errors[]` вида `{ field: <код>, code: 'blocked' }`. Коды:
- `open_shift` — открытые смены точки;
- `stock_count` — идёт инвентаризация;
- `incoming_transfer` — обычные перемещения в пути на точку;
- `outgoing_transfer` — обычные перемещения в пути с точки;
- `transfer_request` — заявки `draft` / `sent` / `in_progress`, где точка — любая сторона;
- `negative_stock` — партии с отрицательным остатком;
- `period_closed` — `closed_until` ≥ сегодня.

**Предупреждения (E8).**
- `draft_documents` — черновики складских документов;
- `open_purchase_orders` — заказы поставщикам точки со статусом не `closed`;
- `unpaid_receipts` — неоплаченные проведённые приходы; `amountMinor` — только с `finance:view-cost`.

**Строки перемещения (E5, E6).**
- Одна строка на партию с положительным остатком: кратно упаковке — в упаковках, иначе — в штуках. Проверка `not_divisible` не применяется.
- Порядок — по товару, затем по партии; перемещения по 500 строк; все отправляются в одной транзакции сегодняшней бизнес-датой.

**Закрытая точка (E11, E12).**
- `status = 'closed'`, `closed_at = now()`.
- Терминалы точки отозваны (`revoked_by` — `closing_started_by`).
- Точка убрана из `discount_rule_stores`; правило `store_scope = 'list'` без точек → `status = 'archived'`.
- `employee_stores` не трогаются.

**Аудит (E14):**
- `store.closing-started` (`receiverStoreId`, `transfers` — номера, `positions`);
- `store.closing-cancelled` (`transfers`);
- `store.closed` (`terminals`, `rulesDetached`, `rulesArchived`).

## Review Focus

1. **Гонка с открытием смены или складским документом в момент закрытия.** Закрытие держит строку точки `FOR UPDATE`, а открытие смены и складские записи читают её `FOR SHARE`. Поэтому одно ждёт другое, и после закрытия открытие смены — 404. Проверка — Задача 3 (curl: открытие смены после закрытия).
2. **Недостача при приёмке перемещения закрытия.** Недостача списывается на закрытой точке, точка закрыта. Отчёт «Потери» за период, захватывающий закрытие, показывает это списание. Проверка — Задачи 4 и 5 (curl).
3. **Больше 500 партий.** Получается два перемещения. После приёмки одного точка ещё «Закрывается», отмена — 409 `closing_partly_received`; после приёмки второго — «Закрыта». Проверка — Задача 4 (curl, синтетические партии).
4. **Управляющий точек A и B после закрытия A.** В сессии только B. Сохранение сотрудника не теряет A и не падает. Отчёт за период до закрытия показывает A. Проверка — Задача 4 (curl).
5. **Вскрытая упаковка делимого товара и целые упаковки неделимого.** В перемещении — строка в штуках и строка в упаковках; остаток получателя совпадает. Проверка — Задача 3 (curl).

---

### Task 1: Контракт и web на моках

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-owner.ts`
- Modify: `apps/web/src/shared/api/routes.ts`, `apps/web/src/shared/api/mocks/handlers-owner.ts`, `apps/web/src/shared/api/mocks/owner-stores.ts`, `apps/web/src/shared/api/mocks/handlers-stock.ts` (отзыв перемещения закрытия)
- Modify: `apps/web/src/pages/owner/stores/ui/StoreDialogs.tsx`, `apps/web/src/pages/owner/stores/ui/StoresPage.tsx`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/{owner,core}.json`

**Interfaces:**
- Produces (DTO):
  - `StoreClosingBlockerCode = 'open_shift' | 'stock_count' | 'incoming_transfer' | 'outgoing_transfer' | 'transfer_request' | 'negative_stock' | 'period_closed'`;
  - `StoreClosingBlocker { code: StoreClosingBlockerCode; count: number }`;
  - `StoreClosingWarningCode = 'draft_documents' | 'open_purchase_orders' | 'unpaid_receipts'`;
  - `StoreClosingWarning { code: StoreClosingWarningCode; count: number; amountMinor?: number }`;
  - `StoreClosingPreview` + `transfers: number`, `blockers: StoreClosingBlocker[]`, `warnings: StoreClosingWarning[]`;
  - `CloseStoreRequest { receiverStoreId: string | null }` (без `closeOn`);
  - `CloseStoreResponse { transferNumbers: string[]; store: OwnerStore }`;
  - `OwnerStore` + `closingTransfers: { number: string; status: 'in_transit' | 'accepted' }[]` (пусто у рабочей точки) и `closingCancellable: boolean`.
- Produces (маршрут клиента): `'stores.cancelClosing': route<OwnerStore, undefined, { id: string }>('POST', (p) => `/stores/${id}/closing/cancellation`)`.

- [ ] **Step 1: Контракт**

Типы выше. Комментарии маршрутов — права, свежий вход и коды ошибок из Global Constraints. У `OwnerStore.status` убрать пометку «`closing` is not used yet». Пересобрать декларации библиотек.

- [ ] **Step 2: Экран закрытия (`CloseStoreDialog`)**

- Убрать поле даты.
- Блокеры — `Alert tone="warning"` со списком «{текст кода}: {count}»; кнопка закрытия недоступна, пока они есть.
- Предупреждения — `Alert tone="info"`; сумма долга — `formatMoney`, если пришла.
- `positions === 0` — текст «Остатков нет — точка закроется сразу», поле получателя скрыто, кнопка доступна, `receiverStoreId: null`.
- `transfers > 1` — текст «Товар уйдёт {n} перемещениями».
- Мутация — через `withFreshAuth`. Итог — номера перемещений через запятую, а для пустой точки — «Точка закрыта».

- [ ] **Step 3: Список и карточка точки (`StoresPage`)**

- Для `closing`: номера перемещений, их статус и кнопка «Отменить закрытие» при `closingCancellable`. Подтверждение — `Dialog tone="warning"`, затем `withFreshAuth(() => apiRequest('stores.cancelClosing', …))`, затем инвалидировать `['stores']`, `['transfers']`, `sessionQueryKey`.
- `closed` — как сейчас.

- [ ] **Step 4: Моки**

- `stores.closingPreview`: блокер `open_shift`, если у демо-смены `storeId` = точка; иначе блокеров нет. Предупреждения — из документов-черновиков мока. `transfers = ceil(lines / 500)`.
- `stores.close`:
  - правила Global Constraints (последняя точка, офлайн, `closing`/`closed`, получатель);
  - строки по партиям в упаковках или штуках;
  - пустая точка → сразу `completeStoreClosing` без перемещения;
  - `closingTransfers` в деталях точки.
- `stores.cancelClosing`: все перемещения в пути → отозвать (`transfers.recall`) и отменить; если принято хоть одно → 409 `closing_partly_received`.

- [ ] **Step 5: i18n RU/TJ**

- `owner.ownerStores.closing`:
  - `blockers.*` — 7 кодов;
  - `warnings.*` — 3 кода;
  - `emptyStore`, `transfersCount`, `closed`, `cancel`, `cancelTitle`, `cancelText`, `cancelled`;
  - удалить `closeOn`.
- `core.apiErrors`: `store_closing`, `store_not_closable`, `closing_partly_received`, `last_store`.
- `core.auditEvents`: `store_closing_started` «Начато закрытие точки», `store_closing_cancelled` «Закрытие точки отменено», `store_closed` «Точка закрыта».

- [ ] **Step 6: Наборы web**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t lint test build fsd -p web --parallel=1`
Expected: зелёные. Если спеки владельца проверяют поле даты закрытия, адаптировать (ruling в реестре).

- [ ] **Step 7: Commit**

```bash
git add libs/shared/dto apps/web/src
git commit --no-gpg-sign -m "feat(web): store closing contract on the mocks — blockers, warnings, transfers, cancellation"
```

---

### Task 2: Схема и перемещения закрытия в `inventory`

**Files:**
- Create: `apps/api/migrations/<Date.now()>_store-closing.sql`
- Create: `apps/api/src/app/inventory/store-closing-transfers.ts`, `apps/api/src/app/inventory/transfer-acceptance.ts`
- Modify: `apps/api/src/app/inventory/{inventory.module.ts, transfers.service.ts, store-access.ts, inventory.repository.ts, documents.repository.ts}`
- Modify: `apps/api/src/core/database/db.generated.ts` (через `api:db-types`)
- Modify: `docs/architecture/data-model/01-platform-org.md`, `docs/architecture/data-model/03-batches-warehouse.md`

**Interfaces:**
- Produces:
  - `ClosingStockLine { batchId; productId; productName: string; batchNumber: string; expiresOn: string; qtyPieces: number; piecesPerPack: number; costPerPieceMinor: number }`.
  - `StoreClosingTransfers` (экспорт `InventoryModule`), методы:
    - `blockers(trx, tenantId, storeId: string, today: string): Promise<StoreClosingBlocker[]>` — только ненулевые коды `inventory` (все, кроме `open_shift`);
    - `draftDocuments(trx, tenantId, storeId): Promise<number>`;
    - `stock(trx, tenantId, storeId): Promise<ClosingStockLine[]>` — только положительный остаток, по товару и партии;
    - `send(trx, ctx: { tenantId: string; employeeId: string }, storeId: string, receiverStoreId: string): Promise<{ id: string; number: string }[]>`;
    - `transfers(trx, tenantId, storeId): Promise<{ id: string; number: string; status: 'in_transit' | 'received' | 'cancelled' }[]>`;
    - `cancel(trx, ctx, storeId): Promise<string[]>` — номера отозванных перемещений; 409 `closing_partly_received`, если есть `received`.
  - `TransferAcceptance` (экспорт), порт по образцу `TerminalRevocationChecks`:
    - `register(listener: TransferAcceptanceListener): void`;
    - `notify(trx, tenantId, transferId): Promise<Array<() => Promise<void>>>`;
    - `TransferAcceptanceListener = (trx, tenantId, transferId) => Promise<(() => Promise<void>) | void>`.
  - `StoreAccess.writableStore` читает строку точки `FOR SHARE`.

- [ ] **Step 1: Миграция** (по разделу 4 спецификации)

- `stores_status_check` → `('active', 'closing', 'closed')`.
- Колонки `stores.closing_started_at timestamptz`, `closing_started_by uuid` (FK сотрудник), `closing_receiver_store_id uuid` (FK точка).
- Проверка: `status <> 'closing' or (closing_started_at is not null and closing_started_by is not null)`. Получатель может быть `null` только у пустой точки, которая сразу закрыта.
- Индексы по двум новым FK.
- `documents.store_closing boolean not null default false` и проверка `not store_closing or type = 'transfer'`.
- Частичный индекс `documents (tenant_id, store_id) where store_closing`.
- Шапка — ссылка на спецификацию.

Затем `api:migrate` и `api:db-types`.
Expected: `Applied 1 migration(s)`, в `db.generated.ts` есть новые колонки.

- [ ] **Step 2: `StoreClosingTransfers`**

**`send`:**
1. `stock()`, затем разбиение по 500.
2. Для каждой части — документ `transfer` через `DocumentsRepository.insertDocument` с `storeClosing: true`; номер — `Numbering.next(…, 'transfer', today)`.
3. Строки — `TransfersRepository.replaceTransferLines`; единица — по Global Constraints.
4. Отправка — `TransferPosting.send(trx, ctx, doc, sender)`. `sender` читается без проверки статуса, но с проверкой `online`.

**`cancel`:** для каждого `in_transit` — `TransferPosting.recall`, затем `markCancelled` и аудит `transfer.cancelled`, как `TransfersService.cancel`.

**`blockers`:**
- `stock_count` — `inventory`-черновик точки;
- `incoming_transfer`, `outgoing_transfer` — `transfer in_transit` без `store_closing`;
- `transfer_request`;
- `negative_stock` — `StockRepository.batchStock` с `qty < 0`;
- `period_closed` — `closed_until >= today`.

**`draftDocuments`:** `status = 'draft'` и тип не `inventory` и не `transfer_request`.

- [ ] **Step 3: Порт приёмки**

`TransfersService.accept`:
1. После `posting.accept` внутри транзакции вызывает `acceptance.notify(trx, tenantId, doc.id)`.
2. Сохраняет полученные функции и выполняет их после того, как транзакция завершилась успешно.
3. Ошибка функции после коммита пишется в лог и в ответ не уходит.

- [ ] **Step 4: Блокировка строки точки**

`InventoryRepository.store(…, { lock: 'share' })` и `writableStore` с `FOR SHARE`; `counterpartStore` — без блокировки.

- [ ] **Step 5: Документы**

- Модель 01: колонки `stores`, статус `closing`.
- Модель 03: `documents.store_closing`, перемещения закрытия.

- [ ] **Step 6: Сборка и наборы**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t build lint test -p api --parallel=1`, затем `… npx nx run api:integration`.
Expected: зелёные (158/158).

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations apps/api/src docs/architecture/data-model
git commit --no-gpg-sign -m "feat(api): store closing transfers — schema, chunked dispatch, recall, acceptance port"
```

---

### Task 3: Предпросмотр, закрытие и отмена в `stores`

**Files:**
- Create: `apps/api/src/app/stores/store-closing.service.ts`, `apps/api/src/app/stores/store-closing.controller.ts`, `apps/api/src/app/stores/dto/store-closing.dto.ts`
- Modify: `apps/api/src/app/stores/{stores.module.ts, stores.service.ts, stores.repository.ts}`
- Modify: `apps/api/src/app/pos/{pos-shifts.ts, shifts.repository.ts, pos-context.ts, shifts.service.ts}`
- Modify: `apps/api/src/app/purchasing/supplier-dues.ts`
- Modify: `apps/api/src/app/platform/tenants/tenants.repository.ts`

**Interfaces:**
- Consumes: Task 2 — `StoreClosingTransfers`, `TransferAcceptance`.
- Produces:
  - `PosShifts.openShiftsOfStore(trx, tenantId, storeId): Promise<number>`;
  - `PosContext.cloudStore(…, { lock?: 'share' })` — открытие смены читает строку точки `FOR SHARE`;
  - `SupplierDues.openOfStore(trx, tenantId, storeId): Promise<{ openOrders: number; unpaidReceipts: number; unpaidMinor: number }>`;
  - `StoresRepository.lockStore(trx, tenantId, storeId): Promise<StoreRow | null>` (`FOR UPDATE`);
  - `StoresRepository.startClosing(trx, tenantId, storeId, employeeId, receiverStoreId: string | null)`, `cancelClosing(…)`, `markClosed(…)`, `activeCount(trx, tenantId): Promise<number>`;
  - `StoreRow` + `closingReceiverName: string | null`, `closedOn: string | null` (дата в часовом поясе сети, SQL).
  - `StoreClosingService`:
    - `preview(id): Promise<StoreClosingPreview>`;
    - `close(id, body: CloseStoreRequest): Promise<CloseStoreResponse>`;
    - `cancel(id): Promise<OwnerStore>`;
    - внутренний `complete(trx, tenantId, storeId): Promise<() => Promise<void>>` — готов в Задаче 4; здесь для пустой точки только смена статуса.
  - `toOwnerStore(row, closing: { transfers: …; cancellable: boolean })`: `status` из БД (`closing` → `closing`), `closedOn`, `stockMovedTo = closingReceiverName`; `closingTransfers` — перемещения закрытия без `cancelled`, `received` → `accepted`; `closingCancellable` — `closing` и ни одного `received`. Перемещения читаются только для точек `closing` и `closed`.

- [ ] **Step 1: Экспорты `pos` и `purchasing`**

- `openShiftsOfStore` — `count(*)` смен точки со `status = 'open'`.
- `cloudStore` с `lock: 'share'` вызывает только `ShiftsService.open`.
- `openOfStore` — заказы `status <> 'closed'`, а долг — как у `SupplierDues.debts`, по одной точке.

- [ ] **Step 2: Предпросмотр и закрытие**

Порядок проверок в `close` (одна транзакция):
1. `lockStore` → 404 вне охвата или нет точки.
2. Статус и режим → 409.
3. `activeCount === 1` → 409 `last_store`.
4. Блокеры: `openShiftsOfStore` + `blockers` → 409 `store_not_closable`.
5. `stock()` пусто → закрытие сразу, без получателя.
6. Иначе получатель (422), затем `send`, затем `startClosing`.
7. Аудит `store.closing-started` (`storeId` — точка), ответ.

`preview` выполняет те же проверки 1–3 и отдаёт блокеры, а не бросает их. Себестоимость — только с `finance:view-cost`.

- [ ] **Step 3: Отмена**

1. `lockStore`; статус не `closing` → 409 `store_closed` или 404.
2. `StoreClosingTransfers.cancel`, затем `cancelClosing` (поля `closing_*` → `null`, статус `active`).
3. Аудит `store.closing-cancelled`.

- [ ] **Step 4: Контроллер**

`@Controller({ path: 'stores', version: '1' })`:
- `@Get(':id/closing-preview')`;
- `@Post(':id/closing')` с `@RequireFreshAuth()`;
- `@Post(':id/closing/cancellation')` с `@RequireFreshAuth()`.

Все — `@RequirePermission('stores:delete')` и `ParseUUIDPipe`. DTO: `receiverStoreId` — `@ValidateIf(v !== null) @IsUUID()`.

`StoresModule` импортирует `InventoryModule`, `PosModule`, `PurchasingModule`, `TerminalsModule`, `PricingModule`, `AuthModule`; цикла нет — проверено. Реестр платформы считает `closing` активной точкой.

- [ ] **Step 5: Сборка, наборы, живая проверка `sc_closing.sh` (часть 1)**

Run: build/lint/test api, затем `api:integration`, перезапуск `api-oc-4210`.

Сценарий на `pos_setup.sh` — точка A с товаром: делимый товар со вскрытой упаковкой и неделимый.
- Открытая смена на A → предпросмотр с `open_shift: 1`, закрытие 409 `store_not_closable`. Закрыть смену.
- Перемещение в пути с A → `outgoing_transfer`; отозвать. Заявка → `transfer_request`.
- Предпросмотр без блокеров: позиции, `transfers: 1`, предупреждения.
- Закрытие без свежего входа → 403 `fresh_auth_required`; с ним → номер перемещения.
- Строки перемещения: штуки у вскрытой упаковки, упаковки у неделимого (RF5).
- A `closing`; открытие смены на A → 404 (RF1); проведение прихода на A → 404; повторное закрытие → 409 `store_closing`.
- Отмена → остаток A вернулся, A `active`.
- Пустая точка C (новая) → закрыта сразу, `transferNumbers: []`.
- Закрыть последнюю → 409 `last_store`.
- Офлайн-точки в dev нет — правило проверяется по коду (ruling).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit --no-gpg-sign -m "feat(api): store closing — preview with blockers and warnings, chunked closing, cancellation"
```

---

### Task 4: Закрытие по приёмке, отвязка, охват и отчёты

**Files:**
- Modify: `apps/api/src/app/stores/store-closing.service.ts`
- Modify: `apps/api/src/app/terminals/terminals.service.ts`
- Create: `apps/api/src/app/pricing/store-discount-detachment.ts`; Modify: `apps/api/src/app/pricing/pricing.module.ts`
- Modify: `apps/api/src/app/staff/{employees.service.ts, staff.repository.ts}`
- Modify: `apps/api/src/app/reports/{reports.repository.ts, reports.service.ts, dashboard.service.ts}`

**Interfaces:**
- Consumes: Task 2 — `TransferAcceptance`, `StoreClosingTransfers.transfers`; Task 3 — `StoresRepository.markClosed`.
- Produces:
  - `TerminalsService.revokeOfStore(trx, tenantId, storeId, revokedBy): Promise<string[]>` — каждый активный терминал проходит через `revokeInTransaction`;
  - `TerminalsService.afterRevokeAll(tenantId, terminalIds: string[]): Promise<void>`;
  - `StoreDiscountDetachment.detachStore(trx, tenantId, storeId): Promise<{ detached: number; archived: number }>` (экспорт `PricingModule`);
  - `StaffRepository.closedStoreIdsOf(trx, tenantId, employeeId): Promise<string[]>`;
  - `ReportsRepository.reportStores(trx, tenantId, scope, from: string): Promise<ReportStore[]>` — `status in ('active','closing')` или `closed` с бизнес-датой `closed_at` ≥ `from`.

- [ ] **Step 1: Завершение закрытия**

`StoreClosingService.onModuleInit` регистрирует слушателя приёмки. Перемещение `store_closing`, у его точки нет закрывающих перемещений `in_transit`, точка в статусе `closing` → `complete`:
1. `markClosed`.
2. `revokeOfStore` с `revokedBy = closing_started_by`.
3. `detachStore`.
4. Аудит `store.closed`.

После коммита — `afterRevokeAll`. Пустая точка из Задачи 3 получает тот же `complete`.

- [ ] **Step 2: Охват сотрудника**

В `checkAssignment` при обновлении: закрытые точки, уже бывшие у сотрудника, исключаются из проверки активности и добавляются к сохраняемому охвату, даже если их нет в запросе. Новая закрытая точка → 400 `unknown_store`.

- [ ] **Step 3: Отчёты**

- `reports.service` и `dashboard.service` берут точки через `reportStores(…, from)`.
- `supplier_debts` при охвате «вся сеть» без `storeId` → `debts(trx, tenantId, today)` без списка точек (PR 2 minor 1).

- [ ] **Step 4: Сборка, наборы, живая проверка `sc_closing.sh` (часть 2)**

Run: build/lint/test api, `api:integration`, перезапуск.

- Закрытие A → приёмка у B с недостачей:
  - A `closed`, `closedOn` = сегодня по Душанбе, `stockMovedTo` = B;
  - остаток A — 0, у B — принятое;
  - списание `transfer_discrepancy` на A;
  - отчёт «Потери» за сегодня показывает A (RF2);
  - терминал A отозван (`GET /terminals` у A пуст, PIN-вход на терминал A — отказ);
  - правило «только A» — `archived`, правило «A и B» — только B.
- Управляющий A и B (RF4): сессия — только B; `PUT` сотрудника с `storeIds: [B]` → охват остаётся A и B; отчёт «Продажи по точкам» за вчера…сегодня содержит A.
- 501 партия (синтетика через `appq`, как `oc_perf.sh`) (RF3):
  - два перемещения;
  - после приёмки первого — `closing`, отмена → 409 `closing_partly_received`;
  - после приёмки второго — `closed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit --no-gpg-sign -m "feat(api): a store closes on the acceptance — terminals, discount rules, kept scope, reports of closed stores"
```

---

### Task 5: Web на API и документы

**Files:**
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-10-12-supplier-returns-transfers-design.md` (T9 — ссылка), `docs/architecture/APPROVAL.md`

**Interfaces:**
- Consumes: Task 1 — маршруты клиента; Tasks 3–4 — API.

- [ ] **Step 1: `REAL_API_ROUTES`**

`stores.closingPreview`, `stores.close`, `stores.cancelClosing`.

- [ ] **Step 2: Документы**

- CLAUDE.md:
  - граф модулей: `inventory`, `pos`, `purchasing`, `terminals`, `pricing` ← `stores` (`StoreClosingTransfers`, `TransferAcceptance`, `PosShifts`, `SupplierDues`, `TerminalsService`, `StoreDiscountDetachment`);
  - `web:dev-api` + «закрытие точки».
- T9 спецификации перемещений — «закрытие точки — спецификация 2026-10-15-store-closing».
- APPROVAL.md — строка утверждения спецификации.

- [ ] **Step 3: Наборы**

Run: `… npx nx run-many -t lint test build fsd -p web --parallel=1`, затем `… npx nx e2e web-e2e`.
Expected: зелёные.

- [ ] **Step 4: Браузер (`web-partial-4210`, владелец сценария)**

- Закрытие точки с блокером: виден текст блокера, кнопка недоступна.
- Без блокеров: список партий, предупреждения, подтверждение паролем, номер перемещения; точка «Закрывается».
- «Отменить закрытие» — точка снова активна.
- Повторное закрытие и приёмка на получателе — точка «Закрыта», дата и куда ушёл товар.
- Пустая точка — «Остатков нет — точка закроется сразу».
- Пометки «Демо-данные» нет.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src CLAUDE.md docs
git commit --no-gpg-sign -m "feat(web): store closing on the API"
```
