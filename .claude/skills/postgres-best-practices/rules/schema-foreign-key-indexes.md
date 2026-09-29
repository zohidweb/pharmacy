---
title: Index Foreign Key Columns (Tenant-Scoped)
impact: HIGH
impactDescription: 10-100x faster JOINs and CASCADE operations
tags: foreign-key, indexes, joins, schema, tenant_id
---

## Index Foreign Key Columns (Tenant-Scoped)

Postgres does not automatically index foreign key columns. Missing indexes cause slow JOINs and
CASCADE/`ON DELETE` checks. В Pharmacy FK — составные `(tenant_id, parent_id)` (запрещают ссылку на
строку чужого тенанта, см. `security-rls-basics.md`), и индекс на дочерней стороне — тоже с
ведущим `tenant_id`.

**Incorrect (unindexed foreign key):**

```sql
create table receipt_lines (
  id uuid primary key,
  tenant_id uuid not null,
  receipt_id uuid not null,
  foreign key (tenant_id, receipt_id) references receipts (tenant_id, id)
);

-- No index on (tenant_id, receipt_id)!
select * from receipt_lines where tenant_id = $1 and receipt_id = $2;  -- Seq Scan
```

**Correct (indexed foreign key):**

```sql
create index receipt_lines_receipt_idx on receipt_lines (tenant_id, receipt_id);
create index receipt_lines_batch_idx   on receipt_lines (tenant_id, batch_id);

select * from receipt_lines where tenant_id = $1 and receipt_id = $2;  -- Index Scan
```

Прикладные данные в Pharmacy не удаляются каскадно (чеки, движения, аудит — неизменяемы), поэтому
по умолчанию `on delete restrict`/`no action`; `cascade` — только для черновиков и служебных таблиц.

Find missing FK indexes (FK columns not covered by the leading columns of any index):

```sql
select c.conrelid::regclass as table_name, c.conname, c.conkey
from pg_constraint c
where c.contype = 'f'
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid
      and i.indnkeyatts >= cardinality(c.conkey)
      -- the first N key columns of the index (indkey is 0-based) are exactly the FK columns
      and (select bool_and(coalesce(i.indkey[s] = any (c.conkey), false))
           from generate_series(0, cardinality(c.conkey) - 1) as s)
  );
```

Reference: [Foreign Keys](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK)
