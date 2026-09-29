---
title: Use EXPLAIN ANALYZE Under the App Role and Tenant Context
impact: LOW-MEDIUM
impactDescription: Identify exact bottlenecks with the same RLS predicates production queries get
tags: explain, analyze, diagnostics, query-plan, rls
---

## Use EXPLAIN ANALYZE Under the App Role and Tenant Context

EXPLAIN ANALYZE executes the query and shows actual timings. В Pharmacy план зависит от RLS: под
superuser/владельцем (без `FORCE`) политика не применяется и план другой. Снимайте планы под ролью
приложения с выставленным `app.tenant_id` и на данных реалистичного объёма.

**Incorrect (guessing, or explaining as superuser):**

```sql
-- "It must be missing an index" — which one?
-- Or: EXPLAIN as postgres superuser → RLS skipped → misleading plan
explain select * from receipts where store_id = $1;
```

**Correct:**

```sql
begin;
set local role pharmacy_app;
select set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

explain (analyze, buffers, format text)
select id, total_dirams from receipts
where tenant_id = '00000000-0000-0000-0000-000000000001'
  and store_id = '00000000-0000-0000-0000-00000000000a'
  and created_at >= now() - interval '1 day';

rollback;   -- EXPLAIN ANALYZE really executes: always wrap INSERT/UPDATE/DELETE in a rolled-back tx
```

Key things to look for:

```sql
-- Seq Scan on a large table                 = missing index (tenant_id-leading?)
-- Rows Removed by Filter large              = poor selectivity / wrong column order
-- SubPlan per row in the filter             = RLS policy not wrapped in (select …)
-- Buffers: read >> hit                      = data not cached
-- Sort Method: external merge               = work_mem too low for this query
-- actual rows >> estimated rows             = stale statistics → ANALYZE
```

Не запускайте `EXPLAIN ANALYZE` тяжёлых запросов на проде в часы работы аптек; используйте копию
с обезличенными данными (реальные клиентские данные в тестах и фикстурах запрещены).

Reference: [EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html),
[Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
