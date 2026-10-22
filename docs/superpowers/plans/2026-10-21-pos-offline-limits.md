# Касса PR 3: пределы буфера, досылка под терминалом, очистка рецептов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** касса облачной точки продаёт без связи в пределах сети (общих и ПКУ), печатает локальный номер и код,
досылает буфер под терминалом после истечения PIN-сессии и с экрана входа; данные рецептов удаляются по сроку сети.

**Architecture:**
- Схема: колонки пределов в `tenant_settings`, `receipts.local_number`, триггер очистки `controlled_sale_records`.
- API:
  - маршруты буфера с `@BufferReplay()` различают «свою операцию» и «под терминалом» (`bufferReplayMode`);
  - режим «под терминалом» включает `BufferReplayInterceptor` модуля `pos`: разрешает device-cookie и входит в
    контекст сети терминала без принципала (`RequestContext.terminal`);
  - `PosContext` проверяет автора по входам `auth.pin-succeeded` (порт `PinSignIns` модуля `audit`);
  - очистку раз в час запускает `app/platform/retention` через порты `PrescriptionRetention` (`pos`) и
    `InboxRetention` (`sync`).
- Web:
  - буфер считает ожидающие операции и чеки с ПКУ, функция `bufferState` даёт уровни `ok` / `warn` / `blocked`;
  - локальный номер присваивается в транзакции записи в буфер;
  - среда отправки создаётся и по привязанному терминалу (экран входа).

