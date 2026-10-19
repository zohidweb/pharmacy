-- Up Migration
-- Statistics of the admin (spec 2026-10-19-admin-dashboard-stats, D1, D4, D16; ADR-0013, amendment
-- 2026-10-19): the marts a network refreshes from its receipts in its own context and the platform
-- reads — the receipts of a pharmacy by business date, the cashiers of a network by month and the time
-- of the last refresh (tenant-export). No goods, no lines of receipts, no employees. An index finds the
-- receipts written to the cloud since the last refresh; the platform sees the kind of a store
-- (amendment, item 3).

set local lock_timeout = '5s';

-- A pharmacy on a business date: the number and the sum of its receipts (discounts applied, returns
-- not subtracted) and the time of the last one. Rows are refreshed, never deleted: receipts are
-- append-only, so a store-day never loses one.
create table pharmacy.store_sales_daily (
  tenant_id uuid not null references pharmacy.tenants (id),
  store_id uuid not null,
  business_date date not null,
  receipts_count integer not null check (receipts_count > 0),
  sales_dirams bigint not null check (sales_dirams >= 0),
  last_sold_at timestamptz not null,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, store_id, business_date),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id)
);
-- the platform reads a period of all networks
create index store_sales_daily_date_idx on pharmacy.store_sales_daily (business_date);

-- A network in a month: the number of different cashiers with a receipt.
create table pharmacy.tenant_cashiers_monthly (
  tenant_id uuid not null references pharmacy.tenants (id),
  month date not null check (extract(day from month) = 1),
  active_cashiers integer not null check (active_cashiers >= 0),
  computed_at timestamptz not null default now(),
  primary key (tenant_id, month)
);

-- The last refresh of the marts of a network: its receipts written to the cloud before it, less a
-- margin, are in the marts (D4).
create table pharmacy.tenant_stats_refresh (
  tenant_id uuid primary key references pharmacy.tenants (id),
  refreshed_at timestamptz not null
);

-- The receipts written to the cloud since the last refresh (D4, D16)
create index receipts_created_idx on pharmacy.receipts (tenant_id, created_at);

alter table pharmacy.store_sales_daily enable row level security;
alter table pharmacy.store_sales_daily force row level security;
alter table pharmacy.tenant_cashiers_monthly enable row level security;
alter table pharmacy.tenant_cashiers_monthly force row level security;
alter table pharmacy.tenant_stats_refresh enable row level security;
alter table pharmacy.tenant_stats_refresh force row level security;

create policy tenant_isolation on pharmacy.store_sales_daily for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_read on pharmacy.store_sales_daily for select to pharmacy_platform
  using (true);
create policy tenant_isolation on pharmacy.tenant_cashiers_monthly for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_read on pharmacy.tenant_cashiers_monthly for select to pharmacy_platform
  using (true);
create policy tenant_isolation on pharmacy.tenant_stats_refresh for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_read on pharmacy.tenant_stats_refresh for select to pharmacy_platform
  using (true);

grant select, insert, update on pharmacy.store_sales_daily to pharmacy_app;
grant select on pharmacy.store_sales_daily to pharmacy_platform;
grant select, insert, update on pharmacy.tenant_cashiers_monthly to pharmacy_app;
grant select on pharmacy.tenant_cashiers_monthly to pharmacy_platform;
grant select, insert, update on pharmacy.tenant_stats_refresh to pharmacy_app;
grant select on pharmacy.tenant_stats_refresh to pharmacy_platform;

-- Pharmacy or warehouse: registry data like the name and the mode (ADR-0013, amendment 2026-10-19,
-- item 3); the statistics and the store tile of the dashboard count pharmacies only.
grant select (kind) on pharmacy.stores to pharmacy_platform;
