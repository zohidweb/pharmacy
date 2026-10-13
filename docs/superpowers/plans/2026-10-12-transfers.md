# Перемещения и заявки (PR-2) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заявки на перемещение и перемещения между облачными точками на API — черновик, отправка, отзыв, отмена,
приёмка с фактическими количествами, автоматическое списание недостачи у отправителя, цена отправителя у получателя
без цены — и экран «Перемещения» `apps/web` на API.

**Architecture:** миграция `transfers` (типы `transfer` / `transfer_request`, статусы, строки, партия `transfer` с
`source_batch_id`, движения `transfer_out` / `transfer_in`). В модуле `inventory` — репозиторий строк, сервисы
заявок и перемещений, проведение перемещения (`TransferPosting`: отправка, отзыв, приёмка); недостача — списание
через репозитории PR #20; цена — новый метод публичного `StorePriceWriter` модуля `pricing`. Строится на PR-1
«Возврат поставщику» (`receiptsOfBatches`, `source_document_id`).

**Tech Stack:** как в PR-1.

**Spec:** `docs/superpowers/specs/2026-10-12-supplier-returns-transfers-design.md` — разделы 2 (T1–T10, E1, E3,
E4, поправки 2.1 п. 4–7), 3.2, 5, 6 (перемещения, `WriteOff`), 7, 8 (PR-2), 10, 11 (PR-2).

## Global Constraints

- Все Global Constraints PR-1 в силе.
- Статусы в БД: перемещение `draft` / `in_transit` / `received` / `cancelled`; заявка `draft` / `sent` /
  `in_progress` / `partial` / `done` / `rejected`. В контракте перемещения `received` → `accepted`.
- `store_id` перемещения — отправитель, заявки — заявитель; `destination_store_id` — получатель / у кого просят.
- Номера `ПМ-<код отправителя>-…` (вид `transfer`), `ЗП-<код заявителя>-…` (вид `transfer_request`) — при создании
  черновика, год — по дате создания.
- Даты (E4): заявка — бизнес-дата создания; перемещение — бизнес-дата отправки (ставится при отправке); без
  «задним числом».
- Права: черновики — `inventory:create` / `update`; отправка перемещения и отклонение заявки — `inventory:post`
  (`send: true` при создании черновика тоже требует его); отзыв — `inventory:unpost`; отмена черновика
  перемещения — `inventory:delete`; приёмка — `inventory:receive`.
- Обе точки — облачные и активные (офлайн → 409 `offline_store_read_only`); видимость — любая из двух точек в
  охвате; действие — своя сторона в охвате.
- Порядок блокировок: заявка → перемещение → склад точки (`StockFreeze`) → партии.
- Принятое перемещение и списание недостачи (`source_document_id` — перемещение) не меняются и не отменяются.

## Review Focus

1. Отзыв и приёмка одного перемещения одновременно → одно 200, другое 409 `transfer_not_in_transit`; товар либо
   вернулся отправителю, либо пришёл получателю, но не оба (Задача 4, curl двумя фоновыми запросами).
2. Приёмка «ничего не пришло» (все количества 0) → партий получателя нет, всё отправленное списано у отправителя
   одним списанием, остаток отправителя не изменился (Задача 4).
3. Отклонение заявки и отправка перемещения по ней одновременно → либо заявка `rejected` и черновик отменён, либо
   перемещение `in_transit` и заявка `done`/`partial`; взаимной блокировки нет (Задача 4: порядок заявка →
   перемещение; curl двумя фоновыми запросами).
4. Партия, пришедшая перемещением, у получателя снова уходит перемещением или возвращается поставщику → возврат
   гасит приход **исходной** точки (цепочка `source_batch_id` в `receiptsOfBatches`, E1) (Задача 4).
5. Делимый товар отправлен в штуках, принят частично в штуках → партия получателя и списание недостачи — в штуках,
   без округления до упаковок (Задача 4).

---

### Task 1: Схема перемещений

**Files:**
- Create: `apps/api/migrations/<Date.now()>_transfers.sql`
- Modify: `table-classes.ts`, `db.generated.ts`

