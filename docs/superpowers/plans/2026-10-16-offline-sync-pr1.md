# Офлайн-точка, PR 1 — облако принимает операции кассы: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** облако принимает от офлайн-точки, по её лицензионному ключу, батчи операций кассы (чек, возврат, смены, терминалы, аудит, сверка) и применяет каждую ровно один раз — с карантином, ожиданием зависимостей и журналом прогонов.

**Architecture:**
- Модуль `sync` (только облако) даёт три маршрута контура точки: handshake, батч, итог прогона. Аутентификация — ключ `phk_<keyId>_<secret>` через резолвер `resolve_license_key` и `LicenseKeyGuard`.
- Каждая операция — своя tenant-транзакция: advisory-лок точки → ворота `sync_inbox` → проверка хеша → применитель модуля-владельца данных (`PosFacts`, `ReturnFacts`, `TerminalFacts`, `AuditFacts`, `StockFacts`). Ошибка — откат и отдельной транзакцией `quarantined` или `pending_dependency`.
- Модули `pos`, `returns`, `terminals`, `audit`, `inventory` ← `sync`; домены от `sync` не зависят.

**Tech Stack:** NestJS 11 (Express 5, body-parser 2), Kysely + pg (CamelCasePlugin), node-pg-migrate SQL (только Up), `node:crypto` (SHA-256, `timingSafeEqual`, `randomBytes`), `uuid` v7. Новых зависимостей нет (`@nestjs/schedule` — с PR 4).

**Spec:** `docs/superpowers/specs/2026-10-16-offline-sync-design.md` (утверждена 2026-10-16) — решения S1–S4, E1–E41; этот PR — раздел 8, п. 1. Основа — ADR-0014.

## Global Constraints

**Тесты и проверка**
- Новых автотестов нет (решение «тесты до MVP»). Существующие наборы остаются зелёными: `shared-*`, `api`, `api:integration` (в нём и проверка каталога таблиц), `web`.
- Проверка — живая: скрипт `os_check.sh` в scratchpad (на основе `pos_setup.sh`) строит конверты в Node (UUIDv7, канонический JSON, SHA-256) и шлёт их curl с ключом точки на `api-oc-4210`.

**Окружение Windows**
- Nx: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, `--parallel=1`.
- После правки контрактов: `npx tsc -b libs/shared/dto/tsconfig.lib.json libs/shared/domain/tsconfig.lib.json --force`.
- После миграции: `npx nx run api:migrate`, затем `npx nx run api:db-types`. `api-oc-4210` раздаёт `dist`, поэтому после сборки его нужно перезапустить.
- Скрипты с кавычками пишутся инструментом Write.

