---
title: Maintain Table Statistics with VACUUM and ANALYZE
impact: MEDIUM
impactDescription: 2-10x better query plans with accurate statistics; index-only scans on movements
tags: vacuum, analyze, statistics, maintenance, autovacuum
---

## Maintain Table Statistics with VACUUM and ANALYZE

Outdated statistics cause the query planner to make poor decisions. VACUUM reclaims space and keeps
the visibility map fresh (needed for index-only scans), ANALYZE updates statistics.

Профили таблиц Pharmacy:

- **append-only, растущие** (`stock_movements`, `audit_log`, журнал ПКУ): мёртвых строк почти нет,
  но без VACUUM visibility map устаревает и расчёт остатка теряет Index Only Scan.
- **высокая «текучка»** (`sync_outbox`, `sync_inbox`, черновики документов): много UPDATE/DELETE →
  раздувание, если autovacuum не успевает.

**Incorrect (stale statistics):**

```sql
-- stock_movements has 40M rows, stats say 1M → planner picks a bad plan
explain select sum(qty) from stock_movements where tenant_id = $1 and batch_id = $2;
```

**Correct (maintain fresh statistics):**

```sql
-- After a large import (opening balances, catalog)
analyze stock_movements;
analyze products;

-- Check when tables were last vacuumed/analyzed
select relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
from pg_stat_user_tables
order by n_dead_tup desc;
```

Autovacuum tuning per table profile:

```sql
-- Append-only: vacuum on inserts (PostgreSQL 13+) to keep the visibility map fresh
alter table stock_movements set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

-- High-churn queue
alter table sync_outbox set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 1000
);

-- Progress of running vacuums
select * from pg_stat_progress_vacuum;
```

Офлайн-точка: autovacuum включён по умолчанию — не отключайте его ради «производительности»
слабого ПК. Длинные незакрытые транзакции мешают VACUUM (см. `conn-idle-timeout.md`).

Reference: [Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