- [ ] **Step 1: миграция** — раздел 3.2 спецификации: `documents_type_check` + `transfer`, `transfer_request`;
  `documents_status_check` + статусы 3.2 и `check` статуса по типу (`cancelled` — у `inventory` и `transfer`);
  колонки 3.2 (FK `destination_store_id` на `stores`, `request_document_id` на `documents`, `dispatched_by`,
  `received_by` на `employees`); `check`: `destination_store_id` заполнена ровно у двух новых типов и ≠
  `store_id`; `rejection_reason in ('no_stock','order_from_supplier','other')` только у заявки; уникальный индекс
  `(tenant_id, request_document_id) where type = 'transfer' and status <> 'cancelled'`; индексы
  `(tenant_id, destination_store_id)`; `transfer_request_lines`, `transfer_lines` (3.2; `unique` номера строки,
  товара заявки, партии перемещения; `check (qty_received_pieces between 0 and qty_sent_pieces)`); `batches`:
  `origin` + `transfer`, `source_batch_id` + FK + `check ((origin = 'transfer') = (source_batch_id is not null))`;
  `stock_movements_kind_check` + `transfer_out`, `transfer_in`; RLS, политики, гранты.
- [ ] **Step 2: манифест** — `transfer_request_lines`, `transfer_lines` класса `tenant`.
- [ ] **Step 3: проверка.** `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration` —
  зелёное.
- [ ] **Step 4: коммит** `feat(api): transfers schema`.