**Git**
- Ветка `feature/offline-sync-pr1` без upstream: `git switch -c feature/offline-sync-pr1 --no-track origin/main`.
- Коммиты: `--no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Не коммитить `package.json`, `apps/web/next-env.d.ts`, `.claude/launch.json`, `.claude/agent-memory/`.
- Спецификация и план — первым коммитом ветки.

**Правила протокола (ADR-0014, спецификация)**
- Ключ идемпотентности — `operationId` (UUIDv7). Ключ inbox — ровно `(tenant_id, store_id, operation_id)`, без секций (E40).
- Повтор с тем же хешем → `duplicate`, с другим хешем → `rejected` (`id_reused`), строка inbox не меняется.
- Хеш — SHA-256 (hex) канонического JSON payload: ключи объектов отсортированы рекурсивно, без пробелов.
- Облако не пересчитывает FEFO и не проверяет остаток. Строки точки вставляются с её id как есть. Номера документов, чеков и смен точки хранятся как есть, счётчики `document_counters` облака для неё не трогаются (E16).
- Время:
  - секционированные `audit_log` и `stock_movements` получают время облака (`clock_timestamp()`), время точки остаётся в собственных колонках факта (`sold_at`, `returned_at`, `opened_at` …) и в `details.storeRecordedAt` строки аудита — неверные часы ПК не роняют вставку в несуществующую секцию;
  - `received_at` фактов — время облака.
- Лимиты батча: ≤ 500 операций и ≤ 2 МБ JSON после распаковки gzip. Больше 500 операций → 413 `batch_too_large`; превышение размера → 413 `batch_too_large`.
- Статусы лицензии (E12):
  - `active`; `expiring` (вычисляется: ≤ `notify_before_days` до срока); `expired`;
  - `revoked`, `revoked_hard`;
  - `store_closed`, `tenant_blocked`.

  Заголовок `Pharmacy-License-Status` — в каждом ответе sync. `revoked` / `expired` / `store_closed` / `tenant_blocked` — приём операций ещё `revoked_key_grace_days` (30) дней от события, потом 403 `license_expired`. `revoked_hard` и неверный ключ — 401 `license_revoked` / `license_invalid`.
- Логи — `Logger` с `correlationId`. Тела операций, ключи и ПДн в логи и ответы об ошибках не попадают.
- Деньги — целые дирамы; `tenant_id` — во всех запросах; RLS FORCE.

## Review Focus

1. **Повтор после потерянного ответа.** Тот же батч отправлен ещё раз: все операции `duplicate`, ни одной лишней строки (чек, движения, аудит), счётчики прогона не удваиваются. Проверка — Задача 5 (`os_check.sh`, шаг «повтор батча»).
2. **Тот же `operationId` с другим payload.** `rejected` / `id_reused`, исходная строка inbox и данные не тронуты. Проверка — Задача 4.
3. **Зависимость пришла позже.** Возврат раньше чека или чек раньше смены → `pending_dependency`, применяется сам в конце следующего батча, где пришла зависимость. Проверка — Задача 5.
4. **Ключ.**
   - Отозванный — приём ещё 30 дней; после льготного срока — 403; `revoked_hard` — 401.
   - Верный `keyId` с неверным секретом — 401 без утечки по времени (`timingSafeEqual`).
   - Ключ одной сети не применяет операции в другую.

   Проверка — Задача 3.
5. **Плохая операция в середине батча.** Остальные применяются (одна операция — одна транзакция). Плохая получает `quarantined` с кодом причины, её конверт сохранён для переприменения. Проверка — Задача 4.

---

### Task 1: Контракты протокола и канонический хеш

**Files:**
- Create: `libs/shared/dto/src/lib/sync-protocol.ts`; export из `libs/shared/dto/src/index.ts`
- Create: `apps/api/src/core/sync/payload-hash.ts`

**Interfaces — Produces:**
- `SyncHandshakeRequest { storeId; protocolVersion: number; appVersion: string; schemaVersion: string; feedCursor: string | null; outboxDepth: number; oldestPendingAt: string | null; storeTime: string }`.
- `SyncHandshakeResponse { syncRunId; license: { status: LicenseStatus; validUntil: string }; minSupportedProtocol: number; recommendedProtocol: number; limits: { maxOperations: 500; maxBytes: 2097152 }; serverTime: string; quarantined: number }`.
- `LicenseStatus = 'active' | 'expiring' | 'expired' | 'revoked' | 'revoked_hard' | 'store_closed' | 'tenant_blocked'`.
- `SyncEnvelope { protocolVersion: number; batchId: string; syncRunId: string; storeId: string; operations: SyncOperation[] }`.
- `SyncOperation { operationId; storeSeq: number; type: SyncOperationType; typeVersion: number; payloadHash: string; correlationId: string; occurredAt: string; actor: { employeeId: string | null; terminalId: string | null }; payload: unknown }`.
- `SyncOperationType` — все типы раздела 4.2 спецификации. В этом PR применяются `receipt.completed`, `return.completed`, `shift.opened`, `shift.cash-collected`, `shift.closed`, `terminal.bound`, `terminal.revoked`, `audit.recorded`, `stock.checkpoint`; прочие пока уходят в карантин `unsupported_type`.
- `SyncOperationResult { operationId; status: 'applied' | 'duplicate' | 'quarantined' | 'rejected' | 'pending_dependency'; reason?: string }`; `SyncBatchResponse { results: SyncOperationResult[] }`.
- `SyncRunCompleteRequest { operationsSent; applied; duplicate; quarantined; rejected; pendingDependency; changesReceived; bytesSent; durationMs; clientErrors: string[] }` (коды, ≤ 20).
- **Payload этого PR.** Строки повторяют колонки таблиц в camelCase без `tenant_id`, `created_at`, `received_at`, `recorded_at`:
  - `ReceiptCompletedPayload { receipt; lines; payments; controlledRecords; movements: SyncMovementRow[]; audit: SyncAuditRow[] }` — `receipt` без `origin`;
  - `ReturnCompletedPayload { customerReturn; lines; refunds; movements; writeOff: SyncWriteOffDocument | null; audit }`;
  - `ShiftOpenedPayload { shift; audit }`, `ShiftCashCollectedPayload { operation; audit }`, `ShiftClosedPayload { shift; audit }` (закрытие — колонки закрытия и итоги);
  - `TerminalBoundPayload { terminal; revokedTerminalId: string | null; audit }` — `terminal` без `credential_hash`; `TerminalRevokedPayload { terminalId; revokedAt; revokedBy; audit }`;
  - `AuditRecordedPayload { audit: SyncAuditRow }`;
  - `StockCheckpointPayload { atStoreSeq: number; batches: number; totalPieces: number; hash: string }`.
- `SyncMovementRow { id; storeId; batchId; qtyDeltaPieces; kind; sourceType; sourceId; sourceLineId; businessDate; reversesMovementId }`.
- `SyncAuditRow { id; recordedAt (время точки); businessDate; employeeId; storeId; terminalId; correlationId; action; entityType; entityId; details }`.
- `SyncWriteOffDocument { document; lines; movements }`.
- Хеш сверки: SHA-256 hex строк `${batchId}:${onHand}\n` по партиям с ненулевым остатком, отсортированных по `batchId` (лексикографически).
- `canonicalJson(value: unknown): string` и `payloadHash(payload: unknown): string` (hex SHA-256 от `canonicalJson`) — в `core/sync/payload-hash.ts`. Числа должны быть целыми; `NaN` и `Infinity` — ошибка.

- [ ] **Step 1:** контракты — с JSDoc у каждого типа (маршрут, единицы, кто пишет), как в соседних файлах DTO.
- [ ] **Step 2:** `canonicalJson` и `payloadHash`.
- [ ] **Step 3:** `npx tsc -b … --force`, `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t lint test build -p shared-dto api --parallel=1`. Expected: зелёные.
- [ ] **Step 4:** Commit `feat(dto): offline sync protocol — envelope, operations, handshake, POS payloads`.

### Task 2: Миграция приёма и ключи точки

**Files:**
- Create: `apps/api/migrations/<timestamp>_sync-receive.sql`. Номер — больше последнего на `origin/main` и в общих БД (`select max(name) from public.pgmigrations`).
- Modify: `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts` (через `api:db-types`).

**Схема:**
- **`license_keys`** (класс `platform`), колонки по модели 01:
  - `id uuid pk`, `key_id text unique`, `key_hash bytea unique (32 байта)`, `tenant_id`, `store_id` (FK на `stores (tenant_id, id)`), `valid_until`, `notify_before_days int default 7`;
  - `status` (`active` / `revoked` / `revoked_hard`), `issued_by uuid null → operators`, `issued_at`, `revoked_by uuid null`, `revoked_at`, `replaces_key_id uuid null`;
  - уникальный частичный индекс `(tenant_id, store_id) where status = 'active'`;
  - RLS: `tenant_own_read` для `pharmacy_app`, `platform_all` для `pharmacy_platform` (select / insert / update, без delete).
- **`resolve_license_key(p_key_id text)`** — SECURITY DEFINER, `set search_path = ''`, владелец `pharmacy_resolver`, EXECUTE — `pharmacy_app`.
  - Возвращает `key_hash, tenant_id, store_id, status, valid_until, revoked_at, store_status, store_closed_at, store_mode, tenant_status`.
  - Политики `resolver_read` и колоночные гранты на `license_keys` и на нужные колонки `stores` — если их ещё нет.
- **`sync_inbox`** (tenant, без секций):
  - pk `(tenant_id, store_id, operation_id)`; `store_seq bigint`, `type`, `type_version`, `payload_hash text`, `envelope jsonb`;
  - `status` (`applied` / `quarantined` / `rejected` / `pending_dependency`), `reason text`, `received_at`, `applied_at`, `attempts int default 0`;
  - индекс `(tenant_id, store_id, status, store_seq)`.
- **`sync_runs`** (tenant):
  - `id uuid pk` (с `tenant_id`), `store_id`, `started_at`, `finished_at`;
  - версии (`protocol_version`, `app_version`, `schema_version`), `outbox_depth`, `oldest_pending_at`, `feed_cursor`;
  - счётчики `applied`, `duplicate`, `quarantined`, `rejected`, `pending_dependency`, `operations_received`, `bytes_received`;
  - `client_report jsonb`, `result` (`open` / `ok` / `errors`), `correlation_id`.
- **`sync_conflicts`** (tenant) — по модели 06. Здесь только создаётся, пишут его PR 2–3.
- **`store_sync_status`** (`tenant-export`, политика `platform_read`):
  - pk `(tenant_id, store_id)`; `last_contact_at`, `last_success_at`, `last_run_id`;
  - версии, `outbox_depth`, `oldest_pending_at`, `feed_cursor`, `clock_skew_sec`, `license_status`, `quarantined`;
  - `last_checkpoint jsonb`, `checkpoint_mismatch boolean default false`, `updated_at`.
- **`platform_settings`** + `feed_window_days int default 90 (1..3650)`, `revoked_key_grace_days int default 30 (0..365)`, `min_supported_protocol int default 1`, `recommended_protocol int default 1` (E13).
- **`receipts.origin`**: проверка + `offline_store`.
- **Регистрация:** классы — в `TABLE_CLASSES`, резолвер — в `RESOLVER_FUNCTIONS`. Аудит и журналы не меняются; `sync_inbox` не append-only — статусы обновляются.

- [ ] **Step 1:** миграция, гранты и RLS по образцу `1792045306882_billing-services.sql` и `1791182068273_auth-terminals.sql`.
- [ ] **Step 2:** `npx nx run api:migrate`, `npx nx run api:db-types`, правка `table-classes.ts`.
- [ ] **Step 3:** `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run api:integration`. Expected: зелёный (проверка каталога таблиц и резолверов).
- [ ] **Step 4:** Commit `feat(db): sync inbox, runs, conflicts, store status and license keys of offline stores`.

### Task 3: Ключ точки — выдача, проверка, контур

**Files:**
- Create:
  - `apps/api/scripts/issue-license-key.mjs`, `apps/api/scripts/revoke-license-key.mjs`;
  - `apps/api/src/app/sync/license-key.guard.ts`, `apps/api/src/app/sync/license-status.ts`, `apps/api/src/app/sync/sync-store.context.ts`.
- Modify:
  - `apps/api/src/core/database/context-resolvers.ts` — `resolveLicenseKey`;
  - `apps/api/src/common/http/contour.ts` — `isSyncPath`;
  - `apps/api/src/common/guards/csrf.guard.ts`, `apps/api/src/common/throttling/principal-throttler.guard.ts`, `apps/api/src/main.ts`;
  - фильтр problem+json (`entity.too.large` → 413 `batch_too_large` на пути sync).

**Interfaces — Produces:**
- **`issue-license-key.mjs --store <uuid> --valid-until <YYYY-MM-DD>`** (`PLATFORM_DATABASE_URL`):
  - проверяет, что точка существует и не закрыта;
  - действующий ключ точки переводит в `revoked` с `replaces_key_id`;
  - вставляет новый (`key_id` — 16 hex-символов из `randomBytes(8)`; секрет — `randomBytes(32)` base64url; хранится SHA-256 секрета);
  - пишет `platform_audit_log` (`actor_kind system`, `job issue-license-key`, `license.issued`, без ключа);
  - печатает `phk_<keyId>_<secret>` и срок один раз.
- **`revoke-license-key.mjs --store <uuid> [--hard]`** — `revoked` или `revoked_hard`, аудит `license.revoked`.
- **`ContextResolvers.resolveLicenseKey(keyId: string): Promise<ResolvedLicenseKey | null>`** — поля резолвера в camelCase; фиксированный SQL, как у `resolveTerminal`.
- **`licenseStatus(row, now, notifyBeforeDays)`** (чистая функция, `license-status.ts`) → `{ status: LicenseStatus; acceptsOperations: boolean; graceUntil: string | null }`.
  - Порядок: `revoked_hard` → `tenant_blocked` → `store_closed` → `revoked` → `expired` → `expiring` → `active`.
  - `acceptsOperations`: `revoked_hard` никогда; льготные статусы — до `событие + revoked_key_grace_days`.
- **`LicenseKeyGuard`:**
  - разбирает `Authorization: Bearer phk_<keyId>_<secret>`, резолвит ключ, сравнивает `sha256(secret)` с `key_hash` через `timingSafeEqual`;
  - кладёт `SyncStore { tenantId; storeId; keyId; license: LicenseStatusResult }` в `req.syncStore`;
  - ставит заголовок `Pharmacy-License-Status`;
  - ошибки: нет ключа или неверный → 401 `license_invalid`; `revoked_hard` → 401 `license_revoked`; `storeId` тела ≠ ключа → 403 `store_mismatch`.
- **`@SyncStoreParam()`** — параметр-декоратор, отдаёт `req.syncStore`.
- **Контур `/api/v1/sync/*`:**
  - CSRF не проверяется, если есть заголовок `Authorization: Bearer phk_` — не браузерный запрос;
  - трекер throttler — `key:<keyId>` из заголовка (неразобранный — IP);
  - JSON-парсер с лимитом 2 МБ только для этого пути (`NestFactory.create(…, { bodyParser: false })`, затем `app.useBodyParser('json', { limit: '2mb', type: <sync path и JSON> })`, затем парсеры по умолчанию — `json`, `urlencoded` — для остальных путей);
  - gzip распаковывается body-parser'ом (`inflate`).

- [ ] **Step 1:** скрипты (стиль `create-operator.mjs`: ESM, `pg`, печать один раз, ошибки в stderr).
- [ ] **Step 2:** резолвер, guard, статус, контур, парсер, фильтр.
- [ ] **Step 3:** сборка `api`. Живая проверка (`os_check.sh`, часть «ключ»):
  - выдать ключ точке A, `POST /sync/runs` → 201 и `active`;
  - неверный секрет → 401 `license_invalid`;
  - отзыв → 201 и `revoked`; `revoked_at` в БД сдвинут на −31 день → 403 `license_expired`;
  - `--hard` → 401 `license_revoked`;
  - `storeId` другой точки → 403;
  - тело 2,5 МБ → 413.
- [ ] **Step 4:** Commit `feat(api): license keys of offline stores and the sync contour`.

### Task 4: Приём батча — inbox, карантин, зависимости, прогоны

**Files:**
- Create:
  - `apps/api/src/app/sync/sync-receive.controller.ts`, `sync-apply.service.ts`, `sync-runs.repository.ts`, `inbox.repository.ts`;
  - `fact-applier.ts` (интерфейс, токен реестра, `SyncApplyError`), `upcasters.ts` (пустой реестр), `dto/sync.dto.ts` (class-validator для конверта и handshake);
  - `apps/api/scripts/reapply-quarantine.mjs`.
- Modify:
  - `apps/api/src/app/sync/sync.module.ts` — регистрация только в облаке, в `app.module.ts`;
  - `apps/api/src/app/audit/audit.service.ts` — `appendFact`.

**Interfaces — Produces:**
- **Маршруты:**
  - `POST /api/v1/sync/runs` → `SyncHandshakeResponse`:
    - `protocolVersion < min_supported_protocol` → 426 `protocol_unsupported`;
    - создаёт `sync_runs` (`open`), upsert `store_sync_status`: контакт, версии, очередь, курсор, `clock_skew_sec = storeTime − serverTime`.
  - `POST /api/v1/sync/operations` (`Idempotency-Key` = `batchId`, иначе 400) → `SyncBatchResponse`;
  - `POST /api/v1/sync/runs/:id/complete` → 204: итог в `sync_runs`; `result ok` → `store_sync_status.last_success_at`.

  Все три маршрута: `@Public()`, `@UseGuards(LicenseKeyGuard)`; обработка — внутри `runWithContext({ correlationId, tenantId: syncStore.tenantId, principal: null })`.
- **`FactApplier` и `SyncApplyError`:**

  ```ts
  interface FactApplier { readonly types: readonly SyncOperationType[]; apply(trx: TenantTransaction, op: AppliedOperation): Promise<void> }
  // AppliedOperation = SyncOperation & { tenantId; storeId; payload } after the upcast
  class SyncApplyError extends Error { constructor(readonly code: string, readonly kind: 'quarantine' | 'dependency') }
  ```

  Применители регистрируются мультипровайдером `FACT_APPLIERS` или через `SyncAppliers.register(applier)` в `onModuleInit` модуля-владельца, как порты `PurchasePrices` и `TransferAcceptance`. Выбор — за исполнителем, по графу без циклов.
- **`SyncApplyService.applyBatch(store: SyncStore, envelope: SyncEnvelope)`.** Операции идут по `storeSeq`. Для каждой — своя `withTenant`:
  1. `pg_advisory_xact_lock(hashtext('sync-apply'), hashtext(storeId))`.
  2. `insert into sync_inbox … on conflict do nothing returning`; нет строки → прочитать существующую: тот же хеш → `duplicate`, если она `applied`, иначе её текущий статус; другой хеш → `rejected` / `id_reused`.
  3. `payloadHash(payload) ≠ op.payloadHash` → `rejected` / `hash_mismatch`.
  4. Upcast (тождество) → применитель → статус `applied`, `applied_at`.
  5. Режим точки `offline_pending` → `offline` при первом `applied` (E31).

  Ошибки:
  - `SyncApplyError` или ошибка БД → откат, затем новая транзакция: inbox `quarantined` (код или `apply_failed:<sqlstate>`), либо `pending_dependency`;
  - нет применителя → `quarantined` / `unsupported_type`;
  - лицензия не принимает операции → 403 до цикла.

  После цикла — повтор `pending_dependency` точки по `store_seq`, пока есть прогресс (`attempts + 1`). Счётчики батча прибавляются к `sync_runs` по `syncRunId`; `store_sync_status.quarantined` пересчитывается.
- **`reapply-quarantine.mjs --store <uuid>`** (E15, до экрана админки; `DATABASE_URL`, `set_config('app.tenant_id', …)` сети точки): строки `quarantined` точки → `pending_dependency` с `reason = requeued:<прежний код>`; они переприменяются сами в конце следующего батча этой точки. Печатает число строк.
- **`AuditService.appendFact(trx, tenantId: string, row: SyncAuditRow, storeId: string)`** — вставка как есть, `source offline_store`, `details.storeRecordedAt = row.recordedAt`, `recorded_at` — облака. Плюс одна запись `sync.batch-applied` на батч (точка, `batchId`, счётчики) с `source cloud`.

- [ ] **Step 1:** контроллер, DTO, сервис, репозитории, реестр применителей (пустой), `appendFact`.
- [ ] **Step 2:** сборка `api`, перезапуск `api-oc-4210`. Живая проверка (`os_check.sh`, часть «ворота»):
  - операция неизвестного типа → `quarantined` / `unsupported_type`;
  - повтор → `quarantined` (текущий статус), строк не прибавилось;
  - тот же id с другим payload → `rejected` / `id_reused`;
  - неверный `payloadHash` → `rejected` / `hash_mismatch`;
  - 501 операция → 413;
  - handshake с `protocolVersion 0` → 426;
  - `complete` → `sync_runs.result ok`;
  - `reapply-quarantine.mjs` → строка `unsupported_type` снова в ожидании, после следующего батча — опять `quarantined` (применителя нет).
- [ ] **Step 3:** Commit `feat(api): sync batch intake — inbox gate, quarantine, dependencies, runs`.

### Task 5: Применители кассы, возврата, терминалов, аудита и сверки

**Files:**
- Create:
  - `apps/api/src/app/pos/pos-facts.ts` — `receipt.completed`, `shift.*`;
  - `apps/api/src/app/returns/return-facts.ts`;
  - `apps/api/src/app/terminals/terminal-facts.ts`;
  - `apps/api/src/app/audit/audit-facts.ts`;
  - `apps/api/src/app/inventory/stock-facts.ts` — `insertMovements` как есть, `applyWriteOffDocument`, `checkpoint`.
- Modify: модули `pos`, `returns`, `terminals`, `audit`, `inventory` (экспорт), репозитории (вставка строк с заданными id, если их ещё нет).

**Interfaces — Consumes:** `FactApplier`, `SyncApplyError`, `AuditService.appendFact` (Задача 4); payload-типы (Задача 1).

**Правила применения** (ссылки на сущности той же сети; отсутствие — код ошибки):

| Тип | Проверки | Пишет |
|---|---|---|
| `terminal.bound` | точка = ключа; сотрудник есть (`quarantine: unknown_employee`); `revokedTerminalId` — терминал этой точки | `terminals` с `credential_hash = randomBytes(32)`: в облаке терминал точки не входит; отзыв предыдущего; аудит |
| `terminal.revoked` | терминал этой точки (`dependency: terminal`) | `revoked_at`, `revoked_by`; аудит |
| `shift.opened` | терминал этой точки (`dependency: terminal`); кассир есть | `shifts` (номер точки как есть); аудит |
| `shift.cash-collected` | смена этой точки (`dependency: shift`) | `shift_cash_operations`; аудит |
| `shift.closed` | смена этой точки открыта (`dependency: shift`) | колонки закрытия `shifts`; аудит |
| `receipt.completed` | смена и терминал точки (`dependency`); товары (`quarantine: unknown_product`); партии этой точки (`dependency: batch`); `Σ строк − скидка = итог`, `Σ оплат = итог + сдача`, целые дирамы, движения `sale` < 0 на партии строк (`quarantine: totals_mismatch` / `movement_mismatch`) | `receipts` (`origin offline_store`), строки, оплаты, ПКУ, движения, аудит |
| `return.completed` | чек точки (`dependency: receipt`), строки чека и остаток к возврату (`quarantine: over_return`); суммы | возврат, строки, возвраты денег, движения; автосписание — документ и строки через `StockFacts.applyWriteOffDocument`; аудит |
| `audit.recorded` | — | одна строка аудита |
| `stock.checkpoint` | — | сравнение с расчётом облака по движениям точки (число партий, сумма, хеш); `store_sync_status.last_checkpoint`, `checkpoint_mismatch` |

- [ ] **Step 1:** применители и их экспорт; правило облака E8. Запись кассы, смен и терминалов точки не `online` — 409 `offline_store_read_only`: проверить `PosContext.cloudStore` и `StoreAccess.writableStore` для `offline_pending`; добавить в `TerminalsService.bind` / `revoke` для точки не `online`.
- [ ] **Step 2:** сборка, наборы `api` и `api:integration`, перезапуск. Живая проверка (`os_check.sh`, часть «касса»):
  - **Подготовка.** Сеть по `pos_setup.sh`: точка A с партиями, приход в облаке. Точку A перевести в `offline` прямым SQL (только проверка) и выдать ей ключ.
  - **Батч 1:** `terminal.bound`, `shift.opened`, `receipt.completed` (2 строки, наличные со сдачей), `shift.cash-collected`, `audit.recorded`, `stock.checkpoint` → всё `applied`. В облаке: чек в списке чеков точки с номером точки; остаток партий уменьшился на проданное; аудит с `source offline_store`; сверка совпала.
  - **Повтор батча 1** → все `duplicate`, строк в `receipts`, `stock_movements`, `audit_log` не прибавилось (RF1).
  - **Батч 2:** `return.completed` (брак → автосписание) раньше `receipt.completed` второго чека → возврат `pending_dependency`, чек `applied`, возврат применился в конце того же батча (RF3).
  - **Батч 3:**
    - чек с чужим `productId` → `quarantined` / `unknown_product`, соседние операции `applied` (RF5);
    - `shift.closed` → `applied`;
    - сверка с намеренно неверным хешем → `checkpoint_mismatch = true`.
  - **Правило облака:** продажа через облако по точке A → 409 `offline_store_read_only`.
- [ ] **Step 3:** Commit `feat(api): apply offline-store POS facts — receipts, returns, shifts, terminals, audit, checkpoint`.

### Task 6: Документы

**Files:**
- Modify:
  - `CLAUDE.md` — граф модулей: `pos`, `returns`, `inventory`, `terminals`, `audit` ← `sync` (применители); контур `/api/v1/sync/*` по ключу точки;
  - `docs/architecture/data-model/06-sync-audit-billing.md` — E40 (`sync_inbox` без секций), колонки `sync_runs`, `store_sync_status`, `receipts.origin`;
  - `docs/architecture/data-model/01-platform-org.md` — `license_keys` и резолвер по Задаче 2;
  - `docs/architecture/data-model/README.md` — `sync_inbox` из списка секционированных;
  - `docs/architecture/adr/0014-protokol-sinhronizacii.md` — раздел «Поправка 2026-10-16»: E5 (секвенсор при чтении — для PR 3), E40;
  - `docs/architecture/APPROVAL.md` — строка утверждения спецификации и поправок.

- [ ] **Step 1:** правки документов.
- [ ] **Step 2:** `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t lint test build -p shared-dto shared-domain api web --parallel=1` и `api:integration`. Expected: зелёные.
- [ ] **Step 3:** Commit `docs: offline sync PR 1 — module graph, data model and ADR-0014 amendments`.
