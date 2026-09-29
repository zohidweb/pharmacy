---
title: Use Transaction-Level Advisory Locks for Application Coordination
impact: MEDIUM
impactDescription: Serialize per-store work (sync apply, shift close, numbering) without dummy lock rows
tags: advisory-locks, coordination, application-locks, sync
---

## Use Transaction-Level Advisory Locks for Application Coordination

Advisory locks provide application-level coordination without requiring database rows to lock.
Примеры в Pharmacy: применение входящих операций синхронизации одной точки строго по очереди,
закрытие смены (Z-отчёт) без параллельных продаж в эту же смену, генерация номера документа.

**Incorrect (dummy rows or session-level locks on pooled connections):**

```sql
-- Dummy table just for locking
create table resource_locks (resource_name text primary key);
select * from resource_locks where resource_name = 'store-42-sync' for update;

-- Session-level lock on a pooled connection: if the app forgets to unlock (exception),
-- the lock stays with the connection and blocks the next request forever
select pg_advisory_lock(hashtext('store-sync'));
```

**Correct (transaction-level lock, two-key form scoped to the store):**

```sql
begin;
select set_config('app.tenant_id', $1, true);
-- key1 = lock namespace, key2 = store; released automatically on COMMIT/ROLLBACK
select pg_advisory_xact_lock(hashtext('sync-apply'), hashtext($2::text));
-- ... apply the next operations of this store in order ...
commit;
```

Non-blocking variant (skip if another worker already handles this store):

```sql
begin;
select pg_try_advisory_xact_lock(hashtext('sync-apply'), hashtext($2::text));  -- true / false
-- false → rollback and pick another store
commit;
```

Правила:

- В пуле соединений — только `*_xact_*` варианты (см. `conn-session-state.md`).
- `hashtext` может давать коллизии: пространство имён (первый ключ) + идентификатор (второй ключ)
  снижает шанс, а коллизия приводит лишь к лишнему ожиданию, не к ошибке данных.
- Advisory lock не заменяет `FOR UPDATE` на партиях при списании — он координирует процессы,
  а не защищает строки.

Reference: [Advisory Locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