### Task 2: Контракт и моки

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-inventory.ts`, `apps/web/src/shared/api/routes.ts`,
  `apps/web/src/shared/api/mocks/{handlers-stock, db-stock}.ts`, `apps/web/src/pages/transfers/ui/*`,
  `apps/web/src/pages/write-offs/ui/WriteOffEditor.tsx` (новые поля — только чтобы собиралось)

**Interfaces:**
- Produces:
  ```ts
  type TransferStatus = 'draft' | 'in_transit' | 'awaiting' | 'accepted' | 'cancelled';
  interface TransferLine { productId; productName; batchId; batchNumber; expiresOn;
    unit: SaleUnit; sentQuantity: number; receivedQuantity: number | null }   // в единицах строки
  interface Transfer { /* … */ discrepancy: { comment: string; writeOffId: string;
    writeOffNumber: string } | null }
  interface TransferInput { requestId; fromStoreId; toStoreId; send: boolean;
    lines: Array<{ productId; batchId; unit: SaleUnit; quantity: number }> }
  interface TransferRequest { /* + */ transferId: string | null; transferNumber: string | null }
  interface RejectTransferRequest { reason: RejectionReason; comment: string }
  interface TransferListItem { /* openDiscrepancy → */ shortage: boolean }
  interface TransferOverview { requests; transfers;
    kpi: { newRequests; requestsInProgress; inTransit };
    stores: Array<{ id: string; name: string; mode: StoreMode }> }
  interface WriteOff { /* + */ transferId: string | null; transferNumber: string | null }
  // routes: transferRequests.{get, create, update, delete, send, reject};
  //   transfers.{overview, get, create, update, send, recall, cancel, accept}; transfers.resolve — удалить
  ```
  `DiscrepancyResolution` удаляется. Пути — раздел 5.1 спецификации (`/sending`, `/recall`, `/cancellation`,
  `/rejection`, `/acceptance`). JSDoc — коды раздела 7.

- [ ] **Step 1: контракт** — как в Interfaces.
- [ ] **Step 2: моки** — на новый контракт: черновики правятся, отправляются, удаляются (заявка) и отменяются
  (перемещение); отзыв; приёмка с недостачей создаёт проведённое списание `transfer_discrepancy` у отправителя;
  «дослать» убрать; `stores` в обзоре; фикстуры с `unit`.
- [ ] **Step 3: проверка.** `npx tsc -b libs/shared/dto && npx tsc --noEmit -p apps/web/tsconfig.json && npx nx
  run-many -t lint test --parallel=1 -p shared-dto web` — зелёное.
- [ ] **Step 4: коммит** `feat(dto): transfers — drafts, recall, automatic shortage write-off`.

### Task 3: API — заявки, черновики перемещений, обзор

**Files:**
- Create: `apps/api/src/app/inventory/{transfers.repository, transfer-requests.service, transfer-requests.controller,
  transfers.service, transfers.controller}.ts`, `apps/api/src/app/inventory/dto/transfers.dto.ts`
- Modify: `apps/api/src/app/inventory/{documents.repository, numbering, store-access, inventory.module}.ts`

**Interfaces:**
- Produces (для Задачи 4):
  ```ts
  type StockDocumentType = … | 'transfer' | 'transfer_request';
  type NumberedKind = … | 'transfer' | 'transfer_request';               // 'ПМ', 'ЗП'
  // DocumentRow + destinationStoreId, requestDocumentId, dispatchedAt, dispatchedBy, receivedAt,
  //   receivedBy, receivedComment, rejectionReason, rejectionComment; status — union статусов БД
  // store-access.ts
  counterpartStore(trx, tenantId, storeId): Promise<StoreForWrite>;   // активная облачная, охват не нужен
  // transfers.repository.ts
  interface TransferLineRow { id; lineNo; sourceBatchId; productId; unit: 'pack' | 'piece';
    qtySentPieces; qtyReceivedPieces: number | null; targetBatchId: string | null;
    lotNumber; expiryDate; purchasePricePerPackDirams: bigint; costPerPieceDirams: bigint;
    supplierId: string | null; piecesPerPack: number }
  transferLines(trx, tenantId, documentId): Promise<TransferLineRow[]>;
  setReceived(trx, tenantId, lineId, qtyReceivedPieces: number, targetBatchId: string | null): Promise<void>;
  // transfers.service.ts — для Задачи 4
  lockedRequest(trx, tenantId, requestId): Promise<DocumentRow>;      // FOR NO KEY UPDATE
  ```
- [ ] **Step 1: ядро документов** — типы, `LINES`, `DocumentRow`/`HEADER`/`HeaderValues`, нумерация `ПМ`/`ЗП`;
  методы шапки `setStatus`, `markDispatched(..., employeeId, documentDate)`, `markRecalled`, `markReceived(...,
  employeeId, comment)`, `markRejected(..., reason, comment)`, `markCancelled` (если нет общего — по образцу
  отмены инвентаризации).
- [ ] **Step 2: DTO** — `TransferRequestInputDto` (`fromStoreId`/`toStoreId` uuid, `comment` ≤ 500, `send`,
  `lines` 1–500 `{ productId uuid, quantity int 1–100 000 }`), `RejectTransferRequestDto` (`reason` из 3,
  `comment` ≤ 500), `TransferInputDto` (`requestId` uuid | null, точки, `send`, `lines` 1–500 `{ productId,
  batchId uuid, unit, quantity int 1–100 000 }`), `AcceptTransferDto` (`comment` ≤ 500, `lines` 1–500 `{ batchId
  uuid, receivedQuantity int 0–100 000 }`), `TransferOverviewQueryDto` (`storeId` uuid?).
- [ ] **Step 3: заявки** — раздел 5.2: черновик (заявитель — `writableStore`, у кого просят —
  `counterpartStore`, ≠ заявителю; товар активный, не повторяется; штуки = упаковки × штук в упаковке), правка и
  `DELETE` только черновика (409 `document_posted` иначе), отправка `draft` → `sent`, отклонение (у кого просят —
  в охвате; `sent` или `in_progress` без отправленного перемещения — иначе 409 `request_not_open`; комментарий
  обязателен при `other` — 400; черновик перемещения → `cancelled`); аудит каждого действия; ответ
  `TransferRequest` с `transferId`/`transferNumber`.
- [ ] **Step 4: черновик перемещения** — раздел 5.3: отправитель `writableStore`, получатель `counterpartStore`;
  по заявке — блокировка заявки первой (`lockedRequest`), статус `sent` (иначе 409 `request_not_open`), точки
  совпадают с заявкой, нет неотменённого перемещения (409 `request_has_transfer`), товары только из заявки и Σ штук
  по товару ≤ запрошенного (400 `lines.i.productId: not_requested` / `lines.i.quantity: exceeds_request`);
  строки: партия отправителя и товара, без повтора, штуки только у делимого; заявка → `in_progress`. Правка — только
  черновик с теми же проверками. Отмена (`/cancellation`) — только черновик: `cancelled`, `cancelled_by/at`, заявка
  → `sent`. `send: true` → отправка Задачи 4 в той же транзакции (нужно `inventory:post`).
- [ ] **Step 5: чтение и обзор** — `GET` заявки и перемещения (видимость — любая точка в охвате, иначе 404);
  обзор раздела 5.4 (`storeId` — в охвате, иначе 403), `stores` — активные точки сети; `discrepancy` из
  списания, где `source_document_id` = перемещение.
- [ ] **Step 6: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное; curl (скрипт на
  основе `cat_setup.sh`, точки A, B и офлайн-точка C): заявка B у A — черновик, правка, отправка, удаление
  черновика → 409 после отправки; товар повторён → 400; заявка к офлайн-точке → 409; черновик перемещения A → B по
  заявке — больше запрошенного → 400 `exceeds_request`, товар не из заявки → 400 `not_requested`, второе
  перемещение по той же заявке → 409 `request_has_transfer`; отмена черновика → заявка снова `sent`; отклонение с
  `other` без комментария → 400, с ним — `rejected`; сотрудник только точки C (вне обеих) — 404; обзор и KPI.
- [ ] **Step 7: коммит** `feat(api): transfer requests and transfer drafts`.

### Task 4: API — отправка, отзыв, приёмка

**Files:**
- Create: `apps/api/src/app/inventory/transfer-posting.ts`
- Modify: `apps/api/src/app/inventory/{transfers.service, transfers.controller, documents.repository,
  supplier-returns.repository, write-offs.service, write-off-posting, inventory.module}.ts`,
  `apps/api/src/app/pricing/{store-price-writer, pricing.repository}.ts`

**Interfaces:**
- Consumes: Задача 3; `StockFreeze.guard`, `WriteOffsRepository.replaceLines`, `Numbering.next`,
  `DocumentsRepository.{insertDocument, insertBatch, insertMovements, reverseMovements, documentMovements,
  lockBatches, markPosted}`, `StockRepository.stockOfBatches`.
- Produces:
  ```ts
  // transfer-posting.ts
  send(trx, ctx, doc: DocumentRow, store: StoreForWrite): Promise<void>;
  recall(trx, ctx, doc: DocumentRow, store: StoreForWrite): Promise<void>;
  accept(trx, ctx, doc: DocumentRow, receiver: StoreForWrite, body: AcceptTransferDto): Promise<void>;
  // store-price-writer.ts
  copyIfMissing(trx, c: { tenantId: string; productIds: readonly string[]; fromStoreId: string;
    toStoreId: string; documentId: string }): Promise<void>;
  // documents.repository.ts — insertBatch: origin + 'transfer', поле sourceBatchId: string | null
  ```
- [ ] **Step 1: отправка** — раздел 5.3: заявка (если есть) заблокирована первой, затем перемещение; `draft`
  (иначе 409 `document_posted` / `document_cancelled`); заморозка отправителя; дата = бизнес-дата, закрытый период
  отправителя → 422; `lockBatches`, `stockOfBatches`, нехватка → 409 `stock_insufficient` у `lines.i.quantity`;
  движения `transfer_out` (−штуки, `source_line_id` — строка); `markDispatched`; заявка → `done`, если по каждому
  товару отправлено ≥ запрошенного, иначе `partial`; аудит `transfer.dispatched`.
- [ ] **Step 2: отзыв** — `in_transit` (иначе 409 `transfer_not_in_transit`); заблокированы заявка, затем
  перемещение; заморозка отправителя; закрытый период по дате документа → 422; `reverseMovements`; `markRecalled`
  (`draft`, `dispatched_at/by` пусты); заявка → `in_progress`; аудит `transfer.recalled`.
- [ ] **Step 3: приёмка** — раздел 5.3: получатель в охвате (403), `in_transit` (409 `transfer_not_in_transit`),
  каждая строка ровно раз (400 `lines`), количество ≤ отправленного (400 `lines.i.receivedQuantity`); принято
  штук = количество × штук в упаковке у строки `pack`, иначе количество; заморозка получателя по товарам с
  количеством > 0; закрытый период получателя → 422; по строке с принятым > 0 — `insertBatch` (origin
  `transfer`, `sourceBatchId`, значения партии отправителя, `isStarting` false) и `transfer_in` с бизнес-датой;
  `setReceived`; `copyIfMissing` по принятым товарам; `markReceived`; аудит `transfer.received`.
- [ ] **Step 4: недостача** — строки с отправлено − принято > 0: `lockBatches` партий отправителя; на перемещение —
  движение `reversal` (+N, `reverses_movement_id` — последнее неотменённое `transfer_out` строки, бизнес-дата
  приёмки); новое списание точки-отправителя: номер `СП` (`Numbering`), причина `transfer_discrepancy`,
  `source_document_id` — перемещение, дата — бизнес-дата, комментарий `"<номер ПМ>: <комментарий получателя>"`
  (≤ 500), строки `replaceLines` (партия, товар, штуки, `unit` строки перемещения), движения `write_off` (−N),
  `markPosted` с принявшим и суммой Σ штуки × `cost_per_piece`; аудит `document.posted` на списание.
- [ ] **Step 5: защита списания недостачи** — `WriteOffsService.update`, `post`, `unpost` и `unpostCheck` списания
  с `sourceDocumentId` → 409 `write_off_from_transfer`; ответ `WriteOff` — `transferId`, `transferNumber`.
- [ ] **Step 6: цена у получателя** — `copyIfMissing`: цены товаров у отправителя и получателя
  (`lockPrices` получателя); где у получателя цены упаковки нет (`null` / нет строки), а у отправителя есть —
  новый `PricingRepository.copyPrice(trx, tenantId, productId, fromStoreId, toStoreId, employeeId)`: цена упаковки
  и `retail_price_per_piece_dirams` отправителя, `price_version` растёт, `price_source 'cloud'`; аудит
  `price.changed` `{ source: 'transfer', documentId, oldPriceMinor: null, newPriceMinor }`; прав на цены не
  требует.
- [ ] **Step 7: корень цепочки** — `SupplierReturnsRepository.receiptsOfBatches`: рекурсивно по `source_batch_id`
  до партии без него; приход — `source_document_id` корня с origin `goods_receipt`, иначе `null`.
- [ ] **Step 8: проверка.** `npx nx run-many -t build typecheck lint -p api --parallel=1` — зелёное; curl (скрипт
  Задачи 3 + второе юрлицо с точкой D):
  - отправка — остаток отправителя уменьшился, заявка `partial`/`done`; больше остатка → 409; заморозка
    отправителя → 409; повторная отправка → 409;
  - отзыв — остаток вернулся, заявка `in_progress`; отправка снова — проходит;
  - приёмка с недостачей — новые партии получателя (срок, серия, цена, `source_batch_id`), `transfer_in`,
    списание `СП` у отправителя с причиной и ссылкой, остаток отправителя не изменился; приёмка «всё 0» (RF2);
    штуки делимого товара (RF5);
  - отзыв и приёмка двумя фоновыми запросами (RF1); отклонение и отправка двумя фоновыми запросами (RF3);
  - приёмка точкой не-получателем → 403; без `inventory:receive` → 403; заморозка получателя → 409;
  - цена: товар без цены у получателя → цена отправителя и аудит; своя цена — без изменений; у отправителя нет
    цены → у получателя нет;
  - `PUT`, проведение и отмена списания недостачи → 409 `write_off_from_transfer`;
  - партия A → B, у B снова → D (другое юрлицо), возврат поставщику у D → кредит гасит приход A (юрлицо A) (RF4).
- [ ] **Step 9: коммит** `feat(api): transfer dispatch, recall and acceptance`.

### Task 5: Web — перемещения на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES` + `transfers.*`, `transferRequests.*`),
  `apps/web/src/pages/transfers/ui/{TransfersPage, TransferDialogs}.tsx` (разделить файл диалогов, если он
  превысит ~1000 строк), `apps/web/src/pages/write-offs/ui/WriteOffEditor.tsx`, i18n `ru`/`tg`

