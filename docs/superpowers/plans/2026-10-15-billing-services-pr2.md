# Биллинг и услуги, PR 2: счета и платежи — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** оператор на API формирует счета сетей за месяц, пересчитывает неоплаченные, вносит, правит и отменяет
платежи с распределением по счетам, ведёт скидки сети и видит долг и аванс в списке и карточке сети.

**Architecture:**
- Одна миграция:
  - `store_usage_monthly` (tenant-export);
  - `invoices`, `invoice_lines`, `tenant_payments`, `tenant_payment_allocations`, `tenant_discounts` (platform);
  - `tenants.billing_advance_dirams`, `tenant_services.request_hash`.
- Тенантский модуль `app/billing` экспортирует порт `StoreUsage`: пересчёт активности точек за месяц в контексте сети.
  Платформенный модуль `app/platform/billing` вызывает его по очереди для каждой сети (`billing` → `platform/billing`).
- Формулы (A2, A3, A4) и распределение платежей (A7) — чистые функции в `libs/shared/domain`. Ими считают и API, и
  моки админки.
- Строки на таблицах платформы не удаляются (B18): снятие строки и скидки — `removed_at`, распределения — обновление
  на месте.
- Админка переходит на эти маршруты; кабинет владельца не меняется (PR 3).

**Tech Stack:** NestJS 11, class-validator, Kysely + pg (CamelCasePlugin), node-pg-migrate (SQL, только Up), RLS
(`tenantTransaction`, `PlatformDatabase.platformTransaction`, `runWithContext`); Next.js static export, TanStack Query,
React Hook Form + zod, use-intl, `uuid` (`uuidv7` из `@pharmacy/shared-util`), `@pharmacy/ui`; Jest.

**Spec:** `docs/superpowers/specs/2026-10-15-billing-services-design.md`. Разделы:
- PR 2 по разделу 13;
- B1, B2, B4–B6, B10, B12–B15, B17, B18; A1–A11 (без печати), A13 (счёт), A15;
- 3.1 п. 3, 4, 8, 9; 3.2; 4 (все таблицы, кроме PR 1); 5;
- 6.1 — счета, платежи, скидки, вкладки сети, долг и аванс в списке; 7 и 8 — те же части; 10 (счета, платежи, скидки);
  11; 14; 15.

Вне PR 2 (PR 3): «Оплата» владельца (`GET billing`), страницы печати, уведомление `invoice_overdue`.

## Global Constraints

**Тесты.**
- Новых автотестов нет: правило проекта «тесты до MVP». Долг перечисляется в описании PR.
- Существующие наборы остаются зелёными: `api`, `admin`, `web`, `shared-dto`, `shared-domain`. Тесты админки, которые
  проверяют прежний контракт, переводятся на новый.
- API проверяется сквозным скриптом на временной базе (Задача 9), экраны — временными экранными тестами на моках
  (в PR не входят).
- Контракт меняется в Задаче 1, а админка компилируется снова только после Задачи 8. Задачи 1–7 проверяют `api`,
  `shared-dto`, `shared-domain` и `web`.

**База.**
- Миграции **не применять** к общим базам `pharmacy` и `pharmacy_test`; `api:integration` не запускать.
- Перед созданием миграции проверить номера:
  - в других ветках: `git diff --name-only origin/main...<ветка> -- apps/api/migrations`;
  - на общих базах: `select name from public.pgmigrations order by id desc limit 3`.
  
  Номер новой миграции — больше всех найденных.
- Тело миграции — проверка на dev в `begin; … rollback;`.
- Полный прогон — на временной базе `pharmacy_billing_check`, как в PR 1:
  - база создаётся суперпользователем, затем выполняется `02-database.sql`;
  - миграции — `node apps/api/scripts/migrate.mjs` через лаунчер scratchpad;
  - `kysely-codegen --verify`;
  - после проверки база удаляется.
- На таблицах класса `platform` у `pharmacy_platform` — только `SELECT`, `INSERT`, `UPDATE` (B18, тест каталога).
  Никакого `DELETE` в SQL платформы.

