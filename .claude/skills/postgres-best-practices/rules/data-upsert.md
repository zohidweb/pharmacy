---
title: Use UPSERT for Insert-or-Update of Reference Data
impact: MEDIUM
impactDescription: Atomic operation, eliminates race conditions
tags: upsert, on-conflict, insert, update
---

## Use UPSERT for Insert-or-Update of Reference Data

Using separate SELECT-then-INSERT/UPDATE creates race conditions. Use INSERT ... ON CONFLICT for
atomic upserts — для настроек, цен, справочников. **Не** для финансовых документов (чек, оплата,
проведённый документ): там `ON CONFLICT DO NOTHING` + ключ идемпотентности
(`data-idempotency-keys.md`), повтор не должен перезаписывать исходные данные.

**Incorrect (check-then-insert race condition):**

```sql
-- Two requests check simultaneously, both find nothing, one fails with duplicate key
select * from store_settings where tenant_id = $1 and store_id = $2 and key = 'receipt_footer';
insert into store_settings (tenant_id, store_id, key, value) values ($1, $2, 'receipt_footer', $3);
```

**Correct (atomic UPSERT):**

```sql
insert into store_settings (tenant_id, store_id, key, value)
values ($1, $2, 'receipt_footer', $3)
on conflict (tenant_id, store_id, key)
do update set value = excluded.value, updated_at = now()
returning *;

-- Retail price of a product at a store (price list is reference data, not a document)
insert into store_prices (tenant_id, store_id, product_id, price_dirams)
values ($1, $2, $3, $4)
on conflict (tenant_id, store_id, product_id)
do update set price_dirams = excluded.price_dirams, updated_at = now()
where store_prices.price_dirams is distinct from excluded.price_dirams;  -- skip no-op writes
```

Конфликтный ключ всегда включает `tenant_id`. Изменение цены, влияющее на историю, пишется в аудит
в той же транзакции.

Reference: [INSERT ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
