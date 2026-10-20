# Офлайн-точка, PR 2c — инвентаризация, возврат поставщику и слияние дубля точки: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** облако применяет `document.posted` офлайн-точки ещё для трёх типов документов:
- инвентаризации (`inventory`) — излишки и недостачи по партиям, новые партии найденного товара;
- возврата поставщику (`supplier_return`) — минус по партиям и кредит поставщику (`SupplierLedger.returnPosted`);
- нового документа точки `product_merge` (E35) — остаток партий слитого товара точки переходит в новые партии карточки сети.

**Architecture:**
- Ветки `DocumentFacts` (PR 2b) по типу документа; общий заголовок документа — один помощник для всех типов.
- Миграция: тип документа `product_merge`, виды движений `merge_out` / `merge_in`, происхождение партии `product_merge`, таблица строк `product_merge_lines`. CHECK большой `stock_movements` расширяется по правилу cr-N3: `not valid`, затем `validate` отдельным файлом.

**Tech Stack:** NestJS 11, Kysely + pg, node-pg-migrate SQL (только Up). Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-16-offline-sync-design.md`: E3, E17, E35, разделы 4.2–4.3, раздел 13 (правила PR 2a и 2b: накладная точки — итог, `pack_mismatch` / `total_mismatch`). Основа — ADR-0014 §4.

## Global Constraints

Всё из Global Constraints планов PR 1, 2a, 2b действует:
- тесты отложены до MVP — живая проверка;
- окружение Windows;
- строки точки — с её id;
- время облака — в `stock_movements` и `audit_log`;
- prettier — только на изменённые файлы;
- облако не перепроверяет решения проведения, а проверяет целостность факта и свободные id (`id_reused`).

Дополнительно:
- Ветка `feature/offline-sync-pr2c`: `git switch -c feature/offline-sync-pr2c --no-track origin/main`. План — первым коммитом.
- Номер миграций — текущее время в мс; перед созданием сверить `ls apps/api/migrations | tail -3`.
- Отложенные мелкие замечания PR 2b учитываются в новом коде:
  - M2 — партии сверяются со строками полностью: различные id, поля партии равны полям строки;
  - M3 — `businessDate` движений = дата документа;
  - M5 — `postedAt` вставляется разобранной датой. Общий помощник заголовка исправляет M5 и для прихода и списания.
  - M1 и M4 остаются в журнале.

## Review Focus

1. **Возврат поставщику по партии, пришедшей не от этого поставщика.**
   - Ожидается: карантин `batch_mismatch` — кредит не уходит чужому поставщику.
   - Проверка — Задача 4, шаг r3.
2. **Инвентаризация с недостачей больше остатка партии в облаке** (на точке продажи, ещё не дошедшие до облака).
   - Ожидается: факт принимается, остаток в облаке временно отрицательный и сходится после прихода чеков (ADR-0014 §4, «остаток не проверяется»).
   - Проверка — Задача 4, шаг i2.
3. **`product_merge` пришёл раньше решения по дублю.**
   - Ожидается: документ ждёт (`pending_dependency`) и применяется после `product.duplicate-resolved` в том же батче; слияние в другую карточку — карантин `merge_target_mismatch`.
   - Проверка — Задача 4, шаги m1, m3.
4. **Итог возврата или инвентаризации точки не сходится со строками.**
   - Ожидается: карантин `total_mismatch`, кредит и движения не записаны.
   - Проверка — Задача 4, шаги i3, r4.
5. **Две строки документа на одну партию или повтор id партии внутри одного документа** (M2 PR 2b).
   - Ожидается: карантин `batch_mismatch`, а не `apply_failed:23505`.
   - Проверка — Задача 4, шаг i3.

---

### Task 1: Контракты и миграция `product_merge`

**Files:**
- Modify: `libs/shared/dto/src/lib/sync-protocol.ts`.
- Create: `apps/api/migrations/<ms>_sync-product-merge.sql`, `apps/api/migrations/<ms+1>_sync-product-merge-validate.sql`.
- Modify: `apps/api/src/core/database/db.generated.ts` (`api:db-types`), `apps/api/src/core/database/table-classes.ts` (`product_merge_lines` — класс `tenant`).
- Modify: `docs/architecture/data-model/03-batches-warehouse.md`.

**Interfaces — Produces:**
- `SyncStockDocumentRow` + `supplierReturnReason: string | null`, `inventoryScope: string | null`, `inventoryCategoryId: string | null`, `inventoryStartedAt: string | null`.
- `SyncInventoryLineRow`:
  - `id; documentId; lineNo; productId; batchId: string | null; isFound: boolean`;
  - `bookQtyPieces; countedQtyPieces; soldSinceStartPieces: number | null; soldAfterCountPieces: number | null`;
  - `surplusBatchId: string | null; surplusExpiryDate: string | null; surplusLotNumber: string | null; surplusPurchasePricePerPackDirams: number | null`.
- `SyncSupplierReturnLineRow { id; documentId; lineNo; productId; batchId; qtyPieces; unit: 'pack' | 'piece'; piecesPerPack: number; amountDirams: number; note: string | null }`.
- `SyncProductMergeLineRow { id; documentId; lineNo; fromBatchId; toBatchId; qtyPieces }`.
- `SyncStockDocumentRow.mergeFromProductId: string | null`, `mergeIntoProductId: string | null` — товар точки и карточка сети документа `product_merge`.
- `DocumentPostedPayload.lines` дополняется тремя типами строк.
- `totalDirams` обязателен (не null) для `inventory`, `supplier_return` — итог точки:
  - инвентаризация — Σ |штуки| × себестоимость штуки партии;
  - возврат — Σ `amountDirams` строк.

  Для `product_merge` — `null`: денег нет.

- [ ] **Step 1: Контракты**, затем `npx tsc -b libs/shared/dto/tsconfig.lib.json libs/shared/domain/tsconfig.lib.json --force`.
  Expected: без вывода.
- [ ] **Step 2: Миграция `sync-product-merge`.**
  - `set lock_timeout = '5s'`.
  - `documents`:
    - `type` + `product_merge`;
    - колонки `merge_from_product_id uuid`, `merge_into_product_id uuid` с FK `(tenant_id, …)` → `products`;
    - check: обе заданы ровно при `type = 'product_merge'`.
  - `batches.origin` + `product_merge`.
  - `stock_movements.kind` + `merge_out`, `merge_in` — `drop constraint` + `add constraint … not valid`.
  - Таблица `product_merge_lines`:
    - `tenant_id, id, document_id, line_no, from_batch_id, to_batch_id, qty_pieces > 0, created_at`;
    - ключ `(tenant_id, id)`, unique `(tenant_id, document_id, line_no)`;
    - FK на документ и обе партии, индексы FK;
    - RLS FORCE и права — как у `write_off_lines`.
  - Имена constraints до правки — из `\d` в psql: `stock_movements_kind_check`, `documents_type_check`, `batches_origin_check`.
  - Validate-файл: `alter table pharmacy.stock_movements validate constraint stock_movements_kind_check`.

  Run: `npx nx run api:migrate`, `npx nx run api:db-types`.
  Expected: обе миграции применены, в `db.generated.ts` — `ProductMergeLines` и новые колонки `Documents`.
- [ ] **Step 3:** модель данных 03 — тип `product_merge`, виды движений, происхождение партии, таблица строк.
- [ ] **Step 4:** `npx nx run-many -t lint build -p shared-dto api --parallel=1`; `npx nx run api:integration` — проверка каталога таблиц.
  Expected: exit 0; integration 158/158.
  Commit: `feat(db): the product merge document of offline stores`.

### Task 2: Общий заголовок и инвентаризация

**Files:** Modify `apps/api/src/app/inventory/document-facts.ts`.

**Interfaces:**
- Consumes: Задача 1; `StockFacts.batchesOf` (партии точки, нет — ожидание), `StockFacts.insertMovements`.
- Produces: `private insertHeader(trx, tenantId, storeId, document, total: number | null, extra: Partial<…>)` — общий для всех типов: `postedAt` разобранной датой (M5); приход переходит на него.

- [ ] **Step 1: Проверки инвентаризации:**
  - **Строки:**
    - не пусты, принадлежат документу;
    - `countedQtyPieces` — целое ≥ 0;
    - `bookQtyPieces`, `soldSinceStartPieces`, `soldAfterCountPieces` — целые ≥ 0 или null.
  - **Строка с партией** (`isFound = false`): партия точки (`batchesOf`, ожидание), `batch.productId = line.productId`, `surplusBatchId = null`.
  - **Найденная строка** (`isFound = true`):
    - `batchId = null`;
    - при `countedQtyPieces > 0` — `surplusBatchId` ∈ `batches`; партия с `origin = 'inventory_surplus'`, `sourceDocumentId = document.id`, `productId`, `expiryDate`, `lotNumber`, `purchasePricePerPackDirams` — как у строки;
    - при `countedQtyPieces = 0` — `surplusBatchId = null`.
  - **Новые партии** — только партии излишков; различные id; свободны в сети (`id_reused`).
  - **Движения** — не больше одного на строку:
    - `inventory_gain` > 0 или `inventory_loss` < 0 на партии строки (для найденной — на партии излишка, только `gain` = `countedQtyPieces`);
    - `businessDate` = дата документа (M3).
  - **Итог** = Σ |штуки движения| × себестоимость штуки партии (существующей — из облака, новой — из `batches`) = `document.totalDirams`, иначе `total_mismatch`.
  - `batches` и `prices` вне правил — `batch_mismatch` / `price_mismatch`.
- [ ] **Step 2: Запись:**
  1. Заголовок (`inventoryScope`, `inventoryCategoryId`, `inventoryStartedAt`).
  2. Партии излишков.
  3. Строки `inventory_lines` как прислала точка.
  4. Движения.
  5. Аудит.
- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply stock counts of offline stores`.