**Окружение и git.**
- Только worktree `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/billing-invoices`, без upstream.
- Коммиты — `git commit --no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Скрипты с кавычками и кириллицей — инструментом Write. Prettier — только для файлов, уже отформатированных на
  `origin/main`, и для новых.

**Деньги, проценты, даты.**
- Суммы — целые дирамы: в контракте `…Minor`, в БД `…_dirams bigint`. Платёж — 1 … 10 000 000 000.
- Скидка и НДС в БД — базисные пункты (`…_bp`). Скидка в контракте — `percentBp` 100…10 000; НДС —
  `vatRatePercent` (как в PR 1).
- Период в контракте — `YYYY-MM`, в БД — `date` 1-го числа. Даты — `YYYY-MM-DD`.
- «Сегодня» и календарь — `Asia/Dushanbe`, в SQL: `(now() at time zone 'Asia/Dushanbe')::date`. API не зависит от
  `@pharmacy/shared-util` (из-за синхронизации Nx, см. ledger PR 1).
- Округление — только функциями Задачи 1 (half up в целых дирамах, расчёт через `BigInt`).

**Конкурентность.**
- Любое изменение денег сети берёт `select … from pharmacy.tenants where id = $1 for update` первым. Порядок блокировок:
  1. advisory-блокировка периода (только формирование);
  2. строки `tenants` по возрастанию `id`;
  3. строки счетов и платежей.
- Распределение (A7) пересчитывается в той же транзакции, что и изменение.

**Права (A15).**
- Чтение — `tenants:view`. Счета, платежи, скидки, услуги сетей — `tenants:manage`.
- Скидки (`POST`, `PATCH`, `DELETE`) — ещё и `@RequireFreshAuth()`. Платежи — без step-up.

**Журнал платформы** (`platform_audit_log`, с `tenantId`):
- `invoice.generated` — на каждый счёт, `details: { number, period, totalMinor }`;
- `invoice.recalculated` — `{ beforeMinor, afterMinor }`;
- `payment.recorded`, `payment.updated` (`details.previous` — прежние сумма, дата, способ), `payment.cancelled`;
- `tenant.discount-added`, `tenant.discount-shortened`, `tenant.discount-removed`.

В `details` нет комментариев и причин: свободный текст хранится в строке платежа.

**Ошибки** — раздел 11 спецификации. Плюс 409 `idempotency_conflict` у добавления услуги сети (B17) и 400
`validation_failed` с кодами полей:
- `future` — дата платежа;
- `order` — `toMonth` раньше `fromMonth`;
- `not_shorter` — продление скидки (продлить = новая скидка);
- `period` — неверный период.

## Review Focus

1. **Платёж во время формирования или пересчёта.** Оператор вносит платёж, пока другой формирует счета той же сети.
   Ожидание: после обеих операций Σ активных платежей сети = Σ `paid_dirams` её счетов + аванс, и ни один счёт не
   оплачен сверх итога. Проверка — Задача 9, параллельные запросы.
2. **Повторное и параллельное формирование.** Две вкладки нажимают «Сформировать» за один период. Ожидание: у каждой
   сети не больше одного счёта, номера `СЧ-ГГГГ-ММ-NNN` идут без дыр и повторов, второй ответ — `created: 0`.
   Проверка — Задача 9.
3. **Правка и отмена платежа.**
   - Итог распределения тот же, как если бы платёж сразу внесли правильно.
   - Платёж, направленный на счёт, который тем временем оплатил другой платёж, закрывает самые старые.
   - Аванс уходит в 0, а не в минус.
   - Проверка — Задачи 5, 9.
4. **Границы дней и сроков.**
   - Первая продажа 20-го в 31-дневном месяце — 12 дней. Закрытие 10-го — 10 дней.
   - Точка, продававшая в прошлом месяце, — весь месяц.
   - Формирование в 00:30 3-го числа по Душанбе (19:30 UTC 2-го) уже разрешено.
   - Срок — 15-е следующего месяца, но не раньше выставления + 10 дней.
   - Проверка — Задачи 1, 4, 9.
5. **Скидка задним числом и её границы.**
   - Скидка на уже выставленный месяц попадает в счёт только при пересчёте неоплаченного счёта.
   - Пересечение сроков — 409.
   - Сокращение раньше последнего выставленного месяца и удаление попавшей в счёт — 409 `discount_invoiced`.
   - Проверка — Задачи 6, 9.

---

### Task 1: Контракт и формулы

**Files:**
- Modify:
  - `libs/shared/dto/src/lib/platform-billing.ts`;
  - `libs/shared/dto/src/lib/platform-tenants.ts`.
- Create:
  - `libs/shared/domain/src/lib/billing.ts`;
  - export в `libs/shared/domain/src/index.ts`.

**Interfaces:**
- Produces (`platform-tenants.ts`):
  - `InvoiceStatus = 'issued' | 'partially_paid' | 'paid'`;
  - `TenantSortKey = 'name' | 'owner' | 'stores' | 'debt'`;
  - `TenantListItem`: убрать `paidUntil` и `monthlyChargeMinor`. Добавить:
    - `debtMinor`, `overdueDebtMinor`, `advanceMinor`;
    - `discount: { percentBp: number; toMonth: string } | null` — скидка, действующая в текущем месяце.
    
    `overdue` = `overdueDebtMinor > 0`.
  - `StoreSummary.paidUntil` — удалить. `MigrateStoreToCloudRequest` не трогать: перевод в облако отложен вместе с
    офлайн-точками (B6).
  - `TenantInvoiceItem { id; number; period; stores; hasServices; totalMinor; paidMinor; remainingMinor; status; overdue: boolean; dueOn }`;
  - `TenantPaymentItem { id; paidOn; amountMinor; method; recordedBy; invoiceNumber: string | null; comment: string | null; cancelled: boolean }`.
- Produces (`platform-billing.ts`):
  - `InvoiceListItem`: добавить `paidMinor`, `remainingMinor`, `overdue: boolean`, `issuedAt: string`,
    `paidOn: string | null`.
  - `InvoiceListFilter = 'all' | 'unpaid' | 'overdue' | 'paid'`:
    - `unpaid` — остаток > 0;
    - `overdue` — остаток > 0 и `dueOn` < сегодня.
  - `InvoiceListQuery { filter?; tenantId?; period?; limit?; offset? }`.
  - `InvoiceLine { id; kind: 'store' | 'service'; description; storeId: string | null; days: number | null; daysInMonth: number | null; baseMinor: number | null; discountBp: number | null; discountMinor: number | null; tenantServiceId: string | null; providedOn: string | null; amountMinor }`. Для точки `description` — название точки, для услуги — RU-название услуги.
  - `InvoiceDetails extends InvoiceListItem`:
    - `pricePerStoreMinor`, `vatRatePercent`;
    - `supplier: PlatformRequisites` (из `platform-system.ts`);
    - `payer: { name: string; inn: string }`;
    - `paymentPurpose`, `recalculatedAt: string | null`, `lines: InvoiceLine[]`.
  - `InvoiceGenerationPreview { period; state: PeriodState; opensOn: string; rows: Array<{ tenantId; tenantName; stores: number; services: number; totalMinor: number; invoiced: boolean }>; totalMinor }`:
    - `opensOn` — дата, с которой можно формировать (A1);
    - `invoiced` — счёт уже есть, `totalMinor` — его итог;
    - `totalMinor` предпросмотра — сумма ещё не выставленных.
  - `RecalculationPreview { beforeMinor; afterMinor }` — без изменений.
  - `PaymentListItem`:
    - `invoiceId` и `invoiceNumber` — `string | null` (выбранный «сначала на счёт»);
    - плюс `cancelReason: string | null`;
    - `comment: string | null`.
  - `PaymentListQuery { tenantId?; limit?; offset? }`.
  - `RecordPaymentRequest { id; tenantId; invoiceId?: string | null; amountMinor; paidOn; method; comment?: string | null }` — без `paidUntil`.
  - `UpdatePaymentRequest { amountMinor; paidOn; method; comment: string | null }`.
  - Скидки:
    - `TenantDiscount { id; percentBp; fromMonth; toMonth; invoicedThrough: string | null }` — `invoicedThrough` =
      последний месяц срока, за который у сети есть счёт;
    - `AddTenantDiscountRequest { percentBp; fromMonth; toMonth }`, `ShortenTenantDiscountRequest { toMonth }`.
  - `AddTenantServiceRequest` += `id: string` (B17).
- Produces (`libs/shared/domain/src/lib/billing.ts`, все — чистые функции, деньги через `BigInt`):
  - `billedDays(month: string, firstSaleEver: string, closedOn: string | null): number` (A2):
    - с `max(firstSaleEver, 1-е)` по `min(closedOn, последний день)`, обе включительно;
    - 0, если пусто.
  - `storeCharge(priceMinor: number, days: number, daysInMonth: number): number` — half up `price × days / dim`.
  - `discountOf(amountMinor: number, percentBp: number): number` — half up `amount × bp / 10000`.
  - `vatOf(subtotalMinor: number, vatBp: number): number` — half up `subtotal × bp / 10000`.
  - `composeInvoice(input: ComposeInput): ComposedInvoice`:
    - `ComposeInput { period; pricePerStoreMinor; vatBp; discountBp: number | null; stores: Array<{ storeId; name; firstSaleEver; closedOn: string | null }>; services: Array<{ tenantServiceId; name; priceMinor; providedOn }> }`;
    - строки точек — по `stores` в порядке названия, точка с 0 дней пропускается;
    - затем услуги — по `providedOn`, затем `tenantServiceId`;
    - `ComposedInvoice { lines: ComposedLine[]; subtotalMinor; vatMinor; totalMinor }`, `ComposedLine` — поля
      `InvoiceLine` без `id`.
  - `generationOpensOn(period: string): string` — 3-е число следующего месяца.
  - `invoiceDueOn(period: string, issuedOn: string): string` — max(15-е следующего месяца, `issuedOn` + 10 дней).
  - `invoiceNumber(period: string, sequence: number): string` — `СЧ-2026-08-001`; NNN дополняется нулями до трёх
    цифр, дальше растёт.
  - `allocatePayments(invoices: Array<{ id; period; number; totalMinor; issuedOn }>, payments: Array<{ id; amountMinor; paidOn; createdAt: string; preferredInvoiceId: string | null }>): Allocation` (A7):
    - платежи — по `(paidOn, createdAt, id)`;
    - каждый идёт сначала на свой счёт, если он не закрыт, потом на счета по `(period, number)`;
    - `Allocation { allocations: Array<{ paymentId; invoiceId; amountMinor }>; invoices: Record<string, { paidMinor: number; paidOn: string | null }>; advanceMinor: number }`;
    - `paidOn` — `paidOn` платежа, закрывшего счёт; у счёта с итогом 0 — `issuedOn`.
  - `invoiceStatus(totalMinor: number, paidMinor: number): InvoiceStatus` — `paid` при paid ≥ total.

- [ ] **Step 1: Контракт.** Правки по Interfaces. Комментарии типов — ссылки на A-пункты.
- [ ] **Step 2: Формулы.** `billing.ts` по Interfaces; `daysInMonth` переиспользовать из `expenses.ts`.
- [ ] **Step 3: Сверка формул.** Временный скрипт (не в PR) печатает:
  - `composeInvoice` за `2026-08` с тарифом 40000, НДС 1400, скидкой 2000 bp:
    - точка «A» с первой продажей `2026-08-20`;
    - точка «B» с продажами раньше и закрытием `2026-08-10`;
    - услуга 30000, оказана `2026-08-25`;
  - `invoiceDueOn('2026-08', '2026-10-15')`;
  - `generationOpensOn('2026-08')`;
  - распределение платежей 40000 (`2026-10-01`) и 100000 (`2026-10-02`) по счетам 60088 и 42180.

  Expected:
  - строки 15484 − 3097 = 12387, 12903 − 2581 = 10322, 30000; без НДС 52709, НДС 7379, итог 60088;
  - срок `2026-10-25`; формирование с `2026-09-03`;
  - распределение: оплачено 60088 и 42180, аванс 37732; без первого платежа — 60088 и 39912, аванс 0.
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test typecheck -p shared-dto shared-domain`,
  `npx tsc -b apps/api/tsconfig.json`. API падает только на `paidUntil` и `monthlyChargeMinor` в
  `platform/tenants`: их правит Задача 6. До неё — минимальная правка `tenants.repository.ts` (`debtMinor: 0`,
  `overdueDebtMinor: 0`, `advanceMinor: 0`, `discount: null`, без `paidUntil` у точек), чтобы API собирался.
