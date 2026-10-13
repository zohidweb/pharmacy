# Касса: смена и продажа на API — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** смена кассы (открытие, внесение и изъятие, закрытие с Z-отчётом), продажа с пометками расхождения,
отложенные чеки и снимок каталога облачной точки на API; касса и смена `apps/web` на API с шифрованием данных ПКУ в
буфере; инвентаризация без ложного излишка от продаж во время пересчёта (I4).

**Architecture:** миграция `pos-shifts-sales` (смены, операции с наличными, отложенные чеки, чеки, строки, оплаты,
записи ПКУ, ключи идемпотентности; `source_type = 'receipt'`; правки `inventory_lines`). Новый модуль `pos` (только
облако) читает каталог, цены и остатки через публичные интерфейсы: `ProductsReader` (`catalog`), новый
`StorePricesReader` (`pricing`), новый `PosStock` и `Numbering` (`inventory`); права автора — `PrincipalLoader`
(`auth`). Модуль `terminals` спрашивает открытую смену через реестр проверок, который заполняет `pos` (зависимость
`pos → terminals`, без цикла). Web — тот же outbox-first буфер, маршруты кассы в `REAL_API_ROUTES`.

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), node-pg-migrate SQL (только Up), RLS через
`tenantTransaction`; Next.js static export, TanStack Query, Zustand, `idb`, WebCrypto (AES-GCM).

**Spec:** `docs/superpowers/specs/2026-10-13-pos-shift-sale-design.md` — разделы 2 (K1–K7, E1–E24, поправки 2.1),
3–11.

## Global Constraints

- Тесты отложены до MVP: новые автотесты не пишутся; существующие наборы (`api`, `shared-dto`, `shared-domain`, `web`,
  `web-e2e`) остаются зелёными. Проверка задач — живая: curl-скрипты на основе `cat_setup.sh` (scratchpad сессии) и
  браузер (`api-web4210` + `web-partial-4210`; порты 4200/4201 не трогать).
- Nx на Windows: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, по одному проекту (`--parallel=1`).
- Работа поверх незакоммиченных PR-1/PR-2 в том же дереве. Подпись GPG не обходится: если коммит невозможен —
  патч задачи (`git diff` от снимка начала задачи) в рабочую папку плана и строка в ledger.
- Деньги — integer дирамы; округление скидки — `discountAmount` (`libs/shared/domain`), цены штуки — вверх.
- `id` смены, чека и операции с наличными = `id` операции клиента (E1); `Idempotency-Key` = `id` тела.
- Номера: чек `ЧК-<код точки>-<год>-<6 цифр>` (вид `receipt`), смена `СМ-<код точки>-<год>-<6 цифр>` (вид
  `z_report`), год — по бизнес-дате (E2).
- «Продажа — факт» (K4, K7, E5–E7, E23, E24): отказ — только по списку E6; остальное — пометка. Права автора
  проверяются по текущему состоянию и дают пометку `author`, не отказ; право маршрута — у владельца сессии (403).
- Коды ошибок — раздел 7 спецификации; 403 только для сессии и охвата (буфер на 401/403 встаёт на паузу).
- Касса — только PIN-сессия привязанного терминала (K6): иначе 403 `terminal_required`; снимок каталога — любой сессии.
- `PosModule` — только облако (`STORE_MODE !== 'offline'`); офлайн-точка → 409 `offline_store_read_only`.
- Порядок блокировок продажи: ключ идемпотентности → смена `FOR SHARE` → партии `FOR UPDATE` по возрастанию id →
  остатки. Закрытие: ключ → смена `FOR UPDATE`. Продажа не берёт заморозку инвентаризации (касса работает).
- Данные рецепта не пишутся в логи, аудит и тексты ошибок.

## Review Focus

1. Две кассы одной точки одновременно продают последнюю упаковку партии → оба чека приняты, у второго пометка
   `stock` и `shortfall_pieces = 1`, партия −1 в фильтре «Минус»; взаимной блокировки нет (Задача 5, два фоновых curl).
2. Один и тот же чек дважды одновременно (ответ потерян, буфер повторил) → один чек и одни движения, оба ответа 201
   с тем же номером (Задачи 3 и 5, два фоновых curl с одним ключом).
3. Закрытие смены одновременно с приёмом чека этой смены → чек либо в Z-отчёте, либо получил 409 `shift_closed`;
   итоги Z = Σ чеков смены (Задача 4, два фоновых curl).
4. Чек, пробитый при перебое до первого ввода инвентаризации (`occurredAt` на 3 часа раньше) и доставленный после
   него, → «продано до пересчёта», без ложной недостачи (Задача 6).
