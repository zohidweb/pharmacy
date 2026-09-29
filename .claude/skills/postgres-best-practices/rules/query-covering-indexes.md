---
title: Use Covering Indexes to Avoid Table Lookups
impact: MEDIUM-HIGH
impactDescription: 2-5x faster queries by eliminating heap fetches
tags: indexes, covering-index, include, index-only-scan
---

## Use Covering Indexes to Avoid Table Lookups

Covering indexes include all columns needed by a query, enabling index-only scans that skip the
table entirely. Главный кандидат в Pharmacy — расчёт остатка партии из движений: запрос читает
только `qty`.

**Incorrect (index scan + heap fetch):**

```sql
create index stock_movements_batch_idx on stock_movements (tenant_id, batch_id);

-- Must fetch qty from the table heap for every movement
select sum(qty) from stock_movements where tenant_id = $1 and batch_id = $2;
```

**Correct (index-only scan with INCLUDE):**

```sql
create index stock_movements_batch_idx on stock_movements (tenant_id, batch_id) include (qty);

select sum(qty) from stock_movements where tenant_id = $1 and batch_id = $2;
-- Index Only Scan (Heap Fetches: 0 when the visibility map is up to date)
```

Use INCLUDE for columns you SELECT but don't filter on:

```sql
-- Barcode scan at the POS: need product_id only (INCLUDE works on PK/UNIQUE constraints too)
create table product_barcodes (
  tenant_id uuid not null,
  barcode text not null,
  product_id uuid not null,
  primary key (tenant_id, barcode) include (product_id)
);
```

Index-only scan эффективен, только если visibility map свежая: для append-only таблиц
(`stock_movements`) настройте autovacuum по вставкам (`monitor-vacuum-analyze.md`).

Reference: [Index-Only Scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)
