---
title: Use JSONB Only for Extensible Attributes, and Index It
impact: LOW
impactDescription: 10-100x faster JSONB queries with proper indexing; keeps core fields relational
tags: jsonb, gin, indexes, json
---

## Use JSONB Only for Extensible Attributes, and Index It

JSONB queries without indexes scan the entire table. Use GIN indexes for containment queries.

В Pharmacy JSONB уместен для действительно расширяемых данных: полезная нагрузка операций очереди
синхронизации, `details` в аудите, дополнительные поля рецепта ПКУ (состав уточняется заказчиком).
**Не** в JSONB: `tenant_id`, суммы, количества, сроки годности, статусы, ссылки на партии —
для них нужны типы, `CHECK`, FK и обычные индексы.

**Incorrect (core fields in JSONB, no index):**

```sql
create table receipts (
  id uuid primary key,
  data jsonb      -- {"tenantId": "...", "total": 12.5, "lines": [...]}
);
select * from receipts where data->>'tenantId' = $1;   -- no RLS column, no FK, Seq Scan
```

**Correct (relational core + indexed JSONB extension):**

```sql
create table prescriptions (
  id uuid primary key,
  tenant_id uuid not null,
  receipt_id uuid not null,
  issued_on date not null,
  extra_fields jsonb not null default '{}'   -- customer-defined fields, personal data masked in logs
);

-- GIN for containment (@>, ?, ?&, ?|)
create index prescriptions_extra_gin on prescriptions using gin (extra_fields jsonb_path_ops);
select * from prescriptions where tenant_id = $1 and extra_fields @> '{"blank_type": "special"}';

-- Frequent single-key lookup: expression B-tree index
create index prescriptions_doctor_idx on prescriptions (tenant_id, (extra_fields->>'doctor_code'));
```

Choose the operator class:

```sql
-- jsonb_ops (default): supports all operators, larger index
-- jsonb_path_ops: only @> (and jsonpath @? @@), 2-3x smaller index
```

Reference: [JSONB Indexing](https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING)