- [ ] **Step 5: Коммит** `feat(dto): invoices, payments and discounts of networks; billing formulas in the domain`.

### Task 2: Схема и документы

**Files:**
- Create: `apps/api/migrations/<номер>_billing-invoices.sql`.
- Modify:
  - `apps/api/src/core/database/table-classes.ts` (классы и шапка);
  - `apps/api/src/core/database/db.generated.ts` (kysely-codegen);
  - `docs/architecture/data-model/06-sync-audit-billing.md`, `01-platform-org.md`, `README.md`;
  - `docs/architecture/adr/0013-krosstenantnyj-dostup.md` (поправка);
  - `docs/architecture/APPROVAL.md`.

**Interfaces:**
- Produces (таблицы; ключи, RLS и гранты — по образцу `tenant_services` и `service_requests` миграции PR 1):
  - **`store_usage_monthly`** (tenant-export):
    - PK `(tenant_id, store_id, month)`, FK `(tenant_id, store_id)` → `stores`;
    - `month date` 1-го числа;
    - `receipts_count int > 0`;
    - `first_sale_date`, `last_sale_date` — в месяце, `first ≤ last`;
    - `first_sale_ever_date ≤ first_sale_date`;
    - `closed_on date null`, `computed_at timestamptz`;
    - индекс `(month, tenant_id)`;
    - RLS: `tenant_isolation` (`pharmacy_app`), `platform_read`;
    - гранты: app `select, insert, delete`; platform `select`.
  - **`invoices`** (platform):
    - колонки по разделу 4 спецификации;
    - `unique (number)`, `unique (tenant_id, period_month)`, `unique (tenant_id, id)`;
    - CHECK:
      - `total = subtotal + vat`;
      - `paid_dirams between 0 and total_dirams`;
      - `(paid_on is not null) = (paid_dirams = total_dirams)`;
    - индекс `(period_month)`;
    - `created_by` → `operators`;
    - RLS: `tenant_own_read` (`pharmacy_app`, `for select`), `platform_all`;
    - гранты: app `select`; platform `select, insert, update`.
  - **`invoice_lines`** (platform):
    - колонки по разделу 4, плюс `removed_at timestamptz null`, `removed_reason text null`
      (`recalculated` / `service_cancelled`);
    - CHECK по `kind`:
      - точка: `store_id`, `store_name`, `days`, `days_in_month`, `base_dirams`, `discount_bp` заполнены;
      - услуга: `tenant_service_id`, `description`, `provided_on` заполнены;
    - CHECK `(removed_at is null) = (removed_reason is null)`;
    - FK:
      - `(tenant_id, invoice_id)` → `invoices (tenant_id, id)`;
      - `(tenant_id, store_id)` → `stores`;
      - `(tenant_id, tenant_service_id)` → `tenant_services (tenant_id, id)`;
    - индексы:
      - `(tenant_id, invoice_id)`;
      - уникальный частичный `invoice_lines_service_uq (tenant_service_id) where removed_at is null`;
    - RLS и гранты — как у `invoices`.
  - **`tenant_payments`** (platform):
    - колонки по разделу 4; `amount_dirams between 1 and 10000000000`; `comment` до 500;
    - `request_hash bytea not null`, `unique (tenant_id, id)`;
    - FK:
      - `(tenant_id, preferred_invoice_id)` → `invoices`;
      - `recorded_by`, `cancelled_by` → `operators`;
    - CHECK отмены: `status = 'cancelled'` ⇔ `cancel_reason`, `cancelled_by`, `cancelled_at` заполнены;
    - индекс `(tenant_id, paid_on)`;
    - RLS: только `platform_all`; гранты: platform `select, insert, update`, app — нет.
  - **`tenant_payment_allocations`** (platform):
    - PK `(payment_id, invoice_id)`, `amount_dirams ≥ 0` (B18);
    - FK `(tenant_id, payment_id)` → `tenant_payments`, `(tenant_id, invoice_id)` → `invoices`;
    - индекс `(tenant_id, invoice_id)`;
    - RLS и гранты — как у `tenant_payments`.
  - **`tenant_discounts`** (platform):
    - колонки по разделу 4, плюс `removed_at`, `removed_by`;
    - CHECK: `percent_bp between 100 and 10000`; `from_month ≤ to_month`; оба 1-го числа;
      `(removed_at is null) = (removed_by is null)`;
    - индекс `(tenant_id, from_month)`;
    - RLS и гранты — как у `invoices` (сеть читает свои — поправка ADR-0013).
  - **`tenants`**: `add column billing_advance_dirams bigint not null default 0 check (≥ 0)`.
  - **`tenant_services`**: `add column request_hash bytea null`; `add constraint tenant_services_tenant_id_uq unique (tenant_id, id)`.
