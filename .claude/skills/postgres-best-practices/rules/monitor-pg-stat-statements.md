---
title: Enable pg_stat_statements for Query Analysis
impact: LOW-MEDIUM
impactDescription: Identify top resource-consuming queries before tuning anything
tags: pg-stat-statements, statistics, diagnostics, performance
---

## Enable pg_stat_statements for Query Analysis

pg_stat_statements tracks execution statistics for all queries, helping identify slow and frequent
queries. Это встроенное contrib-расширение PostgreSQL для диагностики, а не система мониторинга:
мониторинг (Prometheus, Grafana, OpenTelemetry…) не выбран — вводится через ADR; до него экспортёры
и дашборды не подключать.

**Incorrect (no visibility into query patterns):**

```sql
-- The POS is slow, but which queries are the problem? No way to know.
```

**Correct (enable and query pg_stat_statements):**

```sql
-- Requires server config + restart (cloud DB and offline distribution config alike):
--   shared_preload_libraries = 'pg_stat_statements'
create extension if not exists pg_stat_statements;

-- Slowest by total time
select calls,
       round(total_exec_time::numeric, 2) as total_ms,
       round(mean_exec_time::numeric, 2)  as mean_ms,
       left(query, 120) as query
from pg_stat_statements
order by total_exec_time desc
limit 10;

-- POS budget check: statements with mean > 100 ms
select left(query, 120) as query, calls, round(mean_exec_time::numeric, 1) as mean_ms
from pg_stat_statements
where mean_exec_time > 100
order by mean_exec_time desc;

-- Reset after an optimization to measure the effect
select pg_stat_statements_reset();
```

Запросы нормализуются (параметры заменяются на `$n`), поэтому значения `tenant_id` и ПДн в
статистику не попадают; тем не менее доступ к представлению — только ролям диагностики.

Reference: [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)
