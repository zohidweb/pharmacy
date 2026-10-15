-- Invoices and payments of networks (spec 2026-10-15-billing-services, PR 2; sections 3.1, 3.2, 4):
-- the monthly activity of the stores of a network (tenant-export), invoices with their lines, payments
-- with their allocation to invoices and the discounts of networks (platform). Rows of the platform
-- tables are never deleted (B18): a removed line or discount carries removed_at, an allocation that no
-- longer covers an invoice keeps the amount 0. Operators and invoices are never deleted, so the
-- references to them carry no index of their own.

set local lock_timeout = '5s';

-- Activity of a cloud pharmacy in a month (A2, A21): written in the context of the network from its
-- receipts, read by the platform for invoices. closed_on — the business date of the closing in the
-- time zone of the network, which the platform cannot read.
create table pharmacy.store_usage_monthly (
  tenant_id uuid not null references pharmacy.tenants (id),
  store_id uuid not null,
  month date not null check (extract(day from month) = 1),
  receipts_count integer not null check (receipts_count > 0),
  first_sale_date date not null,
  last_sale_date date not null,
  first_sale_ever_date date not null,
  closed_on date,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, store_id, month),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  check (first_sale_date >= month and last_sale_date < (month + interval '1 month')::date),
  check (first_sale_date <= last_sale_date),
  check (first_sale_ever_date <= first_sale_date)
);
create index store_usage_monthly_month_idx on pharmacy.store_usage_monthly (month, tenant_id);

-- An invoice of a network for a month (A4, A5, A8): the snapshot of the tariff, VAT, the requisites of
-- the platform and the payer at issue; paid_dirams and paid_on are written by the allocation.
create table pharmacy.invoices (
  id uuid primary key,
  tenant_id uuid not null references pharmacy.tenants (id),
  period_month date not null check (extract(day from period_month) = 1),
  number text not null unique check (number ~ '^СЧ-[0-9]{4}-[0-9]{2}-[0-9]{3,}$'),
  issued_at timestamptz not null default now(),
  due_on date not null,
  price_per_store_dirams bigint not null check (price_per_store_dirams between 1 and 10000000000),
  vat_bp integer not null check (vat_bp between 0 and 10000),
  subtotal_dirams bigint not null check (subtotal_dirams >= 0),
  vat_dirams bigint not null check (vat_dirams >= 0),
  total_dirams bigint not null,
  paid_dirams bigint not null default 0,
  paid_on date,
  tenant_name text not null,
  tenant_inn text not null,
  supplier_name text not null,
  supplier_inn text not null,
  supplier_bank_account text not null,
  supplier_bank_name text not null,
  supplier_bank_bik text not null,
  supplier_bank_corr_account text not null,
  payment_purpose text not null,
  recalculated_at timestamptz,
  created_by uuid not null references pharmacy.operators (id),
  unique (tenant_id, period_month),
  unique (tenant_id, id),
  check (total_dirams = subtotal_dirams + vat_dirams),
  check (paid_dirams between 0 and total_dirams),
  check ((paid_on is not null) = (paid_dirams = total_dirams))
);
create index invoices_period_idx on pharmacy.invoices (period_month);

-- tenant_services gets a key with the network for the lines of invoices, and the hash of the request
-- that added a service without an order of the network (B17).
alter table pharmacy.tenant_services
  add column request_hash bytea,
  add constraint tenant_services_tenant_id_key unique (tenant_id, id);

-- A line of an invoice: a store with its billed days and discount, or a provided service (A2, A3,
-- A11). A recalculation or a cancelled service removes a line by removed_at (B18).
create table pharmacy.invoice_lines (
  id uuid primary key,
  tenant_id uuid not null references pharmacy.tenants (id),
  invoice_id uuid not null,
  position smallint not null check (position > 0),
  kind text not null check (kind in ('store', 'service')),
  store_id uuid,
  store_name text,
  days smallint check (days > 0),
  days_in_month smallint check (days_in_month between 28 and 31),
  base_dirams bigint check (base_dirams >= 0),
  discount_bp integer check (discount_bp between 0 and 10000),
  tenant_service_id uuid,
  description text,
  provided_on date,
  amount_dirams bigint not null check (amount_dirams >= 0),
  removed_at timestamptz,
  removed_reason text check (removed_reason in ('recalculated', 'service_cancelled')),
  foreign key (tenant_id, invoice_id) references pharmacy.invoices (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, tenant_service_id) references pharmacy.tenant_services (tenant_id, id),
  check (kind <> 'store' or (store_id is not null and store_name is not null and days is not null
    and days_in_month is not null and days <= days_in_month and base_dirams is not null
    and discount_bp is not null)),
  check (kind = 'store' or (store_id is null and days is null and base_dirams is null
    and discount_bp is null)),
  check (kind <> 'service' or (tenant_service_id is not null and description is not null
    and provided_on is not null)),
  check (kind = 'service' or tenant_service_id is null),
  check ((removed_at is null) = (removed_reason is null))
);
create index invoice_lines_invoice_idx on pharmacy.invoice_lines (tenant_id, invoice_id);
create index invoice_lines_store_idx on pharmacy.invoice_lines (tenant_id, store_id)
  where store_id is not null;
