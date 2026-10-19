# Офлайн-точка, PR 2a — локальные цены и товары точки: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** облако применяет три операции офлайн-точки — `price.changed-locally`, `product.created-locally`, `product.duplicate-resolved` — и открывает конфликты `sync_conflicts` (цена — E25, дубль товара — E26).

**Architecture:**
- Два новых применителя регистрируются в реестре ядра `SyncAppliers`, как применители PR 1:
  - `PriceFacts` (модуль `pricing`) — цена точки;
  - `CatalogFacts` (модуль `catalog`) — товар точки и решение по дублю.
- Модуль `sync` не меняется: батч, inbox, карантин и зависимости — из PR 1.
- Миграция добавляет колонки локального товара в `products` (модель данных 02) и правило «один открытый конфликт на точку × вид × сущность».

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), node-pg-migrate SQL (только Up). Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-16-offline-sync-design.md` (утверждена 2026-10-16). Этот PR — первая треть п. 2 раздела 8: E3, E25, E26, E35 (карточка), E36, E38; раздел 4.2, строки `product.*` и `price.changed-locally`. Основа — ADR-0014 §4.

**PR 2 разбит на три** (договорённость о небольших PR):
- 2a — этот;
- 2b — `document.posted`: приход с партиями (E17, E18, E37), начальные остатки, списание (включая `transfer_discrepancy`, `product_merge`), инвентаризация, возврат поставщику;
- 2c — `transfer.dispatched` / `transfer.accepted` (E34), запрет отзыва, правила режима `offline_pending` (E8).

## Global Constraints

Всё из Global Constraints плана PR 1 (`docs/superpowers/plans/2026-10-16-offline-sync-pr1.md`) действует без изменений:
- тесты отложены до MVP — проверка живая;
- окружение Windows (`NX_ISOLATE_PLUGINS=false NX_DAEMON=false`, `--parallel=1`, пересборка деклараций libs, перезапуск `api-oc-4210` после сборки);
- правила протокола: строки точки вставляются с её id, время точки — в колонках факта;
- логи без тел операций и ПДн; деньги — целые дирамы; `tenant_id` в каждом запросе.

Дополнительно:
- Ветка `feature/offline-sync-pr2a`: `git switch -c feature/offline-sync-pr2a --no-track origin/main`. План — первым коммитом.
- Prettier — только на изменённые файлы, никогда на каталог.
- Номер миграции — текущее время в мс, больше `1792144500972`. Перед созданием проверить `ls apps/api/migrations | tail -3`: другая сессия готовит миграцию решений 2026-10-16.
- Отказ применителя — `SyncApplyError(code)`:
  - ссылка на облачные данные (товар, категория, сотрудник, конфликт) — карантин;
  - ожидания (`dependency`) в этом PR нет: всё, на что ссылаются три операции, создаёт облако или раньше та же точка в порядке `storeSeq`.
- Аудит точки — строки `payload.audit` через `AuditService.appendFact` (как в PR 1). Облако своих строк аудита на эти операции не пишет: запись `sync.batch-applied` на батч уже есть.

## Review Focus

1. **Цена, изменённая в облаке, пока точка была без связи.**
   - Ожидается: облачная цена не меняется, открыт один конфликт `price`, операция `applied` (факт принят, решение за владельцем).
   - Вторая такая же правка точки обновляет тот же конфликт, а не открывает второй.
   - Проверка — Задача 4, шаги p2–p3.
2. **Штрихкод нового товара точки уже занят в сети.**
   - Товар создан, штрихкод не вставлен (сканер облака по-прежнему находит старую карточку), открыт конфликт `duplicate_product` с `matchedBy: 'barcode'`.
   - Проверка — Задача 4, шаг c2.
3. **Решение по дублю пришло дважды разными операциями или по чужому/закрытому конфликту.**
   - Ожидается карантин (`conflict_resolved` / `unknown_conflict`), данные не меняются.
   - Проверка — Задача 4, шаг c6.
4. **Чек точки продаёт товар, созданный на точке.**
   - Ожидается: товар уже применён (раньше по `storeSeq`), чек `applied`.
   - Проверка — Задача 4, шаг c7.
5. **«Объединить» с карточкой, отличной от найденной в конфликте.**
   - Ожидается карантин `merge_target_mismatch`: точка не может слить свой товар с произвольной карточкой сети.
   - Проверка — Задача 4, шаг c6.

---

### Task 1: Контракты операций и миграция локального товара

**Files:**
- Modify: `libs/shared/dto/src/lib/sync-protocol.ts`.
- Create: `apps/api/migrations/<ms>_sync-local-catalog.sql`.
- Modify: `apps/api/src/core/database/db.d.ts` (генерация `api:db-types`).
- Modify: `docs/architecture/data-model/02-catalog-prices.md`, `docs/architecture/data-model/06-sync-audit-billing.md`.

**Interfaces — Produces** (в `sync-protocol.ts`, рядом с payload PR 1):
- `SyncProductRow`:
  - поля `ProductValues` каталога (`name`, `inn`, `dosageForm`, `dosage`, `manufacturer`, `country`, `unit`, `piecesPerPack`, `soldByPiece`, `isPrescription`, `isControlled`, `isPriceRegulated`, `maxRetailPricePerPackDirams`, `categoryId`, `markupBp`, `defaultMinStockPieces`);
  - плюс `id`, `createdAtStoreId`, `createdAt` (часы точки).
- `ProductCreatedLocallyPayload { product: SyncProductRow; barcodes: string[]; createdBy: string; audit: SyncAuditRow[] }`.
- `ProductDuplicateResolvedPayload { conflictId: string; productId: string; decision: 'merge' | 'keep'; mergedIntoProductId: string | null; resolvedBy: string; resolvedAt: string; audit: SyncAuditRow[] }`.
- `PriceChangedLocallyPayload`:
  - `productId`, `storeId`;
  - `retailPricePerPackDirams: number`, `retailPricePerPieceDirams: number | null`;
  - `basePriceVersion: number | null` — версия облачной цены, которую видела точка; `null` — у точки цены не было;
  - `changedBy: string`, `changedAt: string`;
  - `audit: SyncAuditRow[]`.

- [ ] **Step 1: Контракты.** Добавить три типа с JSDoc на английском. Пересобрать декларации: `npx tsc -b libs/shared/dto/tsconfig.lib.json libs/shared/domain/tsconfig.lib.json --force`.
  Expected: без вывода.

- [ ] **Step 2: Миграция `<ms>_sync-local-catalog.sql`.**
  - Колонки `products` (модель данных 02):
    - `origin text not null default 'cloud' check (origin in ('cloud','local'))`;
    - `created_at_store_id uuid`, FK `(tenant_id, created_at_store_id)` → `stores`;
    - `merged_into_product_id uuid`, FK `(tenant_id, merged_into_product_id)` → `products`.
  - Проверки `products`:
    - `(origin = 'local') = (created_at_store_id is not null)`;
    - `merged_into_product_id is null or (merged_into_product_id <> id and status = 'archived')`.
  - Индексы:
    - `products (tenant_id, created_at_store_id) where created_at_store_id is not null`;
    - `products (tenant_id, merged_into_product_id) where merged_into_product_id is not null`.
  - `sync_conflicts`:
    - `create unique index sync_conflicts_open_uq on pharmacy.sync_conflicts (tenant_id, store_id, kind, entity_id) where status = 'open'`;
    - `drop index pharmacy.sync_conflicts_open_idx` — его колонки — префикс нового индекса.
  - Новых таблиц нет: `table-classes.ts` не меняется.

  Run: `npx nx run api:migrate`, затем `npx nx run api:db-types`.
  Expected: миграция применена, в `db.d.ts` у `Products` появились `origin`, `createdAtStoreId`, `mergedIntoProductId`.

- [ ] **Step 3: Модель данных.**
  - В 02 колонки `origin`, `created_at_store_id`, `merged_into_product_id` отмечены как введённые этой миграцией.
  - Слитая карточка — `status = 'archived'` + `merged_into_product_id` (E35, «локальная карточка архивируется»). Значения `merged` у `status` нет — исправить строку `status` в 02.
  - В 06 у `sync_conflicts`:
    - один открытый конфликт на (точка, вид, сущность);
    - формы `local_value` / `cloud_value` — из Задач 2 и 3.

- [ ] **Step 4: Проверка и коммит.**
  Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t lint build -p shared-dto api --parallel=1`.
  Expected: exit 0.
  Commit: `feat(db): local products of offline stores and one open sync conflict per entity`.

