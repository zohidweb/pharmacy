# Кабинет владельца, PR 1: настройки, уведомления, главная, журнал действий — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** настройки сети, уведомления, главная (с «Свой период») и журнал действий `apps/web` работают с API:
настоящие цифры по охвату сотрудника, действующие настройки, уведомления владельцу и управляющим.

**Architecture:** миграция `owner-cabinet` (поля `tenant_settings`, таблицы `notifications`, `notification_reads`,
`notification_refresh`, право `notifications:view` существующим ролям). Настройки — `stores` (`GET/PUT /settings`);
журнал — контроллер и экспорт `AuditJournal` в `audit`; новые облачные модули `notifications` и `reports` читают
чужие данные через новые экспорты владельцев: `pos` — `SalesFigures`, `PosAlerts`; `returns` — `ReturnFigures`;
`inventory` — `StockAlerts`; `purchasing` — `SupplierDues`. Цена последнего прихода для экрана цен — порт
`PurchasePrices` модуля `pricing`, который заполняет `inventory` (как `ShiftReturns`). Уведомления обновляются при
чтении (не чаще раза в 5 минут, advisory-блокировка по тенанту).

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), node-pg-migrate SQL (только Up), RLS через
`tenantTransaction`; Next.js static export, TanStack Query, use-intl; Jest (только существующие наборы).

**Spec:** `docs/superpowers/specs/2026-10-14-owner-cabinet-design.md` — O1–O9, E1–E20, поправки 3.1, разделы 4–11
(PR 1: E1, E2, E4–E15, E17, разделы 5.1, 5.2, 5.4, 5.5, 6.1–6.4, 8 «PR 1»).

## Global Constraints

- Тесты отложены до MVP: новые автотесты не пишутся; существующие наборы (`api`, `api:integration`, `shared-dto`,
  `shared-domain`, `web`, `web-e2e`) адаптируются к новым контрактам и остаются зелёными. Проверка API и экранов —
  живая: curl-скрипт `oc_check.sh` в рабочей папке плана по образцу `pos_setup.sh` / `rt_check2.sh` (scratchpad
  сессии) и браузер (`api-web4210` + `web-partial-4210`; порты 4200/4201 не трогать; `api-web4210` раздаёт `dist` —
  перезапуск после сборки).
- Nx на Windows: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, по одному проекту (`--parallel=1`); Jest —
  `--testPathPatterns`; проверка типов — `npx tsc -b <tsconfig> --force`.
- Ветка `feature/owner-cabinet` от свежего `origin/main`. Коммиты — `git commit --no-gpg-sign` (решение пользователя
  2026-10-13), Conventional Commits, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Не коммитить
  `package.json`, `apps/web/next-env.d.ts`, `.claude/launch.json`, `.claude/agent-memory/`.
- Бизнес-дата — в часовом поясе сети (`tenant_settings.timezone`, по умолчанию `Asia/Dushanbe`), «сегодня» считает
  SQL (`(now() at time zone tz)::date`), как в существующих репозиториях.
- Деньги — integer дирамы; процент изменения выручки — одно десятичное (`Math.round(x * 10) / 10`).
- Охват: `principal.storeScope` (`'all'` или список id); точка запроса вне охвата — 403 `store_not_in_scope`; записи и
  уведомления без точки видит только охват `'all'`; суммы по себестоимости — только с `finance:view-cost`.
- Границы модулей (E17): `notifications` и `reports` не читают таблицы `pos`, `returns`, `inventory`, `purchasing` —
  только их новые экспорты; join к справочным `stores`, `employees`, `products`, `categories`, `batches`,
  `suppliers` — для названий. Граф: `pos`, `returns`, `inventory`, `purchasing` ← `notifications` ← `reports`;
  `audit` ← все; `pricing` объявляет `PurchasePrices`, `inventory` заполняет.
- Новых библиотек нет; фоновых задач нет (E11).
- Тексты интерфейса — RU и TJ (паритет ключей проверяет `messages.spec.ts`); сервер готовых фраз не отдаёт.

## Review Focus

1. Управляющий одной точки → главная, колокольчик и журнал не показывают другие точки и записи без точки
   (оплата поставщику другой точки, `settings.updated`, вход владельца без точки); `storeId` чужой точки — 403
   (Задачи 4–6, curl под управляющим).
2. Два одновременных `GET /notifications` в момент обновления → одно обновление, без дублей уведомлений и без
   взаимной блокировки (`pg_try_advisory_xact_lock` + частичный уникальный индекс `dedupe_key`) (Задача 5, два
   фоновых curl).
