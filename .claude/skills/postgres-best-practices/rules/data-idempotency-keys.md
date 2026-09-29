---
title: Deduplicate Receipts and Sync Operations with Idempotency Keys
impact: CRITICAL
impactDescription: Retries from the POS offline buffer or store sync never create a second receipt or a second stock write-off
tags: idempotency, idempotency-key, on-conflict, sync, receipts, retries
---

## Deduplicate Receipts and Sync Operations with Idempotency Keys

Касса досылает операции из буфера перебоев связи, офлайн-точка повторяет пакеты синхронизации,
сеть рвётся после COMMIT, но до ответа. Повтор обязан вернуть **тот же** результат, а не создать
второй чек и второе списание партий. Конвенция проекта: финансовые операции и синхронизация —
idempotency key + correlation ID.

Ключ генерирует **клиент** (браузер кассы / офлайн-точка) при создании операции (UUID) и
передаёт при каждой попытке. Уникальность обеспечивает БД, а не проверка «select, потом insert».

**Incorrect:**

```sql
-- Check-then-insert: two concurrent retries both see "nothing" and both insert
select id from receipts where tenant_id = $1 and idempotency_key = $2;
insert into receipts (...) values (...);

-- Upsert that overwrites a financial document on retry
insert into receipts (...) values (...)
on conflict (tenant_id, idempotency_key) do update set total_dirams = excluded.total_dirams;
```

**Correct (уникальный ключ + `ON CONFLICT DO NOTHING RETURNING` как «ворота» транзакции):**

```sql
create table receipts (
  id uuid primary key,
  tenant_id uuid not null,
  store_id uuid not null,
  idempotency_key uuid not null,
  request_hash text not null,          -- hash of the normalized request payload
  correlation_id uuid not null,        -- tracing only, NOT a dedup key
  total_dirams bigint not null check (total_dirams >= 0),
  created_at timestamptz not null default now(),
  constraint receipts_idempotency_uq unique (tenant_id, idempotency_key)
);

begin;
select set_config('app.tenant_id', $1, true);

insert into receipts (id, tenant_id, store_id, idempotency_key, request_hash, correlation_id, total_dirams)
values ($2, $1, $3, $4, $5, $6, $7)
on conflict (tenant_id, idempotency_key) do nothing
returning id;

-- Row returned  → first attempt: lock batches, write lines + movements + audit, COMMIT.
-- No row        → duplicate: do NOT write movements; COMMIT/ROLLBACK and return the stored result:
select id, request_hash, total_dirams from receipts
where tenant_id = $1 and idempotency_key = $4;
-- request_hash differs → same key reused for a different payload → 409/422 problem+json
commit;
```

Конкурентный повтор с тем же ключом блокируется на уникальном индексе до завершения первой
транзакции и затем получает `DO NOTHING` — дубля не будет даже при одновременной досылке.

Синхронизация офлайн-точек (приёмная сторона в облаке):

```sql
create table sync_inbox (
  tenant_id uuid not null,
  store_id uuid not null,
  operation_id uuid not null,          -- generated on the store when the operation was created
  operation_type text not null,
  received_at timestamptz not null default now(),
  primary key (tenant_id, store_id, operation_id)
);

begin;
select set_config('app.tenant_id', $1, true);
insert into sync_inbox (tenant_id, store_id, operation_id, operation_type)
values ($1, $2, $3, $4)
on conflict do nothing
returning operation_id;
-- Row returned → apply the operation in THIS transaction; no row → already applied, ack it
commit;
```

Правила:

- Ключ и применение операции — в одной транзакции; запись ключа «заранее» отдельной транзакцией
  при сбое оставит ключ без операции.
- `store_id` и `tenant_id` для синхронизации берутся из лицензионного ключа точки, не из тела
  пакета.
- Срок хранения ключей ≥ максимального окна повторов (офлайн-точка может быть без связи днями) —
  ключи чеков не удаляются вместе с чеками.
- `ON CONFLICT DO UPDATE` для финансовых документов запрещён; он уместен для настроек и
  справочников (см. `data-upsert.md`).

Reference: [INSERT … ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