### Task 2: `PriceFacts` — цена точки и конфликт цены (E25, E38)

**Files:**
- Create: `apps/api/src/app/pricing/price-facts.ts`.
- Modify: `apps/api/src/app/pricing/pricing.repository.ts`, `apps/api/src/app/pricing/pricing.module.ts` (imports `SyncCoreModule`, provider `PriceFacts`).

**Interfaces:**
- Consumes:
  - `PriceChangedLocallyPayload` (Задача 1);
  - `SyncAppliers`, `SyncApplyError`, `sameStore`, `isMoney`, `requireEmployees`, `requireProducts` из `core/sync`;
  - `AuditService.appendFact(trx, tenantId, row, storeId)`.
- Produces:
  - `PriceFacts implements FactApplier`, `types = ['price.changed-locally']`;
  - конфликт `kind = 'price'`, `entity_id = productId`:
    - `local_value = { priceDirams, piecePriceDirams, basePriceVersion, changedBy, changedAt }`;
    - `cloud_value = { priceDirams, piecePriceDirams, priceVersion, changedBy, changedAt }`.
    - Читатель — экран «Конфликты цен» в PR 5 (`PriceConflict`).

- [ ] **Step 1: Репозиторий.** В `PricingRepository`:
  - `lockStorePrice(trx, tenantId, storeId, productId)` → `{ priceDirams: bigint | null; piecePriceDirams: bigint | null; priceVersion: number; priceChangedBy: string | null; priceChangedAt: Date | null } | null` — `select … for update`.
  - `setStorePriceFromStore(trx, row)`:
    - upsert `store_products` с `price_source = 'store'`, `price_changed_by` / `price_changed_at` — из операции, `price_version + 1`;
    - вставка новой строки — `on conflict do nothing returning`; ничего не вернулось — строку вставил облачный писатель: снова `lockStorePrice` и сравнение.

