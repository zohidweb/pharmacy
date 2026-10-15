# Биллинг и услуги, PR 1: настройки платформы и услуги — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** оператор ведёт на API настройки платформы (тариф, НДС, реквизиты) и каталог услуг, решает заявки сетей и
отмечает оказанные услуги. Владелец заказывает услуги из каталога и видит решения.

**Architecture:**
- Одна миграция: `platform_settings` и `services` (shared), `service_requests` (tenant-export), `tenant_services`
  (platform, сеть читает свои строки).
- Платформенный модуль `app/platform/billing`: настройки, каталог, заявки, услуги сетей, счётчик меню.
- Тенантский модуль `app/billing`: каталог и заявки владельца. Порт `ServiceDecisions` для уведомлений
  (`billing` ← `notifications`).
- Новый вид уведомления `service_decided`.
- Админка и кабинет владельца переходят на эти маршруты.

**Tech Stack:** NestJS 11, class-validator, Kysely + pg (CamelCasePlugin), node-pg-migrate (SQL, только Up), RLS
(`tenantTransaction`, `PlatformDatabase.platformTransaction`); Next.js static export, TanStack Query, React Hook Form +
zod, use-intl, `@pharmacy/ui`; Jest.

**Spec:** `docs/superpowers/specs/2026-10-15-billing-services-design.md`. Разделы:
- PR 1 по разделу 13;
- B7–B9, B14, A12–A18, A20;
- 3.1 п. 1, 5–7; 4 (`platform_settings`, `services`, `service_requests`, `tenant_services`);
- 6.1 — строки настроек, каталога, заявок, услуг сетей, `attention-counts`; 6.2 — услуги;
- 7, 8, 9 — части про услуги, настройки и счётчик; 10 (услуги, настройки); 11.

## Global Constraints

**Тесты.**
- Новых автотестов нет: правило проекта «тесты до MVP». Долг перечисляется в описании PR.
- Существующие наборы остаются зелёными: `api`, `admin`, `web`, `shared-dto`, `shared-domain`.
- API и экраны проверяются вживую: сквозной скрипт на временной базе (Задача 8), экраны — временными экранными тестами
  на моках, которые в PR не входят.

**База.**
- Миграции **не применять** к общей dev-базе `pharmacy` и к `pharmacy_test`; `api:integration` не запускать.
- Тело миграции — проверка на dev в `begin; … rollback;`.
- Полный прогон — на временной базе `pharmacy_billing_check`:
  - создаётся суперпользователем, затем выполняется `docker/postgres/initdb/02-database.sql`;
  - миграции — `node apps/api/scripts/migrate.mjs` с адресами из `.env` основной папки, база заменена на временную
    (лаунчер в scratchpad сессии, значения не печатаются);
  - после проверки база удаляется.
- Типы Kysely генерируются `kysely-codegen` против временной базы (`MIGRATION_DATABASE_URL` на неё) и сверяются
  `--verify`.

**Окружение и git.**
- Работа только в worktree `C:\Projects\AI Projects\pharmacy-minors`; основную папку не трогать.
- Ветка `feature/billing-services` уже создана без upstream: `git rev-parse --abbrev-ref feature/billing-services@{u}`
  должен выдать ошибку.
