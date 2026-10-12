# Возврат поставщику (PR-1) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** документ «Возврат поставщику» на API (черновик фармацевтом, проведение заведующим, отмена проведения),
зачёт его суммы в расчётах с поставщиком и экран «Возврат поставщику» `apps/web` на API в режиме `partial`.

**Architecture:** миграция `supplier-returns` (тип документа, причина в шапке, строки по партиям, движение
`supplier_return`, распределения возвратов). В модуле `inventory` — репозиторий, сервис, контроллер и проведение
возврата по образцу списания; в модуле `purchasing` — возврат как кредит поставщика: `SupplierLedger` пишет журнал,
`PaymentAllocation` распределяет оплаты **и** кредиты возвратов на приходы. Строится на PR #18–#21.

**Tech Stack:** NestJS 11, Kysely + `pg`, node-pg-migrate (SQL, только Up), Next.js static export, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-12-supplier-returns-transfers-design.md` — разделы 2 (R1–R7, E1, E2,
поправки 2.1 п. 1–3), 3.1, 4, 6 (возврат), 7, 8 (PR-1), 10, 11 (PR-1).

## Global Constraints

- Тесты отложены до MVP: новые автотесты не пишутся, существующие наборы остаются зелёными; проверка — живая
  (curl, браузер), команды и ожидаемый результат — в шагах.
- Деньги — integer дирамы; остатки и движения — в штуках; остаток не хранится, только сумма движений.
- Документ, его движения и записи журнала расчётов — одна транзакция; партии `FOR UPDATE` одним оператором, затем
  подсчёт (ADR-0006); распределения пары «поставщик × юрлицо» — под `PurchasingRepository.lockSettlement`.
- `tenant_id` в каждом запросе; новые таблицы — RLS fail-closed, гранты `pharmacy_app`, манифест `table-classes.ts`.
- Причины возврата — ровно `defect`, `expired`, `broken`; одна на документ.
- Номер `ВП-<код точки>-<год>-<6 цифр>`, счётчик `document_counters` вида `supplier_return`.
- Сумма строки = `round(штуки × цена упаковки партии / штук в упаковке)` (как `linesTotal` прихода).
- Права: `inventory:view` / `create` / `update` / `post` / `unpost`; суммы (`costMinor`, `totalMinor`, сумма KPI) —
  только с `finance:view-cost`, запись черновика этого права **не требует**.
- Офлайн-точка: запись из облака → 409 `offline_store_read_only`; точка вне охвата → 403 `store_not_in_scope`.
- Модули: `inventory` зовёт `purchasing` только через экспортируемый `SupplierLedger` (ADR-0002).
- Commits — Conventional Commits; после `next build` вернуть `apps/web/next-env.d.ts`; Nx при зависании —
  `NX_ISOLATE_PLUGINS=false NX_DAEMON=false`; не коммитить `package.json` (правка axios пользователя) и
  `.claude/launch.json`.

## Review Focus

1. Проведение возврата и оплата тому же поставщику и юрлицу одновременно → ни один приход не покрыт сверх долга:
   по каждому приходу оплаты + возвраты ≤ сумма прихода, остаток оплаты и кредита не отрицателен (Задача 4,
   curl двумя фоновыми запросами + SQL-сверка).
2. Кредит полностью оплаченного прихода забран следующим приходом, затем возврат отменён → распределение кредита
   снято, следующий приход снова должен, освобождённые оплаты перераспределены; итог долга = Σ приходов − Σ
   оплат − Σ проведённых возвратов (Задача 4).
3. Приход, на который общее распределение положило кредит возврата, отменён → распределение возврата снято и
   кредит не потерян: его забирает другой открытый приход или он остаётся остатком (Задача 4).
4. Стартовая партия НО с поставщиком и ценой 0 возвращается → сумма 0, проведение проходит без записи журнала
   (иначе `check amount ≠ 0` журнала уронит транзакцию) (Задача 4).
5. Фармацевт без `finance:view-cost` не получает ни одной суммы ни в списке, ни в KPI, ни в документе, ни в
   `stock-products?supplierId=` (Задача 4).

---

### Task 1: Схема возврата поставщику

**Files:**
- Create: `apps/api/migrations/<Date.now()>_supplier-returns.sql`
- Modify: `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts`
- Also commit: спецификация и оба плана (`docs/superpowers/specs/2026-10-12-supplier-returns-transfers-design.md`,
  `docs/superpowers/plans/2026-10-12-{supplier-returns,transfers}.md`)

- [ ] **Step 1: миграция** — раздел 3.1 спецификации: `documents_type_check` + `supplier_return` (пересоздать, как
  в `stock-counts`); `documents.supplier_return_reason text` с `check (… in ('defect','expired','broken'))` и
  `check ((type = 'supplier_return') = (supplier_return_reason is not null))`; `check (type <> 'supplier_return'
  or supplier_id is not null)`; `documents.source_document_id uuid` + FK `(tenant_id, source_document_id)` на
  `documents` + индекс; `supplier_return_lines` (колонки 3.1, `unique (tenant_id, document_id, line_no)`,
  `unique (tenant_id, document_id, batch_id)`, FK на `documents`, `batches`, `products`, индексы
  `(tenant_id, document_id)`, `(tenant_id, batch_id)`, `(tenant_id, product_id)`); `stock_movements_kind_check` +
  `supplier_return`; `supplier_ledger_entries_kind_check` + `supplier_return`; `supplier_return_allocations`
  (3.1); RLS, политика, гранты (полный DML у строк, как у `write_off_lines`; у распределений — как у
  `supplier_payment_allocations`).
- [ ] **Step 2: манифест** — `supplier_return_lines`, `supplier_return_allocations` класса `tenant`.
- [ ] **Step 3: проверка.** `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration` —
  миграция применяется, типы перегенерированы, интеграционные тесты зелёные.
- [ ] **Step 4: коммит** `docs: supplier returns and transfers — spec and plans` (спецификация и планы), затем
  `feat(api): supplier returns schema`.

### Task 2: Контракт и моки

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-inventory.ts`, `apps/web/src/shared/api/routes.ts`,
  `apps/web/src/shared/api/mocks/{handlers-stock, db-stock}.ts` (фикстуры возвратов),
  `apps/web/src/pages/supplier-returns/ui/{SupplierReturnsPage, SupplierReturnEditor}.tsx`,
  `apps/web/src/entities/stock-document/` (`ClaimStatusPill` — удалить, если больше не используется), i18n `ru`/`tg`

