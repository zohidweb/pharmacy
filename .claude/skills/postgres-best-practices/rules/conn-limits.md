---
title: Set Connection Limits and Timeouts per Environment
impact: HIGH
impactDescription: Prevent OOM on the store PC and runaway queries in the shared cloud database
tags: connections, max-connections, limits, stability, timeouts, offline
---

## Set Connection Limits and Timeouts per Environment

Слишком много соединений съедает память и ухудшает производительность. В Pharmacy два профиля:
облачная БД (все тенанты, общий бюджет — «шумный сосед», ADR-0002) и локальная PostgreSQL
офлайн-точки в Docker на ПК аптеки, где память делится с браузером кассы и ОС.

**Incorrect (лимиты «на всякий случай»):**

```sql
show max_connections;  -- 500 on an 8 GB store PC
-- 500 × work_mem during sorts → out of memory, the cashier's browser freezes
```

**Correct (от расчёта пула, см. `conn-pooling.md`):**

```sql
-- Cloud (starting point, recalculate when API instances are added)
alter system set max_connections = 100;
alter system set superuser_reserved_connections = 3;
alter system set work_mem = '8MB';               -- work_mem × active queries ≤ ~25% RAM
alter system set maintenance_work_mem = '256MB'; -- VACUUM, CREATE INDEX

-- Offline store PC (put the same values into the distribution's postgresql.conf / compose
-- command, so that every store is configured identically — not by hand on site)
-- max_connections = 30, work_mem = 4MB, shared_buffers sized for a shared desktop PC
```

Таймауты — на роль приложения, а не глобально (отчётам и миграциям нужны другие значения):

```sql
alter role pharmacy_app set statement_timeout = '5s';                    -- POS ops must be ≤ 1 s
alter role pharmacy_app set lock_timeout = '2s';                         -- fail fast, retry in app
alter role pharmacy_app set idle_in_transaction_session_timeout = '15s'; -- leaked tx get killed

-- Heavy report inside a request: raise the limit for this transaction only
begin;
select set_config('app.tenant_id', $1, true);
set local statement_timeout = '60s';
-- ... report query ...
commit;
```

Проверка:

```sql
select count(*), state from pg_stat_activity group by state;
select rolname, rolconfig from pg_roles where rolname = 'pharmacy_app';
```

Reference: [Resource Consumption](https://www.postgresql.org/docs/current/runtime-config-resource.html),
[Client Connection Defaults](https://www.postgresql.org/docs/current/runtime-config-client.html)