5. Снимок, взятый за миг до продажи на другой кассе, → дельта `sinceVersion` этого снимка возвращает товар с новым
   остатком (перекрытие 2 минуты, Задача 3).

---

### Task 1: Схема кассы

**Files:**
- Create: `apps/api/migrations/<Date.now()>_pos-shifts-sales.sql`
- Modify: `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts`

- [ ] **Step 1: миграция** — раздел 3 и поправки 2.1 спецификации:
  - `shifts` (`id`, `store_id`, `terminal_id`, `number`, `status` `open`/`closed`, `opened_by`, `opened_at`,
    `received_at`, `opening_cash_dirams ≥ 0`, `closed_by`, `closed_at`, `expected_cash_dirams`,
    `counted_cash_dirams`, `discrepancy_dirams`, `discrepancy_reason`, `terminal_totals jsonb`, `z_report jsonb`,
    `opened_author_flagged`, `closed_author_flagged` boolean (пометка `author` операций смены, K7);
    `check`: закрытые поля заполнены ровно при `closed`); уникальный частичный `(tenant_id, terminal_id) where
    status = 'open'`, уникальный `(tenant_id, store_id, number)`;
  - `shift_cash_operations` (`id`, `shift_id`, `kind` `deposit`/`withdrawal`, `amount_dirams > 0`, `reason` по
    виду, `comment` ≤ 200, `employee_id`, `occurred_at`, `received_at`, `author_flagged boolean`);
  - `held_receipts` (`id`, `store_id`, `shift_id`, `held_by`, `held_at`, `payload jsonb`, `subtotal_dirams`);
  - `receipts` (поля модели 04 + поправка 2.1 п. 4–5: `received_at`, `discrepancy_kinds text[] not null default
    '{}'` со `check` по списку `stock, price, discount, catalog, author, closed_period`, `cash_tendered_dirams`,
    `discount_min_total_dirams`, `origin` `online`/`offline_buffer`, `fiscal_status` (`not_required` по умолчанию),
    `language` `ru`/`tj`, `status` `paid`); уникальный `(tenant_id, store_id, number)`;
  - `receipt_lines` (`receipt_id`, `line_no`, `product_id`, `batch_id`, `sale_unit`, `pieces_per_pack`,
    `qty_pieces > 0`, `unit_price_dirams`, `line_amount_dirams`, `discount_share_dirams`, `cost_dirams`,
    `batch_chosen_manually`, `shortfall_pieces ≥ 0`, `current_price_dirams`); уникальный `(tenant_id, receipt_id,
    line_no)`;
  - `payments` (`receipt_id`, `kind` `cash`/`card`/`qr`/`nfc`, `amount_dirams > 0`);
  - `controlled_sale_records` (`receipt_line_id` уникален, `prescription_file_id` null, `prescription_note jsonb`,
    `recorded_by`, `recorded_at`, `prescription_purged_at`);
  - `idempotency_keys` (`tenant_id`, `scope`, `key`, `request_hash bytea`, `response jsonb`, `status_code`,
    `created_at`, `expires_at`; ключ `(tenant_id, scope, key)`);
  - индексы и FK раздела 3; `stock_movements_source_type_check` + `receipt`; `inventory_lines`: снять
    `book_qty_pieces >= 0`, добавить `sold_after_count_pieces integer`;
  - запрет `UPDATE`/`DELETE` на append-only таблицах тем же способом, что у `stock_movements` (триггер или права —
    как в существующих миграциях); `shifts` — без `DELETE`; RLS fail-closed, политики, гранты `pharmacy_app`.
- [ ] **Step 2: манифест** — новые таблицы класса `tenant`; `APPEND_ONLY_TABLES` + `shift_cash_operations`,
  `receipts`, `receipt_lines`, `payments`, `controlled_sale_records`.
- [ ] **Step 3: проверка.** `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration` —
  зелёное; повторный `api:migrate` — без изменений.
- [ ] **Step 4: коммит** `feat(api): POS schema — shifts, receipts, idempotency keys`.

