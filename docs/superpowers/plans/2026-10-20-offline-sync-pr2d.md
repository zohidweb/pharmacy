# Офлайн-точка, PR 2d — перемещения с офлайн-точкой: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** перемещения работают во всех парах — облако → офлайн, офлайн → облако, офлайн → офлайн (E34):
- облако применяет `transfer.dispatched` и `transfer.accepted` офлайн-точки;
- облако разрешает отправку и заявки с офлайн-стороной;
- облако запрещает отзыв, если хотя бы одна сторона офлайн;
- недостачу при приёме списывает отправитель: облачный — облако, офлайн — сама точка своим `transfer_discrepancy`, которое теперь применяется.

**Architecture:**
- Новый применитель `TransferFacts` (модуль `inventory`) — по образцу `DocumentFacts`.
- Облачный код перемещений (`TransferPosting`, `TransfersService`, `TransferRequestsService`, `StoreAccess`) получает правила офлайн-стороны.
- Ветка списания в `DocumentFacts` принимает `transfer_discrepancy` с движениями сторно отправки.
- Миграций нет.

**Tech Stack:** NestJS 11, Kysely + pg. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-16-offline-sync-design.md`:
- E8 (правила режима), E18 (копия цены при приёме), E34, E37 (статус заявки);
- раздел 4.2 (`transfer.dispatched` / `transfer.accepted`), раздел 13.

Лента «в пути» и `transfer_result` для точки — PR 3.

## Global Constraints

Всё из Global Constraints планов PR 1–2c:
- тесты отложены до MVP, проверка живая; окружение Windows;
- строки точки — с её id;
- время облака — в `stock_movements` / `audit_log`;
- prettier — только на изменённые файлы;
- облако проверяет целостность факта и свободные id, а не решения кассира или кладовщика.

Дополнительно:
- Ветка `feature/offline-sync-pr2d`: `git switch -c feature/offline-sync-pr2d --no-track origin/main`. План — первым коммитом.
- Облако никогда не пишет склад офлайн-точки. Её отправку, приём и списание недостачи пишет только она сама (E34, E16): облачные пути записи для офлайн-стороны — 409 `offline_store_read_only`, как сейчас.
- Режим `offline_pending` = офлайн (E8). Все проверки — `mode !== 'online'`, не `mode === 'offline'`.

## Review Focus

1. **Облачная точка принимает перемещение от офлайн-точки с недостачей.**
   - Ожидается: приём проходит, облако **не** пишет сторно и списание у офлайн-отправителя (его остаток не тронут); списание приходит позже от точки.
   - Проверка — Задача 4, шаг t2.
2. **Офлайн-точка приняла перемещение раньше, чем облаку дошла его отправка** (офлайн → офлайн).
   - Ожидается: `transfer.accepted` ждёт (`pending_dependency`) и применяется после `transfer.dispatched`.
   - Проверка — Задача 4, шаг t4.
3. **Повторная приёмка уже принятого перемещения или приёмка чужой точкой.**
   - Ожидается: карантин (`transfer_not_in_transit` / `store_mismatch`), остатки не меняются.
   - Проверка — Задача 4, шаг t5.
4. **Отзыв в облаке перемещения облако → офлайн.**
   - Ожидается: 409 `offline_transfer_no_recall`, перемещение остаётся «в пути».
   - Проверка — Задача 4, шаг t1.
5. **Списание недостачи офлайн-отправителя.**
   - Количество не равно «отправлено − принято» или списание по перемещению уже есть → карантин.
   - Пришло раньше приёма → ждёт.
   - Проверка — Задача 4, шаг t3.

---

### Task 1: Контракты и `transfer.dispatched`

**Files:**
- Modify: `libs/shared/dto/src/lib/sync-protocol.ts`.
- Create: `apps/api/src/app/inventory/transfer-facts.ts`.
- Modify: `apps/api/src/app/inventory/transfer-posting.ts` (вынести правило статуса заявки), `inventory.module.ts` (provider).

**Interfaces — Produces:**
- `SyncStockDocumentRow.sourceDocumentId: string | null` — перемещение для списания `transfer_discrepancy`.
- `SyncTransferRow`:
  - `id; storeId` (отправитель); `destinationStoreId; number; documentDate; comment: string | null`;
  - `createdBy; dispatchedAt; dispatchedBy; requestDocumentId: string | null`.
- `SyncTransferLineRow { id; documentId; lineNo; productId; sourceBatchId; qtySentPieces; unit: 'pack' | 'piece' }`.
- `TransferDispatchedPayload { transfer: SyncTransferRow; lines: SyncTransferLineRow[]; movements: SyncMovementRow[]; audit: SyncAuditRow[] }`.
- `TransferAcceptedPayload`:
  - `transferId; receivedAt; receivedBy; receivedDate` (дата точки); `comment: string | null`;
  - `lines: Array<{ lineId: string; qtyReceivedPieces: number; targetBatchId: string | null }>`;
  - `batches: SyncBatchRow[]; movements: SyncMovementRow[]; prices: SyncLocalPrice[]; audit: SyncAuditRow[]`.
- `TransferPosting.requestStatusAfterDispatch(trx, tenantId, requestId, lines: Array<{ productId; qtySentPieces }>): Promise<void>` — правило `done` / `partial` из `send`; `send` вызывает его.
- `TransferFacts implements FactApplier`, `types = ['transfer.dispatched', 'transfer.accepted']`.

- [ ] **Step 1:** контракты; пересборка деклараций.
- [ ] **Step 2: `transfer.dispatched`.**
  - **Перемещение:**
    - `sameStore(transfer.storeId)`;
    - получатель — активная точка сети, ≠ отправителя, иначе `unknown_store`;
    - id свободен — `id_reused`;
    - `requireEmployees([createdBy, dispatchedBy])`.
  - **Заявка**, если `requestDocumentId` задан:
    - есть, типа `transfer_request`, отправитель заявки = точка, получатель = получатель перемещения; иначе `request_mismatch`;
    - статус не проверяется.
  - **Строки:**
    - не пусты, `qtySentPieces > 0`;
    - партия точки (`batchesOf`, ожидание), `productId` = партии;
    - различные `sourceBatchId`.
  - **Движения:** одно на строку, `transfer_out`, −штуки, партия строки, `businessDate = transfer.documentDate`.
  - **Запись:**
    1. Документ `type = 'transfer'`, `status = 'in_transit'`, `dispatched_at` = время точки.
    2. Строки `transfer_lines`.
    3. Движения.
    4. `requestStatusAfterDispatch`, если есть заявка.
    5. Аудит.
- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply transfers dispatched by offline stores`.

