# Склад и поставщики (PR-1) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** товар появляется на точке партиями: приход от поставщика и ввод начальных остатков проводятся и
отменяются по API, остатки выводятся из движений, цена точки и долг поставщику пишутся при проведении; экраны
«Остатки», «Приход», «Ввод начальных остатков», «Поставщики» и партии в карточке товара работают с API.

**Architecture:** миграция `inventory-core` (поставщики, счётчики, шапка документов, партии, строки прихода и НО,
секционированные движения, журнал расчётов). Модуль `purchasing` (поставщики, `SupplierLedger`), модуль `inventory`
(документы, проведение, остатки) — только облако; `inventory` импортирует `catalog`, `pricing` (новый
`StorePriceWriter`) и `purchasing`, обратных зависимостей нет. `apps/web`: контракт, моки, `REAL_API_ROUTES`, новый
экран НО.

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), node-pg-migrate (SQL, только Up), class-validator,
Next.js static export, TanStack Query, use-intl, `libs/ui`.

**Spec:** `docs/superpowers/specs/2026-10-09-inventory-purchasing-design.md` (утверждена 2026-10-09, включая
поправку модели I2) — разделы 3.1, 4, 5.1, 6–8 (части PR-1), 10, 11.

## Global Constraints

- Новые автотесты не пишутся до MVP (решение 2026-10-05); существующие наборы — зелёные. Проверка — живая
  (curl, браузер) по разделу 11 спецификации.
- Ни одной новой библиотеки.
- `InventoryModule`, `PurchasingModule` — `ConditionalModule.registerWhen(…, env.STORE_MODE !== 'offline')`.
- Только `TenantDatabase.tenantTransaction`; модули — через `exports` (ADR-0002). Таблицы организации (`stores`,
  `legal_entities`, `tenant_settings`) читаются репозиториями напрямую, как в `pricing`.
- Остаток не хранится: сумма `stock_movements.qty_delta_pieces` по партии. Документ и его движения — одна
  транзакция. Партии блокируются `FOR UPDATE` одним оператором, остаток считается следующим (ADR-0006).
- Деньги — `bigint` дирамы (`BigInt` из пула → `Number` в DTO); количество в БД — штуки, в API — упаковки
  (`qty_pieces = packs × pieces_per_pack`); `cost_per_piece = ceil(цена упаковки / штук)`.
- Права — таблицы 4.1, 4.2, 5.1 спецификации; `finance:view-cost` — поля закупки отсутствуют без него.
- Коды ошибок — раздел 7 (без `idempotency_conflict`, `order_not_editable` — это PR-2).
- Аудит (та же транзакция): `supplier.created`, `supplier.updated`, `document.created`, `document.updated`,
  `document.posted`, `document.unposted`, `price.changed` (`details.source: 'document'`, `documentId`).
- Лимиты: серия ≤ 60; упаковки 1–100 000; цены 0–10¹⁰ (розница 1–10¹⁰); строк 1–500; номер накладной ≤ 60;
  название поставщика 1–200, уникально без учёта регистра; ИНН — 9 цифр или пусто; отсрочка 0–365.
- Номера: `ПР-<stores.code>-<год даты документа>-<6 цифр>`, `НО-…`; счётчик `document_counters` по виду
  `goods_receipt` / `opening_balance`.
- Тексты web — RU и TJ; Conventional Commits; GPG — pinentry; перед PR пользователь запускает `npm run check`.

## Review Focus

Тестов нет — пункты проверяются живой проверкой задачи-владельца и финальным ревью:

1. Два одновременных `POST …/posting` одного прихода → одно проведение (партии и движения один раз), второй —
   409 `document_posted` (Задача 5, curl двумя фоновыми запросами).
2. Отмена проведения после движения `sale` по партии документа → 409 `unpost_blocked` и ничего не изменено; без
   него — сторно, остаток 0, долг снят (Задача 5, curl + вставка `sale` ролью приложения).