- [ ] **Step 1: заявки** — диалог заявки создаёт и открывает черновик: правка, «Отправить», «Удалить»; точка «у кого
  просим» — из `overview.stores` без своей и без офлайн; отклонение — причина и комментарий (обязателен при
  «другое»); у заявки — номер её перемещения.
- [ ] **Step 2: перемещения** — диалог перемещения создаёт и открывает черновик: по заявке строки из заявки
  (количество — запрошенное в пределах остатка, партии по сроку), без заявки — поиск товаров отправителя;
  упаковки/штуки (штуки — у делимого); «Сохранить», «Отправить» (с правом проведения), «Отменить черновик» (с
  правом удаления); получатель — из `overview.stores`.
- [ ] **Step 3: карточка перемещения** — приёмка получателем: фактические количества в единицах строки (по
  умолчанию — отправленные), комментарий; после приёмки с недостачей — номер списания со ссылкой; «Отозвать» у
  отправителя для «В пути»; «Дослать» и решение по расхождению убраны; статус «Отменено» в списке, признак
  недостачи; KPI без «ожидает» и «расхождений».
- [ ] **Step 4: списание недостачи** — в редакторе списания только просмотр, ссылка на перемещение, без кнопок
  правки и отмены проведения.
- [ ] **Step 5: проверка.** Браузер (`api-web4210` + `web-partial-4210`, два сотрудника двух точек): заявка →
  перемещение по заявке → отправка → приёмка с недостачей → списание у отправителя; отзыв; отмена черновика;
  отклонение заявки. `npx nx run-many -t build && npx nx run-many -t typecheck lint test fsd --parallel=1 -p web`,
  `npx nx e2e web-e2e` — зелёные.
- [ ] **Step 6: коммит** `feat(web): transfers on the API`.

### Task 6: Документы

- [ ] **Step 1: правки** — модель `03`: «Введено миграцией `transfers`», поправки 2.1 п. 4–7 (заявка: точки и
  статусы, отклонение; перемещение: статусы, отзыв, отмена, `unit`; списание недостачи; движения недостачи; цена
  у получателя); CLAUDE.md `web:dev-api` (+ перемещения и заявки).
- [ ] **Step 2: коммит** `docs: transfers — data model, CLAUDE.md`.
