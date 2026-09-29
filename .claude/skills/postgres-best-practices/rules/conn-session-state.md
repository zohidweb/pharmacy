---
title: Never Leave Session State on Pooled Connections
impact: CRITICAL
impactDescription: A session-level SET app.tenant_id on a pooled connection leaks one tenant's context into another tenant's request
tags: connection-pooling, session-state, set-local, tenant-context, prepared-statements, pgbouncer
---

## Never Leave Session State on Pooled Connections

Соединение из пула после запроса тенанта A достаётся запросу тенанта B. Всё, что осталось на
соединении на уровне сессии — `SET`, временные таблицы, сессионные advisory-локи — «переезжает» в
чужой запрос. Для `app.tenant_id` это прямая утечка данных между тенантами.

**Incorrect (сессионное состояние):**

```sql
-- Request of tenant A
set app.tenant_id = 'aaaaaaaa-…';        -- session-level: survives COMMIT
select * from receipts;
-- connection returns to the pool

-- Request of tenant B forgets to set context (bug) and gets tenant A's rows
select * from receipts;

-- Also dangerous on pooled connections:
set statement_timeout = '60s';           -- silently applies to all later requests
select pg_advisory_lock(42);             -- lock stays held if the app forgets to unlock
create temp table tmp_report (...);      -- visible to the next request on this connection
```

**Correct (всё состояние — в границах транзакции):**

```sql
begin;
select set_config('app.tenant_id', $1, true);   -- is_local = true == SET LOCAL
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('store-sync'), hashtext($2));  -- released at COMMIT
create temp table tmp_report (...) on commit drop;
-- ... work ...
commit;   -- nothing survives on the connection
```

Правила:

- Слой доступа к данным в `apps/api` открывает транзакцию и первым оператором выставляет контекст
  тенанта; вне такого хелпера запросы к прикладным таблицам запрещены (см. «Интеграция с NestJS»
  в SKILL.md).
- Сессионные `SET`, `LISTEN/NOTIFY`, `pg_advisory_lock` (не xact) — только на выделенных
  соединениях вне пула (например, у отдельного воркера), и это видно на ревью.
- Prepared statements: при пуле в приложении они привязаны к своему соединению и безопасны —
  драйвер сам управляет ими. Ограничения на prepared statements появляются только при внешнем
  пулере в transaction mode (PgBouncer — **требует ADR**; при его введении проверить поддержку
  протокольных prepared statements в выбранной версии и настройке).

Проверка в тестах: два последовательных запроса разных тенантов на **одном** соединении пула —
второй без выставленного контекста должен падать, а не возвращать строки первого.

Reference: [SET](https://www.postgresql.org/docs/current/sql-set.html),
[Advisory Locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
