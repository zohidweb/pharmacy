# Дашборд и статистика админки на API — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Дашборд», «Статистика» и вкладка «Статистика» карточки компании админки работают на API: цифры по чекам — из
витрин, которые каждая сеть пересчитывает в своём контексте, остальное — из платформенных таблиц.

**Architecture:**
- Миграция: витрины `store_sales_daily`, `tenant_cashiers_monthly`, `tenant_stats_refresh` (класс `tenant-export`),
  индекс `receipts (tenant_id, created_at)`, колонка `kind` реестра точек видна платформе.
- Тенантский модуль `pos`: порт `StoreSalesExport.refresh(tenantId)` пересчитывает витрины сети по отметке (D4).
- `platform/billing`: порт `BillingOverview` (просроченные счета, сумма последнего месяца, заявки без решения).
- Новый модуль `app/platform/stats`: перед ответом пересчитывает сети, чей пересчёт старше 5 минут (по очереди, ошибка
  сети не роняет ответ), затем читает витрины и платформенные таблицы одной platform-транзакцией. Маршруты:
  `GET /operator/dashboard`, `GET /operator/usage-stats`, `GET /operator/tenants/{id}/stats`.
- Админка включает три маршрута в `REAL_API_ROUTES`, показывает «Данные на …», выгрузка неактивна, моки повторяют API.

**Tech Stack:** NestJS 11, Kysely + pg (RLS, `tenantTransaction`, `platformTransaction`), node-pg-migrate (SQL); Next.js
static export, TanStack Query, use-intl, `@pharmacy/ui`; Jest.

**Spec:** `docs/superpowers/specs/2026-10-19-admin-dashboard-stats-design.md` — решения D1–D16, раздел 3 (поправка
ADR-0013, п. 1–3), 4 (схема), 5 (пересчёт), 6 (показатели), 7 (контракт), 8 (админка), 12 (документы), 13 (проверка).

## Global Constraints

**Тесты.**
- Новых автотестов нет (правило «тесты до MVP»); долг — в описании PR (спецификация, 13).
- Существующие наборы зелёные: `api`, `admin`, `shared-dto`; тесты прежнего контракта переводятся на новый.
- API проверяется сквозным скриптом на временной базе (Задача 7), экраны — скриншотами `admin:dev-api` (Задача 7).

**База.**
- Миграция одна. Номер — `Date.now()` в момент создания; перед созданием сверить последние номера `origin/main`, всех
  `origin/*` и основной папки (там лежит неслитая `1792384238484_sync-local-catalog.sql` PR 2a синхронизации). Миграция
  ветки, слитой позже, должна иметь больший номер (`checkOrder`) — при конфликте перенумеровать при слиянии.
- Миграцию не применять к общим базам `pharmacy` и `pharmacy_test`; `api:integration` не запускать.
- Временная база `pharmacy_stats_check` (лаунчер `ops_env2.mjs` scratchpad, `OPS_DB`); старую `pharmacy_billing_check`
  удалить, когда PostgreSQL поднят. Docker Desktop выключен — попросить пользователя запустить, сам стек не поднимать.

