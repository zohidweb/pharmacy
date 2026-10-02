---
title: Make Audit Log and ПКУ Journal Append-Only at the Database Level
impact: HIGH
impactDescription: Tamper-resistant audit (≥ 3 years retention) and controlled-substance journal, independent of application bugs
tags: audit, append-only, pku, controlled-substance, triggers, privileges, immutability
---

## Make Audit Log and ПКУ Journal Append-Only at the Database Level

Аудит («кто, когда, что, точка», включая действия оператора «от имени») и журнал ПКУ по требованиям
неизменяемы. Запрет правки только в коде не работает: любой будущий эндпоинт или ручной SQL его
обойдёт. Защита — в два слоя: **права** (`REVOKE UPDATE, DELETE, TRUNCATE`) и **триггер-запрет**
(ловит и роли с правами, кроме владельца, отключившего триггер в миграции — это видно на ревью).
То же относится к `stock_movements` (исправление — сторнирующим движением, см.
`data-stock-from-movements.md`).

**Incorrect:**

```sql
create table audit_log (id bigserial primary key, action text, details text);
grant all on audit_log to pharmacy_app;

-- "Fix" a wrong entry
update audit_log set details = '...' where id = 42;
```

**Correct:**

```sql
-- Columns per data model 06 (audit_log): monthly partitions by recorded_at (schema-partitioning.md)
create table pharmacy.audit_log (
  tenant_id          uuid not null references pharmacy.tenants (id),
  id                 uuid not null,                 -- newId() (UUIDv7) on cloud and offline stores alike
  recorded_at        timestamptz not null default now(),
  business_date      date not null,                 -- tenant time zone (tenant_settings.timezone)
  employee_id        uuid,
  store_id           uuid,
  terminal_id        uuid,
  acting_operator_id uuid,                          -- impersonation (ADR-0008)
  impersonation_id   uuid,
  correlation_id     text not null,
  action             text not null,                 -- receipt.completed, price.changed, access.denied…
  entity_type        text,
  entity_id          uuid,
  details            jsonb not null default '{}',   -- no secrets or raw personal data, mask before insert
  source             text not null check (source in ('cloud', 'offline_store')),
  primary key (tenant_id, id, recorded_at)          -- the partition key must be part of the key
) partition by range (recorded_at);
-- monthly partitions are created ahead by a migration/job (schema-partitioning.md)

create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'table % is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = '42501';  -- insufficient_privilege
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on pharmacy.audit_log   -- row triggers on a partitioned table reach every partition
  for each row execute function forbid_mutation();

create trigger audit_log_no_truncate
  before truncate on pharmacy.audit_log
  for each statement execute function forbid_mutation();

-- RLS for tenant isolation: SELECT/INSERT policies only
alter table pharmacy.audit_log enable row level security;
alter table pharmacy.audit_log force row level security;
create policy audit_read on pharmacy.audit_log for select to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy audit_write on pharmacy.audit_log for insert to pharmacy_app
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert on pharmacy.audit_log to pharmacy_app;   -- exact set; no update/delete/truncate
```

Та же схема защиты — у `stock_movements`, `shift_cash_operations`, `supplier_ledger_entries`,
`platform_audit_log` и `controlled_sale_records` (модель данных; у последней триггер разрешает
только очистку данных рецепта по сроку хранения). Журнал ПКУ — выборка по движениям и записям
продаж ПКУ, отдельной таблицы нет. Ошибочная запись исправляется новой записью (сторно,
корректировка), исходная не меняется.

Нюансы:

- Без UPDATE/DELETE-политик RLS молча затрагивает 0 строк — поэтому нужны `REVOKE` и триггер,
  которые дают явную ошибку.
- Запись в аудит — в той же транзакции, что и действие (чек, проведение документа, вход «от имени»).
- ПДн (ФИО, поля рецепта) в `details` — только в объёме, требуемом журналом; в логи приложения —
  маскированно.
- Удаление по истечении срока хранения (≥ 3 лет) — отдельная регламентная процедура под ролью
  владельца; для этого удобно секционирование по времени (`schema-partitioning.md`). Процедуру
  согласовать до реализации.

Reference: [CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html),
[Privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