**Tech Stack:** NestJS 11 (guards, interceptor, `AsyncLocalStorage`-контекст), Kysely + pg, node-pg-migrate (SQL);
Next.js static export, TanStack Query, `idb`, use-intl, `@pharmacy/ui`. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-21-pos-offline-limits-design.md` (утверждена 2026-10-21, P1–P18;
поправки ADR-0008, ADR-0013, ADR-0015 от 2026-10-21).

## Global Constraints

**Тесты и проверки.**
- Новых автотестов нет (правило «тесты до MVP»). Долг перечисляется в описании PR (спецификация, §9).
- Существующие наборы `api`, `web`, `shared-dto`, `shared-domain`, `shared-util` остаются зелёными; `messages.spec.ts`
  проверяет паритет ключей RU/TG.
- Проверки — временными скриптами в scratchpad, на временной базе и в браузере (Задача 10).
- `build` и `typecheck` api не запускать параллельно: webpack чистит `apps/api/dist`, и это даёт ложный TS6305.

**База.**
- Одна миграция `<Date.now()>_pos-offline-limits.sql`. Номер больше всех на `origin/main`, в ветках, в основной
  папке и в общих базах (`applied_check.mjs`). Сейчас максимум — `1792556744322_import-jobs`.
- Миграцию не применять к общим базам `pharmacy` и `pharmacy_test`. `api:integration` не запускать.
- Временная база `pharmacy_pos3_check`: создаётся как в плане загрузки данных, команды — через `ops_env2.mjs`
  (`OPS_DB=pharmacy_pos3_check`), удаление — `drop_scratch.mjs`.

**Окружение и git.**
- Только worktree `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/pos-pr3-offline-limits` без upstream.
  Основная папка — только чтение.
- Коммиты — `git commit --no-gpg-sign` с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier — только для новых файлов и файлов, отформатированных на `origin/main`.
- Перед каждым коммитом — `git status`: `apps/web/next-env.d.ts` в коммит не попадает.

**Значения спецификации (дословно).**
- Пределы (P6) — `libs/shared/domain/src/lib/pos-buffer.ts`:

  ```ts
  posBufferDefaults = { maxHours: 24, maxOperations: 500, controlledMaxHours: 8, controlledMaxOperations: 20 }
  posBufferBounds = { maxHours: [1, 72], maxOperations: [50, 2000], controlledMaxHours: [1, 24],
                      controlledMaxOperations: [1, 200] }
  prescriptionRetentionBounds = [1, 3650]   // default 90 (DB)
  BUFFER_WARN_RATIO = 0.8
  ```

  Пределы ПКУ не больше общих: часы и операции, иначе 400 `validation_failed` с полем.
- Окно автора (P10): `±5 минут` вокруг момента операции, вход не раньше `момент − pos_buffer_max_hours`.
- Очистка (P3, P5): раз в 60 минут, первый проход через 60 секунд; до 5000 записей ПКУ и до 1000 конвертов сети за
  проход; блокировка `pg_try_advisory_xact_lock(hashtextextended('prescription-purge:' || tenant, 0))`.
- Локальный номер (P12): 1–999999, счётчик `receipt-seq:<shiftId>` в хранилище `state`. Код (P13): последние 8
  символов id чека, заглавными; поиск — строка `^[0-9a-fA-F]{8}$`.
- Коды ошибок: 422 `author_session_missing`, 409 `receipt_code_ambiguous`.
- Данные рецепта не пишутся в логи и аудит. Отчёт читает из записи только `prescriptionNumber`, `prescriptionDate`,
  `clinic`, `doctor`.

**Уточнения спецификации при планировании** (вносятся в спецификацию в Задаче 10 разделом «Уточнения
2026-10-21»):
- **У1.** Device-cookie разрешает не `SessionMiddleware`, а `BufferReplayInterceptor` модуля `pos`, и только на
  четырёх маршрутах буфера. Middleware работает на каждом запросе и обращался бы к базе на каждом гостевом запросе
  терминала. Поведение раздела 4.1 не меняется.
- **У2.** Событие `controlled.prescriptions-purged` не входит в группы журнала (`audit-groups.ts`). Журнал
  показывает его по собственной подписи.
- **У3.** Поиск по коду (P14) ограничен бизнес-датой «сегодня − срок возврата» и идёт по существующему индексу
  `receipts_store_date_idx`. Нового индекса нет.

## Review Focus

1. **Вход другого кассира при восстановлении связи.** A продавал без связи. После связи B входит по PIN раньше, чем
   буфер опустел. Операции A принимаются под терминалом: в момент продажи терминал держал A. Операция A с моментом
   после входа B (часы ПК ушли вперёд более чем на 5 минут) уходит в карантин. Проверка — Задачи 5, 10.
2. **Перезагрузка ПК без связи, потом связь без входа.** Экран входа создаёт среду отправки по запомненному
   терминалу, буфер уходит без PIN. Счётчик на экране входа уменьшается до нуля. Проверка — Задачи 7, 10.
3. **Состав буфера для пределов.** Операция в карантине не блокирует продажи. Операция на паузе (401) считается.
   Снимок без `bufferLimits` (записан до обновления) даёт значения по умолчанию. Доставленный чек с ПКУ уменьшает
   счётчик ПКУ. Проверка — Задачи 7, 8, 10.
4. **Очистка больше 5000 записей и смена срока.** Первый проход очищает 5000, следующий — остальное. Уже очищенные
   записи не трогаются. После сокращения срока владельцем следующий проход очищает и новые просроченные. Любое
   другое изменение строки ПКУ отклоняет триггер. Проверка — Задачи 1, 6, 10.
5. **Очистка данных браузера посреди смены.** Счётчик локального номера поднимается до числа чеков смены на сервере,
   и номера не начинаются с 1. Две вкладки одного терминала не выдают один номер дважды: счётчик меняется в
   транзакции записи в буфер. Проверка — Задачи 7, 10.

---

### Task 1: Схема и модель данных

**Files:**
- Create: `apps/api/migrations/<номер>_pos-offline-limits.sql`
- Modify: `apps/api/src/core/database/db.generated.ts` (kysely-codegen), `apps/api/src/core/database/table-classes.ts`
  (комментарий у `controlled_sale_records` в `APPEND_ONLY_TABLES`: строки не удаляются, допустима только очистка
  трёх колонок)
- Modify: `docs/architecture/data-model/01-platform-org.md` (`tenant_settings`), `04-pos.md` (`local_number`,
  триггер очистки, колонка «Получено» журнала), `06-sync-audit-billing.md` (очистка конвертов `sync_inbox`,
  событие `controlled.prescriptions-purged`)

**Interfaces:**
- Produces:
  - `tenant_settings`: `pos_buffer_max_hours smallint`, `pos_buffer_max_operations integer`,
    `pos_controlled_max_hours smallint`, `pos_controlled_max_operations smallint` (not null, значения по умолчанию и
    границы — Global Constraints); проверки «ПКУ ≤ общих»;
  - `receipts.local_number integer null check (local_number between 1 and 999999)`;
  - функция `pharmacy.controlled_purge_only()`;
  - триггеры `controlled_sale_records_no_delete` и `controlled_sale_records_purge_only` вместо
    `controlled_sale_records_no_update_delete`;
  - `grant update (prescription_file_id, prescription_note, prescription_purged_at) on pharmacy.controlled_sale_records
    to pharmacy_app`;
  - индекс `controlled_sale_records_purge_idx on (tenant_id, recorded_at) where prescription_purged_at is null`;
  - типы Kysely: `TenantSettings.posBufferMaxHours`…, `Receipts.localNumber`.

- [ ] **Step 1: Номер миграции.** Сверка по Global Constraints, найденный максимум — в ledger.
- [ ] **Step 2: Миграция.** В шапке — ссылка на спецификацию (раздел 3). Первой строкой
  `set local lock_timeout = '5s'`. Функция `controlled_purge_only()`:
  - пропускает `update`, только если `old.prescription_purged_at is null` и `new.prescription_purged_at is not
    null`;
  - `new.prescription_note` и `new.prescription_file_id` должны быть `null`;
  - `(tenant_id, id, receipt_line_id, recorded_by, recorded_at, created_at)` не меняются (`is not distinct from`);
  - иначе — `raise exception … using errcode = '42501'`, текст как у `forbid_mutation()`.
- [ ] **Step 3: Временная база.** Создать `pharmacy_pos3_check`, применить все миграции, `kysely-codegen`, затем
  `--verify`.
  Expected: применены все миграции; `--verify` чистый.
- [ ] **Step 4: Проверка триггера и грантов** (скрипт `pos3_db_check.mjs` в scratchpad, ролью `pharmacy_app` в
  контексте сети, синтетическая сеть и чек):
  - очистка трёх колонок — проходит;
  - повторная очистка той же строки — 42501;
  - изменение `recorded_at` вместе с очисткой — 42501;
  - `delete` — 42501;
  - `update` другой колонки — отказ по правам (`42501` permission denied).

  Expected: `ALL OK`.
- [ ] **Step 5: Модель данных** по Files; `npm run docs:check`.
- [ ] **Step 6: Коммит** `feat(db): POS buffer limits, the local receipt number, the prescription purge trigger`.

### Task 2: Контракт и общие правила

**Files:**
- Create: `libs/shared/domain/src/lib/pos-buffer.ts` (+ экспорт в `index.ts`)
- Modify: `libs/shared/dto/src/lib/tenant-pos.ts`, `libs/shared/dto/src/lib/tenant-owner.ts`,
  `libs/shared/dto/src/lib/tenant-auth.ts`

**Interfaces:**
- Produces (`@pharmacy/shared-domain`):
  - `interface PosBufferLimits { maxHours: number; maxOperations: number; controlledMaxHours: number;
    controlledMaxOperations: number }`;
  - `posBufferDefaults: PosBufferLimits`, `posBufferBounds`, `prescriptionRetentionBounds`, `BUFFER_WARN_RATIO`;
  - `receiptCode(id: string): string` — последние 8 символов id без дефисов, заглавными;
  - `isReceiptCode(value: string): boolean` — `^[0-9a-fA-F]{8}$`.
- Produces (`@pharmacy/shared-dto`):
  - `PosStoreSettings.bufferLimits: PosBufferLimits`;
  - `CreateReceiptRequest.localNumber?: number`;
  - `ReturnableReceipt.localNumber: number | null`;
  - `NetworkSettings` и `UpdateNetworkSettingsRequest`: `prescriptionRetentionDays`, `posBufferMaxHours`,
    `posBufferMaxOperations`, `posControlledMaxHours`, `posControlledMaxOperations` (все `number`);
  - `BoundTerminal.tenantId: string`;
  - в doc-комментариях маршрутов — новые коды ошибок (`POST /receipts`, `/shifts*` — 422
    `author_session_missing`; `GET /receipts/returnable` — 409 `receipt_code_ambiguous`).

- [ ] **Step 1: Правила** `pos-buffer.ts` по Interfaces и Global Constraints.
- [ ] **Step 2: Контракт** по Interfaces.
- [ ] **Step 3: Проверка:** `npx nx run-many -t typecheck lint -p shared-domain shared-dto`.
  Expected: зелёное. Ошибки типов в `api` и `web` из-за новых обязательных полей закрывают Задачи 3–9.
- [ ] **Step 4: Коммит** `feat(shared): POS buffer limits, the receipt code, the contract of POS PR 3`.

### Task 3: Настройки сети и снимок кассы (API)

**Files:**
- Modify: `apps/api/src/app/stores/dto/settings.dto.ts`, `network-settings.repository.ts`, `settings.service.ts`
- Modify: `apps/api/src/app/pos/pos.repository.ts` (`settings()`), `catalog-snapshot.service.ts`

**Interfaces:**
- Consumes: `posBufferBounds`, `prescriptionRetentionBounds`, `posBufferDefaults` (Задача 2).
- Produces:
  - `PosRepository.settings()` дополнительно возвращает `bufferLimits: PosBufferLimits` и `retentionDays: number`
    (нет строки настроек — `posBufferDefaults` и 90);
  - снимок каталога отдаёт `settings.bufferLimits`.

- [ ] **Step 1: DTO.** Пять полей с `@IsInt() @Min() @Max()` по границам. «ПКУ ≤ общих» проверяет сервис:
  `FieldProblemException(400, 'validation_failed', [{ field: 'posControlledMaxHours' | 'posControlledMaxOperations',
  code: 'max' }])`.
- [ ] **Step 2: Репозиторий и сервис.** Чтение и upsert новых колонок. Аудит `settings.updated` до и после уже
  покрывает новые поля.
- [ ] **Step 3: Снимок.** `bufferLimits` из `PosRepository.settings()`.
- [ ] **Step 4: Проверка:** `npx nx run api:typecheck`, затем `npx nx test api`.
  Expected: зелёное.
- [ ] **Step 5: Коммит** `feat(api): network settings of the POS buffer and the prescription retention`.

### Task 4: Локальный номер, поиск по коду, журнал ПКУ (API)

**Files:**
- Modify: `apps/api/src/app/pos/dto/pos.dto.ts` (`CreateReceiptDto.localNumber`), `receipts.service.ts`,
  `receipts.repository.ts`
- Modify: `apps/api/src/app/pos/sold-receipts.ts`, `apps/api/src/app/returns/returnable.service.ts`
- Modify: `apps/api/src/app/pos/sales-figures.ts` (`controlledSales`),
  `apps/api/src/app/reports/report-builders.ts` (`controlled`)

**Interfaces:**
- Consumes: `isReceiptCode` (Задача 2).
- Produces:
  - `SoldReceipts.find(trx, tenantId, storeId, by: { id } | { number } | { code: string; sinceDate: string })`;
  - `SoldReceipt.localNumber: number | null`;
  - ошибка `ProblemException(409, 'receipt_code_ambiguous')`.

- [ ] **Step 1: Чек.** `localNumber` — `@IsOptional() @IsInt() @Min(1) @Max(999999)`. Пишется в
  `receipts.local_number` и в детали аудита `receipt.completed`.
- [ ] **Step 2: Поиск по коду.** `ReturnableService.find`: если `number` после очистки проходит `isReceiptCode` —
  ищется код. `sinceDate` = бизнес-дата сегодня минус срок возврата сети.
  - Запрос: `r.business_date >= sinceDate and replace(r.id::text, '-', '') like '%' || lower(code)` по индексу
    `receipts_store_date_idx`, `limit 2`.
  - Две строки — 409 `receipt_code_ambiguous`, ни одной — 404 `not_found`.
  - В ответе — `localNumber`.
- [ ] **Step 3: Журнал ПКУ.**
  - `controlledSales` читает `receipts.received_at`. Из `prescription_note` берутся только четыре поля рецепта
    (`prescription_note -> 'prescriptionNumber'` и т. д.), не весь jsonb.
  - Отчёт `controlled` получает колонку `received` (тип `datetime`) после `at`.
- [ ] **Step 4: Проверка:** `npx nx run api:typecheck`, затем `npx nx test api`.
  Expected: зелёное.
- [ ] **Step 5: Коммит** `feat(api): the local receipt number, the return search by code, the received time of the ПКУ journal`.

### Task 5: Досылка под терминалом (API)

**Files:**
- Modify: `apps/api/src/common/context/request-context.ts`
- Modify: `apps/api/src/common/guards/decorators.ts`, `auth.guard.ts`
- Create: `apps/api/src/common/guards/buffer-replay.ts`
- Modify: `apps/api/src/app/auth/permissions.guard.ts`, `apps/api/src/common/throttling/principal-throttler.guard.ts`
- Create: `apps/api/src/app/pos/buffer-replay.interceptor.ts`, `apps/api/src/app/pos/terminal-holder.ts`
- Modify: `apps/api/src/app/pos/pos-context.ts`, `receipts.controller.ts`, `shifts.controller.ts`,
  `receipts.service.ts`, `shifts.service.ts`
- Create: `apps/api/src/app/audit/pin-sign-ins.ts`
- Modify: `apps/api/src/app/audit/audit.service.ts`, `audit.module.ts`
- Modify: `apps/api/src/app/terminals/terminals.service.ts` (`current` → `tenantId`)

**Interfaces:**
- Produces:
  - `RequestContext.terminal?: { tenantId: string; storeId: string; terminalId: string }`. `runWithContext` требует
    `principal === null` и `tenantId === terminal.tenantId`, иначе бросает ошибку программирования.
    `getTerminal()` возвращает это поле или `null`;
  - `BUFFER_REPLAY_KEY` и `BufferReplay()` — метаданные обработчика; на четырёх маршрутах рядом с
    `@RequirePermission(...)`;
  - `bufferReplayMode(principal: EmployeePrincipal | null, body: unknown): 'own' | 'terminal'`. Значение `'own'` —
    только если `principal.auth === 'pin'`, `principal.terminalId !== null` и `body.employeeId` (строка, без учёта
    регистра) равен `principal.employeeId`;
  - `AuditEvent.employeeId?: string` — пишется, когда принципала нет;
  - `PinSignIns.between(trx, tenantId, storeId, terminalId, from: Date, to: Date):
    Promise<{ employeeId: string; at: Date }[]>` — входы `auth.pin-succeeded` (`entity_id`) по возрастанию
    `recorded_at`; экспорт модуля `audit`;
  - `heldBy(signIns, authorId: string, moment: Date, toleranceMs: number): boolean` — алгоритм ниже;
  - `TerminalSession`: `employeeId: string | null` и `via: 'session' | 'terminal'`.

  ```
  heldBy: holder(t) = employeeId of the last sign-in with at <= t (none -> nobody)
          true if holder(moment - tolerance) === authorId
               or some sign-in with moment - tolerance < at <= moment + tolerance has employeeId === authorId
  ```

- [ ] **Step 1: Контекст и разметка.** `request-context.ts` по Interfaces. `BufferReplay()` и
  `bufferReplayMode()`.
  - `AuthGuard`: маршрут с `BUFFER_REPLAY_KEY` пропускает гостя (принципала нет).
  - `PermissionsGuard`: на таком маршруте при `bufferReplayMode(...) === 'terminal'` право маршрута не проверяется.
  - `PrincipalThrottlerGuard.getTracker`: гость с device-cookie считается по `device:<sha256 секрета>`, а не по IP.
- [ ] **Step 2: Перехватчик** `BufferReplayInterceptor` (только на четырёх маршрутах, через `UseInterceptors` в
  `BufferReplay()` или на обработчиках). Режим `'own'` — обработчик как есть. Режим `'terminal'`:
  1. секрет из `TokenExtractor.extractDeviceSecret(req)`;
  2. `TerminalsService.resolveDevice(secret)`;
  3. нет секрета, `not_bound`, или сеть терминала не равна сети принципала — при принципале 403
     `terminal_required`, без него 401 `unauthenticated`;
  4. иначе обработчик выполняется внутри `runWithContext({ correlationId, tenantId, principal: null, terminal })`.
     Подписка на `next.handle()` происходит внутри `run`.
- [ ] **Step 3: `PosContext`.**
  - `terminalSession()` под терминалом возвращает данные из `getTerminal()` (`employeeId: null`, `via:
    'terminal'`).
  - `operation()` под терминалом:
    - автор всегда перезагружается (`principals.reload`);
    - в одной `tenantTransaction` читаются `pos_buffer_max_hours` (`PosRepository.settings`) и `PinSignIns.between`
      для окна `[момент − часы, момент + 5 мин]`;
    - `!heldBy(...)` — 422 `author_session_missing`.
  - Пометка `author` по K7 и пометка «онлайн-операция другим сотрудником» не меняются.
  - В `receipts.service.ts` и `shifts.service.ts` `requirePrincipal().tenantId` на путях четырёх маршрутов
    заменяется на `requireTenantId()`. В `audit.append` этих операций передаётся `employeeId: op.author.id`, а
    `details` получают `via: 'terminal'`, когда операция пришла под терминалом.
- [ ] **Step 4: `GET /terminals/current`** отдаёт `tenantId`.
- [ ] **Step 5: Проверка:** `npx nx run api:typecheck`, затем `npx nx test api` и `npx nx lint api`.
  Expected: зелёное; существующие тесты guard'ов (`auth.guard.spec.ts`, `permissions.guard.spec.ts`,
  `principal-throttler.guard.spec.ts`) проходят без изменений.
- [ ] **Step 6: Коммит** `feat(api): sending the POS buffer under the terminal (ADR-0008 amendment 2026-10-21)`.

### Task 6: Очистка данных рецептов (API)

**Files:**
- Create: `apps/api/src/app/pos/prescription-retention.ts` (+ провайдер и экспорт в `pos.module.ts`)
- Create: `apps/api/src/app/sync/inbox-retention.ts` (+ провайдер и экспорт в `sync.module.ts`)
- Create: `apps/api/src/app/platform/retention/{platform-retention.module.ts,prescription-purge.scheduler.ts,
  retention.repository.ts}`
- Modify: `apps/api/src/app/app.module.ts` (`ConditionalModule.registerWhen(PlatformRetentionModule, env.STORE_MODE !==
  'offline')`)

**Interfaces:**
- Produces:
  - `PrescriptionRetention.purgeExpired(tenantId: string): Promise<{ purged: number; retentionDays: number } |
    null>` — `null`, если сеть занята другим проходом;
  - `PrescriptionRetention.recordPurge(tenantId: string, records: number, envelopes: number): Promise<void>` —
    событие аудита `controlled.prescriptions-purged` с `{ records, envelopes }`;
  - `InboxRetention.purgeExpired(tenantId: string, retentionDays: number): Promise<number>`;
  - `RetentionRepository.tenantIds(trx: Transaction<DB>): Promise<string[]>` — все сети, по `id` (как
    `StatsRepository.staleTenants`);
  - `PrescriptionPurgeScheduler` (`OnApplicationBootstrap`, `OnApplicationShutdown`).

- [ ] **Step 1: Порт `pos`.** В `runWithContext({ correlationId, tenantId, principal: null })` и `tenantTransaction`:
  1. блокировка по Global Constraints (занято — `null`);
  2. срок из `PosRepository.settings()`;
  3. `update … set prescription_note = null, prescription_file_id = null, prescription_purged_at = now() where
     (tenant_id, id) in (select … where prescription_purged_at is null and (prescription_note is not null or
     prescription_file_id is not null) and recorded_at < now() - make_interval(days => срок) order by recorded_at
     limit 5000)`.
- [ ] **Step 2: Порт `sync`.**
  - Выбираются конверты: `type = 'receipt.completed'`, `received_at < now() - срок`, есть запись ПКУ с непустыми
    `prescriptionNote` или `prescriptionFileId`. Не больше 1000 за проход.
  - У каждой записи `envelope -> 'payload' -> 'controlledRecords'` эти поля становятся `null` (`jsonb_set` по
    пересобранному массиву).
  - `payload_hash` не меняется.
- [ ] **Step 3: Оркестратор.**
  - Первый проход — `setTimeout` на 60 с, затем `setInterval` раз в 60 минут; оба таймера `unref()`, при остановке
    приложения снимаются. Флаг `running` не даёт проходам наложиться.
  - Список сетей — `platformTransaction({ kind: 'system', job: 'prescription-purge' }, …)`.
  - По каждой сети: `pos.purgeExpired`, затем `sync.purgeExpired`; при сумме > 0 — `recordPurge`.
  - Ошибка сети — `logger.warn` с кодом ошибки и `tenantId`, без данных; цикл продолжается. Итог прохода — `log`
    с числами.
- [ ] **Step 4: Проверка:** `npx nx run api:typecheck`, затем `npx nx test api` и `npx nx lint api`.
  Expected: зелёное, без нарушений границ модулей.
- [ ] **Step 5: Коммит** `feat(api): the hourly purge of prescription data by the retention term (ADR-0013 amendment 2026-10-21)`.

### Task 7: Буфер, номер и среда отправки (web)

**Files:**
- Modify: `apps/web/src/shared/lib/offline-queue/{db.ts,queue.ts,runtime.ts,operations.ts,index.ts}`
- Create: `apps/web/src/shared/lib/offline-queue/buffer-state.ts`, `receipt-seq.ts`
- Modify: `apps/web/src/shared/lib/terminal-cache/terminal-cache.ts`,
  `apps/web/src/entities/session/api/session-queries.ts`
- Modify: `apps/web/src/entities/terminal/model/use-terminal.ts`; перенос `useBoundTerminal` и `terminalQueryKey`
  из `features/auth-by-pin/api/pin-login.ts` в `entities/terminal` (фича импортирует из сущности)
- Modify: `apps/web/src/features/pos/model/pay.ts`, `features/pos/lib/*` (сохранение снимка),
  `apps/web/src/entities/shift/api/use-current-shift.ts`

**Interfaces:**
- Consumes: `PosBufferLimits`, `posBufferDefaults`, `BUFFER_WARN_RATIO` (Задача 2).
- Produces:
  - `OutboxRecord.controlled?: boolean` — запись хранится без новой версии базы;
  - `OutboxCounts`: `oldestPendingAt: string | null`, `controlledPending: number`,
    `oldestControlledAt: string | null`;
  - `OfflineQueue.enqueue(record, alsoInTransaction?, prepare?: (tx, record) => Promise<typeof record>)` — `prepare`
    выполняется первым в той же транзакции и возвращает запись для `put`;
  - `TerminalRuntime.enqueueReceipt(payload: CreateReceiptRequest, alsoInTransaction?): Promise<number>` —
    присваивает `localNumber` по счётчику смены (`receipt-seq.ts`: `nextLocalNumber(tx, shiftId)`) и возвращает его;
  - `raiseReceiptSeq(db: PosDb, shiftId: string, atLeast: number): Promise<void>`;
  - `storeBufferLimits(db, limits)`, `readBufferLimits(db): Promise<PosBufferLimits>` — ключ `buffer-limits` в
    `state`; без значения — `posBufferDefaults`;
  - `interface BufferState { general: Level; controlled: Level; signIn: 'ok' | 'blocked'; pending: number;
    oldestHours: number; controlledPending: number }`, где `type Level = 'ok' | 'warn' | 'blocked'`;
  - `bufferState(counts: OutboxCounts, limits: PosBufferLimits, now: number, signedInAt: string | null):
    BufferState`. Значение `blocked` — при `n ≥ max` или `возраст ≥ maxHours`; `warn` — с 80 %; `signIn: 'blocked'`
    — при `now − signedInAt ≥ maxHours`;
  - `useBufferState(): BufferState | null` в `entities/terminal` — счётчики, пределы, `session.authenticatedAt`;
    пересчёт раз в 60 с;
  - `rememberBinding({ tenantId, storeId })`, `rememberedBinding()` в `terminal-cache`. `forgetTerminal()` очищает
    сессию и смены, но не привязку. Привязку снимает только ответ 404 `not_bound` на `GET /terminals/current`.

- [ ] **Step 1: Буфер.** Счётчики и флаг `controlled` по Interfaces. Флаг ставит `runtime`: чек хотя бы с одной
  строкой, где `controlled !== null`.
- [ ] **Step 2: Номер.**
  - `enqueueSale` возвращает запрос с присвоенным `localNumber`.
  - `use-current-shift` после ответа сервера вызывает `raiseReceiptSeq(db, shift.id, shift.receipts)`.
- [ ] **Step 3: Пределы.**
  - Сохранение снимка кассы пишет и `buffer-limits`.
  - `buffer-state.ts` и `useBufferState` по Interfaces.
- [ ] **Step 4: Среда отправки (P18).** `useTerminalRuntime()` берёт сеть и точку по порядку: из сессии, из
  `useBoundTerminal()` (`tenantId`, `store.id`), из `rememberedBinding()`. Успешный ответ терминала вызывает
  `rememberBinding`. Ответ 401 при чтении сессии привязку не трогает.
- [ ] **Step 5: Проверка правил** (временный скрипт `web_pos3_check.mjs` в scratchpad; модули транспилируются, как
  в `web_build.cjs`). Случаи `bufferState`:
  - 499 ожидающих → `warn`, 500 → `blocked`;
  - самая старая 19,2 ч → `warn`, 24 ч → `blocked`;
  - 20 чеков с ПКУ → `controlled: 'blocked'`, при этом `general: 'ok'`;
  - карантин не входит в счётчики;
  - вход 24 ч назад → `signIn: 'blocked'`;
  - пределы по умолчанию без `buffer-limits`.

  Случаи `heldBy` из Задачи 5 — тем же скриптом:
  - вход A, продажа A через 2 ч → `true`;
  - продажа A за 3 минуты до входа A → `true`;
  - вход B через 10 минут после продажи A → `true`;
  - продажа A через 10 минут после входа B → `false`;
  - нет входов → `false`.

  Expected: `ALL OK`.
- [ ] **Step 6: Проверка:** `npx nx run web:typecheck`, затем `npx nx test web` и `npx nx fsd web`.
  Expected: зелёное; Steiger без нарушений.
- [ ] **Step 7: Коммит** `feat(web): buffer limits state, the local receipt number, sending from the bound terminal`.

### Task 8: Касса, шапка и экран входа (web)

**Files:**
- Modify: `apps/web/src/pages/pos/ui/PosPage.tsx`, `features/pos/ui/{CartPanel,SaleReceiptDialog}.tsx`,
  `features/pos/lib/receipt-print.ts`
- Modify: `apps/web/src/widgets/app-shell/ui/ConnectionStatus.tsx`, `apps/web/src/pages/login/ui/LoginPage.tsx`
- Modify: `apps/web/src/shared/api/error-message.ts`, `apps/web/src/pages/shift/ui/ShiftPage.tsx` (тексты карантина)

**Interfaces:**
- Consumes: `useBufferState`, `enqueueSale` → запрос с `localNumber`, `receiptCode` (Задачи 2, 7).
- Produces:
  - `ReceiptLabels.localNumber: (n: number, code: string) => string`;
  - `ReceiptPrintData.request.localNumber` используется, когда `number === null`.

- [ ] **Step 1: Касса.**
  - Проверки `!online` для ПКУ (добавление и оплата) удаляются. Вместо них — `controlled === 'blocked'` с текстами
    `controlledLimit` / `controlledLimitPay`.
  - `general === 'blocked'` блокирует «Оплатить», `signIn === 'blocked'` — «Оплатить» и операции смены на
    экране кассы. На экране — плашка (`Alert`) с причиной.
- [ ] **Step 2: Печать.** Без номера ЧК печатаются строка «Чек № {n} · код {XXXXXXXX}» и «номер ЧК — после
  отправки». То же — в описании диалога чека.
- [ ] **Step 3: Шапка и вход.**
  - `ConnectionStatus`: при `warn` — «Буфер почти заполнен: {n} из {max} · старейшая {h} ч»; при `blocked` —
    «Продажи остановлены: буфер заполнен».
  - `LoginPage` на привязанном браузере: строка «Неотправленных операций: {n}», если их больше нуля.
- [ ] **Step 4: Ошибки.** `author_session_missing` и `receipt_code_ambiguous` — в `error-message.ts`. Карантин
  смены показывает текст из раздела 5 спецификации.
- [ ] **Step 5: Проверка:** `npx nx run web:typecheck`, затем `npx nx test web`, `npx nx lint web` и
  `npx nx fsd web`.
  Expected: зелёное.
- [ ] **Step 6: Коммит** `feat(web): POS blocks by the buffer limits and the sign-in age, the offline receipt number`.

### Task 9: Настройки, возврат, отчёты, моки и тексты (web)

**Files:**
- Create: `apps/web/src/pages/owner/settings/ui/OfflinePosCard.tsx`; Modify: `SettingsPage.tsx`
- Modify: `apps/web/src/pages/returns/ui/ReturnsPage.tsx` (подсказка поиска, «без связи № n», 409)
- Modify: `apps/web/src/shared/api/mocks/{handlers-pos.ts,handlers-owner.ts,db-owner.ts,transport.ts}`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/{pos,owner,core}.json`

**Interfaces:**
- Consumes: `NetworkSettings` (новые поля), `posBufferBounds`, `prescriptionRetentionBounds`, `receiptCode`,
  `isReceiptCode` (Задача 2).

- [ ] **Step 1: Настройки.** Карточка «Касса без связи и рецепты»: пять полей (`TextField` типа number) с границами
  и подсказкой «пределы ПКУ не больше общих». Сохранение — тот же `settings.update` (весь объект настроек,
  подтверждение паролем, как у `NetworkCard`).
- [ ] **Step 2: Возврат.** Поле — «Номер чека или код с чека». Карточка — «без связи № {n}», если есть
  `localNumber`. Код 409 показывается понятным текстом.
- [ ] **Step 3: Моки.**
  - Снимок кассы — `bufferLimits` из настроек мок-сети.
  - `receipts.create` хранит `localNumber`. `receipts.returnable` ищет и по коду (`isReceiptCode`), включая 409.
  - `settings.get/update` — пять полей и проверка «ПКУ ≤ общих».
  - `terminals.current` — `tenantId`.
  - `pick()` в моке отчётов сохраняет `piecesPerPack` и `prescriptionPurged`. Строки `controlled` получают
    `received`, у одной строки — `prescriptionPurged`.
- [ ] **Step 4: Тексты RU/TG** всех новых ключей Задач 8–9 и подписи события `controlled.prescriptions-purged`
  (`auditEvents`).
- [ ] **Step 5: Проверка:** `npx nx run web:typecheck`, затем `npx nx test web` (включая `messages.spec.ts`),
  `npx nx lint web`, `npx nx fsd web` и `npx nx build web`.
  Expected: зелёное.
- [ ] **Step 6: Коммит** `feat(web): POS offline settings, the return search by code, mocks and texts of POS PR 3`.

### Task 10: Документы, живые проверки и PR

**Files:**
- Modify: `CLAUDE.md` (граф модулей: `pos`, `sync` ← `platform/retention` — `PrescriptionRetention`, `InboxRetention`;
  `audit` экспортирует `PinSignIns`; в «Conventions», пункт о буфере, — досылка под терминалом и с экрана входа)
- Modify: `docs/architecture/reviews/2026-10-01-tz-deviations-for-customer.md` (п. 7: копии БД хранят очищенные
  данные рецептов ещё до 30 дней)
- Create (не в git): `.superpowers/pr-pos-pr3.md`

- [ ] **Step 1: Документы** по Files и раздел «Уточнения 2026-10-21» (У1–У3) в спецификации; `npm run docs:check`.
- [ ] **Step 2: Сборка.**
  - `npx nx run-many -t build -p api web admin`.
  - Затем отдельно: `npx nx run-many -t typecheck lint test -p api web admin shared-dto shared-domain shared-util`.
  - `npx nx fsd web`.

  Expected: всё зелёное.
- [ ] **Step 3: Живой API** (собранный API на временной базе через `ops_env2.mjs`, тестовые cookie; скрипт
  `pos3_live.mjs`, синтетическая сеть, точка, терминал, два кассира):
  - под терминалом (без сессии, со входом по паролю, с PIN-сессией другого кассира):
    - чек автора, державшего терминал, — 201;
    - чек автора, не державшего терминал, — 422 `author_session_missing`;
    - вход автора через 3 минуты после момента продажи — 201;
    - продажа автора через 10 минут после входа другого кассира — 422;
    - вход старше `pos_buffer_max_hours` — 422;
    - маршрут не из буфера без сессии — 401;
    - без device-cookie — 401 / 403 `terminal_required`;
  - аудит под терминалом: `employee_id` — автор, `via: 'terminal'`;
  - настройки: границы и «ПКУ ≤ общих» — 400; снимок отдаёт `bufferLimits`;
  - `localNumber` сохраняется; поиск по коду: один — 200, ни одного — 404, два (подобранные id) — 409;
  - журнал ПКУ: колонка `received`, данных покупателя нет;
  - очистка (прямой вызов портов из скрипта или ожидание прохода):
    - 5001 давняя запись — два прохода;
    - свежая запись не очищается; после сокращения срока в настройках следующий проход очищает и её;
    - конверт `receipt.completed` очищается, `payload_hash` прежний;
    - событие аудита с числами.

  Expected: `ALL OK`.
- [ ] **Step 4: Браузер** (`serve_web.mjs` → собранный web на живом API и мок-режим):
  - предупреждение и блокировка по общему пределу и по пределу ПКУ при уменьшенных пределах;
  - блокировка по возрасту входа (подменённое время входа в мок-режиме);
  - операция в карантине не блокирует продажи;
  - печать без связи — номер и код;
  - после очистки данных браузера посреди смены номер продолжает счёт сервера;
  - досылка с экрана входа после перезагрузки страницы;
  - возврат по коду;
  - карточка настроек.

  Скриншоты — пользователю.
- [ ] **Step 5: PR.**
  - Описание `.superpowers/pr-pos-pr3.md`: что сделано, ADR, как проверено, долг тестов (спецификация, §9),
    метка `ai-assisted`; в конце `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - Временная база удаляется (`drop_scratch.mjs pharmacy_pos3_check`).
- [ ] **Step 6: Коммит** `docs: CLAUDE.md and the ТЗ deviations for POS PR 3`.