### Task 3: Возврат поставщику

**Files:** Modify `apps/api/src/app/inventory/document-facts.ts` (зовёт `SupplierReturnsRepository.receiptsOfBatches`, `returnAmount`).

- [ ] **Step 1: Проверки:**
  - **Поставщик:** сети существует (`unknown_supplier`).
  - **Строки:**
    - не пусты, `qtyPieces > 0`, `unit` ∈ `pack` / `piece`, `piecesPerPack` — целое ≥ 1;
    - партия точки (`batchesOf`, ожидание), `batch.productId = line.productId`;
    - **поставщик партии = поставщик документа**, иначе `batch_mismatch`.
  - **Сумма строки** = `returnAmount({ qtyPieces, unit, purchasePricePerPackDirams, costPerPieceDirams` партии`, piecesPerPack` строки`})`, иначе `total_mismatch`. Итог = Σ сумм = `document.totalDirams`, иначе `total_mismatch`.
  - **Движения:** одно на строку, `supplier_return`, −штуки, партия строки, дата документа.
  - `batches` и `prices` пусты.
- [ ] **Step 2: Запись:**
  1. Заголовок (`supplierId`, `supplierReturnReason`).
  2. Строки `supplier_return_lines` с `amount_dirams`.
  3. Движения.
  4. `SupplierLedger.returnPosted`:
     - юрлицо точки;
     - строки с `receiptId` из `receiptsOfBatches`;
     - `employeeId = postedBy`.
  5. Аудит.

  Проверить, что кредит распределяется по открытым приходам один раз: `returnPosted` → распределение не видит возврат дважды (урок C1 PR 2b).
- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply supplier returns of offline stores`.

### Task 4: `product_merge`, живая проверка, документы, наборы

**Files:**
- Modify: `apps/api/src/app/inventory/document-facts.ts`, `CLAUDE.md` (если меняется граф — не меняется), спецификация, раздел 13.
- Scratchpad: `os_doc2.sh`, `os_doc_specs.cjs` (новые типы).

- [ ] **Step 1: `product_merge`:**
  - **Товар точки:** `mergeFromProductId` — товар точки (`origin = 'local'`, `created_at_store_id` = точка), иначе `merge_mismatch`.
    - Его `merged_into_product_id` ещё null → ожидание (`dependency`, код `merge_decision`): решение по дублю ещё не пришло.
    - Равен `mergeIntoProductId` → дальше.
    - Иначе — `merge_target_mismatch`.
  - **Строки:**
    - `fromBatchId` — партия точки товара L (`batchesOf`, ожидание);
    - `toBatchId` ∈ `batches` (новая, `productId = X`, `origin = 'product_merge'`, `sourceDocumentId = document.id`, `expiryDate`, `lotNumber`, цены — как у `fromBatch`);
    - различные id, свободны.
  - **Движения:** на строку пара — `merge_out` −qty на `fromBatchId` и `merge_in` +qty на `toBatchId`, `sourceLineId` = строка, дата документа.
  - **Запись:**
    1. Заголовок без итога.
    2. Партии, `source_batch_id = fromBatchId`.
    3. Строки.
    4. Движения.
    5. Аудит.
- [ ] **Step 2:** сборка, перезапуск `api-oc-4210`.
- [ ] **Step 3: Живые сценарии** (точка A, ключ, `offline`):

  | Шаг | Операция | Ожидается |
  |---|---|---|
  | i1 | инвентаризация: недостача 2 шт. по B2, излишек 1 шт. по BQ, найденный товар Q с новой партией 3 шт. | `applied`; движения −2 / +1 / +3, партия излишка, итог = Σ |шт.| × себестоимость |
  | i2 | недостача по партии больше её остатка в облаке | `applied`, остаток в облаке отрицательный |
  | i3 | итог не сходится; две строки на одну партию | `total_mismatch`; `batch_mismatch` |
  | r1 | возврат поставщику 1 упаковки PR из партии прихода d1-типа (приход точки в том же прогоне) | `applied`; движение −10; запись `supplier_return` в долге, кредит распределён на приход партии один раз |
  | r2 | возврат по штукам | сумма = штуки × себестоимость штуки |
  | r3 | партия другого поставщика | `batch_mismatch` |
  | r4 | итог не сходится | `total_mismatch` |
  | m1 | в одном батче: товар L (с партией из начальных остатков), затем `product_merge` L → X, затем решение `merge` | `product_merge` ждёт и применяется в конце батча; остаток L = 0, у X — новая партия с тем же сроком |
  | m2 | повтор батча | `duplicate` |
  | m3 | `product_merge` в другую карточку после решения | `merge_target_mismatch` |

- [ ] **Step 4: Наборы:**
  - `npx nx run-many -t lint test build -p shared-dto shared-domain api --parallel=1`;
  - `npx nx run api:integration`;
  - `npx nx run api:db-types-verify`.

  Expected: exit 0; integration 158/158.
- [ ] **Step 5: Коммиты:** `feat(api): apply product merge documents of offline stores`, затем `docs: offline sync PR 2c — data model, spec decisions`.