- Produces (`table-classes.ts`): `store_usage_monthly: 'tenant-export'`; остальные пять — `'platform'`. Шапка:
  `pharmacy_app` читает свои строки `tenants`, `tenant_services`, `invoices`, `invoice_lines`, `tenant_discounts`.

- [ ] **Step 1: Номера миграций** — по Global Constraints. Записать найденный максимум в ledger.
- [ ] **Step 2: Миграция** по Interfaces. Проверка на dev в `begin; … rollback;`.
  Expected: без ошибок.
- [ ] **Step 3: Временная база** — все миграции, затем `kysely-codegen` в `db.generated.ts` и `--verify`. Гранты и RLS —
  запросами `has_table_privilege` / `pg_policies` под тем же списком, что проверяет `catalog.int-spec.ts`.
  Expected: у `pharmacy_platform` нет `DELETE` ни на одной таблице класса `platform`; у `pharmacy_app` нет прав на
  `tenant_payments`, `tenant_payment_allocations`.
- [ ] **Step 4: Документы.**
  - Модель 06 — строки «Биллинг и услуги» по разделу 4 и 3.2; поправка 2026-10-15 дополняется PR 2.
  - Модель 01 — `tenants.billing_advance_dirams`.
  - `README` — классы новых таблиц, `store_billing` убрать.
  - ADR-0013 — «Поправка 2026-10-15 (биллинг)»:
    - `tenant_discounts` в списке таблиц, свои строки которых читает тенант;
    - пересчёт `store_usage_monthly` — по нажатию оператора, без фоновой задачи (B13), в цикле по сетям в их
      контексте;
    - DML платформы по-прежнему без `DELETE` (B18).
  - `APPROVAL.md` — строка поправки: утверждена архитектором 2026-10-15 вместе со спецификацией (3.1 п. 9, B13, B18).
- [ ] **Step 5: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `node tools/scripts/check-docs.mjs`,
  `npx nx lint api`.
- [ ] **Step 6: Коммит** `feat(db): invoices, payments, allocations, discounts and store usage of networks`.

### Task 3: Активность точек в контексте сети

**Files:**
- Create:
  - `apps/api/src/app/billing/store-usage.ts` — порт `StoreUsage`;
  - `apps/api/src/app/billing/store-usage.repository.ts`.
- Modify:
  - `apps/api/src/app/billing/billing.module.ts` (provider, export);
  - `CLAUDE.md` (граф модулей).