### Task 2: Контракт и моки

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-pos.ts`, `libs/shared/dto/src/lib/tenant-inventory.ts`,
  `libs/shared/domain/src/lib/` (новая функция цены штуки + экспорт), `apps/web/src/shared/api/routes.ts`,
  `apps/web/src/shared/api/mocks/{handlers-pos, db-pos, fixtures-pos, handlers-stock}.ts`,
  `apps/web/src/features/pos/model/{receipt, pay}.ts`, `apps/web/src/pages/shift/**`,
  `apps/web/src/pages/stock-counts/ui/StockCountEditor.tsx`, `apps/web-e2e/src/support/{fake-api, pos}.ts`,
  `apps/web/specs/{pos, shift-returns, stock}.spec.tsx` (только чтобы собиралось и проходило)

**Interfaces:**
- Produces:
  ```ts
  // tenant-pos.ts
  interface ControlledSaleData { prescriptionNumber?: string; prescriptionDate?: string; clinic?: string;
    doctor?: string; buyerName?: string; buyerDocument?: string }
  interface ReceiptLineInput { /* + */ piecesPerPack: number; batchChosenManually: boolean;
    controlled: ControlledSaleData | null }   // не null ⇔ товар ПКУ в снимке (E23)
  interface CreateReceiptRequest { /* + */ discountPercent: number; discountMinSubtotalMinor: number;
    language: 'ru' | 'tj' }
  interface Shift { /* number: string; + */ discrepancyReceipts: number }
  interface ShiftEvent { /* + */ flagged: boolean }   // чек с пометками или операция смены с пометкой автора
  interface ZReport { /* + */ discrepancyReasonMissing: boolean }
  // routes: shifts.zReport — GET /shifts/{id}/z-report → ZReport
  // tenant-inventory.ts — StockCountLine: soldSincePieces → soldBeforeCountPieces, soldAfterCountPieces
  // libs/shared/domain
  function piecePriceMinor(packMinor: number, piecesPerPack: number, ownPieceMinor: number | null,
    stepMinor: number): number;   // own ?? ceil(pack / (piecesPerPack × step)) × step
  ```
  JSDoc маршрутов — коды раздела 7 спецификации.

- [ ] **Step 1: контракт** — как в Interfaces; `DiscountRule.id` снимка — `<ruleId>:<minSubtotalMinor>` (JSDoc).
- [ ] **Step 2: касса шлёт новые поля** — `buildReceiptRequest` (`pay.ts`): `piecesPerPack` из товара снимка,
  `batchChosenManually` = `manualBatch` строки черновика, `controlled` — `{}` у ПКУ без данных и `null` у прочих,
  `discountPercent` / `discountMinSubtotalMinor` из примененной ступени (0 без скидки), `language` — локаль UI.
- [ ] **Step 3: моки** — смена на терминал сессии (`terminalId`), номера-строки `СМ-…` / `ЧК-…`,
  `discrepancyReceipts`, пометка `stock` при уходе партии в минус, ПКУ без данных принимается, `shifts.zReport`;
  инвентаризация — новые поля строки; фейковый API web-e2e — так же.
- [ ] **Step 4: проверка.** `npx tsc -b libs/shared/dto libs/shared/domain && npx tsc --noEmit -p
  apps/web/tsconfig.json && npx nx run-many -t lint test --parallel=1 -p shared-dto shared-domain web` — зелёное.
- [ ] **Step 5: коммит** `feat(dto): POS contract — snapshot values in the receipt, shift per terminal`.

### Task 3: API — модуль кассы, идемпотентность, снимок каталога

**Files:**
- Create: `apps/api/src/app/pos/{pos.repository, idempotency, pos-context, catalog-snapshot.service,
  catalog-snapshot.controller, deployment.controller}.ts`, `apps/api/src/app/pos/dto/pos.dto.ts`,
  `apps/api/src/app/inventory/pos-stock.ts`, `apps/api/src/app/pricing/store-prices-reader.ts`
- Modify: `apps/api/src/app/pos/pos.module.ts`, `apps/api/src/app/app.module.ts` (`PosModule` — `registerWhen`
  облако), `apps/api/src/app/inventory/{inventory.module, numbering, documents.repository}.ts`,
  `apps/api/src/app/pricing/pricing.module.ts`, `apps/api/src/app/catalog/{products-reader, catalog.repository}.ts`

**Interfaces:**
- Produces (для Задач 4–5):
  ```ts
  // inventory/numbering.ts — NumberedKind + 'receipt' | 'z_report' (префиксы 'ЧК', 'СМ'); InventoryModule
  //   exports: [Numbering, PosStock]
  // inventory/pos-stock.ts
  interface PosBatchRow { id: string; productId: string; lotNumber: string | null; expiryDate: string;
    stockPieces: number; purchasePricePerPackDirams: bigint; costPerPieceDirams: bigint }
  batchesWithStock(trx, tenantId, storeId, productIds: readonly string[] | null): Promise<PosBatchRow[]>; // > 0
  productsMovedSince(trx, tenantId, storeId, since: Date): Promise<string[]>;
  lockBatches(trx, tenantId, storeId, batchIds: readonly string[]): Promise<Map<string, PosBatchRow>>;
    // FOR UPDATE по возрастанию id, затем остатки; только партии этой точки
  recordSale(trx, tenantId, movements: ReadonlyArray<{ storeId: string; batchId: string; qtyPieces: number;
    receiptId: string; lineId: string; businessDate: string }>): Promise<void>; // kind 'sale', source_type 'receipt', −qty
  // pricing/store-prices-reader.ts — PricingModule exports + StorePricesReader
  interface StorePrice { productId: string; packDirams: number; ownPieceDirams: number | null }
  pricesOfStore(trx, tenantId, storeId, productIds: readonly string[] | null): Promise<Map<string, StorePrice>>;
  productsRepricedSince(trx, tenantId, storeId, since: Date): Promise<string[]>;
  activeTiers(trx, tenantId, storeId, businessDate: string): Promise<Array<{ ruleId: string;
    minSubtotalDirams: number; percent: number }>>;
  ruleExists(trx, tenantId, ruleId: string): Promise<boolean>;     // любой статус
  // catalog/products-reader.ts
  interface PosCatalogProduct { id; name; inn: string | null; manufacturer; country; form; categoryId;
    barcodes: string[]; piecesPerPack; divisible; prescription: 'none' | 'rx' | 'controlled';
    status: 'active' | 'archived' }
  listForPos(trx, tenantId, ids: readonly string[] | null): Promise<PosCatalogProduct[]>;
  changedSince(trx, tenantId, since: Date): Promise<{ changed: string[]; archived: string[] }>;
  categoriesForPos(trx, tenantId): Promise<Array<{ id: string; name: string }>>;
  // pos/idempotency.ts
  type PosScope = 'receipt' | 'shift.open' | 'shift.cash' | 'shift.close';
  run<T>(trx, tenantId, scope: PosScope, key: string, body: unknown, status: number,
    work: () => Promise<T>): Promise<T>;   // повтор — сохранённый ответ; другой хеш — 409 idempotency_conflict
  // pos/pos-context.ts
  interface PosOperation { tenantId; storeId; terminalId; sessionEmployeeId; author: { id: string;
    flagged: boolean }; occurredAt: Date; receivedAt: Date; correlationId: string }
  operation(body: PosOperationContext, header: string | undefined, right: Permission): Promise<PosOperation>;
  terminalSession(): { tenantId; storeId; terminalId; employeeId };   // иначе 403 terminal_required
  // pos/pos.repository.ts — stores (имя, адрес, код, режим, юрлицо, ИНН, closed_until), tenants (имя),
  //   tenant_settings (timezone, default_language, return_period_days, receipt_footer, piece_price_rounding_dirams)
  ```
- [ ] **Step 1: экспорты модулей** — `Numbering` (+ виды), `PosStock`, `StorePricesReader`, методы
  `ProductsReader` — как в Interfaces; `PosStock.recordSale` пишет через `DocumentsRepository.insertMovements` с
  новым параметром `sourceType` (по умолчанию `'document'`).
- [ ] **Step 2: идемпотентность** — `run`: `Idempotency-Key` ≠ `body.id` (без учёта регистра) → 400
  `validation_failed` у `Idempotency-Key`; хеш — SHA-256 (`node:crypto`) канонического JSON тела (ключи
  отсортированы); `insert … on conflict do nothing`, при конфликте — чтение строки: хеш совпал → сохранённый
  `response` и `status_code`, иначе 409; после `work` — запись ответа; `expires_at` = +30 дней.
- [ ] **Step 3: контекст операции** — `terminalSession`: PIN-сессия с `terminalId` и `currentStoreId`, иначе 403
  `terminal_required`; `operation`: `storeId`/`terminalId` тела = сессии (иначе 409 `wrong_terminal`); точка
  облачная и активная (иначе 409 `offline_store_read_only` / 404); автор: сотрудник сессии — права из principal;
  иначе `PrincipalLoader.reload` — `null` → 422 `author_not_allowed`; неактивен, точка вне охвата или нет права →
  `flagged: true` (K7); `occurredAt` ISO-строка (400 иначе); `receivedAt` — время сервера.
- [ ] **Step 4: снимок** — `GET /stores/{storeId}/catalog-snapshot` по разделу 4.3 и E16: точка в охвате (403
  `store_not_in_scope`); версия = `Date.now()` начала запроса; `full` без `sinceVersion` или старше 24 ч; дельта —
  объединение `changedSince`, `productsRepricedSince`, `productsMovedSince` от `sinceVersion − 120 000` мс;
  товар в снимке — активный с ценой упаковки на точке; `piecePriceMinor` — `piecePriceMinor()` у делимого, иначе
  `null`; партии — `batchesWithStock`, `costMinor` только с `finance:view-cost`; `discountRules` — `activeTiers` на
  бизнес-дату с `id` `<ruleId>:<min>`; `settings` — по 4.3 (подвал на языке сессии, иначе сети).
- [ ] **Step 5: развёртывание** — `GET /deployment` (`@Public`) → `{ kind: 'cloud' }`.
- [ ] **Step 6: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное; curl: полный
  снимок кассира (без `costMinor`) и заведующего (с ним); товар без цены — нет в снимке; архивный товар после версии
  — в `removedProductIds`; дельта после продажи на другой точке не содержит товар, после прихода на эту — содержит
  (RF5: приход за миг до снимка); точка вне охвата → 403; `/deployment` без сессии → 200.
- [ ] **Step 7: коммит** `feat(api): POS module — idempotency, operation context, catalog snapshot`.

### Task 4: API — смена, отложенные чеки, отвязка терминала

**Files:**
- Create: `apps/api/src/app/pos/{shifts.repository, shifts.service, shifts.controller, held-receipts.service,
  held-receipts.controller, shift-mapper}.ts`
- Modify: `apps/api/src/app/pos/{pos.module, dto/pos.dto}.ts`, `apps/api/src/app/terminals/{terminals.service,
  terminals.module}.ts` (+ новый `terminal-revocation-checks.ts`)

**Interfaces:**
- Consumes: Задача 3 (`idempotency.run`, `pos-context`, `Numbering`, `PosRepository`).
- Produces (для Задачи 5):
  ```ts
  // shifts.repository.ts
  lockOpenShift(trx, tenantId, shiftId, terminalId, mode: 'share' | 'update'): Promise<ShiftRow>;
    // нет — 409 no_open_shift; закрыта — 409 shift_closed; другой терминал — 409 no_open_shift
  // shift-mapper.ts
  shiftView(trx, tenantId, shift: ShiftRow): Promise<Shift>;   // итоги из чеков, оплат, операций, событий
  // terminals/terminal-revocation-checks.ts — TerminalsModule exports
  register(check: (trx: TenantTransaction, tenantId: string, terminalId: string) => Promise<void>): void;
  ```
- [ ] **Step 1: DTO** — `OpenShiftDto`, `CashMovementDto` (`kind` `in`/`out`, `amountMinor` int 1…max, `reason` по
  виду, `comment` ≤ 200), `CloseShiftDto` (`actualCashMinor` ≥ 0, `discrepancyReason` ≤ 500, `terminalTotals`
  card/qr/nfc ≥ 0), `HoldReceiptDto` (`id` uuid, `storeId`, `subtotalMinor`, `lines` 1–100 с полями
  `HeldReceipt['lines']`); общий `PosOperationContextDto` (`id` uuid, `storeId`, `terminalId`, `employeeId` uuid,
  `occurredAt` ISO).
- [ ] **Step 2: открытие и текущая** — раздел 4.4: `POST /shifts` в `idempotency.run('shift.open')`; открытая смена
  терминала → 409 `shift_open`; номер `СМ`; `opened_at` = min(`occurredAt`, `receivedAt`); аудит `shift.opened`;
  ответ `Shift` (201). `GET /shifts/current` — `terminalSession()`, нет — 404 `no_open_shift`.
- [ ] **Step 3: наличные** — `POST /shifts/{id}/cash-movements` (`shift.cash`): `lockOpenShift(share)`, вид `in` →
  `deposit`, `out` → `withdrawal`; изъятие больше ожидаемого принимается (E15); пометка автора — `author_flagged`
  операции (у открытия и закрытия — колонки смены), в журнале событий `flagged`; аудит; ответ `Shift`.
- [ ] **Step 4: `Shift`** — `shiftView`: чеки, по видам оплаты (наличные — чистая часть), выручка, наличные по 4.4
  (наличные продажи = Σ полученных − Σ сдачи), `discrepancyReceipts` — чеки с непустым `discrepancy_kinds`, события
  `opened` / `sale` / `cash_in` / `cash_out` / `closed` по времени с именами сотрудников.
- [ ] **Step 5: закрытие** — `POST /shifts/{id}/closure` (`shift.close`): `lockOpenShift(update)`; ожидаемые и
  расхождение на сервере; без причины при расхождении — `discrepancyReasonMissing` (E24); `terminal_totals`;
  `ZReport` (разница банковского терминала = введённая − системная) в `z_report`; `DELETE` отложенных чеков смены;
  аудит `shift.closed`; ответ `ZReport`. `GET /shifts/{id}/z-report` — закрытая смена точки охвата (`shifts:view`),
  иначе 404.
- [ ] **Step 6: отложенные чеки** — раздел 4.6 и E12: `POST /held-receipts` — `terminalSession()`, открытая смена
  терминала (409 `no_open_shift`), товары и партии точки (400), тот же `id` — тот же чек; `GET
  /stores/{storeId}/held-receipts` — точка сессии; `DELETE` — чек точки, нет — 204.
- [ ] **Step 7: отвязка терминала** — `TerminalRevocationChecks` в `terminals`; `revokeInTransaction` вызывает
  зарегистрированные проверки; `pos` регистрирует проверку «открытая смена терминала → 409 `shift_open`» при
  инициализации модуля.
- [ ] **Step 8: проверка.** Build/typecheck/lint `api` — зелёное; curl (точка A, терминал T1 и T2, кассир с PIN):
  открытие, повтор тем же ключом — та же смена, другое тело — 409, вторая смена T1 — 409; внесение, изъятие больше
  ожидаемого — принято; внесение от имени сотрудника без права — принято, событие `flagged`; отложенный чек,
  список, удаление; закрытие с расхождением без причины —
  `discrepancyReasonMissing: true`, отложенные чеки удалены, `z-report` совпадает; операция по закрытой смене — 409
  `shift_closed`; сессия по паролю — 403 `terminal_required`; `terminalId` чужого терминала — 409
  `wrong_terminal`; отвязка T2 с открытой сменой — 409 `shift_open`; закрытие и приём чека одновременно (RF3) — после
  Задачи 5.
- [ ] **Step 9: коммит** `feat(api): POS shifts, held receipts, no unbinding with an open shift`.

### Task 5: API — чек

**Files:**
- Create: `apps/api/src/app/pos/{receipts.repository, receipts.service, receipts.controller, receipt-pricing}.ts`
- Modify: `apps/api/src/app/pos/{pos.module, dto/pos.dto}.ts`

**Interfaces:**
- Consumes: Задачи 3–4 (`lockOpenShift`, `PosStock`, `StorePricesReader`, `ProductsReader.listForPos`,
  `piecePriceMinor`, `discountAmount`, `bestDiscount`).
- Produces:
  ```ts
  // receipt-pricing.ts — чистые функции
  discountShares(lineAmounts: readonly number[], discount: number): number[];  // пропорционально, Σ = discount,
    // остаток округления — строке с наибольшей суммой (первой при равенстве)
  checkArithmetic(body: CreateReceiptRequest): FieldError[];   // раздел 4.5, по значениям снимка (E23)
  ```
- [ ] **Step 1: DTO** — `CreateReceiptDto`: контекст, `shiftId`, `priceListVersion` int, `lines` 1–200
  (`productId`, `batchId` uuid, `unit`, `quantity` int 1–100 000, `piecesPerPack` int ≥ 1, `unitPriceMinor`,
  `amountMinor` ≥ 0, `batchChosenManually` bool, `controlled` — объект строк ≤ 200 или `null`), `subtotalMinor`,
  `discountRuleId` (`<uuid>:<int>` или `null`), `discountPercent` 0–100, `discountMinSubtotalMinor` ≥ 0,
  `discountMinor`, `totalMinor`, `payments` 1–4 (вид без повтора, > 0), `cashTenderedMinor`, `changeMinor`,
  `language`.
- [ ] **Step 2: приём** — раздел 4.5 в `idempotency.run('receipt')`: `lockOpenShift(share)`; `checkArithmetic` →
  400; правило существует (`ruleExists`, иначе 400 `unknown_discount`); товары (`listForPos`) — неизвестный → 400;
  `lockBatches` — партия не этой точки или не того товара → 400 `unknown_batch` / `wrong_store`; срок < бизнес-даты
  продажи → 400 `batch_expired`; момент продажи — min(`occurredAt`, `receivedAt`), не раньше `opened_at` смены;
  бизнес-дата — в часовом поясе сети; номер `ЧК`.
- [ ] **Step 3: запись** — чек, строки (штуки по E23; `cost_dirams` = штуки × себестоимость штуки партии; доли
  `discountShares`), оплаты (строка наличных = полученные, E10), записи ПКУ (товар ПКУ в снимке или сейчас;
  `prescription_note` — только непустые поля, иначе `null`), `recordSale`; `origin` по 2.1 п. 4.
- [ ] **Step 4: пометки** — E5 по разделу 4.5: остаток партии после продажи < 0 → `stock`, `shortfall_pieces` =
  min(штуки строки, −остаток); цена ≠ текущей (`pricesOfStore` + `piecePriceMinor`) → `price` и
  `current_price_dirams`; лучшая ступень `bestDiscount(subtotal, activeTiers)` ≠ присланной (id и сумма) →
  `discount`; `piecesPerPack`, делимость или признак ПКУ ≠ текущим → `catalog`; автор `flagged` или без права ПКУ
  (строка `controlled ≠ null`) / ручной партии (`batchChosenManually`) по текущим правам → `author`; бизнес-дата ≤
  `closed_until` юрлица точки → `closed_period`. Ответ `CreatedReceipt` (`discrepancies` — число пометок, `fiscal:
  null`); аудит `receipt.completed` без данных рецепта.
- [ ] **Step 5: проверка.** Build/typecheck/lint `api` — зелёное; curl:
  - продажа — номер `ЧК`, движения `sale`, `Shift` (чеки, по видам, наличные с учётом сдачи), доли скидки в сумме =
    скидке, себестоимость; штучная продажа делимого товара;
  - сверх остатка — `stock`, партия в фильтре «Минус» `GET /stock`; две кассы — последняя упаковка (RF1);
  - цена не та — `price`; ступень правлена после снимка — `discount`, не 400; `piecesPerPack` изменён — `catalog`;
  - просроченная партия — 400; партия другой точки — 400; правило, которого нет, — 400; Σ оплат ≠ итогу — 400;
  - ПКУ с пустыми данными — запись ПКУ с `prescription_note = null`; ПКУ и ручная партия у автора без права —
    пометка `author`; автор не из сети — 422; второй кассир сдаёт чек первого — принят от имени первого;
  - повтор тем же ключом одновременно (RF2); другое тело — 409; закрытие одновременно с чеком (RF3).
- [ ] **Step 6: коммит** `feat(api): POS receipts — sale as a fact with discrepancy marks`.

### Task 6: Инвентаризация без ложного излишка (I4)

**Files:**
- Modify: `apps/api/src/app/inventory/{stock-counts.repository, stock-counts.service, stock-count-posting}.ts`,
  `apps/web/src/pages/stock-counts/ui/StockCountEditor.tsx`, i18n `ru`/`tg` `stock.json`

**Interfaces:**
- Produces:
  ```ts
  // stock-counts.repository.ts
  stockAtFirstEntry(trx, tenantId, documentId): Promise<Map<string /* lineId */, number>>;
    // Σ движений партии с моментом ≤ min(entered_at) строки; момент продажи — receipts.sold_at, иначе recorded_at
  ```
- [ ] **Step 1: снимок старта** — партии охвата с остатком ≠ 0 (`s.qty <> 0`).
- [ ] **Step 2: проведение** — раздел 5 спецификации: ожидаемый = `stockAtFirstEntry`; разница = факт − ожидаемый;
  `sold_since_start_pieces` = учёт − ожидаемый, `sold_after_count_pieces` = ожидаемый − текущий.
- [ ] **Step 3: карточка** — `soldBeforeCountPieces`, `soldAfterCountPieces` по разделу 5 (проведённая — из
  колонок, идущая — живой расчёт).
- [ ] **Step 4: web** — колонки «Учёт на начало», «Продано до пересчёта», «Продано после пересчёта», «Факт»,
  «Расхождение» = факт − (учёт − продано до пересчёта); тексты RU/TJ.
- [ ] **Step 5: проверка.** Build/typecheck/lint `api`, `web` — зелёное; curl: старт, ввод по партии, продажа после
  ввода — после проведения нет излишка, «продано после пересчёта» = 1; продажа до ввода — расхождения нет; чек с
  `occurredAt` раньше первого ввода, доставленный после (RF4); партия в минусе (продажа сверх остатка) попадает в
  снимок, факт 0 → `inventory_gain`, остаток 0.
- [ ] **Step 6: коммит** `fix(api): stock count expects the stock at the first entry (I4)`.

### Task 7: Web — касса и смена на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES`), `apps/web/src/pages/pos/ui/PosPage.tsx`,
  `apps/web/src/pages/shift/{ui/ShiftPage, ui/ShiftDialogs, lib/z-report}.tsx|ts`,
  `apps/web/src/features/pos/ui/{PosDialogs, CartPanel}.tsx`, `apps/web/src/entities/catalog/api/use-catalog.ts`,
  `apps/web/src/shared/lib/offline-queue/{queue, runtime}.ts`, вход по PIN и паролю (`features/auth-by-pin`,
  форма пароля) — вызов `resume()`, `apps/web/src/pages/owner/employees/ui/EmployeesPage.tsx`,
  `apps/web/src/shared/api/error-message.ts`, i18n `ru`/`tg`

