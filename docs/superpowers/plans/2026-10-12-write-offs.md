# Списание (PR-1) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** документ «Списание» на API (черновик фармацевтом, проведение заведующим, отмена проведения) и экран
«Списание» `apps/web` на API в режиме `partial`.

**Architecture:** миграция `write-offs` (тип документа, причина в шапке, строки по партиям, движение `write_off`).
В модуле `inventory` — свои репозиторий, сервис, контроллер и проведение списания рядом с приходом; общие проверки
даты и выборка блокирующих движений выносятся из `posting.ts` и уточняются «после проведения». Строится на ядре
склада (PR #18, #19).

**Tech Stack:** NestJS 11, Kysely + `pg`, node-pg-migrate (SQL, только Up), Next.js static export, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-12-write-offs-stock-counts-design.md` — разделы 2 (W1, W2, R1, B1, B2,
B4, поправки 2.1 п. 1–2), 3.1, 4, 6 (списание), 7, 8 (PR-1), 10, 11 (PR-1).

## Global Constraints

- Тесты отложены до MVP: новые автотесты не пишутся, существующие наборы остаются зелёными; проверка — живая
  (curl, браузер), команды и ожидаемый результат — в шагах.
- Деньги — integer дирамы; остатки и движения — в штуках; остаток не хранится, только сумма движений.
- Документ и его движения — одна транзакция; партии `FOR UPDATE` одним оператором, затем подсчёт (ADR-0006).
- `tenant_id` в каждом запросе; новые таблицы — RLS fail-closed, гранты `pharmacy_app`, манифест `table-classes.ts`.
- Причины списания — ровно `expired`, `broken`, `defect`, `misgrade`, `transfer_discrepancy`; одна на документ.
- Номер `СП-<код точки>-<год>-<6 цифр>`, счётчик `document_counters` вида `write_off`.
- Права: `inventory:view` / `create` / `update` / `post` / `unpost`; закупочные суммы (`costMinor`, `totalMinor`, сумма
  KPI) — только с `finance:view-cost`, запись списания этого права **не требует**.
- Офлайн-точка: запись из облака → 409 `offline_store_read_only`; точка вне охвата → 403 `store_not_in_scope`.
- Commits — Conventional Commits; после `next build` вернуть `apps/web/next-env.d.ts`; Nx при зависании —
  `NX_ISOLATE_PLUGINS=false`.

## Review Focus

1. Два одновременных проведения одного списания или двух списаний одной партии на весь остаток → проведено одно,
   второе 409 (`document_posted` / `stock_insufficient`), остаток не уходит в минус (Задача 3, curl двумя фоновыми
   запросами).
2. Отмена проведения прихода, по партии которого раньше был **приход и продажа до** его проведения, не блокируется
   старыми движениями; блокирует только движение после проведения (Задача 3: общий блокер «после проведения»).
3. Фармацевт (без `finance:view-cost`) создаёт и правит черновик и не получает ни одной суммы ни в одном ответе,
   включая список и KPI (Задача 3, curl).
4. Количество в штуках у неделимого товара → 400 у `lines.i.unit`; партия чужой точки → 400 у `lines.i.batchId`
   (Задача 3).
5. Архивный товар с остатком списывается (B1), а приход с архивным товаром по-прежнему 409 `product_archived`
   (Задача 3).

---

### Task 1: Схема списания

**Files:**
- Create: `apps/api/migrations/<Date.now()>_write-offs.sql`
- Modify: `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts`

- [ ] **Step 1: миграция** — раздел 3.1 спецификации: `documents.type` + `write_off` (пересоздать `check`);
  `documents.write_off_reason text` с `check (write_off_reason in (…5 значений…))` и
  `check ((type = 'write_off') = (write_off_reason is not null))`; таблица `write_off_lines` (колонки, FK, индексы
  раздела 3.1, `unique (tenant_id, document_id, line_no)`, `unique (tenant_id, document_id, batch_id)`);
  `stock_movements.kind` + `write_off` (пересоздать `check` на секционированной таблице); RLS, политика, гранты
  (полный DML, как у строк прихода).
- [ ] **Step 2: манифест** — `write_off_lines` класса `tenant`.
- [ ] **Step 3: проверка.** `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration` —
  миграция применяется, типы перегенерированы, интеграционные тесты зелёные.
- [ ] **Step 4: коммит** `feat(api): write-offs schema`.

### Task 2: Контракт, шаблон роли, моки

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-inventory.ts`, `libs/shared/domain/src/lib/role-templates.ts`,
  `apps/web/src/shared/api/routes.ts`, `apps/web/src/shared/api/mocks/handlers-stock.ts`

**Interfaces:**
- Produces: `WriteOffListQuery { storeId?; reason?: WriteOffReason; status?: DocumentStatus; limit?; offset? }`;
  `StockProductsQuery.expired?: boolean` (маршрут `stock.products`); JSDoc маршрутов списания с кодами раздела 7.

- [ ] **Step 1: контракт** — `WriteOffListQuery`; `expired` в запросе `stock.products` с JSDoc (B4: все товары точки,
  включая архивные, только партии с остатком > 0 и сроком < бизнес-даты, без лимита).
- [ ] **Step 2: шаблон роли** — «Фармацевт-кассир» получает `inventory:create`, `inventory:update`; из списка
  `manager` убрать ставшие повторами записи (он раскрывает `cashier`).
- [ ] **Step 3: моки** — `stock.products` с `expired`; запись списания без права на цены разрешена, суммы скрыты.
- [ ] **Step 4: проверка.** `npx tsc -b libs/shared/domain libs/shared/dto && npx tsc --noEmit -p
  apps/web/tsconfig.json && npx nx run-many -t lint test --parallel=1 -p shared-domain shared-dto web` — зелёное
  (тест «cashier away from cost» проходит: шаблон кассира не получает `finance:view-cost`).
- [ ] **Step 5: коммит** `feat(dto): write-off list query, expired batches, pharmacist template`.

### Task 3: API списания

**Files:**
- Create: `apps/api/src/app/inventory/{write-offs.repository, write-offs.service, write-offs.controller,
  write-off-posting}.ts`, `apps/api/src/app/inventory/dto/write-offs.dto.ts`
- Modify: `apps/api/src/app/inventory/{documents.repository, posting, numbering, unposting-check.controller,
  stock.service, stock.controller, inventory.module}.ts`, `dto/stock.dto.ts`

**Interfaces:**
- Produces (для PR-2 и прихода):
  ```ts
  // posting.ts — общие проверки, используются приходом, НО и списанием
  export function checkDocumentDate(
    settings: StockSettings, store: StoreForWrite, date: string,
    opts: { backdating: boolean },
  ): void;                           // 422 date:future / date:too_old / period_closed
  // documents.repository.ts
  foreignMovements(trx, tenantId, batchIds: readonly string[], documentId: string, after: Date):
    Promise<ForeignMovementRow[]>;   // только recorded_at > after
  type StockDocumentType = 'goods_receipt' | 'opening_balance' | 'write_off';
  // numbering.ts
  type NumberedKind = 'goods_receipt' | 'opening_balance' | 'write_off';   // префикс 'СП'
  ```
  `checkDocumentDate`: `backdating: true` — будущее, окно задним числом, закрытый период; `backdating: false` —
  только закрытый период (нужно инвентаризации, B3).

- [ ] **Step 1: общее ядро** — вынести проверки даты прихода в `checkDocumentDate` (поведение прихода и НО не
  меняется); `foreignMovements` с параметром `after` (`doc.postedAt`) — блокеры отмены прихода, НО и списания
  считают только движения после последнего проведения (B2); `DocumentRow` + `writeOffReason`; `LINES` +
  `write_off`; нумерация `write_off` → `СП`.
- [ ] **Step 2: DTO** — `WriteOffInputDto` (дата `DATE`, `storeId` uuid, `reason` из 5, `comment` ≤ 500, `lines`
  1–500 по `{ productId uuid, batchId uuid, unit 'pack'|'piece', quantity int 1–100 000 }`), `WriteOffListQueryDto`
  (limit 1–100); `StockProductsQueryDto.expired` (boolean из строки `'true'`).
- [ ] **Step 3: репозиторий строк** — `WriteOffsRepository`: `replaceLines(trx, tenantId, documentId, lines:
  WriteOffLineValues[])`, `lines(trx, tenantId, documentId): Promise<WriteOffLineRow[]>` (с `cost_per_piece`,
  `lot_number`, `expiry_date`, `store_id` партии), `kpi(trx, tenantId, storeIds, today)` (документы и сумма за
  месяц по проведённым).
- [ ] **Step 4: сервис и контроллер** — маршруты раздела 4; черновик: точка (`writableStore` как у прихода),
  партии этой точки и этого товара (400 `lines.i.batchId`), штуки только у делимого (400 `lines.i.unit`), без
  повтора партии (400 `lines.i.batchId: duplicate`); `qty_pieces` = упаковки × штук в упаковке или штуки; аудит
  `document.created` / `document.updated`; ответы `WriteOff` / `WriteOffListResponse` без сумм без права; KPI
  просроченных и истекающих партий — по `StockRepository.batchStock` точек охвата и `expiry_reminder_days`.
- [ ] **Step 5: проведение и отмена** — `WriteOffPosting.post(trx, ctx, doc, store)` / `unpost(...)`: раздел 4
  спецификации (заголовок уже `FOR NO KEY UPDATE` у `findDocument`; `checkDocumentDate(..., {backdating:true})`;
  без проверки «товар активен» — B1; `lockBatches`, затем `batchStock` этих партий; нехватка → 409
  `stock_insufficient` с `errors[]` `lines.i.quantity`; движения `write_off` −штуки; `total_dirams`; `markPosted`;
  аудит). Отмена: блокеры через `foreignMovements(..., doc.postedAt)` → 409 `unpost_blocked`; закрытый период →
  422; движения `reversal`; `markUnposted`. `unposting-check`: вид `write-offs`.
- [ ] **Step 6: просроченные партии** — `StockService.productOptions` при `expired`: партии точки с остатком > 0 и
  сроком < бизнес-даты → товары (`findForStock`, любой статус) → опции только с этими партиями; без поиска и
  лимита.
- [ ] **Step 7: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное; API на
  `api-test-cookies`, скрипт curl в scratchpad (на основе `cat_setup.sh`: сеть, точки, заведующий, плюс фармацевт с
  шаблоном кассира и правами `inventory:create/update`):
  - нумерация `СП-A1-<год>-000001`; черновик фармацевтом — 201 без `totalMinor`/`costMinor`; список и KPI
    фармацевта без сумм (RF3);
  - проведение заведующим — движение `write_off`, остаток уменьшился; фармацевт → 403;
  - больше остатка → 409 `stock_insufficient` у строки; два фоновых проведения двух списаний одной партии на весь
    остаток → одно 200, другое 409, остаток 0 (RF1);
  - штуки у неделимого → 400 `lines.0.unit`; партия чужой точки → 400 `lines.0.batchId` (RF4);
  - дата в будущем → 422 `date:future`; закрытый период → 422 `period_closed`;
  - архивный товар списывается; приход с архивным → 409 `product_archived` (RF5);
  - отмена: после продажи по партии (вставка движения `sale` через `appx`) → 409; без расхода — сторно; отмена
    прихода, по партии которого движения были только до его повторного проведения, проходит (RF2);
  - `stock-products?expired=true` — только просроченные партии, включая архивный товар;
  - чужая точка → 403, офлайн-точка → 409.
- [ ] **Step 8: коммит** `feat(api): write-offs`.

### Task 4: Web — списание на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES` + `writeOffs.*`; `REAL_API_WHEN['documents.
  unpostCheck']` + `write-offs`), `apps/web/src/pages/write-offs/ui/{WriteOffEditor, WriteOffsPage}.tsx`, i18n
  `ru` / `tg` (`stock.json`)

- [ ] **Step 1: маршруты и экран** — «Добавить просроченные партии» через `stock.products` с `expired: true`
  (отдельный запрос, не общий список товаров); ошибки `stock_insufficient` и `period_closed` — у строк и даты
  (`apiFieldErrors`); черновик доступен без права на цены, суммы скрыты (уже по `canSeeCost`); фильтр по причине.
- [ ] **Step 2: проверка.** Браузер (`api-web4210` + `web-partial-4210`): фармацевт создаёт черновик с
  просроченными партиями без сумм; заведующий проводит; повторное проведение больше остатка — ошибка у строки;
  отмена проведения. `npx nx run-many -t build && npx nx run-many -t typecheck lint test fsd --parallel=1 -p web`,
  `npx nx e2e web-e2e` — зелёные.
- [ ] **Step 3: коммит** `feat(web): write-offs on the API`.

### Task 5: Документы

- [ ] **Step 1: правки** — модель `03`: «Введено миграцией `write-offs`», поправки 2.1 п. 1–2 (причина в шапке,
  `unit` строки), правило отмены «после проведения»; `APPROVAL.md`: строка 2026-10-12 «Поправки модели данных
  `03` (спецификация `2026-10-12-write-offs-stock-counts-design.md`, раздел 2.1): APPROVED»; CLAUDE.md
  `web:dev-api` (+ списание).
- [ ] **Step 2: коммит** `docs: write-offs — data model, approval, CLAUDE.md`.