**Interfaces:**
- Produces: `StoreUsage.refresh(tenantId: string, month: string /* YYYY-MM-01 */): Promise<void>`:
  - выполняется в `runWithContext({ correlationId: из контекста запроса или randomUUID(), tenantId, principal: null }, () => db.tenantTransaction(...))` — как `activations.service.ts`;
  - в одной tenant-транзакции:
    - удаляет строки месяца сети;
    - вставляет заново из `receipts` по `business_date` в месяце, только `stores.kind = 'pharmacy'` и
      `stores.mode = 'online'` (A21);
    - `first_sale_ever_date` — минимум `business_date` точки за всё время (`receipts_store_date_idx`);
    - `closed_on` — `(stores.closed_at at time zone coalesce(tenant_settings.timezone, 'Asia/Dushanbe'))::date`, как
      `stores.repository.ts`.
  - Месяц в будущем не пересчитывается (вызывающий не зовёт).
- Минимальная правка Задачи 1 в `tenants.repository.ts` (заглушки долга, без `paidUntil` у точек) остаётся до Задачи 6.
- `CLAUDE.md`: строка графа — `billing` → `platform/billing` (`StoreUsage`, пересчёт активности точек для счетов).

- [ ] **Step 1: Порт и репозиторий** по Interfaces.
- [ ] **Step 2: Проверка SQL** на временной базе Задачи 2. Суперпользователь вставляет точки, смену и чеки (данные
  проверки, не в PR). Затем пересчёт через временный скрипт ролью `pharmacy_app` с `app.tenant_id`.
  Expected:
  - строка у аптеки с чеками; у аптеки без чеков и у склада строк нет;
  - `first_sale_ever_date` и `closed_on` верны.
- [ ] **Step 3: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `npx nx run-many -t lint test -p api`.
- [ ] **Step 4: Коммит** `feat(api): store usage of a month in the network's context for billing`.

### Task 4: Счета

**Files:**
- Create в `apps/api/src/app/platform/billing/`:
  - `invoices.repository.ts`, `allocation.ts`, `invoices.service.ts`, `invoices.controller.ts`;
  - `dto/invoices.dto.ts`.
- Modify: `platform-billing.module.ts` (импорт `BillingModule`, провайдеры, контроллер).

**Interfaces:**
- Consumes: `StoreUsage.refresh`; функции Задачи 1; `PlatformAuditService.append`; `BillingRepository.settings`
  (PR 1).
- Produces: `TenantAllocation.recompute(trx: Transaction<DB>, tenantId: string): Promise<void>` (`allocation.ts`).
  Шаги:
  1. берёт `tenants … for update`;
  2. читает счета и активные платежи сети;
  3. вызывает `allocatePayments`;
  4. пишет распределения: `insert … on conflict (payment_id, invoice_id) do update`, остальные пары сети — 0;
  5. обновляет `invoices.paid_dirams` и `paid_on` (только изменившиеся) и `tenants.billing_advance_dirams`.
  
  Этим пользуются Задачи 5–7.
- Produces (маршруты `operator`, права — A15):
  - `GET billing/summary?period` → `BillingSummary` по 6.1 (тариф и ставка — из счетов периода, иначе текущие);
  - `GET invoices?filter&tenantId&period&limit&offset` → `InvoiceListResponse`:
    - сортировка — `period_month desc, number`;
    - `counts` — по тем же `tenantId` и `period`;
  - `GET invoices/{id}` → `InvoiceDetails`, только строки без `removed_at`;
  - `GET invoices/generation-preview?period` → `InvoiceGenerationPreview`;
  - `POST invoices/generations {period}` → 201 `{ created }`;
  - `GET invoices/{id}/recalculation-preview` → `RecalculationPreview`;
  - `POST invoices/{id}/recalculation` → `InvoiceDetails`;
  - `GET tenants/{id}/invoices` → `TenantInvoiceItem[]`.
- Правила:
  - **Состояние периода:** `future` — месяц позже текущего; `closed` — сегодня ≥ `generationOpensOn`; иначе
    `current`. Неверный формат — 400 `period`.
  - **Предпросмотр:**
    - для `future` строк нет;
    - иначе `StoreUsage.refresh` по всем сетям (активным и заблокированным), вне платформенной транзакции, по одной;
    - затем расчёт без записи.
  - **Формирование:**
    - 409 `period_not_closed`; 409 `requisites_missing` — любое поле реквизитов пустое;
    - `refresh` по всем сетям;
    - затем одна платформенная транзакция:
      1. `pg_advisory_xact_lock(hashtextextended('invoices:' || period, 0))`;
      2. сети без счёта за период — `for update` по `id`;
      3. для каждой сети по названию — `composeInvoice`:
         - тариф и ставка — текущие;
         - скидка — действующая на месяц;
         - точки — из `store_usage_monthly` и `stores.name`;
         - услуги — `provided`, `provided_on ≤ конец месяца`, без действующей строки (A11);
      4. сеть без строк счёта не получает;
      5. номер — следующий в периоде;
      6. срок — `invoiceDueOn`;
      7. снимок A5, `payment_purpose` = шаблон с номером;
      8. затем `recompute` каждой сети с новым счётом;
      9. журнал.
  - **Пересчёт (A6):**
    - 409 `invoice_paid`, если `paid_dirams > 0`;
    - `refresh` месяца сети;
    - строки точек — по тарифу и ставке счёта и действующей сейчас скидке. Прежние строки точек снимаются
      (`removed_reason = 'recalculated'`), новые вставляются;
    - строки услуг остаются;
    - суммы пересчитываются, `recalculated_at = now()`, затем `recompute` и журнал;
    - предпросмотр — то же без записи.
  - Статус и `overdue` — по A8 в SQL или через `invoiceStatus`; «сегодня» — в SQL.

- [ ] **Step 1: Репозиторий и распределение.**
- [ ] **Step 2: Сервис и контроллер.** Комментарии маршрутов перечисляют коды ответов, как в PR 1.
- [ ] **Step 3: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `npx nx run-many -t lint test -p api`, `npx nx build api`.
- [ ] **Step 4: Коммит** `feat(api): invoices of networks — preview, generation, recalculation and allocation`.

