---
title: Use Partial Indexes for Filtered Queries
impact: HIGH
impactDescription: 5-20x smaller indexes, faster writes and queries
tags: indexes, partial-index, query-optimization, storage
---

## Use Partial Indexes for Filtered Queries

Partial indexes only include rows matching a WHERE condition, making them smaller and faster when
queries consistently filter on the same condition.

**Incorrect (full index includes irrelevant rows):**

```sql
-- Index covers all documents, but the UI only lists drafts and in-transit transfers
create index documents_store_idx on documents (tenant_id, store_id, created_at);

select * from documents
where tenant_id = $1 and store_id = $2 and status = 'draft'
order by created_at desc;
```

**Correct (partial index matches query filter):**

```sql
create index documents_open_idx on documents (tenant_id, store_id, created_at desc)
where status in ('draft', 'in_transit');

select * from documents
where tenant_id = $1 and store_id = $2 and status = 'draft'
order by created_at desc;
```

Common use cases in Pharmacy:

```sql
-- Queue: only rows a worker can pick up (see lock-skip-locked.md)
create index sync_outbox_ready_idx on sync_outbox (next_attempt_at, id) where status = 'pending';

-- Open shift per store (also enforces "one open shift" per store)
create unique index shifts_one_open_idx on shifts (tenant_id, store_id) where closed_at is null;

-- Active (not archived) products for POS search
create index products_active_idx on products (tenant_id, name_ru) where archived_at is null;
```

Условие запроса должно логически совпадать с условием индекса (с литералами, а не параметрами),
иначе планировщик его не выберет.

Reference: [Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
