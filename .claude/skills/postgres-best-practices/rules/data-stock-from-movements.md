---
title: Derive Stock from Batch Movements in One Atomic Transaction (FEFO + FOR UPDATE)
impact: CRITICAL
impactDescription: Stock = sum of movements always holds; no overselling of a batch under concurrent cashiers
tags: stock, stock-movements, batches, fefo, for-update, transactions, invariant
---

## Derive Stock from Batch Movements in One Atomic Transaction (FEFO + FOR UPDATE)

Главный инвариант системы (ADR-0002): **остаток партии = сумма её движений**. Отдельной таблицы или
колонки остатков нет. Документ (приход, перемещение, списание, инвентаризация, возврат поставщику)
или чек и все его движения пишутся **в одной транзакции** — либо всё, либо ничего. Движения
append-only: ошибка исправляется сторнирующим движением, а не `UPDATE`.

**Incorrect:**

```sql
-- Stored balance updated separately from the receipt: drifts on any failure or race
update batch_balances set on_hand = on_hand - 2 where batch_id = $1;

-- Check-then-write without a lock: two cashiers both see 2 units and both sell 2
select sum(qty) from stock_movements where tenant_id = $1 and batch_id = $2;  -- 2
insert into stock_movements (tenant_id, batch_id, qty, ...) values ($1, $2, -2, ...);

-- Receipt committed in one transaction, movements in another: a crash in between
-- leaves a paid receipt without stock write-off
```

**Correct (одна транзакция: чек-«ворота» → блокировка партий → FEFO-расчёт → движения):**

```sql
begin;
select set_config('app.tenant_id', $1, true);

-- 0. Receipt header first: idempotency gate (see data-idempotency-keys.md).
--    No row returned → duplicate retry: stop here, write no movements.
insert into receipts (id, tenant_id, store_id, shift_id, idempotency_key, request_hash,
                      correlation_id, total_dirams, status)
values ($5, $1, $2, $6, $7, $12, $13, $8, 'paid')
on conflict (tenant_id, idempotency_key) do nothing
returning id;

-- 1. Lock candidate batches of the product at this store.
--    Always lock in the same order (by id) on every write path → no deadlocks
--    (FOR UPDATE is not allowed together with GROUP BY, hence a separate statement).
select b.id
from batches b
where b.tenant_id = $1 and b.store_id = $2 and b.product_id = $3
  and b.expires_on >= current_date
order by b.id
for update;

-- 2. FEFO allocation over balances derived from movements ($4 = requested qty)
with balances as (
  select b.id as batch_id, b.expires_on, coalesce(sum(m.qty), 0) as on_hand
  from batches b
  left join stock_movements m on m.tenant_id = b.tenant_id and m.batch_id = b.id
  where b.tenant_id = $1 and b.store_id = $2 and b.product_id = $3
    and b.expires_on >= current_date
  group by b.id, b.expires_on
  having coalesce(sum(m.qty), 0) > 0
),
fefo as (
  select batch_id, on_hand,
         sum(on_hand) over (order by expires_on, batch_id) - on_hand as taken_before
  from balances
)
select batch_id, least(on_hand, $4 - taken_before) as take_qty
from fefo
where taken_before < $4
order by taken_before;
-- The app checks sum(take_qty) = $4; otherwise ROLLBACK with "insufficient stock" (RFC 7807).
-- If the cashier picked a batch manually, lock and check only that batch.

-- 3. Receipt lines, movements and audit — same transaction
insert into receipt_lines (...) values (...);

insert into stock_movements (id, tenant_id, store_id, batch_id, qty, source_type, source_id)
values ($9, $1, $2, $10, -$11, 'receipt', $5);     -- one row per allocated batch

insert into audit_log (...) values (...);
commit;
```

Схема и индексы:

```sql
create table stock_movements (
  id uuid primary key,
  tenant_id uuid not null,
  store_id uuid not null,
  batch_id uuid not null,
  qty integer not null check (qty <> 0),          -- +in / -out, minimal sale units
  source_type text not null check (source_type in ('document', 'receipt', 'return', 'reversal')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, batch_id) references batches (tenant_id, id)
);
-- Balance of a batch = index-only scan
create index stock_movements_batch_idx on stock_movements (tenant_id, batch_id) include (qty);
create index stock_movements_source_idx on stock_movements (tenant_id, source_type, source_id);
-- FEFO candidate lookup
create index batches_fefo_idx on batches (tenant_id, store_id, product_id, expires_on);
```

Правила:

- **Каждый** путь, уменьшающий остаток партии (чек, списание, перемещение, возврат поставщику),
  сначала берёт `FOR UPDATE` на строки `batches` в порядке `id`. Один путь без блокировки ломает
  инвариант для всех.
- Внешние вызовы (фискализация, курсы НБТ) — **вне** этой транзакции (`lock-short-transactions.md`).
- Проведение документа: смена статуса «черновик → проведён» и вставка движений — одна транзакция;
  повторное проведение не создаёт движения второй раз (проверка статуса под блокировкой документа).
- `stock_movements` — append-only (`schema-append-only-audit.md`): `REVOKE UPDATE, DELETE`.
- Производительность: остатки по точке считаются агрегацией по индексу. Если замеры покажут, что
  отчёты не укладываются, производный кэш остатков (материализованное представление/таблица,
  полностью пересчитываемая из движений) — архитектурное изменение, **требует ADR через `/03-adr`**.
- Тест обязателен: параллельные продажи одной партии не уводят остаток в минус.

Reference: [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html),
[SELECT … FOR UPDATE](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