- [ ] **Step 2: Применитель.** Порядок в `apply`:
  1. Проверки: `sameStore(payload.storeId, storeId)`; цены — `isMoney` и > 0 (`invalid_price`); `requireProducts([productId])` (карантин `unknown_product`); `requireEmployees([changedBy])`.
  2. `lockStorePrice`. Цена точки применяется, если:
     - строки нет;
     - в строке нет цены пачки;
     - `priceVersion === basePriceVersion`.

     Тогда `setStorePriceFromStore`. Если открыт конфликт `price` по этой точке и товару — он закрывается: `resolution = 'local'`, `resolved_by = changedBy`, `resolved_at = now()`. Это новое решение точки, принятое уже после облачной цены (E38).
  3. Иначе облачная цена остаётся. Конфликт: `insert … on conflict (tenant_id, store_id, kind, entity_id) where status = 'open' do update set local_value = excluded.local_value, cloud_value = excluded.cloud_value`. id конфликта — `uuidv7()`.
  4. Строки `payload.audit` → `appendFact`, в обоих случаях: точка у себя цену поменяла.

  Цена выше предельной не проверяется: на точке редактор её подтвердил, а это факт (ADR-0014 §4).

- [ ] **Step 3: Проверка и коммит.**
  Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply local prices of offline stores with the price conflict`.

### Task 3: `CatalogFacts` — товар точки и решение по дублю (E26, E35, E36)

**Files:**
- Create: `apps/api/src/app/catalog/catalog-facts.ts`.
- Modify: `apps/api/src/app/catalog/catalog.repository.ts`, `apps/api/src/app/catalog/catalog.module.ts` (imports `SyncCoreModule`, provider `CatalogFacts`).

**Interfaces:**
- Consumes:
  - `ProductCreatedLocallyPayload`, `ProductDuplicateResolvedPayload` (Задача 1);
  - `core/sync` (как в Задаче 2), `AuditService.appendFact`.
- Produces:
  - `CatalogFacts implements FactApplier`, `types = ['product.created-locally', 'product.duplicate-resolved']`;
  - конфликт `kind = 'duplicate_product'`, `entity_id` = id товара точки:
    - `local_value = { productId, name, createdBy, pendingBarcodes: string[] }`;
    - `cloud_value = { productId, matchedBy: 'barcode' | 'name', barcode: string | null }`.
    - Читатель — `catalog.duplicates` в PR 4–5 (`CatalogDuplicate`).

- [ ] **Step 1: `product.created-locally`.**
  1. Проверки:
     - `sameStore(product.createdAtStoreId, storeId)`; `requireEmployees([createdBy])`;
     - категория сети существует — иначе карантин `unknown_category`;
     - id товара уже есть в сети — карантин `id_reused`.
  2. Вставка через `insertProduct` с `origin = 'local'`, `created_at_store_id = storeId`; `created_at` — время точки. Остальные правила (единица, кратность, ПКУ ⇒ рецептурный, предельная цена) проверяют CHECK таблицы — нарушение уходит в карантин `apply_failed:<sqlstate>`, как в PR 1.
  3. Штрихкоды — в порядке сортировки:
     - свободный в сети — вставляется;
     - занятый — не вставляется, попадает в `pendingBarcodes`; первый занятый даёт совпадение `barcode` с его карточкой.
  4. Нет совпадения по штрихкоду — поиск по названию: активная карточка сети (`merged_into_product_id is null`, `id <> product.id`), у которой совпадают:
     - `lower(inn->>'ru')`, `lower(dosage_form)`, `lower(dosage)`, `lower(manufacturer)` — все четыре не пустые;
     - первая по `created_at`, затем по `id`.

     Найдено — совпадение `name`.
  5. Есть совпадение — конфликт `duplicate_product` (`uuidv7()`), `on conflict do nothing`.
  6. `payload.audit` → `appendFact`.

- [ ] **Step 2: `product.duplicate-resolved`.**
  1. Конфликт: `select … for update` по `conflictId` в сети.
     - Нет конфликта, другой вид, другая точка или `entity_id ≠ productId` — карантин `unknown_conflict`.
     - Конфликт уже закрыт — карантин `conflict_resolved`.
     - `requireEmployees([resolvedBy])`.
  2. `merge`:
     - `mergedIntoProductId` должен равняться `cloud_value.productId` — иначе карантин `merge_target_mismatch`;
     - карточка X не слита сама — иначе тот же код;
     - товар точки: `status = 'archived'`, `archived_at = resolvedAt`, `merged_into_product_id = X`;
     - его штрихкоды переходят на X (`update product_barcodes set product_id = X`), чтобы скан находил ту же карточку;
     - `pendingBarcodes` не вставляются: занятые уже указывают на X или на другую карточку.
  3. `keep`: `mergedIntoProductId` должен быть `null`; ничего не меняется; `pendingBarcodes` остаются только на точке (E26).
  4. Конфликт: `status = 'resolved'`, `resolution = decision`, `resolved_by`, `resolved_at = resolvedAt`.
  5. `payload.audit` → `appendFact`.

  Остатки по товару точки при `merge` переносит её документ `product_merge` (E35) — это PR 2b. Группировка истории отчётов через алиас (`coalesce(merged_into_product_id, product_id)`) — с отчётами владельца, PR 5.

- [ ] **Step 3: Проверка и коммит.**
  Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply local products of offline stores and duplicate decisions`.