3. Повторное проведение после отмены без правок — те же партии; после правки строки — новая партия, старая с
   нулевым остатком не попадает в «Остатки» (Задача 5, curl).
4. Строка с розницей выше предельной цены или сотрудник без права на цену точки → 422 / 403, документ остаётся
   черновиком, движений нет (Задача 5, curl).
5. Дата документа в будущем, раньше окна задним числом, в закрытом периоде юрлица → 422 у поля `date`
   (`period_closed` для закрытого) (Задача 5, curl с `closed_until`, выставленным SQL).

---

### Task 1: Схема склада и поставщиков

**Files:**
- Create: `apps/api/migrations/<Date.now()>_inventory-core.sql`
- Modify: `apps/api/src/core/database/table-classes.ts` (`TABLE_CLASSES`, `APPEND_ONLY_TABLES`), `db.generated.ts`
- Modify: `apps/api/src/app/app.module.ts` (`InventoryModule`, `PurchasingModule` — облако)

**Interfaces:**
- Produces: таблицы раздела 3.1 спецификации; функция `pharmacy.forbid_mutation()` (уже есть) на
  `stock_movements` и `supplier_ledger_entries`; секции `stock_movements_YYYY_MM` 2026-10…2028-12.

- [ ] **Step 1: миграция** по образцу `1790934768191_auth-identity-audit.sql` (секции, триггеры, без грантов на
  секции) и `1791372899143_catalog-pricing.sql` (RLS, политики, гранты). `stock_movements` и
  `supplier_ledger_entries` — `grant select, insert`; остальные — полный DML.
- [ ] **Step 2: манифест** — 8 таблиц `'tenant'`; `APPEND_ONLY_TABLES` + `stock_movements`,
  `supplier_ledger_entries`; модули — под `registerWhen`.
- [ ] **Step 3: проверка.**
  Run: `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration`
  Expected: миграция применена; в `db.generated.ts` 8 новых интерфейсов; интеграционные — зелёные (манифест,
  RLS, гранты, append-only, секции без прав).
- [ ] **Step 4: коммит** `feat(api): inventory and suppliers schema`.