3. Границы бизнес-дня: продажа в 23:30 по Душанбе (18:30 UTC) и в 00:10 → разные дни на главной; «Неделя» — 7 дней
   с сегодняшним; «Месяц» 1-го числа — один день; `custom` 93 дня — 422 (Задача 6, curl с `occurredAt`).
4. Настройки меняются → эффект сразу, без ожидания 5 минут: `PUT /settings` сбрасывает `notification_refresh`;
   выключенный вид исчезает из колокольчика, порог сроков меняет «Истекает срок» и `batch_expiring` (Задачи 3, 5).
5. Без `finance:view-cost` → в уведомлении об оплате поставщику нет суммы, в журнале нет сумм списаний,
   инвентаризаций и приходов (суммы продаж, возвратов и смен — есть) (Задачи 4, 5).

---

### Task 1: Схема

**Files:**
- Create: `apps/api/migrations/<Date.now()>_owner-cabinet.sql`
- Modify: `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts`

**Interfaces:**
- Produces: `tenant_settings.warn_below_cost`, `tenant_settings.disabled_notifications`; таблицы `notifications`,
  `notification_reads`, `notification_refresh`; типы Kysely `Notifications`, `NotificationReads`,
  `NotificationRefresh`.

- [ ] **Step 0: ветка и документы** — `git fetch` и ветка `feature/owner-cabinet` от `origin/main`; коммит
  спецификации и плана `docs: owner cabinet — spec and PR 1 plan`.
- [ ] **Step 1: миграция** — по поправкам 3.1 п. 1–2 спецификации:
  - `tenant_settings`: `warn_below_cost boolean not null default true`; `disabled_notifications text[] not null default
    '{}'` с `check (disabled_notifications <@ array['batch_expiring','low_stock','supplier_payment_due',
    'transfer_in_transit','shift_discrepancy','negative_stock','sync_conflict','license_expiring']::text[])`;
  - `notifications`: `tenant_id`, `id uuid`, `kind` (тот же список), `store_id uuid null` (FK `stores`), `dedupe_key
    text`, `entity_type text null`, `entity_id uuid null`, `params jsonb not null default '{}'` (объект),
    `created_at timestamptz not null default now()`, `resolved_at timestamptz null`; PK `(tenant_id, id)`; уникальный
    `(tenant_id, dedupe_key) where resolved_at is null`; индексы `(tenant_id, created_at)`, `(tenant_id, store_id)`;
  - `notification_reads`: `tenant_id`, `notification_id`, `employee_id`, `read_at default now()`; PK
    `(tenant_id, notification_id, employee_id)`; FK на `notifications` и `employees`; индекс `(tenant_id, employee_id)`;
  - `notification_refresh`: `tenant_id` PK, `refreshed_at timestamptz null`, `events_after timestamptz not null default
    now()`;
  - RLS `enable` + `force`, политика `tenant_isolation` как у соседних таблиц; гранты `pharmacy_app`:
    SELECT/INSERT/UPDATE на `notifications` и `notification_refresh`, SELECT/INSERT на `notification_reads`;
  - право: `insert into role_permissions (tenant_id, role_id, permission) select tenant_id, role_id,
    'notifications:view' from role_permissions where permission = 'settings:view' on conflict do nothing`; затем
    `employees.permissions_version + 1` у сотрудников этих ролей.
- [ ] **Step 2: манифест** — три таблицы в `TABLE_CLASSES` класса `tenant` (не в `APPEND_ONLY_TABLES`).
- [ ] **Step 3: применить и типы** — `npx nx run api:migrate`, затем `npx nx run api:db-types`; Expected: миграция
  применена, в `db.generated.ts` новые интерфейсы и поля `TenantSettings.warnBelowCost`, `disabledNotifications`.
- [ ] **Step 4: регрессия** — `npx nx run api:integration`. Expected: зелёное (проверка манифеста в
  `catalog.int-spec.ts` проходит).
- [ ] **Step 5: коммит** — `feat(api): owner cabinet schema — settings fields, notifications`.

### Task 2: Контракт, домен и web на моках

