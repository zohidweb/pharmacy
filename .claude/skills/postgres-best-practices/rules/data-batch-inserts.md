---
title: Batch INSERT Statements for Bulk Data
impact: MEDIUM
impactDescription: 10-50x faster bulk inserts (catalog import, opening balances, sync packets)
tags: batch, insert, bulk, performance, copy
---

## Batch INSERT Statements for Bulk Data

Individual INSERT statements have high overhead. Batch multiple rows in single statements or use
COPY. Где это важно в Pharmacy: импорт каталога, «ввод начальных остатков» (тысячи партий и
движений), применение пакета синхронизации офлайн-точки, строки чека и движения по нескольким
партиям.

**Incorrect (individual inserts):**

```sql
-- One round trip per row, often one transaction per row
insert into stock_movements (id, tenant_id, store_id, batch_id, qty, source_type, source_id)
values ($1, $2, $3, $4, 120, 'document', $5);
-- ... 5000 more for the opening-balance document
```

**Correct (batch insert):**

```sql
-- Multi-row insert from arrays (one statement, one round trip)
insert into stock_movements (id, tenant_id, store_id, batch_id, qty, source_type, source_id)
select m.id, $1, $2, m.batch_id, m.qty, 'document', $3
from unnest($4::uuid[], $5::uuid[], $6::integer[]) as m(id, batch_id, qty);
```

Для крупных загрузок — `COPY … FROM STDIN` через драйвер (данные идут из приложения):

```sql
copy staging_products (tenant_id, name_ru, name_tj, inn, barcode) from stdin with (format csv);
```

Правила:

- `COPY … FROM '/path/file'` (файл на сервере БД) требует привилегий `pg_read_server_files` —
  роли приложения их не выдавать.
- Большой импорт — в staging-таблицу, валидация, затем перенос в прикладные таблицы
  `insert … select` в одной транзакции документа (инвариант остатков сохраняется).
- Пачки по ~1 000 строк: одна гигантская транзакция держит блокировки и раздувает WAL.

Reference: [COPY](https://www.postgresql.org/docs/current/sql-copy.html),
[Populating a Database](https://www.postgresql.org/docs/current/populate.html)
