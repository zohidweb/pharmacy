---
title: Prevent Deadlocks with Consistent Lock Ordering
impact: MEDIUM-HIGH
impactDescription: Eliminate deadlock errors between concurrent receipts and stock documents
tags: deadlocks, locking, transactions, ordering, batches
---

## Prevent Deadlocks with Consistent Lock Ordering

Deadlocks occur when transactions lock resources in different orders. В Pharmacy типичный случай —
две кассы продают одни и те же два товара в разном порядке строк чека, или чек пересекается с
проведением документа списания по тем же партиям.

**Incorrect (inconsistent lock ordering):**

```sql
-- Receipt A (lines: X, then Y)          -- Receipt B (lines: Y, then X)
begin;                                   begin;
select … from batches                    select … from batches
where id = 'batch-X' for update;         where id = 'batch-Y' for update;

select … from batches                    select … from batches
where id = 'batch-Y' for update;         where id = 'batch-X' for update;
-- A waits for B                         -- B waits for A → DEADLOCK
```

**Correct (lock all needed rows up front, in one global order):**

```sql
begin;
select set_config('app.tenant_id', $1, true);
-- Lock every candidate batch of all receipt lines at once, ordered by id
select id from batches
where tenant_id = $1 and store_id = $2 and product_id = any($3::uuid[])
order by id
for update;
-- Now allocate FEFO and insert movements in any order — locks are already held
commit;
```

Правило для всех путей, меняющих остаток (чек, списание, перемещение, инвентаризация): блокировать
`batches` одним запросом `order by id`. Если в транзакции блокируются разные таблицы — фиксированный
порядок таблиц (например, документ → партии), одинаковый во всём коде `apps/api`.

Приложение ловит `40P01` (deadlock_detected) и `55P03` (lock_not_available при `lock_timeout`) и
повторяет транзакцию целиком ограниченное число раз — безопасно благодаря ключу идемпотентности.

Detect deadlocks:

```sql
select datname, deadlocks from pg_stat_database where deadlocks > 0;

-- Log lock waits longer than deadlock_timeout (server config)
alter system set log_lock_waits = on;
alter system set deadlock_timeout = '1s';
select pg_reload_conf();
```

Reference: [Deadlocks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS)