**Files:**
- Modify: `libs/shared/domain/src/lib/{permissions.ts, permissions.spec.ts, role-templates.ts}`, `libs/shared/domain/src/index.ts`
- Create: `libs/shared/domain/src/lib/audit-groups.ts`
- Modify: `libs/shared/dto/src/lib/{tenant-home.ts, tenant-owner.ts, tenant-staff.ts, tenant-auth.ts}`
- Modify: `apps/web/src/pages/dashboard/ui/DashboardPage.tsx`, `apps/web/src/widgets/app-shell/ui/NotificationsBell.tsx`,
  `apps/web/src/entities/reminder/**`, `apps/web/src/pages/owner/settings/ui/SettingsPage.tsx`,
  `apps/web/src/pages/owner/audit-log/ui/AuditLogPage.tsx`, `apps/web/src/pages/pricing/ui/PricingDialogs.tsx`,
  `apps/web/src/shared/api/mocks/**` (`transport.ts`, `db.ts`, `db-owner.ts`, `handlers-owner.ts`,
  `handlers-staff.ts`, `session.ts`), `apps/web/src/shared/i18n/messages/{ru,tg}/{core,owner,home}.json` (где лежат
  затронутые ключи), `apps/web/specs/{shell.spec.tsx, owner.spec.tsx}`, `apps/web-e2e/src/support/fake-api.ts`

**Interfaces:**
- Produces (домен): модуль прав `notifications: ['view']` (`notifications:view` у шаблонов `owner` — весь каталог — и
  `manager`); `AuditGroup` (20 значений раздела 6.4 спецификации), `AUDIT_GROUP_RULES: readonly AuditGroupRule[]`,
  `interface AuditGroupRule { group: AuditGroup; actions?: readonly string[]; prefixes?: readonly string[];
  documentTypes?: readonly string[] }`, `auditGroupOf(action: string, details: Record<string, unknown>): AuditGroup |
  null`. Правила взаимно исключают друг друга (точные списки там, где у префикса есть исключения: `auth.*`,
  `employee.*`, `transfer.*`, `document.*`); строка подходит, если `action` в `actions` или начинается с одного из
  `prefixes`, и (если задано) `details.type` в `documentTypes`.
- Produces (DTO): `DashboardPeriod` + `'custom'`; `DashboardQuery { period; from?; to? }`; `TenantDashboard` + `from`,
  `to`, `recentActivity: TenantAuditEntry[]` (`ActivityEntry` удаляется); `NotificationKind` — 8 значений раздела
  6.3 (`ReminderKind` удаляется, `Reminder.kind: NotificationKind`); `ReminderParams` + `expiresOn`, `shiftNumber`;
  `TenantNotification` + `storeId: string | null`; `NetworkSettings.notifications: Record<NotificationKind,
  boolean>`; `UpdateNetworkSettingsRequest = Omit<NetworkSettings, 'networkName'>`; `AuditAction = AuditGroup`
  (реэкспорт из домена); `TenantAuditEntry { id; at; documentDate: string | null; employeeName: string | null;
  storeName: string | null; action: AuditAction | null; event: string; object: string | null; params:
  Record<string, string | number | null>; byOperator: boolean }`; `EmployeeSession.tenant.warnBelowCost: boolean`.

- [ ] **Step 1: домен** — права, шаблон `manager` + `notifications:view`, `audit-groups.ts` по разделу 6.4
  спецификации (все коды из отчёта разведки: `receipt.completed`, `return.completed`, `shift.*`, `document.*`,
  `transfer.*`, `transfer_request.*`, `stock_count.*`, `price.changed`, `discount_rule.*`, `markups.updated`,
  `product.*`, `category.*`, `supplier.*`, `payment.*`, `purchase_order.*`, `auth.*`, `access.denied`, `employee.*`,
  `role.*`, `store.*`, `legal-entity.*`, `terminal.*`, `settings.*`); в `permissions.spec.ts` — `notifications` в
  ожидаемом списке модулей.
- [ ] **Step 2: DTO** — по Interfaces; `npx tsc -b libs/shared/dto/tsconfig.lib.json --force` — Expected: ошибки
  только у потребителей в `apps/web`/`apps/api` (их чинят шаги 3–5 и задачи 3–6).
