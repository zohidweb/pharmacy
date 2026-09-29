---
title: Add Indexes on WHERE and JOIN Columns
impact: CRITICAL
impactDescription: 100-1000x faster queries on large tables
tags: indexes, performance, sequential-scan, query-optimization
---

## Add Indexes on WHERE and JOIN Columns

Queries filtering or joining on unindexed columns cause full table scans, which become
exponentially slower as tables grow. В Pharmacy почти каждый запрос фильтруется по `tenant_id`
(и RLS добавляет это условие), поэтому индексы горячих путей начинаются с `tenant_id`.

**Incorrect (sequential scan on large table):**

```sql
-- Stock of a batch: no index on stock_movements (tenant_id, batch_id)
select sum(qty) from stock_movements where tenant_id = $1 and batch_id = $2;

-- EXPLAIN: Seq Scan on stock_movements (… rows=40000000 …)
```

**Correct (index scan):**

```sql
create index stock_movements_batch_idx on stock_movements (tenant_id, batch_id) include (qty);

select sum(qty) from stock_movements where tenant_id = $1 and batch_id = $2;
-- EXPLAIN: Index Only Scan using stock_movements_batch_idx
```

For JOIN columns, always index the referencing side (see `schema-foreign-key-indexes.md`):

```sql
create index receipt_lines_receipt_idx on receipt_lines (tenant_id, receipt_id);

select r.id, l.qty, l.line_total_dirams
from receipts r
join receipt_lines l on l.tenant_id = r.tenant_id and l.receipt_id = r.id
where r.tenant_id = $1 and r.shift_id = $2;
```

Горячие пути, которые обязаны иметь индекс до релиза: поиск товара по штрихкоду, FEFO-выборка
партий, остаток партии, чеки смены, документы точки за период, разбор очереди синхронизации.

Reference: [Indexes](https://www.postgresql.org/docs/current/indexes.html)
