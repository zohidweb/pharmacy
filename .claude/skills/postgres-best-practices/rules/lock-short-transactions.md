---
title: Keep Transactions Short — No External Calls Inside
impact: MEDIUM-HIGH
impactDescription: 3-5x throughput improvement, fewer lock waits at the POS
tags: transactions, locking, contention, performance, fiscalization
---

## Keep Transactions Short — No External Calls Inside

Long-running transactions hold locks that block other queries. Пока транзакция чека держит
`FOR UPDATE` на партиях, другие кассы с теми же товарами ждут. Внешние вызовы (адаптер
фискализации, синхронизация по HTTPS) внутри транзакции превращают
миллисекунды блокировки в секунды.

**Incorrect (long transaction with external call):**

```sql
begin;
select id from batches where tenant_id = $1 and id = any($2::uuid[]) order by id for update;
insert into receipts (...) values (...);

-- Application calls the fiscalization adapter here (1-5 s, or a timeout)
-- Every other cashier selling these batches is blocked

insert into stock_movements (...) values (...);
commit;
```

**Correct (minimal transaction scope):**

```sql
-- 1. Before: validate input, load prices, compute totals (no locks)

-- 2. Short transaction: receipt + lines + movements + audit + outbox record
begin;
select set_config('app.tenant_id', $1, true);
-- ... lock batches, insert receipt, movements, audit ...
insert into sync_outbox (tenant_id, store_id, operation_id, operation_type, payload)
values ($1, $2, $3, 'fiscalize_receipt', $4);
commit;   -- locks held for milliseconds

-- 3. After: a worker sends the receipt to the fiscal adapter (lock-skip-locked.md)
--    and records the result in its own short transaction
```

Если фискализация по требованиям должна пройти до выдачи чека покупателю — это синхронный вызов
**после** COMMIT с отдельной фиксацией статуса, а не вызов внутри транзакции списания.

Guards against runaway transactions (per role, see `conn-limits.md`):

```sql
alter role pharmacy_app set statement_timeout = '5s';
alter role pharmacy_app set idle_in_transaction_session_timeout = '15s';

-- Per transaction, when a longer limit is justified
set local statement_timeout = '60s';
```

Reference: [Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html)
