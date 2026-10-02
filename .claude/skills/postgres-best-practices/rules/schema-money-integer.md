---
title: Store Money as Integer Dirams (bigint), Never float or money
impact: CRITICAL
impactDescription: Exact sums on receipts, shifts, supplier debts and 1C exports — no rounding drift
tags: money, dirams, minor-units, bigint, check-constraint, schema
---

## Store Money as Integer Dirams (bigint), Never float or money

Конвенция проекта: деньги — целое число в **дирамах** (minor units TJS, 1 сомони = 100 дирам).
`real/double precision` накапливают ошибку округления, тип `money` зависит от `lc_monetary` и не
хранит валюту, `numeric(10,2)` в колонках сумм расходится с `libs/shared/util` (там integer) и
провоцирует дробные значения на границе API.

**Incorrect:**

```sql
create table receipt_lines (
  unit_price double precision,   -- 0.1 + 0.2 != 0.3
  discount   money,              -- locale-dependent, no currency
  line_total numeric(10,2)       -- fractional somoni leak into JSON as 12.5
);

-- Integer division silently truncates: cost per unit rounded DOWN (against the pharmacy)
select pack_cost_dirams / units_per_pack from batches;
```

**Correct:**

```sql
create table receipt_lines (
  id uuid primary key,
  tenant_id uuid not null,
  receipt_id uuid not null,
  batch_id uuid not null,
  qty integer not null check (qty > 0),                        -- in minimal sale units
  unit_price_dirams bigint not null check (unit_price_dirams >= 0),
  discount_dirams   bigint not null default 0 check (discount_dirams >= 0),
  line_total_dirams bigint not null check (line_total_dirams >= 0),
  check (line_total_dirams = unit_price_dirams * qty - discount_dirams)
);

create table batches (
  -- ...
  pack_cost_dirams bigint  not null check (pack_cost_dirams >= 0),
  units_per_pack   integer not null check (units_per_pack > 0)
  -- TJS only (ADR-0016): no currency / exchange-rate columns  -- docs-check: ok
);

-- Unit cost when splitting a pack: round UP in favour of the pharmacy (project rule)
select (pack_cost_dirams + units_per_pack - 1) / units_per_pack as unit_cost_dirams
from batches;
```

Правила:

- Суффикс колонки — `_dirams`; единственная валюта — TJS (ADR-0016), колонок `currency`/курса нет. <!-- docs-check: ok -->
- Чтение: type parser пула (`apps/api/src/core/database/pool.ts`) отдаёт `int8` как JS `bigint`,
  и `kysely-codegen` типизирует такие колонки как `bigint` (ADR-0006 п. 3) — без потери точности
  и без `parseFloat`.
- `bigint`, а не `integer`: строка чека влезает и в `integer`, но итоги смен, обороты тенанта и долги
  поставщикам за годы — нет (`integer` ≈ 21,4 млн сомони).
- `CHECK (>= 0)` — для цен, сумм строк, оплат, скидок. **Не** ставьте его на сальдо/долг
  поставщику/расхождение смены — они бывают отрицательными. Возвраты — отдельным документом со
  своим типом, а не отрицательной ценой в чеке.
- Правило округления фиксируется в одном месте (`libs/shared/util` и/или SQL-функция) — не
  дублировать разными формулами в отчётах.
- Драйверы Node.js обычно отдают `bigint` строкой — преобразование в число/`bigint` делает слой
  доступа к данным с проверкой диапазона, никогда не `parseFloat`.

Reference: [Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html),
[Monetary Types](https://www.postgresql.org/docs/current/datatype-money.html)