- [ ] **Step 3: экраны**:
  - дашборд: пункт `custom` («Свой период…») и две даты (`TextField type="date"`, `from` ≤ `to` ≤ сегодня, ≤ 92 дня;
    по умолчанию последние 7 дней), запрос с `from`/`to`, заголовок графика «Выручка по дням», журнал — через общий
    рендер записи журнала (шаг 4);
  - колокольчик: скрыт без `notifications:view`; тексты по `NotificationKind` (`reminder.<kind>.*` — новые
    `shift_discrepancy`, `negative_stock`; переименованные ключи `expiry` → `batch_expiring` и т. д. в настройках);
  - настройки: название сети `readOnly` с подсказкой «Название меняет оператор платформы»; тайм-аут 5–240;
    сохранение `withFreshAuth(() => apiRequest('settings.update', …))` без `networkName`; подсказка
    `warnBelowCostHint` — «При изменении цены»;
  - цены: `warningsOf` убирает `below_cost`, если `!session.tenant.warnBelowCost`;
  - журнал: фильтр — 20 групп; текст события — `auditEvents.<код с . и - → _>` с `params`, без перевода — название
    группы, без группы — код; `object` и `documentDate` («документ от …»).
- [ ] **Step 4: рендер записи журнала** — `entities/audit-entry` (`useAuditEntryText(entry): string`) для журнала и
  главной (FSD: используется двумя страницами).
- [ ] **Step 5: i18n RU/TJ** — группы журнала, `auditEvents.*` для всех кодов шага 1, виды уведомлений, тексты
  настроек, название модуля прав `notifications` и действия в редакторе ролей; паритет ключей.
- [ ] **Step 6: моки и e2e** — моки отдают новые формы (дашборд с `custom`, уведомления по `NotificationKind` с
  проверкой `notifications:view` и отметками по сотруднику, журнал `TenantAuditEntry` с `event`/`params`, настройки
  без смены названия, `session.tenant.warnBelowCost`); `fake-api.ts` — `GET /notifications` по новому контракту.
- [ ] **Step 7: спеки** — `shell.spec.tsx`, `owner.spec.tsx` под новые контракты и тексты (без новых тестов).
- [ ] **Step 8: проверка** — `npx nx run-many -t lint test --parallel=1 -p shared-domain shared-dto web`,
  `npx nx fsd web`, `npx tsc -b apps/web/tsconfig.json --force`. Expected: зелёное.
- [ ] **Step 9: коммит** — `feat(web): owner cabinet contracts on the mocks — custom period, notification kinds, audit
  groups, settings`.

### Task 3: Настройки сети и цена ниже закупочной

**Files:**
- Create: `apps/api/src/app/stores/{settings.controller.ts, settings.service.ts, dto/settings.dto.ts}`,
  `apps/api/src/app/pricing/purchase-prices.ts`, `apps/api/src/app/inventory/purchase-prices-source.ts`
- Modify: `apps/api/src/app/stores/{stores.module.ts, stores.repository.ts}`,
  `apps/api/src/app/auth/{employee-auth.repository.ts, session-profile.ts}`,
  `apps/api/src/app/pricing/{prices.service.ts, pricing.repository.ts, pricing.module.ts}`,
  `apps/api/src/app/inventory/inventory.module.ts`

**Interfaces:**
- Consumes: DTO Задачи 2; `AuditService`.
- Produces: `GET/PUT /settings`; `PurchasePrices` (`pricing`, экспорт): `register(source: PurchasePriceSource): void`,
  `lastPackCosts(trx: TenantTransaction, productIds: readonly string[]): Promise<Map<string, number>>`;
  `type PurchasePriceSource = (trx, productIds) => Promise<Map<string, number>>`; `stores.repository`
  `resetNotificationRefresh(trx)` — `update notification_refresh set refreshed_at = null`.

- [ ] **Step 1: DTO** — `UpdateNetworkSettingsDto`: `posSessionTimeoutMinutes` int 5–240, `minPinLength` int 4–8,
  `expiryNoticeDays` int 1–365, `warnBelowCost` boolean, `notifications` — объект, ровно 8 ключей `NotificationKind`
  с boolean (неизвестный или пропущенный ключ — 400 `validation_failed`, не 500).
- [ ] **Step 2: GET/PUT** — `GET /settings` (`settings:view`): `tenants.name`, `cashier_session_idle_min`,
  `pin_min_length`, `expiry_reminder_days`, `warn_below_cost`, `notifications` = все виды `true`, кроме
  `disabled_notifications`. `PUT /settings` (`settings:update`, `@RequireFreshAuth()`): upsert `tenant_settings`
  (`updated_at`, `updated_by`), `resetNotificationRefresh`, аудит `settings.updated` с `{ before, after }`
  (`entityType: 'tenant_settings'`, `entityId: tenantId`); ответ — `NetworkSettings`.
- [ ] **Step 3: профиль сессии** — `employee-auth.repository` читает `warn_below_cost` (по умолчанию `true` без
  строки), `session-profile` отдаёт `tenant.warnBelowCost`.
