---
title: Configure Idle Connection Timeouts
impact: MEDIUM
impactDescription: Kill leaked idle-in-transaction sessions before they block VACUUM and hold row locks
tags: connections, timeout, idle, resource-management
---

## Configure Idle Connection Timeouts

Сессия «idle in transaction» держит блокировки строк (например, `FOR UPDATE` на партии) и мешает
VACUUM. Типичная причина — транзакция, не закрытая из-за исключения или внешнего вызова внутри неё.

**Incorrect (таймауты выключены):**

```sql
show idle_in_transaction_session_timeout;  -- 0 (disabled)

select pid, usename, state, now() - state_change as idle_for, left(query, 80)
from pg_stat_activity
where state = 'idle in transaction'
order by idle_for desc;
-- Sessions idle for hours, holding locks on batches
```

**Correct (таймаут на роль приложения):**

```sql
-- Terminate sessions idle inside a transaction
alter role pharmacy_app set idle_in_transaction_session_timeout = '15s';
```

`idle_session_timeout` (обрыв просто простаивающих соединений) для роли приложения **не**
включайте: пул в `apps/api` держит простаивающие соединения намеренно, и сервер будет рвать их
«из-под» пула. Вместо этого настройте idle-таймаут самого пула (закрывать лишние соединения
через N минут простоя). `idle_session_timeout` уместен для ручных/диагностических ролей.

Внешний пулер (PgBouncer и его `server_idle_timeout`/`client_idle_timeout`) — только после ADR
(см. `conn-pooling.md`).

Reference: [Connection Timeouts](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-IDLE-IN-TRANSACTION-SESSION-TIMEOUT)