### Task 5: Платежи

**Files:**
- Create в `apps/api/src/app/platform/billing/`:
  - `payments.repository.ts`, `payments.service.ts`, `payments.controller.ts`, `dto/payments.dto.ts`.
- Create: `apps/api/src/common/request-hash.ts` — `requestHash(body: unknown): Buffer` (sha256 канонического JSON, как
  `canonical` в `pos/idempotency.ts`; `pos` не меняется).
- Modify: `platform-billing.module.ts`.

**Interfaces:**
- Consumes: `TenantAllocation.recompute`; `requestHash`.
- Produces:
  - `GET payments?tenantId&limit&offset` → `Page<PaymentListItem>` (новые первыми: `paid_on desc, created_at desc, id`);
  - `GET tenants/{id}/payments` → `TenantPaymentItem[]`;
  - `POST payments` → `PaymentListItem` (201);
  - `PATCH payments/{id}` → `PaymentListItem`;
  - `POST payments/{id}/cancellation {reason}` → `PaymentListItem`.
- Правила:
  - **Создание:**
    - ids — в нижнем регистре;
    - хеш тела `{ tenantId, amountMinor, paidOn, method, invoiceId: …|null, comment: trim|null }`;
    - платёж с этим `id` уже есть: тот же хеш — текущее состояние, другой — 409 `idempotency_conflict`;
    - иначе:
      1. `tenants … for update` (404);
      2. `paidOn` ≤ сегодня (400 `future`);
      3. выбранный счёт — этой сети (404) и не закрыт (409 `invoice_paid`);
      4. `insert … on conflict (id) do nothing`; если не вставилось — повтор (победил параллельный);
      5. `recompute`, журнал.
  - **Правка:**
    - 409 `payment_cancelled`;
    - те же проверки даты;
    - `updated_at`;
    - `recompute`;
    - журнал с `previous`. Хеш не меняется: повтор исходного `POST` получает текущее состояние.
  - **Отмена:**
    - `reason` 5…500;
    - 409 `payment_cancelled`;
    - `status`, `cancel_reason`, `cancelled_by`, `cancelled_at`;
    - `recompute`, журнал.

- [ ] **Step 1: Репозиторий, сервис, контроллер, DTO.**
- [ ] **Step 2: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `npx nx run-many -t lint test -p api`.
- [ ] **Step 3: Коммит** `feat(api): payments of networks with idempotent recording and allocation`.

### Task 6: Скидки, долг и аванс сети

**Files:**
- Create в `apps/api/src/app/platform/billing/`:
  - `discounts.service.ts`, `discounts.controller.ts`, `dto/discounts.dto.ts`.
  - Запросы — в `invoices.repository.ts` или в `discounts.repository.ts` (на выбор исполнителя).
- Modify:
  - `apps/api/src/app/platform/tenants/tenants.repository.ts`;
  - `apps/api/src/app/platform/tenants/dto/tenant.dto.ts`.

**Interfaces:**
- Produces:
  - `GET tenants/{id}/discounts` → `TenantDiscount[]` — без удалённых, по `from_month`;
  - `POST tenants/{id}/discounts` → `TenantDiscount` (201);
  - `PATCH discounts/{id} {toMonth}` → `TenantDiscount`;
  - `DELETE discounts/{id}` → 204.
  
  Изменения — `tenants:manage` + `@RequireFreshAuth()`.
- Правила (A10):
  - Все изменения — под `tenants … for update`.
  - Пересечение с действующей скидкой — 409 `discount_overlap`.
  - `invoicedThrough` — максимум `period_month` счетов сети в сроке скидки.
  - `PATCH`:
    - `toMonth` ≥ `fromMonth` (400 `order`) и ≤ текущего `toMonth` (400 `not_shorter`);
    - `toMonth` раньше `invoicedThrough` — 409 `discount_invoiced`.
  - `DELETE`: есть `invoicedThrough` — 409 `discount_invoiced`; иначе `removed_at`, `removed_by`.
  - Журнал: `tenant.discount-*`, `details` — проценты и месяцы.
- Список и карточка сети:
  - `debtMinor` = Σ (`total` − `paid`);
  - `overdueDebtMinor` — то же по счетам с `due_on` < сегодня;
  - `advanceMinor` = `billing_advance_dirams`;
  - `discount` — действующая на текущий месяц;
  - `overdue` = просроченный долг > 0.
  
  Фильтр `unpaid` и его счётчик — сети с просроченным долгом. Сортировка `debt` — по `debtMinor`, затем название.

- [ ] **Step 1: Скидки.**
- [ ] **Step 2: Список и карточка сети.** Убрать заглушки `paidUntil`, `monthlyChargeMinor`, `unpaid: 0`, сортировки по
  ним.
- [ ] **Step 3: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `npx nx run-many -t lint test -p api`.
- [ ] **Step 4: Коммит** `feat(api): discounts of networks; debt, overdue debt and advance in the tenants list`.

### Task 7: Услуги в счёте и ключ добавления услуги

**Files:**
- Modify:
  - `apps/api/src/app/platform/billing/service-orders.service.ts`;
  - `apps/api/src/app/platform/billing/service-orders.repository.ts`;
  - `apps/api/src/app/platform/billing/dto/billing.dto.ts` (`AddTenantServiceDto.id`).

**Interfaces:**
- Consumes: `TenantAllocation.recompute`; `requestHash`.
- Правила A13:
  - **Цена и снятие «оказано»** — 409 `service_invoiced`, если на услугу ссылается действующая строка счёта.
  - **Отмена услуги с действующей строкой:**
    - счёт с `paid_dirams > 0` — 409 `service_invoiced`;
    - иначе в одной транзакции:
      1. `tenants … for update`;
      2. строка снимается (`removed_reason = 'service_cancelled'`);
      3. суммы счёта пересчитываются по его действующим строкам и ставке;
      4. `recompute`;
      5. журнал `service.cancelled` (как в PR 1).