- [ ] **Step 4: цена последнего прихода** — `PurchasePrices` в `pricing` (экспорт), источник в `inventory`
  (`onModuleInit` регистрирует): по каждому товару — `batches.purchase_price_per_pack_dirams` партии с
  `origin = 'goods_receipt'` из последнего проведённого прихода (`documents.posted_at` desc). `prices.service`:
  `costMinor` из `lastPackCosts` (с `finance:view-cost`, иначе поля нет, как сейчас), `priceWarnings` получает
  `costMinor` только при `warn_below_cost`.
- [ ] **Step 5: сборка** — `npx nx run-many -t build lint --parallel=1 -p api`. Expected: зелёное.
- [ ] **Step 6: живая проверка** (`oc_check.sh`, раздел «настройки»): `GET`; `PUT` без свежего входа — 403
  `fresh_auth_required`, после `POST /sessions/current/confirmation` — 200 и запись `settings.updated`; тайм-аут 4 —
  422; ключ `notifications.foo` — 400; новая сессия получает новый тайм-аут (`idle` в профиле/куке), старый PIN
  входит после `minPinLength` 6, установка PIN из 4 цифр — 422 `pin_length`; цена ниже последнего прихода —
  `below_cost` при `warnBelowCost` и без него при выключенном; без `finance:view-cost` — нет `costMinor`.
- [ ] **Step 7: коммит** — `feat(api): network settings and the below-cost price warning`.

### Task 4: Журнал действий

**Files:**
- Create: `apps/api/src/app/audit/{audit-journal.repository.ts, audit-journal.controller.ts, audit-journal.ts, dto/audit-journal.dto.ts}`
- Modify: `apps/api/src/app/audit/audit.module.ts`; события документов: `apps/api/src/app/inventory/{posting.ts,
  write-off-posting.ts, stock-count-posting.ts, supplier-return-posting.ts, return-stock.ts, transfer-posting.ts,
  stock-documents.service.ts, write-offs.service.ts, supplier-returns.service.ts, transfers.service.ts,
  transfer-requests.service.ts}`

**Interfaces:**
- Consumes: `AUDIT_GROUP_RULES`, `auditGroupOf` (Задача 2).
- Produces: `GET /audit-log`; `AuditJournal` (экспорт `audit`): `recent(trx: TenantTransaction, limit: number,
  excludeGroups: readonly AuditGroup[]): Promise<TenantAuditEntry[]>` — по охвату текущего сотрудника.

- [ ] **Step 1: DTO** — `AuditJournalQueryDto`: `from`, `to` (YYYY-MM-DD, `@IsISO8601({ strict: true })`, по
  умолчанию последние 30 дней), `employeeId?`, `storeId?` (UUID), `action?` (`AuditGroup`), `q?` (≤ 100), `limit`
  1–100 (20), `offset` ≥ 0; `from` > `to` — 422 `validation_failed` (`range`).
- [ ] **Step 2: репозиторий** — `audit_log` за `from`…`to` (границы суток в часовом поясе сети, как
  `operator-audit.repository.ts:148-158`), охват (точка в охвате; `store_id null` — только `'all'`), фильтр группы —
  SQL-выражение из правил группы (`action in (…) or action like 'prefix%'`, `details->>'type' in (…)`), `q` — по
  `details->>'number'` и названию объекта; join `employees` (полное имя), `stores` (название); новые сверху; `total`.
- [ ] **Step 3: проекция записи** — `action` = `auditGroupOf`; `event` = код; `object` = `details.number`, иначе
  название сущности по `entity_type` (`product`, `category`, `employee`, `store`, `supplier`, `role` — на языке
  сотрудника); `params` — скалярные поля `details` (без `before`/`after`, `authorId`, `terminalId`, id); суммы
  (`totalMinor`, `amountMinor`) у групп `goods_receipt`, `write_off`, `stock_count`, `supplier_return`, `transfer`,
  `purchasing` — только с `finance:view-cost`; `documentDate` = `details.documentDate`, если отличается от
  `business_date` записи; `byOperator` = `acting_operator_id is not null`.
- [ ] **Step 4: дата документа в событиях** — события `document.*` и `transfer.*` пишут `documentDate`
  (`documents.document_date`) в `details`.
- [ ] **Step 5: контроллер и экспорт** — `GET /audit-log` (`audit:view`; `storeId` вне охвата — 403
  `store_not_in_scope`); `AuditJournal.recent` для главной. Контроллер регистрируется вместе с `AuditModule`
  (журнал точки доступен и офлайн).
