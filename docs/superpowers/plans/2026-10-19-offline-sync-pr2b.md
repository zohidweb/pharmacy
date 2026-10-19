# Офлайн-точка, PR 2b — приход, начальные остатки и списание точки: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** облако применяет операцию `document.posted` офлайн-точки для прихода, начальных остатков и списания. Документ, строки, новые партии и движения вставляются с id точки. Приход пишет долг поставщику (E17), розницу из строк (E18) и статус заказа (E37).

**Architecture:**
- Новый применитель `DocumentFacts` (модуль `inventory`) регистрируется в `SyncAppliers`, как применители PR 1 и 2a.
- Цены из строк прихода применяются по правилу `price.changed-locally` (E25, PR 2a). Для этого правило выносится из `PriceFacts` в экспорт `pricing` — `LocalPriceRule`, его зовут оба применителя.
- Долг поставщику — `SupplierLedger.receiptPosted`, статус заказа — `OrderReceiving.refreshStatus`: тот же код, что у облачной точки.
- Миграций нет.

**Tech Stack:** NestJS 11, Kysely + pg. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-16-offline-sync-design.md` (утверждена 2026-10-16): E3, E17, E18, E37, раздел 4.2 (`document.posted`), 4.3; раздел 13 (решения PR 2a). Основа — ADR-0014 §4.

**Остаток PR 2 разбит на три** (договорённость о небольших PR):
- 2b — этот;
- 2c — инвентаризация, возврат поставщику, документ слияния дубля `product_merge` (E35, с миграцией);
- 2d — `transfer.dispatched` / `transfer.accepted`, списание `transfer_discrepancy` (E34), запрет отзыва и правила режима `offline_pending` (E8).

## Global Constraints

Всё из Global Constraints планов PR 1 и PR 2a действует:
- тесты отложены до MVP, проверка живая;
- окружение Windows (`NX_ISOLATE_PLUGINS=false NX_DAEMON=false`, `--parallel=1`, пересборка деклараций libs, перезапуск `api-oc-4210` после сборки; rebase — `git -c commit.gpgsign=false`);
- строки точки вставляются с её id;
- в `stock_movements` и `audit_log` — время облака, время точки — в колонках факта;
- prettier — только на изменённые файлы.

Дополнительно:
- Ветка `feature/offline-sync-pr2b`: `git switch -c feature/offline-sync-pr2b --no-track origin/main`. План — первым коммитом.
- Облако **не проверяет** правила проведения, которые касаются решения кассира или кладовщика: дату документа и закрытый период, окно задним числом, активность поставщика и товара, открытость заказа, заморозку инвентаризацией, предельную цену. Проведённый документ точки — факт (ADR-0014 §4).

  Проверяется только целостность факта (спецификация, раздел 4.3):
  - ссылки на сеть;
  - соответствие строк, партий и движений;
  - знаки;
  - целые дирамы;
  - id, ещё не занятые в сети.
- Ссылки на облачные справочники (товар, поставщик, заказ, сотрудник) — карантин. Ссылки на факты той же точки (партия для списания) — ожидание.
- Порядок блокировок — как у облачной `DocumentPosting`: заказ, затем партии и движения, затем цены (в порядке товаров), затем расчёты с поставщиком.

## Review Focus

1. **Приход с розницей, когда владелец успел поменять цену одного товара.**
   - Ожидается: документ `applied`, цены остальных строк применены, по изменённому товару облачная цена осталась и открыт один конфликт `price` (правило PR 2a).
   - Проверка — Задача 4, шаг d1.
2. **Приход по заказу, который в облаке уже закрыт или отменён.**
   - Ожидается: факт принят, `refreshStatus` не ломает отменённый заказ (он сам пропускает `draft`; отменённый — проверить).
   - Проверка — Задача 4, шаг d2b.
3. **Партия или документ с id, уже занятым в сети.**
   - Ожидается: карантин `id_reused`, ничего не записано, а не 500 и не `apply_failed:23505`.
   - Проверка — Задача 4, шаг d5.
4. **Количество строки не делится на штук в упаковке у облачной карточки** (облако поменяло упаковку после проведения на точке).
   - Ожидается: карантин `pack_mismatch` с понятной причиной — долг поставщику не считается по неверной сумме.
   - Проверка — Задача 4, шаг d5.
5. **Чек точки продаёт товар, созданный на точке, и его партию из начальных остатков в том же батче.**
   - Чек раньше документа ждёт партию и применяется в конце того же батча (повтор c7 из PR 2a до `applied`).
   - Проверка — Задача 4, шаг d3.

---

### Task 1: Контракты `document.posted` и правило локальной цены как порт `pricing`

**Files:**
- Modify: `libs/shared/dto/src/lib/sync-protocol.ts`.
- Create: `apps/api/src/app/pricing/local-price-rule.ts`.
- Modify: `apps/api/src/app/pricing/price-facts.ts` (логика переезжает в правило), `apps/api/src/app/pricing/pricing.module.ts` (provider и export `LocalPriceRule`).

**Interfaces — Produces:**
- `SyncStockDocumentRow extends SyncDocumentRow` + `supplierId`, `supplierInvoiceNumber`, `supplierInvoiceDate`, `paymentDueDate`, `purchaseOrderId` (все `string | null`).
- `SyncGoodsReceiptLineRow { id; documentId; lineNo; productId; batchId; expiryDate; lotNumber: string | null; qtyPieces; purchasePricePerPackDirams; orderPricePerPackDirams: number | null; purchaseOrderLineId: string | null; retailPriceDraftDirams: number }`.
- `SyncOpeningBalanceLineRow { id; documentId; lineNo; productId; batchId; expiryDate; lotNumber: string | null; qtyPieces; purchasePricePerPackDirams; retailPriceDraftDirams: number | null; supplierId: string | null; isStarting: boolean }`.
- `SyncBatchRow { id; storeId; productId; expiryDate; lotNumber: string | null; purchasePricePerPackDirams; costPerPieceDirams; supplierId: string | null; origin: string; sourceDocumentId; isStarting: boolean }`.
- `SyncLocalPrice = Omit<PriceChangedLocallyPayload, 'audit'>`.
- `DocumentPostedPayload`:
  - `document: SyncStockDocumentRow`;
  - `lines`: строки таблицы типа документа — `SyncGoodsReceiptLineRow[]` | `SyncOpeningBalanceLineRow[]` | `SyncWriteOffLineRow[]`;
  - `batches: SyncBatchRow[]`, `movements: SyncMovementRow[]`;
  - `prices: SyncLocalPrice[]`, `audit: SyncAuditRow[]`.
- `LocalPriceRule.apply(trx, tenantId, storeId, price: SyncLocalPrice): Promise<'applied' | 'conflict'>`:
  - всё, что делала `PriceFacts.apply` между проверкой `sameStore` и аудитом: проверки цены и версии, `requireProducts`, `requireEmployees`, блокировка строки, применение или конфликт;
  - `PriceFacts` вызывает правило и затем пишет аудит.

- [ ] **Step 1:** контракты с JSDoc; `npx tsc -b libs/shared/dto/tsconfig.lib.json libs/shared/domain/tsconfig.lib.json --force`.
  Expected: без вывода.
- [ ] **Step 2:** вынести правило в `LocalPriceRule`, экспортировать из `PricingModule`.
  Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
- [ ] **Step 3: Коммит** `refactor(api): the local price rule as a port of pricing; document.posted contracts`.

### Task 2: `DocumentFacts` — приход и начальные остатки (E17, E18, E37)

**Files:**
- Create: `apps/api/src/app/inventory/document-facts.ts`.
- Modify: `apps/api/src/app/inventory/inventory.module.ts` (provider, imports `SyncCoreModule`). Если нужен запрос юрлица точки, добавить его в `StockFacts` или в `DocumentsRepository`.

**Interfaces:**
- Consumes:
  - `DocumentPostedPayload` и `LocalPriceRule` (Задача 1);
  - `StockFacts.insertMovements` (PR 1);
  - `SupplierLedger.receiptPosted(trx, ReceiptLedgerEvent)`;
  - `OrderReceiving.lock` / `refreshStatus`;
  - `DocumentsRepository`, `linesTotal` / `packsOf` из `posting.ts`;
  - `AuditService.appendFact`.
- Produces: `DocumentFacts implements FactApplier`, `types = ['document.posted']`, отказ по типу документа вне этого PR — карантин `unsupported_document_type`.

- [ ] **Step 1: Проверки** (`goods_receipt`, `opening_balance`):
  - **Заголовок:**
    - `sameStore(document.storeId)`; `status = 'posted'`; `postedAt`, `postedBy` заданы;
    - `requireEmployees([createdBy, postedBy])`;
    - id документа свободен в сети, иначе `id_reused`.
  - **Строки:**
    - не пусты, `documentId` = id документа, `qtyPieces > 0`;
    - `purchasePricePerPackDirams` — целое > 0 (`isMoney`);
    - `requireProducts`;
    - количество делится на `pieces_per_pack` облачной карточки, иначе `pack_mismatch`.
  - **Партии:**
    - ровно одна новая партия на строку (`line.batchId` ∈ `batches`);
    - `productId`, `storeId`, `sourceDocumentId = document.id`, `origin = document.type`, `purchasePricePerPackDirams` = строки;
    - `costPerPieceDirams` — целое ≥ 0;
    - id партий свободны, иначе `id_reused`.
  - **Движения:** ровно одно на строку — `kind = document.type`, `sourceType = 'document'`, `sourceId` / `sourceLineId`, `batchId` строки, `qtyDeltaPieces = +qtyPieces`, `businessDate = documentDate`; иначе `movement_mismatch`.
  - **Приход:**
    - поставщик сети существует, иначе `unknown_supplier`;
    - `supplierInvoiceNumber` задан.
  - **Заказ:** если `purchaseOrderId` задан — заказ есть, той же точки и того же поставщика; иначе `unknown_order` / `order_mismatch`.
  - **Цены:** только по товарам строк и только этой точки, иначе `price_mismatch`.

- [ ] **Step 2: Запись** — в порядке облачной `DocumentPosting.post`:
  1. `OrderReceiving.lock`, если есть заказ.
  2. Документ со статусом `posted` и итогом `linesTotal`: упаковки × закупочная цена упаковки по облачной карточке.
  3. Строки в `goods_receipt_lines` / `opening_balance_lines` с их `batch_id`.
  4. Партии.
  5. Движения через `StockFacts.insertMovements`.
  6. Цены, отсортированные по товару, через `LocalPriceRule.apply`.
  7. Для прихода с поставщиком — `SupplierLedger.receiptPosted`: юрлицо — юрлицо точки, сумма — итог, срок — `paymentDueDate`, дата — `documentDate`, `employeeId = postedBy`.
  8. `OrderReceiving.refreshStatus`.
  9. Аудит точки через `appendFact`.

- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply goods receipts and opening balances of offline stores`.