**Interfaces:**
- Produces:
  ```ts
  // pages/shift/lib
  pendingCashDeltaMinor(records: readonly OutboxRecord[], shiftId: string): number;
    // наличная часть неотправленных чеков + внесения − изъятия этой смены
  ```
- [ ] **Step 1: маршруты** — `REAL_API_ROUTES` + `catalog.snapshot`, `receipts.create`, `heldReceipts.*`,
  `shifts.*` (с `shifts.zReport`), `deployment.get`, `health.get`.
- [ ] **Step 2: без терминала** — «Касса» и «Смена» при `session.terminalId === null`: «Касса работает на
  привязанном терминале после входа по PIN», без кнопок продажи и смены.
- [ ] **Step 3: касса** — окно ПКУ: поля необязательны, «Сохранить» с пустыми, оплата не блокируется
  (`controlled_data_missing` убрать); снимок `staleTime` 60 000 мс.
- [ ] **Step 4: смена** — номер-строка («…» до доставки); окно закрытия — ожидаемые = сервер +
  `pendingCashDeltaMinor`; после закрытия — `ZReport` из ответа доставки за 1,5 с, иначе локальный с пометкой
  «предварительный, итог — после отправки»; счётчик «Чеков с расхождением» на странице и в Z; «Причина не указана» в
  Z при `discrepancyReasonMissing`.
