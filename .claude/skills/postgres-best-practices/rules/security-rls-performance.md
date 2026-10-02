---
title: Keep Tenant RLS Policies Cheap and Index-Friendly
impact: HIGH
impactDescription: RLS adds near-zero overhead when the policy is a single indexed equality on a leading tenant_id
tags: rls, performance, tenant_id, indexes, multi-tenant
---

## Keep Tenant RLS Policies Cheap and Index-Friendly

Касса должна укладываться в ≤ 1 сек, а `stock_movements` за 3 года — десятки миллионов строк.
RLS-политика добавляется к каждому запросу, поэтому она должна быть одним равенством по
`tenant_id`, которое планировщик может использовать в индексе.

**Incorrect (подзапросы и функции в политике, индексы без tenant_id):**

```sql
-- Per-row subquery: tenant resolved through employees on every row
create policy tenant_isolation on stock_movements for all to pharmacy_app
  using (store_id in (
    select s.id from stores s
    join employees e on e.tenant_id = s.tenant_id
    where e.id = current_setting('app.employee_id')::uuid
  ));

-- Index without tenant_id: the policy predicate cannot use it
create index stock_movements_batch_idx on stock_movements (batch_id);
```

**Correct (одно равенство, значение вычисляется один раз, ведущий tenant_id):**

```sql
-- (select ...) turns the setting into an InitPlan: evaluated once per query, not per row
create policy tenant_isolation on stock_movements for all to pharmacy_app
  using      (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

-- Every hot-path index starts with tenant_id
create index stock_movements_batch_idx  on stock_movements (tenant_id, store_id, batch_id) include (qty_delta_pieces);
create index receipts_store_created_idx on receipts (tenant_id, store_id, created_at);

-- Unique constraints are scoped to the tenant as well
alter table products add constraint products_code_uq unique (tenant_id, code);
```

Правила:

- В политике — только изоляция тенанта. Права «модуль × действие × охват точек» (кастомные роли)
  проверяются в приложении, а не в RLS: их логика сложная и меняется, в политике она убивает план.
- Если без проверки по связанной таблице не обойтись — `SECURITY DEFINER` функция с
  `set search_path = ''`, `STABLE`, вызываемая как `(select fn(...))`; владелец функции — не роль
  приложения. Такие функции проходят ревью как код с повышенными правами.
- Приложение **всё равно** пишет `where tenant_id = $1` явно: так планировщик видит параметр
  (точнее статистика и выбор индекса), а RLS остаётся страховкой.
- Проверяйте планы под ролью приложения и с выставленным контекстом — план от superuser/владельца
  без RLS не показателен (см. `monitor-explain-analyze.md`).

```sql
begin;
set local role pharmacy_app;
select set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);
explain (analyze, buffers)
select sum(qty) from stock_movements
where tenant_id = '00000000-0000-0000-0000-000000000001' and batch_id = $1;
-- Expect: Index Only Scan using stock_movements_batch_idx
rollback;
```

Reference: [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)
