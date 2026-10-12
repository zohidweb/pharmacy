# Инвентаризация (PR-2) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** инвентаризация на API — старт со снимком остатков, пересчёт несколькими сотрудниками со сканером,
найденный товар, проведение (излишки, недостачи, новые партии), отмена проведения, отмена инвентаризации,
заморозка товаров охвата для складских документов — и экран «Инвентаризация» `apps/web` на API.

**Architecture:** миграция `stock-counts` (тип `inventory`, статус `cancelled`, строки, записи пересчёта, партия
`inventory_surplus`, движения `inventory_gain` / `inventory_loss`). В модуле `inventory` — сервис инвентаризации,
её проведение и внутренний сервис заморозки `StockFreeze`, который вызывают проведение и отмена прихода, НО и
списания. Строится на PR-1 «Списание» (`checkDocumentDate`, `foreignMovements(..., after)`).

**Tech Stack:** как в PR-1.

**Spec:** `docs/superpowers/specs/2026-10-12-write-offs-stock-counts-design.md` — разделы 2 (S1–S7, R1, B1–B3,
поправки 2.1 п. 3–6), 3.2, 5, 6 (инвентаризация), 7, 8 (PR-2), 10, 11 (PR-2).

## Global Constraints

- Все Global Constraints PR-1 в силе.
- Статусы: в БД `draft` / `posted` / `cancelled`; в контракте `in_progress` / `posted` / `cancelled`.
- Номер `ИН-<код точки>-<год>-<6 цифр>`, счётчик вида `inventory`; дата документа — бизнес-дата старта.
- Права: старт, проведение — `inventory:post`; записи, найденный товар, комментарий — `inventory:update`; отмена
  проведения — `inventory:unpost`; отмена инвентаризации — `inventory:delete`; удаление чужой записи —
  `inventory:post`; стоимость и цена найденного товара (видеть и вводить) — `finance:view-cost`.
- Одна инвентаризация `draft` на точку; охват `all` / `category` (без «Выборочно»).
- Запись пересчёта: `id` — ключ идемпотентности планшета (UUIDv7); повтор с тем же телом — тот же ответ, с
  другим — 409 `idempotency_conflict`.
- Заморозка (5.3): блокировка точки `pg_advisory_xact_lock_shared` / `pg_advisory_xact_lock` по ключу
  `stock:<tenant>:<store>`.

## Review Focus

1. Старт инвентаризации и проведение прихода с товаром охвата в одну секунду → либо приход проведён до снимка
   (и попал в учётный остаток), либо он получает 409 `stock_count_in_progress`; третьего нет (Задача 3, curl двумя
   фоновыми запросами).
2. Два планшета одновременно шлют записи одной строки и повторяют их при обрыве → факт = сумма уникальных записей,
   повтор не задваивает (Задача 4).
3. Продажа (движение `sale`) по партии во время пересчёта → при проведении расхождение считается от текущего
   остатка, излишка «на проданное» нет (Задача 5, вставка `sale` через `appx`).
4. Отмена проведения инвентаризации всей точки после продажи товара **без расхождения** не блокируется (B2), после
   продажи товара с расхождением или из новой партии излишка — 409 (Задача 5).
5. Отмена инвентаризации снимает заморозку сразу: приход с товаром охвата проводится (Задача 4).

---

### Task 1: Схема инвентаризации

**Files:**
- Create: `apps/api/migrations/<Date.now()>_stock-counts.sql`
- Modify: `table-classes.ts`, `db.generated.ts`

- [ ] **Step 1: миграция** — раздел 3.2 спецификации: `documents.type` + `inventory`; `documents.status` +
  `cancelled` с `check (status <> 'cancelled' or type = 'inventory')`; колонки инвентаризации и `cancelled_by/at`
  (FK на `employees`, на `categories`), `check` раздела 3.2; `inventory_lines` (уникальность строки с партией —
  частичный уникальный индекс `where batch_id is not null`), `inventory_count_entries` (FK на строку и документ,
  индекс `(tenant_id, line_id)`, `(tenant_id, document_id)`); `batches.origin` + `inventory_surplus` (у такой
  партии `supplier_id` пуст); `stock_movements.kind` + `inventory_gain`, `inventory_loss`; частичный индекс
  `documents (tenant_id, store_id) where type = 'inventory' and status = 'draft'` (одна активная на точку —
  `unique`); RLS, гранты.