- Коммиты — `git commit --no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Скрипты с кавычками и кириллицей пишутся инструментом Write, не heredoc.
- Prettier — только для файлов, которые на `origin/main` уже отформатированы, и для новых.

**Деньги и даты.**
- Суммы — целые дирамы, в контракте `…Minor`, в БД `…_dirams bigint`.
- Цена услуги и тариф — 1 … 10 000 000 000 дирамов.
- НДС в контракте — целый процент `vatRatePercent` 0…99, в БД `vat_bp = процент × 100` (по умолчанию 1400).
- Даты услуг — календарные дни `Asia/Dushanbe` (`toAppDate` из `libs/shared/util`).

**Права (A15, A16).**
- Оператор:
  - чтение настроек и каталога — `platform:view`; их изменение — `platform:manage`;
  - заявки и услуги сетей: чтение — `tenants:view`, действия — `tenants:manage`.
- `PUT /operator/settings` — ещё и `@RequireFreshAuth()`.
- Владелец: `services:view` — `GET /services`; `services:create` — заявка и её отзыв. Права уже есть в каталоге.

**Тексты ошибок.**
- `reason` — 5…500 символов после trim, `comment` — до 500 или `null`.
- Название услуги: RU 1…120, TJ 0…120 или `null`. Описание: RU 1…1000, TJ — до 1000 или `null`.
- Имена и тексты — без управляющих и невидимых символов (`/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u`, кроме описания: в нём
  разрешён перевод строки).

**Журнал.**
- Платформа (`platform_audit_log`), `entityType` и `entityId` — объект:
  - `settings.updated` (`details.fields` — имена изменённых полей);
  - `service.created`, `service.updated`;
  - `service.approved`, `service.rejected`, `service.added`, `service.price-changed`, `service.cancelled`,
    `service.provided`, `service.provision-undone` — с `tenantId`.
- Сеть (`audit_log`):
  - `settings.service-requested`, `settings.service-request-withdrawn` — `entityType: 'service_request'`.
  - Префикс `settings.` выбран, чтобы события попали в существующую группу журнала `settings_change`. Спецификация
    (раздел 10) называет их `service.*`; отступление записать в описании PR.

## Review Focus

1. **Отзыв и решение одновременно.** Владелец отзывает заявку в ту же секунду, когда оператор её подтверждает.
   Выигрывает ровно одно действие: у владельца 409 `service_decided`, либо у оператора 404. Решения без заявки не
   бывает. Проверка — Задача 8, параллельные запросы.
2. **Скрытая и архивная услуга.**
   - Владелец не видит их в каталоге, заявка на них — 404.
   - Оператор может добавить сети скрытую, но не архивную услугу (архивная — 404).
   - Проверка — Задачи 4, 5, 8.
3. **Повторная заявка.** Пока по прежней заявке нет решения — 409 `service_requested`. После отклонения или отмены
   можно заказать снова. Проверка — Задачи 5, 8.
4. **Дата «оказано».**
   - Будущая дата — 400. Дата раньше дня подтверждения по Душанбе — 400.
   - Подтверждённая в 00:30 по Душанбе (19:30 UTC накануне) отмечается оказанной в тот же календарный день — 200.
   - Проверка — Задачи 4, 8.
5. **Таджикский интерфейс без TJ-названия.** Владелец с языком `tg` видит RU-название и RU-описание, а не пустоту. Мок
   отвечает так же. Проверка — Задачи 5, 7, 8.

---

### Task 1: Контракт

**Files:**
- Modify:
  - `libs/shared/dto/src/lib/platform-system.ts`;
  - `libs/shared/dto/src/lib/platform-billing.ts`;
  - `libs/shared/dto/src/lib/platform-tenants.ts`;
  - `libs/shared/dto/src/lib/tenant-owner.ts`;
  - `libs/shared/dto/src/lib/tenant-home.ts`.

**Interfaces:**
- Produces (`platform-system.ts`):
  - `PlatformRequisites { name; inn; bankAccount; bankName; bankBik; bankCorrAccount; paymentPurposeTemplate }` (все `string`);
  - `PlatformSettings { pricePerStoreMinor: number; vatRatePercent: number; supplier: PlatformRequisites }`.
  - Поля `prorateByDays`, `keyExpiryNoticeDays`, `defaultSyncSchedule`, `acceptLegacyVersionSync` удаляются.
  - `AttentionCounts` не меняется.
- Produces (`platform-billing.ts`, раздел «Services»):
  - `PlatformService { id; nameRu; nameTj: string | null; descriptionRu; descriptionTj: string | null; basePriceMinor: number; visible: boolean; archived: boolean; tenants: number }` — `tenants` = сети с услугой `approved` или `provided`;
  - `UpsertServiceRequest` = `PlatformService` без `id` и `tenants`;
  - `ServiceRequestItem { id; serviceId; serviceName; tenantId; tenantName; requestedAt; basePriceMinor; comment: string | null }`;
  - `ApproveServiceRequest { priceMinor }`, `RejectServiceRequest { reason }` (есть);
  - `TenantServiceStatus = 'approved' | 'rejected' | 'cancelled' | 'provided'`;
  - `TenantServiceItem { id; serviceId; serviceName; tenantId; tenantName; status; priceMinor: number | null; reason: string | null; requestId: string | null; requestedAt: string | null; comment: string | null; decidedAt; decidedBy: string; providedOn: string | null }`;
  - `AddTenantServiceRequest { serviceId; priceMinor }`, `ProvideTenantServiceRequest { providedOn }`,
    `UpdateTenantServiceRequest { priceMinor }`, `CancelTenantServiceRequest { reason }`;
  - `TenantServiceQuery { status?: TenantServiceStatus; tenantId?: string }`.
- `platform-tenants.ts`:
  - удаляются `ServiceBilling` и прежний `TenantServiceItem`;
  - вкладка «Услуги» сети отдаёт `TenantServiceItem[]` из `platform-billing.ts`.
- Produces (`tenant-owner.ts`) — `TenantService`, `TenantServiceKey`, `TenantServiceState` удаляются; вместо них:
  - `ServiceCatalogItem { id; name; description; basePriceMinor }` — имя и описание на языке сотрудника, без TJ — RU;
  - `ServiceOrderStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'provided'`;
  - `ServiceOrder { requestId: string | null; serviceId; serviceName; status; comment: string | null; requestedAt: string | null; priceMinor: number | null; reason: string | null; providedOn: string | null; decidedAt: string | null }`;
  - `TenantServices { catalog: ServiceCatalogItem[]; orders: ServiceOrder[] }` — заказы: новые первыми;
  - `CreateServiceRequestBody { serviceId; comment: string | null }`.
- `tenant-home.ts`: `NotificationKind` += `'service_decided'`. `ReminderParams` += `serviceName?`, `priceMinor?`,
  `reason?`, `decision?: 'approved' | 'rejected' | 'cancelled'`.

- [ ] **Step 1: Изменить типы** по списку выше. JSDoc на каждом маршруте — коды ошибок из раздела 11 спецификации
  (`service_requested`, `service_decided`, `service_not_approved`, 404, 403 `fresh_auth_required` у настроек).
- [ ] **Step 2: Проверить библиотеки**
  Run: `npx nx run-many -t build lint typecheck -p shared-dto shared-domain`
  Expected: зелёные. `apps/admin` и `apps/web` перестанут собираться — их чинят Задачи 6 и 7 (сказать об этом в
  коммите).
- [ ] **Step 3: Commit** — `feat(dto): platform settings with bank requisites, service catalog, orders and decisions`

---

### Task 2: Миграция, манифест, типы, модель данных

**Files:**
- Create: `apps/api/migrations/<Date.now()>_billing-services.sql`.
- Modify:
  - `apps/api/src/core/database/table-classes.ts`;
  - `apps/api/src/core/database/db.generated.ts` (через `kysely-codegen` против временной базы);
  - `docs/architecture/data-model/06-sync-audit-billing.md` — «Биллинг и услуги»: настройки, услуги, заявки, решения
    по спецификации 4; таблицы PR 2 — пометка «PR 2»;
  - `docs/architecture/data-model/README.md` — `platform_settings` и `services` в `shared`, `store_billing` убрать.

**Interfaces:**
- Produces (таблицы схемы `pharmacy`):
  - **`platform_settings`** (shared):
    - `id smallint primary key check (id = 1)`;
    - `store_monthly_price_dirams bigint check (1 … 10_000_000_000)`, default 40000;
    - `vat_bp integer check (vat_bp between 0 and 9900 and vat_bp % 100 = 0)`, default 1400;
    - `supplier_name`, `supplier_inn`, `supplier_bank_account`, `supplier_bank_name`, `supplier_bank_bik`,
      `supplier_bank_corr_account`, `payment_purpose_template` — `text not null default ''`;
    - `updated_at`, `updated_by uuid null`.

    Строка `id = 1` вставляется миграцией.
  - **`services`** (shared):
    - `id uuid primary key`;
    - `name jsonb` (`{ru, tj?}`), `description jsonb`;
    - `base_price_dirams bigint`;
    - `visible boolean not null default true`, `archived boolean not null default false`;
    - `created_at`, `updated_at`.
  - **`service_requests`** (tenant-export):
    - `tenant_id`, `id`, `service_id → services(id)`;
    - `comment text null`, `requested_by uuid not null`, `requested_at`;
    - ключ `(tenant_id, id)`;
    - частичный уникальный индекс не нужен: правило «одна заявка без решения на услугу» проверяет сервис под
      advisory-блокировкой `(tenant, service)`.
  - **`tenant_services`** (platform):
    - `id uuid primary key`, `tenant_id → tenants(id)`, `service_id → services(id)`;
    - `request_id uuid null`; FK `(tenant_id, request_id) → service_requests(tenant_id, id)`, уникален;
    - `price_dirams bigint null`;
    - `status text check in ('approved','rejected','cancelled','provided')`;
    - `reason text null`;
    - `decided_by uuid not null`, `decided_at`;
    - `provided_on date null`, `provided_by uuid null`;
    - `updated_at`;
    - CHECK-и: цена есть у всех статусов, кроме `rejected`; `provided_on` есть ровно у `provided`; `reason` — у
      `rejected` и `cancelled`;
    - индексы `(tenant_id, decided_at)`, `(status)`.
  - **Гранты и RLS** по образцу `1791956981070_owner-cabinet.sql` и `org-foundation.sql`:
    - shared: `pharmacy_app` SELECT, `pharmacy_platform` SELECT/INSERT/UPDATE;
    - tenant-export: `pharmacy_app` SELECT/INSERT/DELETE по `tenant_isolation`, `pharmacy_platform` SELECT по
      политике `FOR SELECT`;
    - platform: `pharmacy_app` SELECT по политике «свои строки» `tenant_id = current_setting('app.tenant_id')::uuid`
      (как `tenant_self_read`), `pharmacy_platform` SELECT/INSERT/UPDATE `USING (true)`;
    - RLS `enable` + `force` на tenant-export и platform.
  - **Уведомления.** CHECK-и `notifications.kind` и `tenant_settings.disabled_notifications` пересоздаются с добавлением
    `'service_decided'` и `'invoice_overdue'` (второе — заранее для PR 3). Имена ограничений взять из `pg_constraint`.
  - **Манифест** `TABLE_CLASSES`: `platform_settings: 'shared'`, `services: 'shared'`,
    `service_requests: 'tenant-export'`, `tenant_services: 'platform'`.

- [ ] **Step 1: Написать миграцию** по описанию выше; шапка-комментарий — как у соседних файлов.
- [ ] **Step 2: Проверить тело на dev в откатываемой транзакции**
  Run: `(echo "begin;"; cat <файл>; echo "rollback;") | docker exec -i pharmacy-dev-postgres-1 psql -U postgres -d pharmacy -v ON_ERROR_STOP=1`
  Expected: без ошибок.
- [ ] **Step 3: Временная база и полный прогон.** Создать `pharmacy_billing_check` (как в Global Constraints),
  применить все миграции.
  Expected: `Applied N migration(s)`, последней идёт новая.
- [ ] **Step 4: Типы.** Сгенерировать `db.generated.ts` против временной базы, затем `kysely-codegen --verify`.
  Expected: «Generated types are up-to-date».
- [ ] **Step 5: Гранты на временной базе.** Запрос `has_table_privilege` по ролям и четырём таблицам.
  Expected:
  - на `tenant_services` у `pharmacy_app` только SELECT;
  - на `service_requests` у `pharmacy_platform` только SELECT;
  - TRUNCATE и REFERENCES — ни у кого.
- [ ] **Step 6: Модель данных и проверка документов** — правки 06 и README.
  Run: `node tools/scripts/check-docs.mjs` → «no violations»; `npx tsc -b apps/api/tsconfig.json` → без ошибок.
- [ ] **Step 7: Commit** — `feat(db): platform settings, service catalog, requests and decisions`

---

### Task 3: API оператора — настройки и каталог

**Files:**
- Create (в `apps/api/src/app/platform/billing/`):
  - `platform-billing.module.ts`;
  - `platform-settings.controller.ts`, `platform-settings.service.ts`;
  - `services-catalog.controller.ts`, `services-catalog.service.ts`;
  - `billing.repository.ts`;
  - `dto/billing.dto.ts`.
- Modify: `apps/api/src/app/app.module.ts` — `ConditionalModule.registerWhen(PlatformBillingModule, …)` как у
  `OperatorsModule`.

**Interfaces:**
- Consumes: Задача 1 (`PlatformSettings`, `PlatformService`, `UpsertServiceRequest`), Задача 2 (таблицы).
- Produces:
  - маршруты:
    - `GET /operator/settings` (`platform:view`);
    - `PUT /operator/settings` (`platform:manage` + step-up) → `PlatformSettings`;
    - `GET /operator/services` (`platform:view`) — архивные последними;
    - `POST /operator/services` (`platform:manage`) → 201;
    - `PUT /operator/services/:id` (`platform:manage`), 404;
  - `BillingRepository` — запросы к `platform_settings` и `services` в транзакции вызывающего; его же расширяют
    Задачи 4 и (в PR 2) счета.

- [ ] **Step 1: DTO.**
  - `UpdatePlatformSettingsDto`: `pricePerStoreMinor` (int 1…1e10), `vatRatePercent` (int 0…99), вложенный
    `supplier` (`@IsObject @ValidateNested`):
    - ИНН `^\d{9}$`, расчётный и корреспондентский счета `^\d{20}$`, БИК `^\d{9}$`;
    - название и банк — 1…200 печатных;
    - шаблон — 1…200 и содержит `{number}`.
  - `UpsertServiceDto` — правила раздела «Тексты» Global Constraints.
- [ ] **Step 2: Сервисы и контроллеры.**
  - Изменение настроек и каталога — одна `platformTransaction` с событием журнала.
  - Настройки: в `details.fields` — изменённые поля, без значений.
- [ ] **Step 3: Проверка.**
  Run: `npx tsc -b apps/api/tsconfig.json && npx nx run-many -t lint test -p api`
  Expected: зелёные, 462+ тестов.
- [ ] **Step 4: Commit** — `feat(api): platform settings and the service catalog for operators`

---

### Task 4: API оператора — заявки, услуги сетей, счётчик

**Files:**
- Create (в `apps/api/src/app/platform/billing/`):
  - `service-orders.controller.ts`, `service-orders.service.ts`;
  - `attention.controller.ts`.
- Modify: `billing.repository.ts`, `dto/billing.dto.ts`, `platform-billing.module.ts`.

**Interfaces:**
- Consumes: Задачи 1–3.
- Produces — маршруты, права по Global Constraints:

| Маршрут | Ответ, ошибки |
|---|---|
| `GET /operator/service-requests` | заявки без решения, старые первыми |
| `POST /operator/service-requests/:id/approval {priceMinor}` | 201 `TenantServiceItem`; 404; 409 `service_decided` |
| `POST /operator/service-requests/:id/rejection {reason}` | 201 `TenantServiceItem`; 404; 409 `service_decided` |
| `GET /operator/tenant-services?status&tenantId` | новые первыми |
| `GET /operator/tenants/:id/services` | вкладка карточки сети; 404 |
| `POST /operator/tenants/:id/services {serviceId, priceMinor}` | услуга без заявки, сразу `approved`; 404 для архивной |
| `POST /operator/tenant-services/:id/provision {providedOn}` | 200; 409 `service_not_approved`; 400 за датой |
| `DELETE /operator/tenant-services/:id/provision` | 200, назад в `approved`; 409 `service_not_approved`, если не `provided` |
| `PATCH /operator/tenant-services/:id {priceMinor}` | 200; 409 `service_not_approved` для `rejected` и `cancelled` |
| `POST /operator/tenant-services/:id/cancellation {reason}` | 200; 409 `service_not_approved` для `rejected` и `cancelled` |
| `GET /operator/attention-counts` | `{ serviceRequests, expiringLicenses: 0, unreadNotifications: 0 }` |

- Проверки «услуга уже в счёте» (409 `service_invoiced`, A13) добавит PR 2: в PR 1 счетов ещё нет.

- [ ] **Step 1: Репозиторий.**
  - Заявки без решения: `service_requests` left join `tenant_services` on `request_id`, где решения нет.
  - Решение по заявке:
    - вставка в `tenant_services` с `request_id`;
    - 23505 по `request_id` → 409 `service_decided`;
    - 23503 (заявку отозвали) → 404.
  - Изменения статуса — `update … where id = $1 and status = any($expected)`: пустой результат даёт 409 или 404.
- [ ] **Step 2: Даты «оказано».** `providedOn` ≤ `toAppDate()` и ≥ `toAppDate(decidedAt)`, иначе 400
  `validation_failed` (`providedOn`: `future` / `before_decision`).
- [ ] **Step 3: Журнал** — события из Global Constraints; `tenantId` — сеть услуги.
- [ ] **Step 4: Проверка.**
  Run: `npx tsc -b apps/api/tsconfig.json && npx nx run-many -t lint test -p api`
  Expected: зелёные.
- [ ] **Step 5: Commit** — `feat(api): service requests, network services and the menu counter for operators`

---

### Task 5: API сети — каталог и заявки владельца, уведомление `service_decided`

**Files:**
- Create (в `apps/api/src/app/billing/`):
  - `billing.module.ts`;
  - `owner-services.controller.ts`, `owner-services.service.ts`, `owner-services.repository.ts`;
  - `service-decisions.ts`;
  - `dto/services.dto.ts`.
- Modify:
  - `apps/api/src/app/app.module.ts` — облачный `BillingModule`, как остальные модули владельца;
  - `apps/api/src/app/notifications/{notification-kinds.ts, notifications-refresh.ts, notifications.module.ts}`;
  - корневой `CLAUDE.md` — граф модулей: `billing` ← `notifications` (`ServiceDecisions`).

**Interfaces:**
- Consumes: Задачи 1–2; `AuditService`, `TenantDatabase`, принцип сотрудника (`locale`).
- Produces:
  - `GET /services` (`services:view`) → `TenantServices`. Каталог: `visible and not archived`, имя на языке
    сотрудника с откатом на RU. Заказы: заявки и строки `tenant_services` своей сети.
  - `POST /service-requests {serviceId, comment}` (`services:create`) → 201 `ServiceOrder`.
    - Скрытая, архивная или неизвестная услуга — 404.
    - Есть заявка без решения на эту услугу — 409 `service_requested` (проверка под
      `pg_advisory_xact_lock(hashtext(tenant || service))`).
  - `DELETE /service-requests/:id` (`services:create`) → 204; 404; 409 `service_decided` (решение есть: FK запрещает
    удаление).
  - `ServiceDecisions.decidedSince(trx, tenantId, since: Date): Promise<{ id: string; serviceName: string; status: 'approved' | 'rejected' | 'cancelled'; priceMinor: number | null; reason: string | null; decidedAt: Date }[]>`
    — экспорт `BillingModule`.
  - `service_decided`:
    - в `NOTIFICATION_KINDS` и `EVENT_KINDS` (событие, видно 30 дней);
    - `KIND_PERMISSION.service_decided = 'services:view'`;
    - `storeId: null`, `dedupeKey: 'service:' + id + ':' + status`, `entityType: 'tenant_service'`;
    - `params`: `serviceName`, `decision`, `priceMinor`, `reason`.

- [ ] **Step 1: Контроллер, сервис, репозиторий.**
  - Каждая запись — `tenantTransaction` с событием журнала сети (`settings.service-requested` /
    `settings.service-request-withdrawn`).
  - `requested_by` — сотрудник из принципала.
- [ ] **Step 2: Уведомления.** Порт `ServiceDecisions` и блок `if (enabled('service_decided'))` в
  `notifications-refresh.ts` по образцу `shift_discrepancy`.
- [ ] **Step 3: Проверка.**
  Run: `npx tsc -b apps/api/tsconfig.json && npx nx run-many -t lint test -p api`
  Expected: зелёные. Тест каталога видов уведомлений, если он сверяет полный список, — обновить ожидание.
- [ ] **Step 4: Commit** — `feat(api): the owner orders services; service decisions notify the network`

---

### Task 6: Админка

**Files:**
- Modify:
  - `apps/admin/src/shared/api/{routes.ts, client.ts}`;
  - моки `apps/admin/src/shared/api/mocks/{db-billing.ts, handlers-billing.ts, handlers-system.ts, db-system.ts}`;
  - `apps/admin/src/pages/services/ui/ServicesPage.tsx` (диалоги можно вынести рядом);
  - `apps/admin/src/pages/settings/ui/SettingsPage.tsx`;
  - вкладка «Услуги» карточки компании (`apps/admin/src/pages/company/ui/`), `apps/admin/src/entities/tenant/api/tenant-queries.ts`;
  - `apps/admin/src/entities/operator-audit/**` (тексты событий);
  - `apps/admin/src/shared/i18n/messages/{ru,tg}.json`;
  - `apps/admin/specs/{billing,system}.spec.tsx` — только под новый контракт.

**Interfaces:**
- Consumes: маршруты Задач 3–4, контракт Задачи 1.
- Produces — ключи маршрутов:
  - `settings.get`, `settings.update`;
  - `services.list`, `services.create`, `services.update`;
  - `serviceRequests.list`, `serviceRequests.approve` (тело `ApproveServiceRequest`), `serviceRequests.reject`;
  - `tenants.services`, `tenants.addService`;
  - `tenantServices.list`, `tenantServices.provide`, `tenantServices.unprovide`, `tenantServices.update`,
    `tenantServices.cancel`;
  - `attention.counts`.

  Все — в `REAL_API_ROUTES`.

- [ ] **Step 1: Маршруты и моки.** Моки отвечают как API: те же коды, порядок проверок и поля. Засев:
  - три услуги: перенос данных, выезд инженера, обучение персонала; одна скрытая;
  - две заявки;
  - одна подтверждённая и одна оказанная услуга.
- [ ] **Step 2: «Настройки».**
  - Тариф, НДС, реквизиты с банком, БИК и корр. счётом; валидация как в DTO.
  - Офлайн-блок и «пропорционально дням» убрать.
  - `fresh_auth_required` — существующим текстом.
- [ ] **Step 3: «Услуги».**
  - Каталог: RU и TJ, базовая цена, «показывать владельцу», архив.
  - Заявки: «Подтвердить» — диалог с ценой, по умолчанию базовая; «Отклонить» — с причиной.
  - Список «Подтверждены, не оказаны»: «Оказано» с датой (по умолчанию сегодня), «Цена», «Отменить».
- [ ] **Step 4: Карточка компании → «Услуги».**
  - Список услуг сети со статусами.
  - «Добавить услугу» (без архивных, скрытые — с пометкой); те же действия, что на экране «Услуги».
- [ ] **Step 5: Тексты.** RU/TJ: экраны, коды ошибок (`service_requested`, `service_decided`,
  `service_not_approved`), события журнала из Global Constraints.
- [ ] **Step 6: Проверка.**
  Run: `npx tsc -b apps/admin/tsconfig.json && npx nx run-many -t lint test fsd -p admin`
  Expected: зелёные. Временный экранный тест на моках проходит: подтвердить с ценой, отклонить, оказано, добавить
  услугу, сохранить настройки. Тест удалить.
- [ ] **Step 7: Commit** — `feat(admin): platform settings, the service catalog, requests and network services on the API`

---

### Task 7: Кабинет владельца

**Files:**
- Modify:
  - `apps/web/src/shared/api/{routes.ts, client.ts}`;
  - моки `apps/web/src/shared/api/mocks/{handlers-owner.ts, db-owner.ts}`;
  - `apps/web/src/pages/owner/stores/ui/StoresPage.tsx` — блок услуг вынести в `ServicesSection.tsx` рядом;
  - тексты уведомлений и переключателя вида в настройках (найти по `shift_discrepancy` в `apps/web/src`);
  - `apps/web/src/shared/i18n/messages/{ru,tg}/owner.json`, файлы уведомлений и настроек.

**Interfaces:**
- Consumes: маршруты Задачи 5, контракт Задачи 1.
- Produces:
  - ключи `services.list` → `TenantServices`;
  - `serviceRequests.create` (`POST /service-requests`);
  - `serviceRequests.withdraw` (`DELETE /service-requests/{id}`);
  - все три — в `REAL_API_ROUTES`. Прежний `services.request` удаляется.

- [ ] **Step 1: Маршруты и моки** — как API, включая откат на RU для `tg`.
- [ ] **Step 2: Блок «Услуги».**
  - Каталог: название, описание, «от {цена}», кнопка «Заказать» → диалог с комментарием.
  - Под каталогом — «Мои заказы»:
    - статус;
    - цена, причина, дата оказания;
    - «Отозвать» у ждущих решения.
  - Без `services:create` кнопок нет. Пять прежних пунктов и их тексты удалить.
- [ ] **Step 3: Уведомление `service_decided`.** Тексты RU/TJ для трёх решений и переключатель вида в настройках
  уведомлений.
- [ ] **Step 4: Проверка.**
  Run: `npx tsc -b apps/web/tsconfig.json && npx nx run-many -t lint test fsd -p web`
  Expected: зелёные. Временный экранный тест на моках проходит: заказать, отозвать, повторный заказ — 409-текст, RU-имя
  при `tg`. Тест удалить.
- [ ] **Step 5: Commit** — `feat(web): the owner orders services from the operator's catalog`

---

### Task 8: Сквозная проверка, документы, PR

**Files:**
- Create: скрипт `billing_pr1_live.mjs` в scratchpad сессии (не в репозитории); `.superpowers/pr-billing-services-pr1.md`.

- [ ] **Step 1: Собрать и запустить API** на временной базе: `npx nx build api`, запуск `apps/api/dist/main.js` на
  `:4318` через лаунчер.
- [ ] **Step 2: Сквозной скрипт.** Оператор создаётся `create-operator.mjs`, сеть — через API. Владелец входит кодом
  активации (`POST /activations`, затем `POST /sessions`). Скрипт проверяет и печатает `OK/FAIL` без секретов:
  - настройки:
    - чтение;
    - сохранение без step-up — 403;
    - неверный ИНН, БИК, шаблон без `{number}` — 400;
  - каталог: создание, правка, скрытие, архив;
  - заявки:
    - заказ;
    - повтор — 409 `service_requested`;
    - скрытая услуга — 404;
    - отзыв; повтор после отзыва;
  - решения:
    - подтверждение с ценой; повторное решение — 409;
    - отклонение;
    - повторный заказ после отклонения;
  - гонка «отзыв ↔ подтверждение» — 20 пар параллельных запросов, ни одной пары «оба успешны» (Review Focus 1);
  - услуга без заявки: архивная — 404, скрытая — 201;
  - «оказано»:
    - будущая дата и дата до подтверждения — 400;
    - снятие отметки; цена; отмена;
  - `GET /services` с языком `tg` без TJ-имени — RU (Review Focus 5);
  - уведомление `service_decided` у владельца после `GET /notifications`;
  - журналы платформы и сети — нужные события;
  - `attention-counts.serviceRequests` совпадает с числом заявок без решения;
  - изоляция: владелец второй сети не видит заказов первой.
- [ ] **Step 3: Полные проверки.**
  Run: `npx tsc -b apps/api/tsconfig.json apps/admin/tsconfig.json apps/web/tsconfig.json && npx nx run-many -t lint test typecheck fsd -p api admin web shared-dto shared-domain && node tools/scripts/check-docs.mjs`
  Expected: всё зелёное.
- [ ] **Step 4: AI-ревью.** Агенты `nestjs-reviewer` (API, контракт, моки) и `postgresql-database-reviewer`
  (миграция, RLS, гранты); замечания — исправить и перепроверить.
- [ ] **Step 5: Описание PR** `.superpowers/pr-billing-services-pr1.md`:
  - что сделано;
  - как проверено;
  - отступление по префиксу событий журнала;
  - что ждёт PR 2 (`service_invoiced`, счета);
  - долг по тестам;
  - просьба прогнать `api:migrate`, `api:db-types-verify`, `api:integration`, api-e2e.
- [ ] **Step 6: Удалить временную базу, отправить ветку** — `git push -u origin feature/billing-services:feature/billing-services`;
  убедиться, что upstream — своя ветка, а `origin/main` не изменился.