**Interfaces:**
- Produces:
  ```ts
  interface SupplierReturn { /* без claim */ comment: string; /* остальное как есть */ }
  interface SupplierReturnInput { date; supplierId; storeId; receiptId: string | null;
    reason: SupplierReturnReason; comment: string; lines: Array<StockLineInput & { note: string }> }
  interface SupplierReturnListItem { /* без claim */ }
  interface SupplierReturnListResponse { kpi: { documentsThisMonth: number; returnedThisMonthMinor?: number } }
  interface SupplierReturnListQuery { storeId?; supplierId?; reason?: SupplierReturnReason;
    status?: DocumentStatus; limit?; offset? }
  interface StockProductsQuery { /* + */ supplierId?: string }
  type StockDocumentKind = … | 'supplier-returns';
  ```
  `ClaimStatus` удаляется. JSDoc маршрутов возврата — коды раздела 7.

- [ ] **Step 1: контракт** — как в Interfaces; `supplierId` в `stock.products`: «только партии этого поставщика;
  товары без них не возвращаются; сочетается с `query`/`limit` и `ids`».
- [ ] **Step 2: моки и экраны** — моки на новый контракт (комментарий вместо претензии, фильтр `supplierId` в
  `stock.products`, список по `supplierId`); на экранах убрать флажок, печать и колонку претензии, KPI претензий;
  поле «Комментарий» (≤ 500) в редакторе.
- [ ] **Step 3: проверка.** `npx tsc -b libs/shared/dto && npx tsc --noEmit -p apps/web/tsconfig.json && npx nx
  run-many -t lint test --parallel=1 -p shared-dto web` — зелёное.
- [ ] **Step 4: коммит** `feat(dto): supplier returns without claims, supplier filter of stock products`.

### Task 3: Кредит возврата в расчётах (`purchasing`)