### Task 2: Контракт и моки web

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-inventory.ts`
- Modify: `apps/web/src/shared/api/routes.ts`, `mocks/handlers-stock.ts`, `mocks/db-stock.ts` (НО, партии карточки)
- Modify: экраны, которые перестали компилироваться (`StockPage`, редактор прихода, `ProductForm`/`ProductPage`)

**Interfaces:**
- Produces (контракт): `StockRow.retailPriceMinor: number | null`; `StockProductOption.retailPriceMinor: number |
  null`, `markupPercent: number | null`; `ProductBatchRow { storeId, storeName, batchId, batchNumber, expiresOn,
  quantityPieces, costMinor? }`; `OpeningBalanceLine { productId, productName, batchNumber, expiresOn, quantity,
  costMinor, retailPriceMinor: number | null, starting: boolean }`; `OpeningBalance { id, number, status, date,
  storeId, storeName, comment, lines, totalMinor, createdBy, postedBy }`; `OpeningBalanceInput = Pick<…, 'date' |
  'storeId' | 'comment'> & { lines: Omit<OpeningBalanceLine, 'productName'>[] }`; `OpeningBalanceListItem { id,
  number, date, storeName, positions, totalMinor?, status }`; `OpeningBalanceListResponse extends
  Page<OpeningBalanceListItem>`; `StockDocumentKind` + `'opening-balances'`.
- Produces (маршруты web): `openingBalances.list/get/create/update/post/unpost` (`/opening-balances…`, как
  `goodsReceipts.*`), `stock.productBatches` (`GET /stock/products/{productId}/batches` → `ProductBatchRow[]`).

- [ ] **Step 1: контракт** с JSDoc маршрутов и кодами раздела 7.
- [ ] **Step 2: маршруты и моки** (НО по образцу прихода в моках, без поставщика и долга; партии карточки из
  мок-партий).
- [ ] **Step 3: компиляция экранов** (без новых функций — они в Задаче 7).
- [ ] **Step 4: проверка.**
  Run: `npx tsc -b libs/shared/domain libs/shared/dto && npx tsc --noEmit -p apps/web/tsconfig.json && npx nx
  run-many -t lint test --parallel=1 -p shared-dto web`
  Expected: зелёное.
- [ ] **Step 5: коммит** `feat(dto): stock contract — opening balances, product batches, nullable store prices`.

### Task 3: Модуль `purchasing` — поставщики и журнал расчётов

**Files:**
- Create: `apps/api/src/app/purchasing/{purchasing.repository, suppliers.service, suppliers.controller,
  supplier-ledger, suppliers-reader}.ts`, `dto/purchasing.dto.ts`
- Modify: `apps/api/src/app/purchasing/purchasing.module.ts` (`exports: [SuppliersReader, SupplierLedger]`)

**Interfaces:**
- Produces:
  ```ts
  class SuppliersReader {
    findActive(trx: TenantTransaction, tenantId: string, id: string):
      Promise<{ id: string; name: string; paymentTermDays: number } | null>;
    names(trx: TenantTransaction, tenantId: string, ids: readonly string[]): Promise<Map<string, string>>;
  }
  class SupplierLedger {
    receiptPosted(trx: TenantTransaction, e: { tenantId: string; supplierId: string; legalEntityId: string;
      documentId: string; amountDirams: number; dueDate: string | null; businessDate: string;
      employeeId: string }): Promise<void>;
    receiptUnposted(trx: TenantTransaction, e: Omit<Parameters<SupplierLedger['receiptPosted']>[1], 'dueDate'>):
      Promise<void>; // reversal (−amount)
  }
  ```
- Produces (HTTP): маршруты 5.1 спецификации, ответы `SupplierOption[]`, `SupplierListResponse`, `SupplierCard`
  (`orders: []` до PR-2; `ledger` — записи журнала: `goods_receipt` → `receipt`, `reversal` с документом).

- [ ] **Step 1: DTO** — `SupplierInput` (лимиты Global Constraints), список (`limit` 1–100).
- [ ] **Step 2: репозиторий и сервис** — уникальность названия `toLocaleLowerCase('ru')` → 409
  `supplier_name_taken` (поле `name`); долг/просрочка: остаток прихода = `total_dirams` проведённых приходов
  поставщика (в PR-1 оплат нет), `debtState` по бизнес-дате сети; аудит.
- [ ] **Step 3: контроллер** — права 5.1; `GET /suppliers/options` — активные, по названию.
- [ ] **Step 4: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное; curl: создать,
  дубль названия 409, правка, список, карточка без/с `finance:view-cost` (кассир → 403 на карточку).
- [ ] **Step 5: коммит** `feat(api): suppliers and their ledger`.

### Task 4: `StorePriceWriter` в `pricing`

**Files:**
- Create: `apps/api/src/app/pricing/store-price-writer.ts`
- Modify: `prices.service.ts` (запись цены — через writer), `pricing.module.ts` (`exports: [StorePriceWriter]`)

**Interfaces:**
- Produces:
  ```ts
  class StorePriceWriter {
    /** 403 forbidden without the right on the store, 422 above_max_price (field) unless confirmed. */
    set(trx: TenantTransaction, input: { tenantId: string; productId: string; storeId: string;
      priceMinor: number; maxPriceMinor: number | null; confirmAboveMax: boolean;
      field: string; source: 'prices' | 'document'; documentId?: string }): Promise<'changed' | 'unchanged'>;
    /** Prices of packs at the stores; no key — not sold there. */
    pricesAt(trx: TenantTransaction, tenantId: string, storeIds: readonly string[],
      productIds: readonly string[]): Promise<Map<string /* `${storeId}/${productId}` */, number>>;
  }
  ```
  Права — как в `PricesService.update` (своя точка — `update-store` или `update-network`, чужая — `update-network`);
  блокировка строки цены, `price_version + 1`, `price.changed`.

- [ ] **Step 1: writer** и перевод `PricesService.update` на него (поведение `PUT /prices` не меняется).
- [ ] **Step 2: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1`; повтор
  `t4_check.sh` из каталога (цены и скидки) — те же ответы.
