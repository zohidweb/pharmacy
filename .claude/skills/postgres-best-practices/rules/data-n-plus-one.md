---
title: Eliminate N+1 Queries with Batch Loading
impact: MEDIUM-HIGH
impactDescription: 10-100x fewer database round trips — key for the ≤ 1 s POS budget
tags: n-plus-one, batch, performance, queries
---

## Eliminate N+1 Queries with Batch Loading

N+1 queries execute one query per item in a loop. Batch them into a single query using arrays or
JOINs. На кассе каждый лишний round trip съедает бюджет ≤ 1 сек (чек из 15 строк × 3 запроса на
строку — уже 45 обращений к БД).

**Incorrect (N+1 queries):**

```sql
-- For each receipt line the service loads product, then batch, then price
select * from products where tenant_id = $1 and id = $2;
select * from batches  where tenant_id = $1 and id = $3;
select price_dirams from store_prices where tenant_id = $1 and store_id = $4 and product_id = $2;
-- ... repeated for every line
```

**Correct (single batch query):**

```sql
-- One query for all lines: pass arrays as parameters
select p.id, p.name_ru, p.name_tj, p.is_controlled, sp.price_dirams
from products p
join store_prices sp
  on sp.tenant_id = p.tenant_id and sp.product_id = p.id and sp.store_id = $2
where p.tenant_id = $1
  and p.id = any($3::uuid[]);
```

Application pattern: collect IDs in the service, one query with `= any($n::uuid[])`, map results
in memory. Проверяйте ORM/слой доступа (когда будет выбран ADR) на ленивую загрузку связей — это
типичный источник N+1.

Reference: [Row and Array Comparisons](https://www.postgresql.org/docs/current/functions-comparisons.html)
