---
title: Choose the Right Index Type for Your Data
impact: HIGH
impactDescription: 10-100x improvement with correct index type
tags: indexes, btree, gin, gist, brin, hash, index-types
---

## Choose the Right Index Type for Your Data

Different index types excel at different query patterns. The default B-tree isn't always optimal.

**Incorrect (B-tree for substring search):**

```sql
-- B-tree cannot serve '%…%' patterns
create index products_name_idx on products (tenant_id, name_ru);
select * from products where tenant_id = $1 and name_ru ilike '%парацет%';  -- Seq Scan
```

**Correct (trigram GIN for substring / typo search):**

```sql
create extension if not exists pg_trgm;
create index products_name_trgm_idx on products using gin (name_ru gin_trgm_ops);
select * from products where tenant_id = $1 and name_ru ilike '%парацет%';
```

Index type guide:

```sql
-- B-tree (default): =, <, >, BETWEEN, IN, IS NULL, ORDER BY — almost all tenant-scoped lookups
create index batches_fefo_idx on batches (tenant_id, store_id, product_id, expires_on);

-- GIN: full-text (tsvector), trigrams (pg_trgm), JSONB, arrays
create index products_search_idx on products using gin (search_vector);

-- GiST: trigram KNN ordering (ORDER BY name <-> 'query'), ranges/exclusion constraints
create index products_name_gist_idx on products using gist (name_ru gist_trgm_ops);

-- BRIN: huge append-only tables queried by time range (tiny index)
create index audit_log_occurred_brin on audit_log using brin (occurred_at);

-- Hash: equality only; B-tree is usually just as good — prefer B-tree
```

Расширения (`pg_trgm`, `btree_gin` и др.) должны быть доступны и в облачной БД, и в образе
офлайн-точки — см. `advanced-full-text-search.md`.

Reference: [Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