- [ ] **Step 3: коммит** `refactor(api): store price writer for documents`.

### Task 5: Модуль `inventory` — приход и НО

**Files:**
- Create: `apps/api/src/app/inventory/{inventory.repository, documents.repository, numbering, goods-receipts.service,
  opening-balances.service, posting, goods-receipts.controller, opening-balances.controller,
  unposting-check.controller}.ts`, `dto/documents.dto.ts`
- Modify: `apps/api/src/app/inventory/inventory.module.ts` (`imports: [AuditModule, CatalogModule, PricingModule,
  PurchasingModule]`)
- Modify: `apps/api/src/app/catalog/products-reader.ts` (+ `findForStock(trx, tenantId, ids)` →
  `{ id, name, status, piecesPerPack, maxPriceMinor }[]`)

**Interfaces:**
- Consumes: `ProductsReader.findForStock`, `StorePriceWriter.set`, `SuppliersReader`, `SupplierLedger` (Задачи 3–4).
- Produces: `numbering.next(trx, tenantId, store: { id, code }, kind: 'goods_receipt' | 'opening_balance',
  date: string): Promise<string>`; `inventory.repository.ts` — `storeForWrite(trx, tenantId, storeId)` →
  `{ id, code, name, mode, legalEntityId, closedUntil }`, `businessDate(trx, tenantId)`,
  `batchStock(trx, tenantId, batchIds)`; общий `posting.ts` — `postLines(...)` / `unpostDocument(...)` для обоих типов.

- [ ] **Step 1: DTO** — `GoodsReceiptInput`, `OpeningBalanceInput`, `DocumentListQuery` (лимиты Global Constraints).
- [ ] **Step 2: черновик** — охват (403), `mode = 'online'` (409 `offline_store_read_only`), поставщик активный,
  срок оплаты по умолчанию `date + payment_term_days`, номер при создании, замена строк с сохранением партии
  неизменённой строки (товар, срок, серия, цена), правка проведённого → 409 `document_posted`; аудит.
- [ ] **Step 3: проведение** — шаги 1–8 раздела 4.1 (шаг 7 — только `receiptPosted`); `period_closed` — 422 у
  поля `date`; ошибки строк — `lines.<i>.<field>`.
- [ ] **Step 4: отмена и проверка отмены** — раздел 4.1; `blockers` — товар, серия, количество расхода,
  номера документов-источников.
- [ ] **Step 5: список и карточка** — фильтры, KPI (проведено за месяц бизнес-даты, сумма с `finance:view-cost`,
  черновики), `GET …/{id}` с `finance:view-cost`.
- [ ] **Step 6: проверка.** curl по 11 (PR-1, документы) + Review Focus 1–5;
  `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное.
- [ ] **Step 7: коммит** `feat(api): goods receipts and opening balances with posting`.

### Task 6: Остатки

**Files:**
- Create: `apps/api/src/app/inventory/{stock.repository, stock.service, stock.controller}.ts`, `dto/stock.dto.ts`

**Interfaces:**
- Consumes: `ProductsReader` (поиск — `productConditions` каталога через новый
  `ProductsReader.searchIds(trx, tenantId, q)`: `Promise<string[] | null>` — null без `q`), цены точки — только
  через `pricing`: новый метод `StorePriceWriter.pricesAt(trx, tenantId, storeIds, productIds)` →
  `Map<\`${storeId}/${productId}\`, number>` (нет ключа — цены нет); `stock.repository` таблицу `store_products`
  не читает.