### Task 3: `DocumentFacts` — списание

**Files:** Modify `apps/api/src/app/inventory/document-facts.ts`.

- [ ] **Step 1:** `write_off`:
  - Причина — `expired`, `broken`, `defect` или `misgrade`.
    - `transfer_discrepancy` → карантин `unsupported_write_off_reason` (PR 2d).
    - `customer_return_*` → `write_off_mismatch`: такие списания приходят только внутри `return.completed`.
  - `batches` и `prices` пусты, иначе `write_off_mismatch`.
  - Id документа свободен, иначе `id_reused`.
  - Дальше — `StockFacts.applyWriteOff(trx, tenantId, storeId, { document, lines, movements }, null)` из PR 1: строки, партии точки (нет партии — ожидание), движения, итог = штуки × себестоимость штуки.
  - Аудит точки.
- [ ] **Step 2:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply write-offs of offline stores`.

### Task 4: Живая проверка, документы, наборы

**Files:**
- Modify: `CLAUDE.md` — граф модулей: `inventory` регистрирует `DocumentFacts`; `pricing` отдаёт `LocalPriceRule` (`pricing` ← `inventory` уже есть).
- Modify: спецификация, раздел 13 — решения PR 2b.
- Scratchpad: `os_doc.sh`, `os_doc_specs.cjs` (по образцу `os_cat.sh`).

- [ ] **Step 1:** `npx nx build api`, перезапуск `api-oc-4210`.
- [ ] **Step 2: Живые сценарии** (точка A сети `pos_setup.sh`, ключ, режим `offline`):

  | Шаг | Операция | Ожидается |
  |---|---|---|
  | d1 | приход от поставщика: 2 строки (PR, Q), розница по обеим; по Q владелец перед этим поменял цену | `applied`; документ `posted`, итог = Σ упаковки × цена; 2 партии, 2 движения +; остаток вырос; запись долга поставщику = итог; цена PR применена, по Q — конфликт |
  | d2 | приход по заказу (заказ владелец создаёт и подтверждает через API) на часть количества | `applied`; заказ `partially_received` |
  | d2b | приход по заказу, который владелец до этого отменил | `applied`; статус отменённого заказа не изменился |
  | d3 | в одном батче: товар точки L, затем чек с L, затем начальные остатки L | товар `applied`, чек ждёт партию и применяется в конце батча, остатки `applied` |
  | d4 | списание `expired` части партии | `applied`, остаток уменьшился, итог = штуки × себестоимость |
  | d5 | неизвестный поставщик; партия чужого товара; движение с неверным знаком; повтор id документа в новой операции; количество не делится на упаковку; списание `transfer_discrepancy` | `quarantined`: `unknown_supplier` / `batch_mismatch` / `movement_mismatch` / `id_reused` / `pack_mismatch` / `unsupported_write_off_reason` |
  | d6 | повтор батча d1 | `duplicate`, строк не прибавилось |

- [ ] **Step 3: Наборы:**
  - `npx nx run-many -t lint test build -p shared-dto shared-domain api --parallel=1`;
  - `npx nx run api:integration`;
  - `npx nx run api:db-types-verify`.

  Expected: exit 0; integration 158/158.
- [ ] **Step 4: Коммит** `docs: offline sync PR 2b — module graph, spec decisions`.