**Files:**
- Modify: `apps/api/src/app/purchasing/{purchasing.repository, allocation, supplier-ledger, suppliers.service}.ts`

**Interfaces:**
- Produces (для Задачи 4):
  ```ts
  // supplier-ledger.ts
  export interface ReturnCreditLine { receiptId: string | null; amountDirams: number }
  returnPosted(trx, e: { tenantId: string; supplierId: string; storeLegalEntityId: string;
    documentId: string; businessDate: string; employeeId: string;
    lines: readonly ReturnCreditLine[] }): Promise<void>;
  returnUnposted(trx, e: { tenantId: string; documentId: string; businessDate: string;
    employeeId: string }): Promise<void>;
  ```
- [ ] **Step 1: репозиторий** —
  - `returnsWithRest(trx, tenantId, supplierId, legalEntityId): Promise<Array<{ returnId: string; restDirams:
    bigint }>>` — кредит возврата = −Σ записей журнала с `source_id` возврата в паре − Σ его распределений, только
    > 0; порядок — `business_date`, `recorded_at`, id;
  - `paymentsWithRest` — тот же порядок по `paid_on`, `created_at`, id (как сейчас) и поле даты в ответе для
    слияния (`date: string`);
  - `addReturnAllocation(trx, tenantId, returnId, receiptId, amountDirams: bigint)` (`on conflict do update`, как
    у оплат); `releaseReturnAllocations(trx, tenantId, by: { returnId: string } | { receiptId: string }):
    Promise<number>`;
  - `openReceipts` и `postedReceipts.allocated_dirams` вычитают/учитывают и распределения возвратов;
  - `ledger` отдаёт `document_type` источника.
- [ ] **Step 2: распределение** — `PaymentAllocation.allocate(...)` (сигнатура прежняя) берёт **кредиты** — оплаты с
  остатком и возвраты с кредитом, слитые по дате (дата оплаты / дата возврата), затем по времени записи; пишет
  распределение в таблицу своего вида. Новый `allocateToReceipts(trx, tenantId, supplierId, legalEntityId,
  returnId, targets: Array<{ documentId: string; maxDirams: bigint }>)` — кредит возврата сначала на остаток
  указанных приходов, не больше `maxDirams` каждого (вызывать под `lockSettlement` пары).
- [ ] **Step 3: журнал** — `SupplierLedger.returnPosted`: `lines` с `receiptId` → пара по юрлицу записи
  `goods_receipt` этого прихода (`balancesOfSource(receiptId)`, нет записи — `storeLegalEntityId`), `receiptId:
  null` → `storeLegalEntityId` (E1, E2); по каждой паре с суммой > 0: `lockSettlement`, запись `supplier_return`
  (−сумма, `source_type 'document'`, `due_date null`), `allocateToReceipts` (цели — приходы её строк, `maxDirams` —
  сумма их строк), затем `allocate`. Пары — в порядке `(supplierId, legalEntityId)`, чтобы два возврата не взяли
  блокировки навстречу. `returnUnposted`: как `receiptUnposted` — блокировки пар `balancesOfSource`, снять
  распределения возврата, запись `reversal`, `allocate` каждой пары. `receiptUnposted` снимает и распределения
  возвратов на приход (аудит `payment.allocations_released` с суммой обоих видов) и перераспределяет, если что-то
  освободилось.
- [ ] **Step 4: карточка поставщика** — `ledgerEntries`: запись с источником-возвратом (её `supplier_return` и
  `reversal`) → вид `return`; долг списка и карточки — через `allocatedDirams` с возвратами.
- [ ] **Step 5: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное; API на
  `api-test-cookies`, скрипт PR #19 `pay_check.sh` (scratchpad) — оплаты, предоплата, отмена прихода ведут себя
  как раньше.
- [ ] **Step 6: коммит** `feat(api): supplier return credits in the settlements`.

### Task 4: API возврата поставщику

**Files:**
- Create: `apps/api/src/app/inventory/{supplier-returns.repository, supplier-returns.service,
  supplier-returns.controller, supplier-return-posting}.ts`, `apps/api/src/app/inventory/dto/supplier-returns.dto.ts`