- [ ] **Step 6: сборка** — `npx nx run-many -t build lint --parallel=1 -p api`. Expected: зелёное.
- [ ] **Step 7: живая проверка** (`oc_check.sh`, «журнал»): фильтры группы (`sale`, `write_off`, `unpost`,
  `settings_change`), сотрудник, точка, `q` по номеру; управляющий — без записей других точек и без записей без
  точки; без `finance:view-cost` — нет сумм списания, сумма продажи есть; задним числом проведённый приход —
  `documentDate`.
- [ ] **Step 8: коммит** — `feat(api): tenant audit journal`.

### Task 5: Уведомления

**Files:**
- Create: `apps/api/src/app/inventory/stock-alerts.ts`, `apps/api/src/app/purchasing/supplier-dues.ts`,
  `apps/api/src/app/pos/pos-alerts.ts`, `apps/api/src/app/notifications/{notifications.module.ts,
  notifications.repository.ts, notifications-refresh.ts, notifications.service.ts, notifications.controller.ts,
  reminders.ts, dto/notifications.dto.ts}`
- Modify: `apps/api/src/app/{inventory/inventory.module.ts, purchasing/purchasing.module.ts, pos/pos.module.ts,
  app.module.ts}`

**Interfaces:**
- Produces (экспорты владельцев; все методы — в транзакции тенанта, по списку точек или всем точкам сети):
  - `StockAlerts.lowStock(trx, storeIds?): Promise<{ storeId: string; positions: number }[]>` — ассортимент точки как
    на экране остатков (`stock.service.ts`), активный товар, `default_min_stock_pieces` > 0, остаток < минимума (E4);
  - `StockAlerts.expiringBatches(trx, thresholdDays: number, storeIds?): Promise<{ batchId; storeId; productId;
    productName: Json; lotNumber: string | null; expiryDate: string; qtyPieces: number; piecesPerPack: number }[]>` —
    остаток > 0, срок ≤ сегодня + порог (включая истёкшие);
  - `StockAlerts.transfersInTransit(trx, storeIds?): Promise<{ documentId; number; fromStoreId; toStoreId;
    positions: number }[]>`;
  - `SupplierDues.dueByStore(trx, untilDate: string, storeIds?): Promise<{ supplierId; supplierName; storeId;
    dueDate: string; amountMinor: number }[]>` — приходы с долгом > 0 и сроком ≤ `untilDate`, сгруппированы по
    поставщику × точке × сроку (`supplierDebt` в `libs/shared/domain/purchasing.ts`);
  - `PosAlerts.closedShiftsWithDiscrepancy(trx, after: Date): Promise<{ shiftId; storeId; number; discrepancyMinor;
    closedAt }[]>`;
  - `PosAlerts.shortfallsByDay(trx, after: Date): Promise<{ storeId; businessDate: string; lines: number }[]>` — по
    (точка, бизнес-дата) чеков, принятых после `after`, — полное число строк с `shortfall_pieces` > 0 за эту дату.
- Produces (`notifications`): `GET /notifications`, `POST /notifications/read-all`; `Reminders` (экспорт):
  `forDashboard(trx, limit: number): Promise<Reminder[]>` (видимые сотруднику, непрочитанные первыми);
  `NotificationsRefresh.run(trx): Promise<void>`.

- [ ] **Step 1: экспорты владельцев** — классы и методы по Interfaces, в `exports` своих модулей.
- [ ] **Step 2: обновление** — `NotificationsRefresh.run`: `notification_refresh` моложе 5 минут — выход;
  `pg_try_advisory_xact_lock(hashtextextended('notifications:' || tenant_id, 0))` не взят — выход; настройки
  (`disabled_notifications`, `expiry_reminder_days`, `supplier_payment_reminder_days`); для каждого включённого вида
  таблицы 5.4 спецификации: состояния — upsert по `dedupe_key` (`on conflict (tenant_id, dedupe_key) where
  resolved_at is null do update set params`), неснятые этого вида вне текущего набора — `resolved_at = now()`;
  события — факты после `events_after − 5 минут` (повтор безвреден благодаря ключу); `refreshed_at = now()`,
  `events_after` = время начала обновления. Параметры: `productName` — jsonb названия, `batchNumber`, `expiresOn`,
  `quantity` (упаковки), `storeName`, `supplierName`, `dueDate`, `amountMinor`, `documentNumber`, `fromStore`,
  `toStore`, `positions`, `shiftNumber`.
