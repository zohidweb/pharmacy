---
title: Bound OFFSET Pagination; Use Keyset for Deep Scans and Exports
impact: MEDIUM
impactDescription: Consistent performance for sync, exports and long reports regardless of depth
tags: pagination, cursor, keyset, offset, performance
---

## Bound OFFSET Pagination; Use Keyset for Deep Scans and Exports

Контракт REST проекта — `limit`/`offset` (конвенция CLAUDE.md), и для экранных списков
(каталог, документы, чеки за смену) это нормально: глубина страниц мала, запрос всегда
отфильтрован по `tenant_id`/`store_id` и периоду. Проблема OFFSET — сканирование пропущенных строк
на больших глубинах, поэтому:

- для UI — `offset` с верхним пределом `limit` (например, ≤ 100) и индексом под сортировку;
- для внутренних проходов по большим объёмам (выгрузка в 1С за период, пакеты синхронизации,
  пересчёты, отчёты по движениям) — keyset-пагинация, не OFFSET.

**Incorrect (OFFSET в фоновой выгрузке):**

```sql
-- 1C export walks 2M movements with growing offset: each page is slower than the previous
select * from stock_movements
where tenant_id = $1 and created_at >= $2 and created_at < $3
order by created_at, id
limit 1000 offset 1500000;
```

**Correct:**

```sql
-- UI list: bounded offset, index matches filter + sort
create index receipts_store_created_idx on receipts (tenant_id, store_id, created_at desc, id desc);

select id, total_dirams, created_at from receipts
where tenant_id = $1 and store_id = $2
order by created_at desc, id desc
limit $3 offset $4;               -- API validates limit ≤ 100

-- Internal export / sync: keyset on (created_at, id); $4, $5 = last row of the previous page
select * from stock_movements
where tenant_id = $1 and created_at < $3
  and (created_at, id) > ($4, $5)
order by created_at, id
limit 1000;
```

Курсор должен включать все колонки сортировки и уникальный хвост (`id`). Если понадобится
cursor-пагинация в публичном REST, это изменение контракта API — обсуждается отдельно.

Reference: [LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html),
[Row Constructor Comparison](https://www.postgresql.org/docs/current/functions-comparisons.html#ROW-WISE-COMPARISON)
