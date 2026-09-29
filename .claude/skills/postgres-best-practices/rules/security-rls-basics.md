---
title: Enforce Tenant Isolation with tenant_id and Row Level Security
impact: CRITICAL
impactDescription: Database-enforced tenant isolation — a missed WHERE in the app cannot leak another tenant's data
tags: rls, row-level-security, multi-tenant, tenant_id, set_config, security
---

## Enforce Tenant Isolation with tenant_id and Row Level Security

Pharmacy — мультитенантная платформа в одной PostgreSQL (ADR-0002). Первый рубеж изоляции — слой
доступа к данным в `apps/api`, который добавляет фильтр тенанта в каждый запрос. Второй рубеж — RLS:
даже если в коде забыли `where tenant_id = …`, БД не отдаст чужие строки. Одно без другого не
принимается на ревью.

Обязательные элементы:

1. `tenant_id uuid not null` — во **всех** прикладных таблицах (чеки, партии, движения, документы,
   сотрудники, аудит…), включая дочерние (`receipt_lines`), даже если tenant выводится через родителя.
2. `ENABLE` + `FORCE ROW LEVEL SECURITY` на каждой такой таблице.
3. Политика через `current_setting('app.tenant_id')` с `USING` **и** `WITH CHECK`.
4. Контекст тенанта выставляется **внутри транзакции запроса** через `set_config(..., true)`
   (= `SET LOCAL`) — никогда сессионным `SET` (см. `conn-session-state.md`).
5. Роль приложения — не владелец таблиц, не superuser, без `BYPASSRLS` (см. `security-privileges.md`).
6. Индексы и уникальные ограничения — с ведущим `tenant_id` (см. `security-rls-performance.md`).

**Incorrect (фильтр только в приложении, сессионный контекст, приложение — владелец):**

```sql
-- App connects as the table owner: RLS is silently skipped for owners without FORCE
create table receipts (
  id uuid primary key,
  store_id uuid not null,          -- no tenant_id: isolation depends on joins through stores
  total_dirams bigint not null
);
alter table receipts enable row level security;   -- no FORCE, owner bypasses it

-- Session-level SET on a pooled connection: the next request on this connection
-- inherits the previous tenant
set app.tenant_id = '6f1c…';
select * from receipts;
```

**Correct (tenant_id везде, FORCE RLS, контекст на транзакцию):**

```sql
create table receipts (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null,
  total_dirams bigint not null check (total_dirams >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),                              -- target for composite FKs
  foreign key (tenant_id, store_id) references stores (tenant_id, id)
);

alter table receipts enable row level security;
alter table receipts force row level security;        -- applies to the owner too

create policy tenant_isolation on receipts
  using      (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

-- Child tables carry tenant_id too and reference the parent by (tenant_id, id):
-- a line can never point to a receipt of another tenant
create table receipt_lines (
  id uuid primary key,
  tenant_id uuid not null,
  receipt_id uuid not null,
  batch_id uuid not null,
  qty integer not null check (qty > 0),
  unit_price_dirams bigint not null check (unit_price_dirams >= 0),
  foreign key (tenant_id, receipt_id) references receipts (tenant_id, id),
  foreign key (tenant_id, batch_id)   references batches  (tenant_id, id)
);
alter table receipt_lines enable row level security;
alter table receipt_lines force row level security;
create policy tenant_isolation on receipt_lines
  using      (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
```

Запрос приложения — всегда в транзакции, контекст первым оператором:

```sql
begin;
-- set_config(..., is_local => true) == SET LOCAL, but accepts a bind parameter
-- (SET LOCAL cannot be parameterized — never build it with string concatenation)
select set_config('app.tenant_id', $1, true);
select id, total_dirams from receipts where tenant_id = $1 and store_id = $2;  -- app filter stays
commit;  -- context disappears with the transaction
```

Поведение при отсутствии контекста — fail-closed: `current_setting('app.tenant_id')` без
`missing_ok` падает с ошибкой, а после завершённой транзакции значение пустое и `''::uuid` тоже
даёт ошибку. Не «чините» это через `current_setting(..., true)` с подстановкой дефолта.

Нюансы Pharmacy:

- **Офлайн-точка** использует ту же схему и те же миграции (один тенант, но RLS не отключается —
  один код для облака и точки).
- **Синхронизация**: tenant определяется по лицензионному ключу точки на сервере, а не по полю из
  тела запроса.
- **Админка оператора** («вход от имени») работает через тот же контекст тенанта. Кросс-тенантные
  операции (биллинг по всем тенантам, реестр тенантов) — отдельная роль/путь доступа с узкими
  правами; это решение **требует ADR через `/03-adr`**, `BYPASSRLS` роли API не выдаётся.
- Проверяйте изоляцию тестом: под ролью приложения с контекстом тенанта A выборка/UPDATE строк
  тенанта B возвращает 0 строк, INSERT с чужим `tenant_id` падает на `WITH CHECK`.

Reference: [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[set_config](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET)