- [ ] **Step 3: видимость и чтение** — вид видим, если не выключен, у сотрудника `notifications:view` и право
  раздела (E10: `inventory:view` — `batch_expiring`, `low_stock`, `negative_stock`, `transfer_in_transit`;
  `purchasing:view` — `supplier_payment_due`; `shifts:view` — `shift_discrepancy`), точка в охвате или без точки при
  `'all'`. Список — неснятые состояния и события за 30 дней, новые сверху, `limit` 1–50, `unread`; при чтении:
  `productName` — на языке сотрудника, `days` = `expiresOn` − сегодня, `amountMinor` — только с `finance:view-cost`.
  `read-all` — `insert … select` видимых `on conflict do nothing`.
- [ ] **Step 4: контроллер и модуль** — `GET /notifications` и `POST /notifications/read-all`
  (`notifications:view`) сначала вызывают `run`; модуль импортирует `AuditModule`, `AuthModule`, `InventoryModule`,
  `PurchasingModule`, `PosModule`; облачный (`ConditionalModule.registerWhen(…, env => env.STORE_MODE !==
  'offline')`, как `ReturnsModule`).
- [ ] **Step 5: сборка** — `npx nx run-many -t build lint --parallel=1 -p api`. Expected: зелёное.
- [ ] **Step 6: живая проверка** (`oc_check.sh`, «уведомления»): партия в пороге → `batch_expiring`, после списания —
  снято; приход с отсрочкой → `supplier_payment_due` (без суммы без `finance:view-cost`); перемещение в пути — у
  получателя; закрытие смены с расхождением; продажа в минус; повтор в течение 5 минут не обновляет, после `PUT
  /settings` — обновляет; выключенный вид исчезает; два параллельных запроса (Review Focus 2) — без дублей;
  управляющий — только своя точка; кассир — 403; `read-all` — `unread` 0 только у этого сотрудника.
- [ ] **Step 7: коммит** — `feat(api): notifications — refresh on read, kinds, recipients, read marks`.

### Task 6: Главная

**Files:**
- Create: `apps/api/src/app/pos/sales-figures.ts`, `apps/api/src/app/returns/return-figures.ts`,
  `apps/api/src/app/reports/{reports.module.ts, dashboard.service.ts, dashboard.controller.ts, dashboard-period.ts,
  reports.repository.ts, dto/dashboard.dto.ts}`
- Modify: `apps/api/src/app/{pos/pos.module.ts, returns/returns.module.ts, app.module.ts}`

**Interfaces:**
- Consumes: `StockAlerts` (Задача 5), `Reminders` (Задача 5), `AuditJournal` (Задача 4).
- Produces: `GET /dashboard`; `SalesFigures.byStoreDay(trx, storeIds, from, to): Promise<{ storeId; businessDate;
  receipts: number; salesMinor: number }[]>`; `ReturnFigures.byStoreDay(trx, storeIds, from, to): Promise<{ storeId;
  businessDate; refundMinor: number }[]>`; `resolveDashboardPeriod(period, today, from?, to?): { from; to; prevFrom;
  prevTo; chartFrom; chartTo }` (`dashboard-period.ts`, чистая функция; ошибки — 422 по E1).

- [ ] **Step 1: экспорты** — `SalesFigures` (`pos`), `ReturnFigures` (`returns`) — суммы по точке и бизнес-дате.
- [ ] **Step 2: период** — `resolveDashboardPeriod` по E1 и E6: `today` → `today`…`today`, график — 7 дней;
  `week` → 7 дней с сегодняшним, график — они же; `month` → 1-е число…сегодня, график — они же; `custom` → `from`…`to`
  (оба обязательны, `to` ≤ сегодня, ≤ 92 дня), график — они же; предыдущий отрезок — той же длины перед `from`.
- [ ] **Step 3: главная** — `DashboardQueryDto` (`period` из 4 значений, `from`/`to` YYYY-MM-DD); `GET /dashboard`
  (`reports:view`): точки охвата — активные (`status = 'active'`) вида `pharmacy` (склады без продаж в таблицу не
  попадают), `mode` (`online` → `cloud`), `lastSyncAt` = null; KPI по E2 (выручка = продажи − возвраты; чеки; средний
  чек = продажи / чеки, 0 без чеков; изменение к предыдущему отрезку, `null` при нуле) и E4 (`lowStockItems` = Σ
  `positions` `StockAlerts.lowStock`; `expiringBatches` / `expiringCritical` — по `expiringBatches` с порогом сети
  и 7 днями); `revenueByDay` — каждый день графика, нули там, где продаж нет; `reminders` = `Reminders.forDashboard(5)`;
  `recentActivity` = `AuditJournal.recent(8, ['sign_in', 'access_denied'])`.