- B17 — `POST tenants/{id}/services {id, serviceId, priceMinor}`:
  - хеш `{ tenantId, serviceId, priceMinor }` пишется в `request_hash`;
  - строка с этим `id` уже есть: тот же хеш — текущее состояние, другой или `null` — 409 `idempotency_conflict`;
  - параллельный повтор — по 23505 первичного ключа, затем повтор.

- [ ] **Step 1: Правила по Interfaces.**
- [ ] **Step 2: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `npx nx run-many -t lint test -p api`.
- [ ] **Step 3: Коммит** `feat(api): services in invoices — invoiced services are locked, a cancellation leaves an unpaid invoice; idempotent add`.

### Task 8: Админка

**Files** (карта — по разбору экранов; номера строк на `origin/main` 1a621cc):
- **Маршруты и клиент:**
  - `apps/admin/src/shared/api/routes.ts` — новые `query` у `invoices.list`, `payments.list`; новые ключи
    `tenants.discounts`, `tenants.addDiscount`, `discounts.shorten`, `discounts.remove`;
  - `client.ts` — в `REAL_API_ROUTES`:
    - `billing.summary`, `invoices.*`, `payments.*`;
    - `tenants.invoices`, `tenants.payments`;
    - четыре маршрута скидок;
  - `error-message.ts` и `apiErrors` — новые коды (`requisites_missing`, `discount_overlap`, `discount_invoiced`,
    `idempotency_conflict`, `service_invoiced`). `invoices_already_generated` убрать.
- **Моки:**
  - `mocks/db-billing.ts` — сиды в новой форме. Счета собираются `composeInvoice`, оплата — `allocatePayments` из
    сидов платежей. У платежей есть `tenantId`. Плюс скидки.
  - `mocks/handlers-billing.ts` — все маршруты по правилам Задач 4–7: те же коды, поля и расчёт. Формирование реально
    создаёт счета: активность точки в моках — облачная точка с `connectedOn` как первой продажей и `closedOn`.
    Действия пишут журнал операторов через `logAction`.
  - `mocks/transport.ts` — список сетей: долг, просроченный долг, аванс, скидка — из счетов и платежей моков;
    сортировка `debt`, фильтр `unpaid`.
  - `mocks/db.ts` — убрать `paidUntil`, `monthlyChargeMinor`, статический `overdue`.
  - `mocks/handlers-system.ts` — `dashboard.get`:
    - просрочка — по флагу `overdue`;
    - `accruedMinor` — Σ итогов счетов последнего выставленного периода.
- **Сущности и фичи:**
  - `entities/invoice` — фильтры, ключи с `tenantId`/`period`;
  - `InvoiceStatusPill` — три статуса плюс отдельная пометка «просрочен»;
  - `invoicePdfHref` убрать: PDF на сервере нет (B11), печать — PR 3.
  - `entities/tenant/api/tenant-queries.ts` — вкладка `discounts`.
  - `features/record-payment/ui/RecordPayment.tsx`:
    - сеть (выбор, если не задана);
    - «сначала на счёт» — необязательный список неоплаченных счетов сети, сумма по умолчанию — `remainingMinor`;
    - `id` — `uuidv7()` при открытии;
    - поля и тексты `paidUntil` убрать.
  - Новая фича `features/tenant-discounts` — список, добавить, сократить, удалить (step-up — сообщение
    `fresh_auth_required`, как в настройках).
  - `features/tenant-service-actions/ui/AddTenantService.tsx` — `id: uuidv7()` при открытии, сброс в `close()`.
- **Страницы:**
  - `pages/billing`:
    - фильтры `all/unpaid/overdue/paid`;
    - колонки «Оплачено» и «Остаток», статус с пометкой просрочки;
    - «Пересчитать» — только при `paidMinor = 0`;
    - предпросмотр формирования — точки, услуги, «уже выставлен», дата `opensOn`;
    - карточка счёта — строки с днями, скидкой, датой оказания; оплачено и остаток; без кнопки PDF;
    - текст пересчёта по A6;
    - платёж без счёта — «—» в колонке счёта; заголовок карточки платежа — сеть и дата.
  - `pages/companies` — колонки «Долг» и «Аванс» (сортировка `debt`) вместо «Оплачено до» и «Начислено»; карточный
    вид так же.
  - `pages/company`:
    - в шапке — долг, просроченный долг, аванс, текущая скидка;
    - вкладка «Счета и платежи»: счета с «Оплачено» / «Остаток» / статусом; платежи с отменой; карточка «Скидки»
      (`features/tenant-discounts`);
    - в «Точках» срок оплаты облачной точки убран, у офлайн-точки остаётся «Ключ до»;
    - видимость вкладок: «Счета и платежи» и «Услуги» — по `isApiRouteAvailable('tenants.invoices')`, «Статистика» и
      «Журнал» — по своим маршрутам.
  - `pages/dashboard` — сортировка `debt`, строка сети — долг вместо «оплачено до» и начисления.
  - `pages/store` — плитка `kpi.paidUntil` убрана; диалог перевода в облако не меняется (B6).
- **Тексты:** `ru.json`, `tg.json` — по всем правкам; ключи RU и TJ совпадают (`messages.spec.ts`).
- **Тесты:** `apps/admin/specs/billing.spec.tsx`, `companies.spec.tsx`, `system.spec.tsx` — на новый контракт и моки.
  Сценарии те же: фильтр просрочки, платёж по просроченному счёту, отмена платежа, формирование только за закрытый
  период, строки счёта.

- [ ] **Step 1: Маршруты, моки, сущности.**
- [ ] **Step 2: Фичи** (`record-payment`, `tenant-discounts`, `AddTenantService`).
- [ ] **Step 3: Страницы и тексты.**
- [ ] **Step 4: Тесты админки** — перевести на новый контракт.
- [ ] **Step 5: Временные экранные тесты** (не в PR):
  - платёж без счёта уходит в аванс и показывается в карточке сети;
  - скидка: добавить, пересечение — сообщение, удалить;
  - формирование создаёт счёт и он виден в списке;
  - axe на карточке сети.