- Modify: `apps/api/src/app/inventory/{documents.repository, numbering, unposting-check.controller, stock.service,
  stock.repository, inventory.module}.ts`, `dto/stock.dto.ts`

**Interfaces:**
- Consumes: `SupplierLedger.returnPosted / returnUnposted` (Задача 3); `StoreAccess.writableStore`,
  `StockFreeze.guard`, `checkDocumentDate`, `DocumentsRepository.{lockBatches, insertMovements, reverseMovements,
  foreignMovements, markPosted, markUnposted}`.
- Produces (для PR-2):
  ```ts
  type StockDocumentType = … | 'supplier_return';
  type NumberedKind = … | 'supplier_return';                 // префикс 'ВП'
  // DocumentRow + supplierReturnReason: string | null; sourceDocumentId: string | null
  // supplier-returns.repository.ts
  receiptsOfBatches(trx, tenantId, batchIds: readonly string[]): Promise<Map<string, string | null>>;
  //   партия → приход в корне её цепочки; в PR-1 — `source_document_id` партии с origin 'goods_receipt',
  //   иначе null (PR-2 добавит переход по source_batch_id)
  ```
- [ ] **Step 1: ядро документов** — `supplier_return` в `StockDocumentType`, `LINES`, `DocumentRow`/`HEADER`/
  `HeaderValues` (`supplierReturnReason`, `sourceDocumentId`), нумерация `ВП`.
- [ ] **Step 2: DTO** — `SupplierReturnInputDto` (дата `DATE`, `storeId`/`supplierId` uuid, `receiptId` uuid |
  null, `reason` из 3, `comment` ≤ 500, `lines` 1–500 по `{ productId uuid, batchId uuid, unit, quantity int
  1–100 000, note ≤ 200 }`), `SupplierReturnListQueryDto` (limit 1–100); `StockProductsQueryDto.supplierId` uuid.
- [ ] **Step 3: репозиторий** — `SupplierReturnsRepository`: `batches(...)` (партия точки с `supplier_id`, товаром,
  ценой упаковки — для проверки строк), `replaceLines`, `lines` (с `purchase_price_per_pack`, `cost_per_piece`,
  `lot_number`, `expiry_date`, штук в упаковке товара), `setAmounts(lines: Array<{ id; amountDirams }>)`, `kpi`,
  `receiptsOfBatches`.
- [ ] **Step 4: сервис и контроллер** — маршруты раздела 4 по образцу `WriteOffsService`: черновик —
  `writableStore`; поставщик есть и `active` (иначе 409 `supplier_archived`); `receiptId` — проведённый приход
  этого поставщика на этой точке (иначе 400 `receiptId`); строки: партия этой точки и товара (400
  `lines.i.batchId`), `supplier_id` партии = поставщик (400 `lines.i.batchId: wrong_supplier`), штуки только у
  делимого (400 `lines.i.unit`), без повтора партии; аудит `document.created`/`updated`; ответы без сумм без права;
  список по точкам охвата с фильтрами; KPI — проведённые за месяц бизнес-даты и их сумма.
- [ ] **Step 5: проведение и отмена** — `SupplierReturnPosting.post / unpost / blockers` по образцу
  `WriteOffPosting` (раздел 4 спецификации): после движений `supplier_return` — суммы строк (формула Global
  Constraints) в `setAmounts`, `total_dirams`, затем `SupplierLedger.returnPosted` с `receiptsOfBatches` и
  `store.legalEntityId`; отмена — B2-блокеры, сторно, `markUnposted`, `SupplierLedger.returnUnposted`.
  `unposting-check`: вид `supplier-returns`.
- [ ] **Step 6: партии поставщика** — `StockService.productOptions` с `supplierId`: `batchStock` отдаёт
  `supplier_id`; партии фильтруются по поставщику, товары без них отбрасываются.
