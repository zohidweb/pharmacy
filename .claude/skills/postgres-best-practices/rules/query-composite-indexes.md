---
title: Create Composite Indexes with tenant_id First
impact: HIGH
impactDescription: 5-10x faster multi-column queries
tags: indexes, composite-index, multi-column, query-optimization, tenant_id
---

## Create Composite Indexes with tenant_id First

When queries filter on multiple columns, a composite index is more efficient than separate
single-column indexes. В мультитенантной схеме первая колонка — `tenant_id` (равенство в каждом
запросе и в RLS), затем остальные равенства, диапазон — последним.

**Incorrect (separate indexes, tenant_id missing):**

```sql
create index documents_status_idx  on documents (status);
create index documents_created_idx on documents (created_at);

select * from documents
where tenant_id = $1 and store_id = $2 and status = 'draft' and created_at > $3;
```

**Correct (composite index):**

```sql
-- Equality columns first (tenant_id, store_id, status), range column last (created_at)
create index documents_store_status_created_idx
  on documents (tenant_id, store_id, status, created_at);

select * from documents
where tenant_id = $1 and store_id = $2 and status = 'draft' and created_at > $3;
```

**Column order matters** (leftmost prefix rule):

```sql
-- Index (tenant_id, store_id, status, created_at)
-- Works for: WHERE tenant_id = … AND store_id = …
-- Works for: WHERE tenant_id = … AND store_id = … AND status = … AND created_at > …
-- Does NOT work well for: WHERE store_id = … AND created_at > … (tenant_id skipped)
```

Не плодите индексы: каждый индекс замедляет запись чека и движений. Перед добавлением — проверьте
`pg_stat_user_indexes.idx_scan` существующих индексов и план запроса.

Reference: [Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