- [ ] **Step 2: манифест** — обе таблицы класса `tenant`.
- [ ] **Step 3: проверка.** `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration` —
  зелёное.
- [ ] **Step 4: коммит** `feat(api): stock counts schema`.

### Task 2: Контракт и моки

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-inventory.ts`, `apps/web/src/shared/api/routes.ts`,
  `apps/web/src/shared/api/mocks/handlers-stock.ts`

**Interfaces:**
- Produces (раздел 6 спецификации):
  ```ts
  type StockCountScope = 'all' | 'category';
  interface StockCountEntry { id: string; pieces: number; byName: string; mine: boolean; at: string }
  interface StockCountLine {
    lineId: string; productId: string; productName: string; barcodes: string[];
    isFound: boolean; batchId: string | null; batchNumber: string; expiresOn: string | null;
    piecesPerPack: number; bookPieces: number; soldSincePieces: number;
    counted: boolean; factPieces: number | null; entries: StockCountEntry[];
    pieceCostMinor?: number;          // с правом
    costMinor?: number | null;        // цена упаковки найденного товара, с правом
  }
  // StockCount.status: 'in_progress' | 'posted' | 'cancelled'; + cancelledBy: DocumentAuthor | null
  interface StartStockCountRequest { storeId: string; scope: StockCountScope; categoryId: string | null }
  interface SaveStockCountRequest { comment: string }
  interface StockCountEntryRequest { id: string; lineId: string; pieces: number }
  interface FoundLineInput { productId: string; batchNumber: string; expiresOn: string | null; costMinor: number | null }
  ```
  Маршруты web: `stockCounts.addEntry` (`POST …/entries` → `StockCountLine`), `stockCounts.deleteEntry`
  (`DELETE …/entries/{entryId}` → `StockCountLine`), `stockCounts.addFoundLine` / `updateFoundLine` /
  `deleteFoundLine` (→ `StockCount`), `stockCounts.cancel` (`POST …/cancellation` → `StockCount`);
  `stockCounts.save` → только комментарий.

- [ ] **Step 1: контракт и маршруты** — как выше, JSDoc с кодами раздела 7.
- [ ] **Step 2: моки** — новый контракт: записи складываются, найденный товар, отмена, заморозка
  (`stock_count_in_progress` у прихода, НО и списания с товаром охвата).
- [ ] **Step 3: проверка.** `npx tsc -b libs/shared/domain libs/shared/dto && npx tsc --noEmit -p
  apps/web/tsconfig.json && npx nx run-many -t lint test --parallel=1 -p shared-dto web` — зелёное (экраны
  инвентаризации компилируются на временных адаптациях; полностью они переделываются в Задаче 6).
- [ ] **Step 4: коммит** `feat(dto): stock counts with entries, found lines and cancellation`.

### Task 3: Заморозка склада

**Files:**
- Create: `apps/api/src/app/inventory/stock-freeze.ts`
- Modify: `posting.ts`, `write-off-posting.ts`, `stock-documents.service.ts`, `write-offs.service.ts`,
  `inventory.module.ts`

**Interfaces:**
- Produces:
  ```ts
  class StockFreeze {
    /** Shared lock of the store's stock for a document posting or unposting. */
    lockShared(trx, tenantId: string, storeId: string): Promise<void>;
    /** Exclusive lock for a stock count start, posting, unposting and cancellation. */
    lockExclusive(trx, tenantId: string, storeId: string): Promise<void>;
    /** 409 stock_count_in_progress with errors[] lines.i.productId for frozen products. */
    assertNotFrozen(trx, tenantId: string, storeId: string, productIds: readonly string[],
      exceptDocumentId?: string): Promise<void>;
  }
  ```

- [ ] **Step 1: реализация** — ключ `hashtextextended('stock:'||tenant||':'||store, 0)`; заморожен — есть
  `inventory` `draft` точки с охватом `all` или `category` = текущая категория товара (категории через
  `ProductsReader.findForStock`).
- [ ] **Step 2: подключение** — проведение и отмена прихода, НО (`DocumentPosting`) и списания
  (`WriteOffPosting`): первым действием после блокировки заголовка — `lockShared`, затем `assertNotFrozen` по
  товарам строк.
- [ ] **Step 3: проверка** — после Задачи 4 (нужен старт); здесь `npx nx run-many -t build typecheck lint -p api
  --parallel=1` — зелёное.
- [ ] **Step 4: коммит** `feat(api): freeze the stock of a running stock count`.

### Task 4: API инвентаризации — старт, пересчёт, найденный товар, отмена

**Files:**
- Create: `apps/api/src/app/inventory/{stock-counts.repository, stock-counts.service, stock-counts.controller}.ts`,
  `dto/stock-counts.dto.ts`
- Modify: `documents.repository.ts` (тип `inventory`, колонки шапки, статус `cancelled`), `numbering.ts`
  (`inventory` → `ИН`), `unposting-check.controller.ts` (`stock-counts`), `inventory.module.ts`

**Interfaces:**
- Consumes: `StockFreeze` (Задача 3); `StockRepository.batchStock`; `ProductsReader.findForStock`, `searchIds`
  (товары категории — новый `ProductsReader.idsOfCategory(trx, tenantId, categoryId): Promise<string[]>`, любой
  статус).
- Produces: `StockCountsRepository` с `insertLines`, `lines`, `entries`, `insertEntry` (`on conflict (tenant_id, id)
  do nothing returning id`), `findEntry`, `deleteEntry`, `insertFoundLine`, `updateFoundLine`, `deleteFoundLine`,
  `activeCount(trx, tenantId, storeId)`; `StockCountsService.toDto(trx, tenantId, doc)`.

- [ ] **Step 1: DTO** — `StartStockCountDto` (категория обязательна тогда и только тогда, когда `category`),
  `StockCountEntryDto` (`pieces` integer −1 000 000…1 000 000), `FoundLineDto` (`costMinor` 0–10¹⁰ или null,
  `expiresOn` `DATE` или null, `batchNumber` ≤ 60), `SaveStockCountDto` (`comment` ≤ 500), список.
- [ ] **Step 2: старт** — раздел 5.2: `lockExclusive`; активная инвентаризация точки → 409
  `stock_count_in_progress` (уникальный индекс ловит гонку → тот же 409); снимок строк; аудит
  `stock_count.started`.
- [ ] **Step 3: пересчёт** — записи (идемпотентность, только `draft` → 409 `document_posted` /
  `document_cancelled`, ответ — строка); удаление записи — автор или `inventory:post`; найденный товар (активный
  → иначе 409 `product_archived`; цену принимать и показывать только с `finance:view-cost`, без права — поле
  игнорируется); удаление найденной строки без записей; комментарий.
- [ ] **Step 4: отмена инвентаризации** — `lockExclusive`, только `draft`, статус `cancelled`, аудит
  `stock_count.cancelled`.
- [ ] **Step 5: чтение** — список (без `draft`-фильтра по умолчанию), карточка: факт = сумма записей,
  `soldSincePieces` = учётный при старте − текущий остаток (для строк с партией), `entries` с `mine`.
- [ ] **Step 6: проверка.** build/typecheck/lint api — зелёное; curl:
  - старт всей точки → строки по партиям с остатком; второй старт → 409;
  - две записи разных сотрудников одной строки → сумма; повтор записи тем же ключом из двух фоновых запросов →
    одна запись (RF2); тот же ключ с другим числом → 409;
  - чужая запись: фармацевт → 403, заведующий → удалена;
  - найденный товар; архивный → 409; цена фармацевтом игнорируется;
  - заморозка: проведение прихода, списания и НО с товаром охвата → 409 `stock_count_in_progress`; инвентаризация
    категории — товар другой категории проводится; старт и проведение прихода двумя фоновыми запросами (RF1);
  - отмена инвентаризации → приход проводится (RF5).
- [ ] **Step 7: коммит** `feat(api): stock counts — start, counting, found products, cancellation`.

### Task 5: API инвентаризации — проведение и отмена проведения

**Files:**
- Create: `apps/api/src/app/inventory/stock-count-posting.ts`
- Modify: `stock-counts.service.ts`, `stock-counts.controller.ts`

- [ ] **Step 1: проведение** — раздел 5.2 спецификации: `lockExclusive`; полнота (422 `lines.i.counted`,
  `lines.i.expiresOn`, `lines.i.costMinor`, итог < 0 → `lines.i.counted: negative`);
  `checkDocumentDate(..., { backdating: false })` (B3); партии строк `FOR UPDATE`, затем остатки; расхождения →
  `inventory_gain` / `inventory_loss`; найденный товар → партия `inventory_surplus` (себестоимость штуки — вверх;
  при повторном проведении та же `surplus_batch_id`) и `inventory_gain`; `counted_qty_pieces`,
  `sold_since_start_pieces`, `total_dirams`; аудит.
- [ ] **Step 2: отмена проведения** — блокеры только по партиям, которые документ двигал (строки с расхождением ≠ 0
  и партии излишков; B2), `foreignMovements(..., doc.postedAt)` → 409 `unpost_blocked`; закрытый период → 422;
  другая активная инвентаризация точки → 409 `stock_count_in_progress`; `reversal`; статус `draft`, записи
  сохраняются; `unposting-check` по тем же партиям.
- [ ] **Step 3: проверка.** build/typecheck/lint api; curl:
  - неполный лист → 422 у строк; найденный товар без цены → 422 `lines.i.costMinor`;
  - проведение: излишек, недостача, новая партия, остатки = факт;
  - продажа во время пересчёта (`appx` вставляет `sale`) → расхождение от текущего остатка (RF3);
  - отмена проведения после продажи товара без расхождения — проходит; после продажи из партии излишка — 409
    (RF4); повторное проведение — та же партия излишка;
  - закрытый период → 422.
- [ ] **Step 4: коммит** `feat(api): stock count posting and unposting`.

### Task 6: Web — инвентаризация на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES` + `stockCounts.*`; `REAL_API_WHEN` +
  `stock-counts`), `apps/web/src/pages/stock-counts/ui/{StockCountsPage, StockCountEditor}.tsx`, редакторы
  прихода, НО и списания (текст `stock_count_in_progress`), i18n `ru` / `tg`