create unique index invoice_lines_service_uq on pharmacy.invoice_lines (tenant_service_id)
  where removed_at is null;

-- A payment of a network (B1, B2, A9): id is the idempotency key made by the client, request_hash —
-- the hash of the first request. A cancelled payment stays with its reason.
create table pharmacy.tenant_payments (
  id uuid primary key,
  tenant_id uuid not null references pharmacy.tenants (id),
  amount_dirams bigint not null check (amount_dirams between 1 and 10000000000),
  paid_on date not null,
  method text not null check (method in ('bank_transfer', 'cash')),
  comment text check (comment is null or char_length(comment) between 1 and 500),
  preferred_invoice_id uuid,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 5 and 500),
  cancelled_by uuid references pharmacy.operators (id),
  cancelled_at timestamptz,
  recorded_by uuid not null references pharmacy.operators (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  request_hash bytea not null,
  unique (tenant_id, id),
  foreign key (tenant_id, preferred_invoice_id) references pharmacy.invoices (tenant_id, id),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check ((status = 'cancelled') = (cancelled_by is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index tenant_payments_tenant_idx on pharmacy.tenant_payments (tenant_id, paid_on);

-- What a payment covers of an invoice (A7): derived, written again on every change of the network;
-- an amount 0 means the pair no longer covers anything (B18).
create table pharmacy.tenant_payment_allocations (
  payment_id uuid not null,
  invoice_id uuid not null,
  tenant_id uuid not null references pharmacy.tenants (id),
  amount_dirams bigint not null check (amount_dirams >= 0),
  primary key (payment_id, invoice_id),
  foreign key (tenant_id, payment_id) references pharmacy.tenant_payments (tenant_id, id),
  foreign key (tenant_id, invoice_id) references pharmacy.invoices (tenant_id, id)
);
create index tenant_payment_allocations_invoice_idx
  on pharmacy.tenant_payment_allocations (tenant_id, invoice_id);

-- A discount of a network on the store tariff for months from … to, both included (A10); periods of
-- one network do not overlap (checked by the service under the lock of the network).
create table pharmacy.tenant_discounts (
  id uuid primary key,
  tenant_id uuid not null references pharmacy.tenants (id),
  percent_bp integer not null check (percent_bp between 100 and 10000),
  from_month date not null check (extract(day from from_month) = 1),
  to_month date not null check (extract(day from to_month) = 1),
  created_by uuid not null references pharmacy.operators (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references pharmacy.operators (id),
  check (from_month <= to_month),
  check ((removed_at is null) = (removed_by is null))
);
create index tenant_discounts_tenant_idx on pharmacy.tenant_discounts (tenant_id, from_month);

-- The advance of a network: payments not allocated to invoices (3.1 p. 3), written by the allocation.
alter table pharmacy.tenants
  add column billing_advance_dirams bigint not null default 0
    check (billing_advance_dirams >= 0);

alter table pharmacy.store_usage_monthly enable row level security;
alter table pharmacy.store_usage_monthly force row level security;
alter table pharmacy.invoices enable row level security;
alter table pharmacy.invoices force row level security;
alter table pharmacy.invoice_lines enable row level security;
alter table pharmacy.invoice_lines force row level security;
alter table pharmacy.tenant_payments enable row level security;
alter table pharmacy.tenant_payments force row level security;
alter table pharmacy.tenant_payment_allocations enable row level security;
alter table pharmacy.tenant_payment_allocations force row level security;
alter table pharmacy.tenant_discounts enable row level security;
alter table pharmacy.tenant_discounts force row level security;

create policy tenant_isolation on pharmacy.store_usage_monthly for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_read on pharmacy.store_usage_monthly for select to pharmacy_platform
  using (true);

-- The network reads its own invoices, their lines and its discounts (ADR-0013, amendment 2026-10-15);
-- payments and allocations it does not read: what is paid it sees in its invoices.
create policy tenant_own_read on pharmacy.invoices for select to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_all on pharmacy.invoices for all to pharmacy_platform
  using (true) with check (true);
create policy tenant_own_read on pharmacy.invoice_lines for select to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_all on pharmacy.invoice_lines for all to pharmacy_platform
  using (true) with check (true);
create policy tenant_own_read on pharmacy.tenant_discounts for select to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_all on pharmacy.tenant_discounts for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.tenant_payments for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.tenant_payment_allocations for all to pharmacy_platform
  using (true) with check (true);

grant select, insert, delete on pharmacy.store_usage_monthly to pharmacy_app;
grant select on pharmacy.store_usage_monthly to pharmacy_platform;
grant select on pharmacy.invoices to pharmacy_app;
grant select, insert, update on pharmacy.invoices to pharmacy_platform;
grant select on pharmacy.invoice_lines to pharmacy_app;
grant select, insert, update on pharmacy.invoice_lines to pharmacy_platform;
grant select on pharmacy.tenant_discounts to pharmacy_app;
grant select, insert, update on pharmacy.tenant_discounts to pharmacy_platform;
grant select, insert, update on pharmacy.tenant_payments to pharmacy_platform;
grant select, insert, update on pharmacy.tenant_payment_allocations to pharmacy_platform;