- [ ] **Step 5: буфер и ошибки** — `resume()` после входа; тексты `shift_open`, `no_open_shift`, `shift_closed`,
  `wrong_terminal`, `idempotency_conflict`, `author_not_allowed`, `terminal_required`, `batch_expired`; отвязка
  терминала с открытой сменой — «Сначала закройте смену на этом терминале».
- [ ] **Step 6: проверка.** Браузер (`partial`, привязанный терминал, PIN): открытие смены → скан → смешанная оплата
  → номер `ЧК-…` → отложить и продолжить → внесение → закрытие с Z-отчётом сервера; API остановлен — продажа в
  буфере, после запуска доставлена; вход по паролю — сообщение про терминал. `npx nx run-many -t build && npx nx
  run-many -t typecheck lint test fsd --parallel=1 -p web`, `npx nx e2e web-e2e` — зелёные.
- [ ] **Step 7: коммит** `feat(web): POS and shift on the API`.

### Task 8: Web — данные ПКУ в буфере

**Files:**
- Create: `apps/web/src/shared/lib/offline-queue/controlled-crypto.ts`
- Modify: `apps/web/src/shared/lib/offline-queue/{operations, index}.ts`, `apps/web/src/features/pos/model/{pos-store,
  pay}.ts`, `apps/web/src/features/pos/ui/{ProductPicker, CartPanel}.tsx` (или `PosPage.tsx` — где `requestAdd`),
  i18n `ru`/`tg`