**Окружение и git.**
- Только worktree `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/admin-dashboard-stats` без upstream.
- Коммиты — `git commit --no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier — только для файлов, отформатированных на `origin/main`, и для новых.

**Данные, время, права.**
- Деньги — целые дирамы (`bigint` в SQL, `number` в DTO); средний чек — `Math.round(sales / receipts)`, 0 при 0 чеков.
- «Сегодня» — `(now() at time zone 'Asia/Dushanbe')::date` в SQL, не дата JS; даты чеков — их `business_date`.
- Открытая точка — `status in ('active', 'closing')`, как в списке компаний; аптека — `kind = 'pharmacy'`; облако —
  `mode = 'online'`, офлайн — `mode <> 'online'`.
- Права: дашборд и статистика — `platform:view`, вкладка компании — `tenants:view` (`@RequireOperatorPermission`).
- Платформа не читает сырые тенантные таблицы (только реестр `stores`, витрины, платформенные таблицы); пересчёт — только
  в `tenantTransaction` под `pharmacy_app` в `runWithContext({ correlationId, tenantId, principal: null })`.
- Модули оператора — только в облаке (`ConditionalModule.registerWhen(…, env.STORE_MODE !== 'offline')`).

## Review Focus

1. **Поздний чек офлайн-точки за прошлый месяц.** Записан в облако сейчас (`created_at` — сейчас, `business_date` —
   прошлый месяц): прошлый месяц статистики и его кассиры меняются, текущий — нет. Проверка — Задачи 3, 7.
2. **Два запроса одновременно.** Один пересчитывает сеть, второй читает витрину без ожидания; ни `23505`, ни deadlock,
   ни двойного счёта. Проверка — Задачи 3, 7.
3. **Сеть без чеков и сеть, которую не удалось пересчитать.** Нули без ошибки; `asOf` — самое старое из показанных
   пересчётов; ошибка одной сети — 200 с прежними данными. Проверка — Задачи 5, 7.
4. **Граница суток Душанбе.** Чек в 23:30 по Душанбе — в своей бизнес-дате; 14 дней графика кончаются сегодняшней
   датой Душанбе, даже когда в UTC уже/ещё другой день. Проверка — Задачи 5, 7.
5. **Изоляция.** `pharmacy_platform` получает 42501 на `receipts` и читает витрины; `pharmacy_app` сети видит только свои
   строки витрин; склад не попадает ни в плитку, ни в статистику. Проверка — Задача 7.

---

### Task 1: Контракт

**Files:**
- Modify: `libs/shared/dto/src/lib/platform-system.ts`, `libs/shared/dto/src/lib/platform-tenants.ts`.
- Modify (только чтобы админка компилировалась): `apps/admin/src/shared/api/mocks/handlers-system.ts`,
  `apps/admin/src/shared/api/mocks/db.ts` (`mockStats`), `apps/admin/src/shared/api/routes.ts` (тип запроса
  `usage.stats`).

**Interfaces:**
- Produces:
  - `DashboardSummary.accruedPeriod: string | null` (`YYYY-MM`); комментарий `accruedMinor` — «The invoices of the last
    invoiced period, with VAT (D12)».
  - `DashboardResponse.asOf`, `UsageStatsResponse.asOf`, `TenantStats.asOf`: `string | null` — ISO-время самого старого
    пересчёта показанных сетей (D7).
  - `UsageStatsQuery { period: string; tenantId?: string }` в `platform-system.ts`; маршрут `usage.stats` в
    `routes.ts` берёт его как тип запроса.
  - Комментарии полей: `salesMinor` — сумма чеков, возвраты не вычитаются (D8); `activeCashiers` — разные кассиры с
    чеками за месяц (D9); `lastActivityAt` — D10.

- [ ] **Step 1: Контракт** по Interfaces.
- [ ] **Step 2: Моки компилируются:** `asOf: new Date().toISOString()`, `accruedPeriod` — период последних счетов мока.
  Смысл моков — Задача 6.
- [ ] **Step 3: Проверка.** `npx nx run-many -t lint test typecheck -p shared-dto admin`.
  Expected: зелёные (api не затронут).
- [ ] **Step 4: Коммит** `feat(dto): dashboard and statistics — asOf, accruedPeriod, usage stats query`.

### Task 2: Миграция витрин

**Files:**
- Create: `apps/api/migrations/<ms>_admin-stats.sql`.
- Modify: `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts`,
  `docs/architecture/data-model/06-sync-audit-billing.md`, `04-pos.md`, `01-platform-org.md`, `README.md`,
  `docs/architecture/glossary.md`.

**Interfaces:**
- Produces (схема — спецификация, раздел 4, дословно):
  - `store_sales_daily` (`tenant_id`, `store_id`, `business_date`, `receipts_count`, `sales_dirams`, `last_sold_at`,
    `computed_at`), ключ `(tenant_id, store_id, business_date)`, FK `(tenant_id, store_id)` → `stores`, индекс
    `store_sales_daily_date_idx (business_date)`;
  - `tenant_cashiers_monthly` (`tenant_id`, `month`, `active_cashiers`, `computed_at`), ключ `(tenant_id, month)`,
    `check (extract(day from month) = 1)`;
  - `tenant_stats_refresh` (`tenant_id` — ключ и FK → `tenants`, `refreshed_at`);
  - RLS `enable` + `force`, политики `tenant_isolation for all to pharmacy_app` и `platform_read for select to
    pharmacy_platform using (true)` — по образцу `store_usage_monthly` (`1792052930122_billing-invoices.sql`, строки
    183–222); гранты `pharmacy_app` — `select, insert, update`, `pharmacy_platform` — `select`;
  - `create index receipts_created_idx on pharmacy.receipts (tenant_id, created_at)` (D16, под `set local lock_timeout =
    '5s'` в начале файла);
  - `grant select (kind) on pharmacy.stores to pharmacy_platform` (раздел 3, п. 3);
  - `table-classes.ts`: три таблицы — `'tenant-export'`.

- [ ] **Step 1: Номер миграции.** Сверить номера (Global Constraints, «База»); записать в ledger найденный максимум.
- [ ] **Step 2: Миграция** по Interfaces; шапка-комментарий — ссылка на спецификацию и D1, D16, раздел 3.
- [ ] **Step 3: Временная база.** Создать `pharmacy_stats_check`, применить все миграции (`ops_env2.mjs` +
  `node apps/api/scripts/migrate.mjs`), затем `kysely-codegen` (`OPS_CWD=apps/api`) и `--verify`.
  Expected: миграция применена; в `db.generated.ts` три новых интерфейса; `--verify` чистый.
- [ ] **Step 4: Модель данных.**
  - `06` — три таблицы вместо строки `tenant_stats_daily`, со ссылкой на поправку ADR-0013 2026-10-19;
  - `README.md` — список класса `tenant-export`;
  - `04-pos.md` — индекс `receipts (tenant_id, created_at)` и его назначение (D4);
  - `01-platform-org.md` — колонки `stores`, видимые платформе, + `kind`;
  - `docs/architecture/glossary.md`, «Витрина тенанта» — вместо «счётчики без ПДн и сумм позиций»: «продажи аптек по
    дням (число и сумма чеков) и число кассиров по месяцам — без сумм позиций, ПДн и идентификаторов сотрудников».
- [ ] **Step 5: Проверка.** `npx tsc -b apps/api/tsconfig.json`; `node tools/scripts/check-docs.mjs`; тест
  `catalog.int-spec` не запускается (интеграционный) — сверка классов: роль платформы видит ровно `select` на трёх
  таблицах (`\dp` во временной базе).
- [ ] **Step 6: Коммит** `feat(api): statistics marts of the admin — store sales by day, cashiers by month, refresh time`.

### Task 3: Порт `StoreSalesExport` (`pos`)

**Files:**
- Create: `apps/api/src/app/pos/store-sales-export.ts`, `apps/api/src/app/pos/store-sales-export.repository.ts`.
- Modify: `apps/api/src/app/pos/pos.module.ts` (провайдеры и `exports`, комментарий экспорта).

**Interfaces:**
- Consumes: таблицы Задачи 2.
- Produces:
  - `StoreSalesExport.refresh(tenantId: string): Promise<void>` — одна `tenantTransaction` в `runWithContext`, как
    `StoreUsage.refresh` (`apps/api/src/app/billing/store-usage.ts`); экспортируется `PosModule`.
  - `StoreSalesExportRepository`:
    - `tryLock(trx, tenantId): Promise<boolean>` — `pg_try_advisory_xact_lock(hashtextextended('platform-stats:' ||
      tenantId, 0))` (D6); `false` — `refresh` выходит без изменений;
    - `since(trx, tenantId): Promise<string | null>` — `refreshed_at − interval '10 minutes'` или `null`;
    - `refreshDays(trx, tenantId, since: string | null): Promise<string[]>` — один запрос: затронутые пары `(store_id,
      business_date)` чеков с `created_at >= since` (все — при `null`) → агрегат `count(*)`, `sum(total_dirams)`,
      `max(sold_at)` по этим парам → `insert … on conflict (tenant_id, store_id, business_date) do update` (с
      `computed_at = now()`); возвращает затронутые месяцы `YYYY-MM-01` без повторов;
    - `refreshCashiers(trx, tenantId, months: readonly string[]): Promise<void>` — для каждого месяца
      `count(distinct cashier_id)` чеков сети с `business_date` в месяце → upsert `tenant_cashiers_monthly`;
    - `markRefreshed(trx, tenantId): Promise<void>` — upsert `tenant_stats_refresh.refreshed_at = now()`.
  - Все запросы — с `tenant_id = ${tenantId}` (RLS — второй рубеж).

- [ ] **Step 1: Репозиторий и порт** по Interfaces; порядок шагов — спецификация, раздел 5.
- [ ] **Step 2: `PosModule`:** провайдеры и экспорт `StoreSalesExport`; в комментарии экспорта — «the statistics marts
  of the admin (spec 2026-10-19-admin-dashboard-stats, `pos` ← `platform/stats`)».
- [ ] **Step 3: Проверка.** `npx nx run-many -t lint test typecheck -p api`.
  Expected: зелёные. Поведение пересчёта (отметка, запас, поздние чеки, параллельные запросы) проверяется в Задаче 7
  через маршруты Задачи 5.
- [ ] **Step 4: Коммит** `feat(api): pos exports the refresh of the statistics marts`.

### Task 4: Порт `BillingOverview` (`platform/billing`)

**Files:**
- Create: `apps/api/src/app/platform/billing/billing-overview.ts`.
- Modify: `apps/api/src/app/platform/billing/platform-billing.module.ts` (провайдер, `exports: [BillingOverview]`),
  `invoices.repository.ts` (два запроса). `ServiceOrdersRepository.pendingRequests` уже сортирует по `requestedAt`, `id`
  — без изменений.

**Interfaces:**
- Produces (`BillingOverview`, все методы принимают platform-транзакцию `trx: Transaction<DB>`):
  - `lastInvoicedPeriod(trx): Promise<{ period: string; totalMinor: number } | null>` — наибольший `period_month`
    среди счетов, сумма их `total_dirams` (как `issued` в `InvoicesRepository.summary`); `period` — `YYYY-MM`;
  - `overdueInvoices(trx, today: string): Promise<Array<{ id: string; tenantId: string; tenantName: string; number:
    string; remainingMinor: number; dueOn: string }>>` — условие фильтра «Просрочены» (`paid_dirams < total_dirams and
    due_on < today`), по `due_on`, затем `number`;
  - `pendingRequests(trx): Promise<ServiceRequestItem[]>` — `ServiceOrdersRepository.pendingRequests`, по
    `requestedAt` (старые первыми).

- [ ] **Step 1: Порт** по Interfaces; условие просрочки — то же выражение, что `filterSql('overdue')`, без копии
  (вынести в одну функцию модуля, если она приватная).
- [ ] **Step 2: Проверка.** `npx nx run-many -t lint test typecheck -p api`.
  Expected: зелёные.
- [ ] **Step 3: Коммит** `feat(api): platform billing exports its overview for the dashboard`.

### Task 5: Модуль `platform/stats`

**Files:**
- Create в `apps/api/src/app/platform/stats/`: `platform-stats.module.ts`, `stats.repository.ts`, `stats.service.ts`,
  `stats.controller.ts`, `dto/usage-stats.dto.ts`.
- Modify: `apps/api/src/app/app.module.ts` (регистрация в облаке), `CLAUDE.md` (граф модулей, список `admin:dev-api`).

**Interfaces:**
- Consumes: `StoreSalesExport.refresh` (Задача 3), `BillingOverview` (Задача 4), `PlatformDatabase.platformTransaction(
  { kind: 'operator', operatorId: requireOperator().operatorId }, work)`.
- Produces:
  - `UsageStatsQueryDto implements UsageStatsQuery`: `period` — `@Matches(/^\d{4}-(0[1-9]|1[0-2])$/)`; `tenantId` —
    `@IsOptional() @IsUUID()`. Период раньше `2026-01` или позже текущего месяца — 400 `validation_failed` (в сервисе,
    поле `period`).
  - `StatsController` (`@Controller({ path: 'operator', version: '1' })`):
    - `@Get('dashboard')` `platform:view` → `DashboardResponse`;
    - `@Get('usage-stats')` `platform:view` → `UsageStatsResponse`;
    - `@Get('tenants/:id/stats')` `tenants:view`, `ParseUUIDPipe` → `TenantStats`; неизвестная сеть — 404 `not_found`.
  - `StatsService`:
    - `private refresh(tenantIds: readonly string[] | null): Promise<void>` — `StatsRepository.staleTenants` → для
      каждой `StoreSalesExport.refresh`; ошибка — `Logger.warn` с кодом/именем ошибки, `correlationId` и id сети, цикл
      продолжается (D7);
    - `dashboard()`, `usage(query)`, `tenant(id)` — сначала `refresh`, затем одна `platformTransaction` чтения.
  - `StatsRepository` (platform-транзакция; только реестр `stores` с колонками, видимыми платформе, + `kind`, витрины,
    `tenants`, `license_keys`, `store_sync_status`):
    - `today(trx): Promise<string>`;
    - `staleTenants(trx, ids: readonly string[] | null): Promise<string[]>` — сети без строки `tenant_stats_refresh` или с
      `refreshed_at < now() − interval '5 minutes'`;
    - `asOf(trx, ids: readonly string[] | null): Promise<string | null>` — `min(refreshed_at)` по сетям (сети без строки
      не участвуют; нет строк — `null`);
    - `counts(trx)` — `tenants`, `activeTenants`, `cloudStores`, `offlineStores` (открытые аптеки, Global Constraints);
    - `salesByDay(trx, from: string, to: string, tenantId: string | null): Promise<Array<{ date: string; salesMinor:
      number }>>` — все 14 дат (`generate_series`), пустые — 0;
    - `usageRows(trx, month: string, tenantId: string | null)` — аптеки (открытые + закрытые с чеками в месяце) с
      `receipts`, `sales`, `lastActivityAt` (D10: облако — `max(last_sold_at)` по всем строкам точки; офлайн —
      `store_sync_status.last_success_at`), сеть, режим;
    - `cashiers(trx, month: string, ids: readonly string[] | null): Promise<Map<string, number>>`;
    - `expiringKeys(trx, today)` — действующие ключи открытых офлайн-аптек с `valid_until < now() +
      notify_before_days дней` (и истёкшие), `days` = дата окончания по Душанбе − `today`; по `valid_until`;
    - `staleStores(trx, today)` — открытые офлайн-аптеки, где `coalesce(last_success_at, выдача первого действующего
      ключа) < now() − interval '7 days'`; `days` = `today` − та дата по Душанбе; старые первыми;
    - `tenantExists(trx, id): Promise<boolean>`.
  - Очередь (D13, D14): счета → ключи → синхронизация → заявки, первые 20; `target` — `{ screen: 'tenant', id }` для
    первых трёх, `{ screen: 'services' }` для заявок; `id` пункта — `invoice:<id>`, `key:<id>`, `sync:<storeId>`,
    `request:<id>`. `attention` — полные числа каждого вида.
  - `PlatformStatsModule`: `imports: [PlatformDatabaseModule, PlatformBillingModule, PosModule]`, регистрация в
    `AppModule` — `ConditionalModule.registerWhen(PlatformStatsModule, (env) => env.STORE_MODE !== 'offline')`.

- [ ] **Step 1: Репозиторий, сервис, контроллер, DTO** по Interfaces; показатели — спецификация, раздел 6.
- [ ] **Step 2: `AppModule`** и проверка архитектурного теста (`core/database/architecture.spec.ts`: `PlatformDatabase`
  только в `app/platform/**`).
- [ ] **Step 3: `CLAUDE.md`.** В абзац графа модулей: «статистика админки — `app/platform/stats`: `pos` отдаёт ей
  `StoreSalesExport` (пересчёт витрин сети), `platform/billing` — `BillingOverview`»; в список готовых маршрутов
  `admin:dev-api` — «дашборд, статистика».
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test typecheck -p api`; `npx nx build api`.
  Expected: зелёные, сборка есть.
- [ ] **Step 5: Коммит** `feat(api): operator dashboard and usage statistics from the marts`.

### Task 6: Админка

**Files:**
- Create: `apps/admin/src/shared/ui/AsOfNote.tsx` (экспорт из `shared/ui/index.ts`).
- Modify: `apps/admin/src/shared/api/client.ts` (`REAL_API_ROUTES`), `apps/admin/src/pages/dashboard/ui/DashboardPage.tsx`,
  `apps/admin/src/pages/statistics/ui/StatisticsPage.tsx`, `apps/admin/src/pages/company/ui/CompanyTabs.tsx`
  (`StatsTab`), `apps/admin/src/shared/api/mocks/handlers-system.ts`, `apps/admin/src/shared/api/mocks/db.ts`,
  `apps/admin/src/shared/api/mocks/db-system.ts` (если там пороги/очередь), `apps/admin/src/shared/i18n/messages/ru.json`,
  `tg.json`.

**Interfaces:**
- Consumes: контракт Задачи 1.
- Produces:
  - `AsOfNote({ at }: { at: string | null })` — `null` → ничего; сегодня — «Данные на {time}», иначе — «Данные на {date}
    {time}» (время и дата через `useFormatter`, 24 ч); тексты `shell.asOf.today`, `shell.asOf.earlier`.
  - `REAL_API_ROUTES` += `dashboard.get`, `usage.stats`, `tenants.stats`.

- [ ] **Step 1: Экраны.**
  - Дашборд: `AsOfNote` над плитками; подсказка «Выставлено за период» — `kpi.accruedHint` с месяцем
    `accruedPeriod` («{month}, с НДС»), `null` — `kpi.accruedNone` («счетов ещё нет»); `salesHint` — «Сумма чеков всех
    аптек по дням; возвраты не вычитаются».
  - Статистика: `AsOfNote` над плитками; кнопка «Выгрузить в Excel» — `Button` `disabled` с `aria-describedby` и
    строкой `statistics.exportPending` («Выгрузка появится позже») в обоих режимах, ссылка на
    `/operator/usage-stats/export` и тост мока удаляются; `note` дополняется «Продажи — сумма чеков, возвраты не
    вычитаются».
  - Вкладка компании: `AsOfNote` над плитками.
- [ ] **Step 2: Моки — как API.** Порог синхронизации 7 дней; истёкшие ключи в очереди (`days` < 0); пункты ключей и
  синхронизации — `{ screen: 'tenant', id: tenantId }`; порядок и предел 20 очереди; `accruedPeriod`; склады не
  считаются точками и не попадают в строки статистики; `asOf` — сейчас.
- [ ] **Step 3: Тексты RU и TJ** — новые ключи в обоих файлах.
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test typecheck fsd -p admin`; `npx nx build admin`.
  Expected: зелёные (`messages.spec.ts` — паритет ключей).
- [ ] **Step 5: Коммит** `feat(admin): dashboard, statistics and the company statistics on the API`.

### Task 7: Сквозная проверка, документы, PR

**Files:**
- Create (scratchpad, не в PR): `stats_live.mjs` — на основе `billing_pr2_lib.mjs` / `billing_seed.mjs`.
- Create: `.superpowers/pr-admin-dashboard-stats.md`.

- [ ] **Step 1: Стенд.** Docker поднят (иначе — попросить пользователя); удалить `pharmacy_billing_check`; временная
  база Задачи 2; собранный API на `:4318` (`ops_env2.mjs`, `OPS_DB=pharmacy_stats_check`).
- [ ] **Step 2: Сценарий** — спецификация, 13, полностью, плюс Review Focus 1–5:
  - две сети; в первой — облачная аптека, офлайн-аптека (режим и ключ — SQL и `issue-license-key.mjs`), склад; во
    второй — облачная аптека; чеки за прошлый и текущий месяц и сегодня (`seedReceipts`), два кассира;
  - сверка графика, статистики и вкладки с суммами из базы до дирама; склад не виден;
  - второй запрос в пределах 5 минут не меняет `tenant_stats_refresh`; после сдвига `refreshed_at` на 6 минут назад
    новый чек виден;
  - чек с `business_date` прошлого месяца, вставленный сейчас, меняет прошлый месяц и его кассиров (Focus 1);
  - два параллельных запроса дашборда — оба 200, суммы верны (Focus 2);
  - сеть без чеков — нули, `asOf` не `null` (Focus 3);
  - чек `sold_at` 23:30 Душанбе — в своей дате (Focus 4);
  - очередь: просроченный счёт, ключ за 3 дня и истёкший, офлайн-аптека без синхронизации 8 дней и 6 дней (нет),
    заявка; плитка = очереди; 21 пункт — 20 в очереди (Focus из спецификации);
  - `pharmacy_platform`: `select` из `receipts` — 42501, из витрин — строки; `pharmacy_app` с контекстом сети — только
    свои строки (Focus 5);
  - 404 неизвестной сети (вкладка и `tenantId` статистики), 400 `period=2025-12`, `2026-13`, будущий месяц; 403 без
    прав (оператор без `platform:view` — если такой роли нет, пропустить с записью в ledger).
- [ ] **Step 3: Экраны.** `npx nx run admin:dev-api` против стенда: дашборд, статистика, вкладка компании — скриншоты RU
  и TJ (Playwright, установленный Chrome), без горизонтальной прокрутки на 1280×800.
- [ ] **Step 4: Полный прогон затронутого.** `npx nx run-many -t lint test typecheck fsd -p api admin shared-dto`,
  `check-docs`, `npx nx sync:check`.
- [ ] **Step 5: Ревью ветки** — агенты `nestjs-reviewer` и `postgresql-database-reviewer` (только чтение); существенное —
  исправить, повторить сценарий; мелкое — в ledger и в PR.
- [ ] **Step 6: PR-текст** `.superpowers/pr-admin-dashboard-stats.md`: что сделано, ссылка на спецификацию и поправку
  ADR-0013, как проверено, порядок миграций с PR 2a синхронизации, долг по тестам (спецификация, 13), просьба прогнать
  `api:migrate`, `api:db-types-verify`, `api:integration`, api-e2e, web-e2e. Удалить временную базу, остановить API.
- [ ] **Step 7: Коммит документов, пуш** `git push -u origin feature/admin-dashboard-stats:feature/admin-dashboard-stats`;
  ссылка compare, заголовок, файл описания — пользователю.