- [ ] **Step 7: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное; API на
  `api-test-cookies`, скрипт curl в scratchpad (на основе `cat_setup.sh` и `pay_check.sh`: сеть, точки A и B,
  заведующий, фармацевт с `inventory:create/update`, поставщики P1 и P2, приходы):
  - нумерация `ВП-A1-<год>-000001`; черновик фармацевтом — 201 без сумм; список, KPI, `stock-products?supplierId=`
    фармацевта — без сумм (RF5); партия P2 в возврате P1 → 400 `lines.0.batchId` `wrong_supplier`;
  - проведение заведующим: движение `supplier_return`, остаток уменьшился; сумма строки 3 штук упаковки 10 штук
    за 1001 → 300; больше остатка → 409 `stock_insufficient` у строки; фармацевт → 403;
  - неоплаченный приход 1000 и возврат на 200 → долг 800, распределение возврата на этот приход;
  - полностью оплаченный приход и возврат на 200 → долг 0, кредит 200; следующий приход 500 → долг 300; отмена
    возврата → кредит снят с нового прихода, долг 500, исходный приход снова оплачен полностью (RF2);
  - открытые приходы R1 (раньше срок) и R2, возврат партии R2 больше остатка R2 → R2 закрыт, излишек кредита — на
    R1; отмена R1 (без движений партий) → распределение возврата снято, кредит остаётся остатком (RF3);
  - возврат и оплата той же пары двумя фоновыми запросами → SQL-сверка: ни один приход не покрыт сверх суммы,
    остатки ≥ 0 (RF1);
  - стартовая партия НО с ценой 0 → проведение 200, записи журнала нет (RF4);
  - отмена после продажи по партии (вставка `sale` через `appx`) → 409; без расхода — сторно, долг вернулся;
  - заморозка (идущая инвентаризация точки) → 409 `stock_count_in_progress`; дата в будущем → 422; офлайн-точка
    → 409; чужая точка → 403; карточка поставщика — записи вида `return`.
- [ ] **Step 8: коммит** `feat(api): supplier returns`.

### Task 5: Web — возврат поставщику на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES` + `supplierReturns.*`;
  `REAL_API_WHEN['documents.unpostCheck']` + `supplier-returns`),
  `apps/web/src/pages/supplier-returns/ui/{SupplierReturnEditor, SupplierReturnsPage}.tsx`,
  `apps/web/src/features/stock-document/ui/{StockLinesEditor, ProductSearch}.tsx`, i18n `ru`/`tg`

- [ ] **Step 1: выбор партий поставщика** — `supplierId?: string` в `ProductSearch` и `StockLinesEditor` (уходит в
  `stock.products`, ключ запроса его учитывает); редактор возврата передаёт поставщика документа; смена поставщика
  при непустых строках — строки очищаются (подтверждение).
- [ ] **Step 2: строки и накладная** — сохранённые строки открываются по `ids=` товаров документа (как
  `WriteOffEditor`, не `useStoreProducts` с лимитом 500); «Заполнить из накладной» — строки накладной, у партий
  которых ещё есть остаток (через `stock.products?ids=&supplierId=`); ошибки `stock_insufficient`,
  `stock_count_in_progress`, `period_closed` — у строк и даты (`apiFieldErrors`); суммы скрыты без права.
- [ ] **Step 3: проверка.** Браузер (`api-web4210` + `web-partial-4210`): фармацевт создаёт черновик по накладной
  без сумм; заведующий проводит; карточка поставщика — долг уменьшился, запись «Возврат»; отмена проведения.
  `npx nx run-many -t build && npx nx run-many -t typecheck lint test fsd --parallel=1 -p web`,
  `npx nx e2e web-e2e` — зелёные.
- [ ] **Step 4: коммит** `feat(web): supplier returns on the API`.

### Task 6: Документы

- [ ] **Step 1: правки** — модель `03`: «Введено миграцией `supplier-returns`», поправки 2.1 п. 1–2; модель `05`:
  зачёт возврата (п. 3), `supplier_return_allocations`, формула остатка по приходу, вид журнала
  `supplier_return`; `APPROVAL.md`: строка 2026-10-12 «Поправки модели данных `03`, `05` (спецификация
  `2026-10-12-supplier-returns-transfers-design.md`, раздел 2.1): APPROVED»; CLAUDE.md `web:dev-api` (+ возврат
  поставщику).
- [ ] **Step 2: коммит** `docs: supplier returns — data model, approval, CLAUDE.md`.