**Interfaces:**
- Produces:
  ```ts
  interface SealedControlled { iv: Uint8Array; data: ArrayBuffer }
  sealControlled(db: PosDb, value: ControlledSaleData): Promise<SealedControlled>;
  openControlled(db: PosDb, sealed: SealedControlled): Promise<ControlledSaleData>;
    // ключ — AES-GCM 256, generateKey(extractable: false), хранится в state['controlled-key'] той же БД;
    // IV — 12 случайных байт на запись
  ```
- [ ] **Step 1: шифрование** — `controlled-crypto.ts` как в Interfaces (только `crypto.subtle`).
- [ ] **Step 2: черновик и буфер** — в IndexedDB данные рецепта строк хранятся только как `SealedControlled`
  (зеркало черновика и запись `receipt` буфера); в памяти черновика — открытые; отправка расшифровывает перед
  запросом; после доставки запись удаляется как раньше.
- [ ] **Step 3: ПКУ без связи** — добавление ПКУ и оплата чека с ПКУ при отсутствии связи — блокировка с
  сообщением «Продажа ПКУ без связи недоступна» (E17).
- [ ] **Step 4: проверка.** Браузер: ПКУ с данными — в IndexedDB (DevTools) нет открытого текста полей, чек доставлен
  с данными, запись ПКУ на сервере с ними; без связи ПКУ не добавляется. Build/typecheck/lint/test `web`, `npx nx e2e
  web-e2e` — зелёные.
- [ ] **Step 5: коммит** `feat(web): encrypted ПКУ data in the POS buffer`.

### Task 9: Документы

- [ ] **Step 1: правки** — модель `04`: поправки 2.1 пп. 1–8, «Введено миграцией `pos-shifts-sales`»; `03`:
  `source_type` `receipt`, правило минуса при продаже (п. 10), ожидаемый остаток инвентаризации (п. 9); `06`:
  `idempotency_keys` введена; `APPROVAL.md` — строка: поправки модели, I4 (K2), уточнение ADR-0015 о правах автора
  (K7); CLAUDE.md — `web:dev-api` (касса и смена), `PosModule` только в облаке.
- [ ] **Step 2: коммит** `docs: POS shift and sale — data model, approval, CLAUDE.md`.