- Create (при необходимости разбиения): `apps/web/src/pages/stock-counts/ui/{CountScanner, FoundLineDialog}.tsx`

- [ ] **Step 1: экран** — раздел 8 спецификации: старт «Вся точка» / «Категория» (кнопка — с `inventory:post`);
  поле сканера (штрихкод → строка по `barcodes`; несколько партий — выбор; нет в листе — диалог найденного
  товара с поиском по `stock.products`); ввод количества (в упаковках или штуках) отправляет запись с ключом
  `uuidv7()`, ключ живёт до успеха (повтор не задваивает); у строки — итог и записи, удаление своих (чужих — с
  `inventory:post`); `refetchInterval` 10 с, пока документ `in_progress`; «Провести» подсвечивает непосчитанные
  строки по `errors[]`; «Отменить инвентаризацию» (с `inventory:delete`, подтверждение); статус «Отменена».
- [ ] **Step 2: проверка.** Браузер (`partial`): старт; ввод штрихкода в поле сканера; две вкладки разных
  сотрудников вводят записи одной строки — сумма видна в обеих; найденный товар; проведение; приход с товаром
  охвата во время пересчёта — понятная ошибка; отмена инвентаризации. `npx nx run-many -t build && npx nx
  run-many -t typecheck lint test fsd --parallel=1 -p web`, `npx nx e2e web-e2e` — зелёные.
- [ ] **Step 3: коммит** `feat(web): stock counts on the API`.

### Task 7: Документы

- [ ] **Step 1: правки** — модель `03`: «Введено миграцией `stock-counts`», поправки 2.1 п. 3–6, правило
  заморозки; CLAUDE.md `web:dev-api` (+ инвентаризация).
- [ ] **Step 2: коммит** `docs: stock counts — data model, CLAUDE.md`.