### Task 2: `transfer.accepted`

**Files:** Modify `transfer-facts.ts`, `transfer-posting.ts` (`writeOffShortage` → публичный `writeOffShortageAtCloudSender`).

- [ ] **Step 1: Проверки:**
  - **Перемещение:**
    - нет в сети → ожидание (`transfer`, `dependency`): отправка офлайн-точки ещё не дошла;
    - не `transfer` или получатель ≠ точка → `store_mismatch`;
    - статус не `in_transit` → `transfer_not_in_transit`.
  - `requireEmployees([receivedBy])`; дата и время точки читаемы.
  - **Строки:** каждая строка перемещения ровно один раз; `0 ≤ qtyReceivedPieces ≤ qtySentPieces`; `targetBatchId` задан ровно при `qtyReceivedPieces > 0`.
  - **Партии получателя:**
    - различные id, свободны;
    - `storeId` = точка, `productId` = строки, `origin = 'transfer'`, `sourceDocumentId` = перемещение;
    - `expiryDate`, `lotNumber`, цены и поставщик — как у партии отправителя (`source_batch_id` = `sourceBatchId` строки).
  - **Движения:** одно на принятую строку, `transfer_in`, +принято, целевая партия, `businessDate = receivedDate`.
  - **Цены:** только по товарам принятых строк, через `LocalPriceRule` (E18: копия цены отправителя — локальная цена получателя).
- [ ] **Step 2: Запись:**
  1. Блокировка партий отправителя (как `accept`).
  2. Партии получателя.
  3. `qty_received_pieces` / `target_batch_id` строк.
  4. Движения.
  5. Цены.
  6. Документ `received`, `received_at` / `received_by` — точки, комментарий.
  7. **Недостача:** отправитель облачный (`mode = 'online'`) → `writeOffShortageAtCloudSender` (сторно отправки и списание `transfer_discrepancy` у отправителя, как сейчас; сотрудник — принявший на точке); офлайн → ничего (E34).
  8. Аудит.
- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): apply transfers accepted by offline stores`.

### Task 3: Облачные правила офлайн-стороны и списание недостачи точки

**Files:** Modify `store-access.ts`, `transfers.service.ts`, `transfer-requests.service.ts`, `transfer-posting.ts`, `document-facts.ts`, `stock-facts.ts` (`applyWriteOff` + `sourceDocumentId`).

- [ ] **Step 1: Облако.**
  - `StoreAccess.transferCounterpart(trx, tenantId, storeId, field)` — как `counterpartStore`, но офлайн-точка допустима: перемещения и заявки с ней идут через синхронизацию (E34, E37). Его вызывают отправка перемещения и создание/правка заявки; `counterpartStore` остаётся для прочего.
  - **Отзыв:** отправитель или получатель не `online` → 409 `offline_transfer_no_recall` (E34).
  - **Облачный приём от офлайн-отправителя** (получатель облачный): без `writeOffShortage`. Сторно и списание пишет точка, облако его склад не трогает.
- [ ] **Step 2: Списание `transfer_discrepancy` в `DocumentFacts`.**
  - `sourceDocumentId` — перемещение этой точки-отправителя:
    - нет → ожидание;
    - другой отправитель → `store_mismatch`;
    - `in_transit` → ожидание (`transfer_result`): приёмка ещё не дошла;
    - не `received` → `write_off_mismatch`;
    - по перемещению уже есть списание `transfer_discrepancy` → `discrepancy_exists`.
  - **Строки:** по строкам с недостачей ровно одна строка списания на строку перемещения — партия = `sourceBatchId`, штуки = отправлено − принято.
  - **Движения:**
    - на строку — сторно `reversal` +штуки: `sourceId` = перемещение, `sourceLineId` = его строка, `reversesMovementId` = живое `transfer_out` этой строки (из облака);
    - и `write_off` −штуки по строке списания.
  - **Запись:** `applyWriteOff(…, sourceDocumentId)` — документ, строки и `write_off`; сторно — через `insertMovements`.
- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): transfers with offline stores in the cloud — dispatch, no recall, the store's own shortage`.

### Task 4: Живая проверка, документы, наборы

**Files:**
- Modify: `CLAUDE.md` (граф: `inventory` регистрирует `TransferFacts`), спецификация, раздел 13.
- Scratchpad: `os_tr.sh`, `os_tr_specs.cjs`.

- [ ] **Step 1:** сборка, перезапуск `api-oc-4210`.
- [ ] **Step 2: Живые сценарии.** Точки сети `pos_setup.sh`: A — офлайн с ключом, B — облачная; для t4 — третья точка C, офлайн со своим ключом.

  | Шаг | Операция | Ожидается |
  |---|---|---|
  | t1 | облако B → A: владелец создаёт и отправляет перемещение; отзыв; A принимает 3 из 4 шт. с копией цены | отправка 200; отзыв 409 `offline_transfer_no_recall`; `transfer.accepted` `applied`, у A партия +3; у B сторно +1 и списание −1 `transfer_discrepancy` (облачный отправитель); цена у A |
  | t2 | A → B: `transfer.dispatched` 5 шт.; B принимает 4 в облаке | `applied`, у A −5; приём 200; у A **нет** сторно и списания |
  | t3 | списание недостачи t2 точкой A | `applied`: сторно +1 и списание −1 у A. Повтор другой операцией → `discrepancy_exists`; списание по t1, пока его перемещение `in_transit`, — ожидание |
  | t4 | A → C: C присылает `transfer.accepted` раньше, чем A — `transfer.dispatched`; затем батч A; затем следующий батч C | приёмка C `pending_dependency`; после отправки A — применяется в конце следующего батча C (повтор ожидающих — в батчах своей точки) |
  | t5 | повторная приёмка t1; приёмка t2 точкой A (она отправитель) | `transfer_not_in_transit` / `store_mismatch` |
  | t6 | E8: точка в `offline_pending`, облачная запись склада и кассы | 409 `offline_store_read_only` |
  | t7 | заявка B → A (поставщик — офлайн-точка), отправка A по заявке | заявка создана; после `transfer.dispatched` статус заявки `done` / `partial` |

- [ ] **Step 3: Наборы:**
  - `npx nx run-many -t lint test build -p shared-dto shared-domain api --parallel=1`;
  - `npx nx run api:integration`;
  - `npx nx run api:db-types-verify`.

  Expected: exit 0. Если облачные отказы с офлайн-стороной закреплены тестами, их ожидания приводятся к E34 (не новые тесты).
- [ ] **Step 4: Коммиты:** `docs: offline sync PR 2d — module graph, spec decisions`.