### Task 4: Живая проверка, документы, наборы

**Files:**
- Modify: `CLAUDE.md` — граф модулей: `catalog` и `pricing` тоже регистрируют применители.
- Modify: спецификация — ответ на открытые вопросы «Решения при реализации» в конце (переход штрихкодов при `merge`, статус слитой карточки).
- Scratchpad: `os_check.sh` (часть `cat`), `os_cat_specs.cjs` (по образцу `os_pos_specs.cjs`).

- [ ] **Step 1: Сборка и перезапуск.**
  Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx build api`, перезапустить `api-oc-4210`.
  Expected: exit 0, `/api/v1/health` — 200.

- [ ] **Step 2: Живые сценарии** (точка A сети `pos_setup.sh`, ключ из `issue-license-key.mjs`, режим `offline`).

  **Цены:**

  | Шаг | Операция | Ожидается |
  |---|---|---|
  | p1 | цена Q с `basePriceVersion` = текущая версия | `applied`; цена Q у A новая, `price_source = store`, версия +1, строка аудита точки |
  | p2 | облако меняет цену Q у A (`PUT /prices`, владелец) | версия +1 |
  | p3 | правка точки со старой версией, затем ещё одна со старой | обе `applied`; облачная цена не изменилась; один открытый конфликт `price` с последней ценой точки |
  | p4 | правка с актуальной версией | `applied`; цена точки; конфликт `resolved` / `local` |
  | p5 | цена неизвестного товара; цена 0 | `quarantined:unknown_product`; `quarantined:invalid_price` |

  **Товары:**

  | Шаг | Операция | Ожидается |
  |---|---|---|
  | c1 | товар L1 со свободным штрихкодом | `applied`; `origin = local`, `created_at_store_id = A`, штрихкод у L1 |
  | c2 | товар L2 со штрихкодом PR | товар есть, штрихкод у PR; конфликт `duplicate_product` / `barcode` с PR |
  | c3 | товар L3 с МНН, формой, дозировкой и производителем Q | конфликт `name` с Q |
  | c4 | решение `merge` по L2 → PR | L2 `archived`, `merged_into_product_id = PR`, конфликт `merge` |
  | c5 | решение `keep` по L3 | конфликт `keep`, L3 активна |
  | c6 | второе решение по L2 другой операцией; `merge` L3 с чужой карточкой; несуществующий конфликт; L4 с неизвестной категорией | `quarantined:conflict_resolved` / `merge_target_mismatch` / `unknown_conflict` / `unknown_category` |
  | c7 | чек точки (смена, терминал из PR 1-спеков), продающий L1 | `applied` |
  | c8 | весь батч c1–c3 повторно | все `duplicate`, строк не прибавилось |

- [ ] **Step 3: Наборы.**
  Run:
  - `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t lint test build -p shared-dto shared-domain api --parallel=1`;
  - `npx nx run api:integration`;
  - `npx nx run api:db-types-verify`.

  Expected: exit 0; `api` 462/462; integration 158/158 (каталог таблиц не меняется).

- [ ] **Step 4: Коммит документов.**
  Commit: `docs: offline sync PR 2a — module graph, data model, spec decisions`.