- [ ] **Step 6: Проверка.**
  - `npx tsc -p apps/admin/tsconfig.json --noEmit` и `npx tsc -p apps/web/tsconfig.json --noEmit` (buildinfo
    отложить, ruling PR 1);
  - `npx nx run-many -t lint test typecheck fsd -p admin web`.
- [ ] **Step 7: Коммит** `feat(admin): invoices, payments, discounts, debt and advance on the API`.

### Task 9: Сквозная проверка, документы, PR

- [ ] **Step 1: Сборка и запуск.** `npx nx build api`, `nx sync:check`. API на свободном порту против временной базы
  (`STEP_UP_MAX_AGE_SECONDS=8`).
- [ ] **Step 2: Данные.**
  - Через API: оператор (`create-operator.mjs`), сети «Сеть А …» и «Сеть Б …», их владельцы и точки.
  - SQL суперпользователя во временной базе (данные проверки):
    - смены и чеки с прошлыми `business_date`;
    - закрытие точки `status = 'closed', closed_at`;
    - перенос `tenant_services.decided_at` в прошлое, чтобы услугу можно было отметить оказанной в августе.
- [ ] **Step 3: Сценарий** (печатает OK/FAIL без секретов). Тариф 40000, НДС 14 %, сегодня — дата прогона.
  - **«Сеть А», август 2026:**
    - точка A — первая продажа `2026-08-20`, продажи и в сентябре;
    - точка B — продажи в июле и `2026-08-03`, закрыта `2026-08-10`;
    - точка C — без продаж; склад W — с продажами;
    - скидка 20 % на `2026-08`…`2026-10`;
    - услуга S1 за 30000 оказана `2026-08-25`.
    
    Expected: счёт `СЧ-2026-08-001` — строки 12387 (12 дн. из 31), 10322 (10 дн.), 30000; без НДС 52709, НДС 7379,
    итог 60088; склада и точки C нет. Срок — `invoiceDueOn('2026-08', сегодня)`.
  - **Повтор формирования** за август — `created: 0`. Два параллельных формирования за сентябрь — один набор счетов.
  - **Поздняя услуга:** S2 за 5000 отмечена оказанной `2026-08-28` после августовского счёта.
    
    Expected: в сентябрьском счёте «Сети А» — точка A 40000 − 8000 = 32000 и S2 5000; итог 37000 + 5180 = 42180.
  - **«Сеть Б», сентябрь:**
    - точка D — первая продажа `2026-09-20`: 11 дн. из 30, 14667;
    - услуга S3 за 10000 оказана `2026-09-10`.
    
    Expected:
    - итог 24667 + 3453 = 28120;
    - отмена S3 — строка снята, итог 16720;
    - скидка 50 % на `2026-09` задним числом, предпросмотр пересчёта — было 16720, станет 8360; пересчёт — 8360.
  - **Скидки:**
    - вторая скидка «Сети А» на `2026-10`…`2026-12` — 409 `discount_overlap`; на `2026-11`…`2026-12` — 201;
    - удаление скидки август–октябрь — 409 `discount_invoiced`;
    - сокращение до `2026-08` — 409; до `2026-09` — 200;
    - без повторного входа — 403 `fresh_auth_required`.
  - **Платежи «Сети А»:**
    - P1 40000 от `2026-10-01` — август «частично оплачен», остаток 20088;
    - P2 100000 от `2026-10-02` — оба счёта оплачены, аванс 37732;
    - повтор P2 с тем же телом — тот же ответ, с другой суммой — 409;
    - отмена P1 — август оплачен, сентябрь оплачен 39912 из 42180, аванс 0;
    - правка P2 на 103000 — оба оплачены, аванс 732;
    - отмена отменённого — 409; платёж на оплаченный счёт — 409 `invoice_paid`;
    - пересчёт счёта с оплатой — 409 `invoice_paid`;
    - цена услуги в счёте — 409 `service_invoiced`.
  - **Гонка:** 10 пар «платёж ↔ пересчёт или формирование» одновременно. После каждой — Σ активных платежей =
    Σ оплаченного + аванс по каждой сети (SQL).
  - **Список сетей:** долг, просроченный долг (срок в прошлом задаётся SQL у одного счёта), аванс, скидка; фильтр
    `unpaid`, сортировка `debt`.
  - **Изоляция** (SQL ролью `pharmacy_app` с `app.tenant_id` второй сети):
    - видны только её `invoices`, `invoice_lines`, `tenant_discounts`;
    - `tenant_payments` — нет прав.
  - **Журнал:** события `invoice.*`, `payment.*`, `tenant.discount-*`.
  - **Повтор добавления услуги (B17):** тот же `id` и тело — тот же ответ; другая цена — 409.
- [ ] **Step 4: Полная проверка.**
  - `tsc` для api, admin, web;
  - `npx nx run-many -t lint test typecheck fsd -p api admin web shared-dto shared-domain`;
  - `node tools/scripts/check-docs.mjs`.
- [ ] **Step 5: AI-ревью** — `nestjs-reviewer`, `postgresql-database-reviewer` и итоговое ревью ветки. Ревьюеры только
  читают: не пишут файлы и agent-memory. Исправить существенное.
- [ ] **Step 6: Описание PR** `.superpowers/pr-billing-invoices.md`:
  - что сделано, как проверено;
  - B17, B18 и поправка 3.2;
  - поправка ADR-0013 и строка `APPROVAL.md`;
  - долг по тестам;
  - что осталось на PR 3;
  - просьба прогнать `api:migrate`, `api:db-types-verify`, `api:integration`, api-e2e.
- [ ] **Step 7: Отправка.**
  - удалить временную базу;
  - `git push -u origin feature/billing-invoices:feature/billing-invoices`;
  - проверить upstream и что `origin/main` не изменился;
  - дать пользователю ссылку, заголовок и файл; обновить ledger и память.
