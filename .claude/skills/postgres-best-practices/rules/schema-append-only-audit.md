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
create table audit_log (
  id uuid primary key,                      -- generated on cloud and offline stores alike
  tenant_id uuid not null,
  store_id uuid,
  actor_employee_id uuid,
  on_behalf_operator_id uuid,               -- platform operator acting "on behalf"
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}',      -- no raw personal data, mask before insert
  correlation_id uuid not null,
  occurred_at timestamptz not null default now()
);

revoke update, delete, truncate on audit_log from pharmacy_app;
grant select, insert on audit_log to pharmacy_app;

create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'table % is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = '42501';  -- insufficient_privilege
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each row execute function forbid_mutation();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function forbid_mutation();

-- RLS for tenant isolation: SELECT/INSERT policies only
alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy audit_read on audit_log for select
  using (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy audit_write on audit_log for insert
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
```

Журнал ПКУ (`controlled_substance_journal`) — та же схема защиты. Ошибочная запись исправляется
новой записью-корректировкой со ссылкой на исходную (`corrects_entry_id`), исходная не меняется.

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