- Produces: маршруты 4.2 (кроме дефицита).

- [ ] **Step 1: `GET /stock`** — строки партий с ненулевым остатком + «нет в наличии»; состояние `stockState`
  (`shared-domain`); `counts`; сортировки; `limit` 1–100.
- [ ] **Step 2: `GET /stores/{storeId}/stock-products`** — до 50 товаров, партии точки FEFO.
- [ ] **Step 3: `GET /stock/products/{productId}/batches`**.
- [ ] **Step 4: проверка.** curl: остатки после приходов, «мало» (минимум из карточки), «истекает» (срок в
  окне), «нет в наличии», фильтр точки, чужая точка 403, без `finance:view-cost` нет закупки; партии карточки.
  `npx nx run-many -t build typecheck lint -p api --parallel=1`.
- [ ] **Step 5: коммит** `feat(api): stock levels from movements`.

### Task 7: Web — склад и поставщики на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES`, правило `documents.unpostCheck` по `kind`)
- Modify: `apps/web/src/pages/stock/ui/StockPage.tsx`, `pages/goods-receipts/ui/GoodsReceiptsPage.tsx`,
  `widgets/goods-receipt-editor/ui/GoodsReceiptEditor.tsx`, `pages/catalog/ui/ProductPage.tsx`,
  `pages/suppliers/ui/*.tsx`
- Create: `apps/web/src/pages/opening-balances/{index.ts, ui/OpeningBalancesPage.tsx, ui/OpeningBalanceEditor.tsx}`,
  `apps/web/app/(shell)/opening-balances/page.tsx`
- Modify: `apps/web/src/shared/config/routes.ts` (`openingBalances`), `widgets/app-shell/config/navigation.ts`
  (пункт после `goodsReceipts`, `inventory:view`), i18n `ru`/`tg`

- [ ] **Step 1: маршруты** — список 8 спецификации (PR-1); `documents.unpostCheck` — в API только при
  `kind ∈ {goods-receipts, opening-balances}`.
- [ ] **Step 2: остатки** — «—» без цены.
- [ ] **Step 3: приход** — предупреждение «выше предельной» в строке до проведения; ошибки строк
  `lines.<i>.<field>` и `period_closed` — у полей.
- [ ] **Step 4: НО** — список и редактор (товар, серия, срок, упаковки, закупка, розница — необязательна,
  «стартовая партия»), проведение и отмена как у прихода.
- [ ] **Step 5: карточка товара** — блок партий (`stock.productBatches`, `inventory:view`).
- [ ] **Step 6: поставщики** — список, карточка, создание и правка на API; оплата — на моках до PR-2.
- [ ] **Step 7: тексты** RU/TJ.
- [ ] **Step 8: проверка.** Браузер (`web:dev-api` на 4210): поставщик → приход → проведение → остатки, цена
  точки, партии в карточке, долг в «Поставщиках»; НО; отмена. `npx nx run-many -t build && npx nx run-many -t
  typecheck lint test fsd --parallel=1 -p web` и `npx nx e2e web-e2e` — зелёные.
- [ ] **Step 9: коммит** `feat(web): stock, goods receipts, opening balances and suppliers on the API`.

### Task 8: Документы

**Files:**
- Modify: `docs/architecture/data-model/03-batches-warehouse.md`, `05-purchasing.md`,
  `docs/architecture/APPROVAL.md` (строка: поправка модели I2 — розница из прихода при проведении, утверждено
  2026-10-09), `CLAUDE.md`, `.claude/skills/nestjs-api/reference/nestjs-conventions.md`

- [ ] **Step 1: правки** — раздел 10 спецификации (части PR-1).
- [ ] **Step 2: коммит** `docs: inventory core and suppliers — data model, CLAUDE.md`.
