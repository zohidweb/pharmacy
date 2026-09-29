---
title: Use SKIP LOCKED Table Queues Instead of a Message Broker
impact: HIGH
impactDescription: Parallel, non-blocking workers for sync queue / outbox with no broker (brokers are not approved by the radar)
tags: skip-locked, queue, outbox, sync-queue, workers, concurrency
---

## Use SKIP LOCKED Table Queues Instead of a Message Broker

Брокеры сообщений (RabbitMQ, Kafka, BullMQ-как-брокер, NATS…) — категория радара «На утверждении»,
использовать нельзя. По ADR-0002 очереди — **таблицы в PostgreSQL**: очередь синхронизации
офлайн-точки, outbox для фоновых задач (фискализация, отложенная обработка). `SKIP LOCKED` позволяет
нескольким воркерам разбирать очередь, не ожидая блокировок друг друга.

**Incorrect (workers block each other):**

```sql
-- Worker 1 and Worker 2 both try to get the next job
begin;
select * from jobs where status = 'pending' order by created_at limit 1 for update;
-- Worker 2 waits for Worker 1's lock to release!
```

**Correct (SKIP LOCKED for parallel processing):**

```sql
-- Atomic claim-and-update in one statement
update jobs
set status = 'processing', worker_id = $1, started_at = now()
where id = (
  select id from jobs
  where status = 'pending'
  order by created_at
  limit 1
  for update skip locked
)
returning *;
```

### Pharmacy: outbox / очередь синхронизации офлайн-точки

Операция попадает в outbox **в той же транзакции**, что и бизнес-изменение (чек → запись в
`sync_outbox`), — иначе при сбое чек есть, а операции на отправку нет (transactional outbox).

```sql
create table sync_outbox (
  id bigint generated always as identity primary key,  -- local to one database, order of creation
  tenant_id uuid not null,
  store_id uuid not null,
  operation_id uuid not null,                  -- idempotency key on the receiving side
  operation_type text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (tenant_id, operation_id)
);
create index sync_outbox_ready_idx on sync_outbox (next_attempt_at, id) where status = 'pending';

-- 1. Claim a batch with a lease (short transaction)
update sync_outbox o
set status = 'processing', locked_until = now() + interval '2 minutes', attempts = attempts + 1
where o.id in (
  select id from sync_outbox
  where status = 'pending' and next_attempt_at <= now()
  order by id
  limit 100
  for update skip locked
)
returning o.id, o.operation_id, o.operation_type, o.payload;

-- 2. Send over HTTPS OUTSIDE any transaction (license key auth; receiver dedups by operation_id)

-- 3a. Success
update sync_outbox set status = 'sent', locked_until = null where id = any($1::bigint[]);

-- 3b. Failure: exponential backoff, give up after N attempts
update sync_outbox
set status = case when attempts >= 10 then 'failed' else 'pending' end,
    next_attempt_at = now() + least(interval '1 hour', interval '10 seconds' * power(2, attempts)),
    locked_until = null,
    last_error = left($2, 1000)
where id = any($1::bigint[]);

-- 4. Recover leases of crashed workers
update sync_outbox set status = 'pending', locked_until = null
where status = 'processing' and locked_until < now();
```

Нюансы:

- Доставка «как минимум один раз» → приёмная сторона обязана быть идемпотентной
  (`data-idempotency-keys.md`, таблица `sync_inbox`).
- `SKIP LOCKED` не гарантирует порядок между воркерами. Если порядок операций точки важен (чек →
  его возврат), на офлайн-точке — один отправляющий воркер в порядке `id`; в облаке обработка
  входящих операций одной точки сериализуется `pg_advisory_xact_lock` по `store_id`
  (`lock-advisory.md`).
- HTTP-вызов внутри транзакции захвата запрещён (`lock-short-transactions.md`).
- Воркер в облаке, разбирающий очереди **всех** тенантов, не может работать под RLS-контекстом
  одного тенанта: отдельная роль с правами только на таблицы очередей, затем обработка каждой
  операции — в транзакции с `set_config('app.tenant_id', …)`. Модель ролей воркера — **требует ADR**.
- Отправленные строки чистить/архивировать регулярно, таблица с высокой «текучкой» — настроить
  autovacuum (`monitor-vacuum-analyze.md`).

Reference: [SELECT FOR UPDATE SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