- [ ] **Step 4: модуль** — `ReportsModule` импортирует `AuditModule`, `AuthModule`, `PosModule`, `ReturnsModule`,
  `InventoryModule`, `NotificationsModule`; облачный, как `NotificationsModule`.
- [ ] **Step 5: сборка** — `npx nx run-many -t build lint --parallel=1 -p api`. Expected: зелёное.
- [ ] **Step 6: живая проверка** (`oc_check.sh`, «главная»): сценарий из двух точек (продажи со скидкой, возврат,
  продажа 23:30 и 00:10 по Душанбе через `occurredAt` в буфере) — выручка дня = Σ чеков − Σ возвратов, совпадает с
  итогами смены, открытой и закрытой в этот день; 4 периода; `custom` без дат — 400, 93 дня — 422, `to` в будущем —
  422; управляющий — только своя точка; кассир — 403.
- [ ] **Step 7: регрессия** — `npx nx run api:integration`. Expected: зелёное.
- [ ] **Step 8: коммит** — `feat(api): owner dashboard on real figures`.

### Task 7: Web на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES`), `apps/web/src/shared/api/error-message.ts`,
  `apps/web/src/shared/i18n/messages/{ru,tg}/*.json`

**Interfaces:**
- Consumes: маршруты Задач 3–6, контракт Задачи 2.

- [ ] **Step 1: маршруты** — в `REAL_API_ROUTES`: `dashboard.get`, `notifications.list`, `notifications.readAll`,
  `auditLog.list`, `settings.get`, `settings.update`.
- [ ] **Step 2: тексты ошибок** — `validation_failed` с `range` для периода и настроек — понятным текстом RU/TJ.
- [ ] **Step 3: браузер (`partial`)** — владелец: главная за 4 периода и свой период, пометки «Демо-данные» нет;
  колокольчик с настоящими уведомлениями и «прочитать все»; журнал с фильтрами и текстами событий на RU и TJ;
  настройки — сохранение с подтверждением пароля, выключенный вид уведомлений пропадает из колокольчика; цены — «Ниже
  закупочной» по настройке. Управляющий: только своя точка. Expected: как в спецификации, консоль без ошибок.
- [ ] **Step 4: проверка** — `npx nx run-many -t lint test --parallel=1 -p web`, `npx nx fsd web`,
  `npx nx e2e web-e2e`. Expected: зелёное.
- [ ] **Step 5: коммит** — `feat(web): owner cabinet — settings, notifications, dashboard, audit journal on the API`.

### Task 8: Документы

**Files:**
- Modify: `docs/architecture/data-model/{01-platform-org.md, 06-sync-audit-billing.md, README.md}`,
  `docs/architecture/c4/container.md`, `docs/architecture/APPROVAL.md`, `CLAUDE.md`

- [ ] **Step 1: модель данных** — `01`: `warn_below_cost`, `disabled_notifications` в `tenant_settings`; `06`:
  `notifications` по поправке 3.1 п. 2, `notification_reads`, `notification_refresh`, правило «обновление при
  чтении» (E11), события документов с `documentDate` (E8); `README`: классы новых таблиц. Пометка «Введено
  миграцией `owner-cabinet`».
- [ ] **Step 2: C4** — модули API: + «отчёты», «уведомления»; PNG не перегенерировать без нужды (описание в `.md`).
- [ ] **Step 3: APPROVAL.md** — строка 2026-10-14: спецификация кабинета владельца (O1–O9, E1–E20, поправки 3.1)
  утверждена архитектором.
- [ ] **Step 4: CLAUDE.md** — структура `apps/api` (+ `notifications`, `reports`); `web:dev-api`: «…, возвраты
  покупателей, главная, уведомления, журнал действий, настройки сети»; офлайн-точка: `notifications`, `reports` —
  только облако; граф модулей: `pos`, `returns`, `inventory`, `purchasing` ← `notifications` ← `reports`
  (`SalesFigures`, `PosAlerts`, `ReturnFigures`, `StockAlerts`, `SupplierDues`, `Reminders`, `AuditJournal`); порт
  `PurchasePrices` (`pricing`, заполняет `inventory`).
- [ ] **Step 5: коммит** — `docs: owner cabinet — data model, C4, approval, CLAUDE.md`.
