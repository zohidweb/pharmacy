-- Up Migration
-- Owner cabinet, PR 3 (spec 2026-10-14-owner-cabinet, O4, O5, E16, amendment 3.1 item 3; data model 01):
-- the other expenses of a month — rent, salaries, utilities — entered by the owner for a store or for
-- the whole network (store_id null). A report over a part of the month takes the share of its days
-- (prorateExpense, libs/shared/domain). The cash withdrawals «на расходы» are not copied here: the
-- reports read them from shift_cash_operations (O9). A record is edited and deleted, every change goes
-- to audit_log with the previous values, so the table is of class `tenant`, not append-only.
create table pharmacy.expenses (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  -- the first day of the month
  month date not null check (extract(day from month) = 1),
  store_id uuid,
  kind text not null check (kind in ('rent', 'salary', 'utilities', 'other')),
  amount_dirams bigint not null check (amount_dirams > 0),
  comment text check (char_length(comment) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, created_by) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, updated_by) references pharmacy.employees (tenant_id, id)
);
-- the records of the months of a report or of the screen
create index expenses_month_idx on pharmacy.expenses (tenant_id, month);
-- the foreign keys, as the other employee and store references
create index expenses_store_idx on pharmacy.expenses (tenant_id, store_id);
create index expenses_created_by_idx on pharmacy.expenses (tenant_id, created_by);
create index expenses_updated_by_idx on pharmacy.expenses (tenant_id, updated_by);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app.
alter table pharmacy.expenses enable row level security;
alter table pharmacy.expenses force row level security;
create policy tenant_isolation on pharmacy.expenses for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

-- not append-only: the full DML set of a tenant table (ADR-0013 p. 8; checked by catalog.int-spec)
grant select, insert, update, delete on pharmacy.expenses to pharmacy_app;
