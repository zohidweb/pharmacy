-- Up Migration
-- Billing and services, PR 1 (spec 2026-10-15-billing-services, B7–B9, A12–A14, A20; amendment 3.1
-- items 1, 5–7; data model 06): the platform settings (tariff, VAT, requisites), the catalog of
-- one-time services, the requests of networks and the operator's decisions on them.
--   platform_settings, services - class `shared`: every network reads them (the tariff for the
--     estimate of the month, the catalog), only the platform writes;
--   service_requests - class `tenant-export`: the network writes its requests, the platform reads;
--   tenant_services - class `platform`: the operator's decisions and services added without a
--     request; the network reads its own rows.
-- The notification kinds gain `service_decided` (this PR) and `invoice_overdue` (PR 2/3 of the spec).

-- One row (id = 1). The requisites are empty until the operator fills them in: invoices are not
-- generated without them (PR 2).
create table pharmacy.platform_settings (
  id smallint primary key check (id = 1),
  store_monthly_price_dirams bigint not null default 40000
    check (store_monthly_price_dirams between 1 and 10000000000),
  -- a whole percent in basis points: 1400 = 14 %
  vat_bp integer not null default 1400 check (vat_bp between 0 and 9900 and vat_bp % 100 = 0),
  supplier_name text not null default '' check (char_length(supplier_name) <= 200),
  supplier_inn text not null default '' check (supplier_inn = '' or supplier_inn ~ '^[0-9]{9}$'),
  supplier_bank_account text not null default ''
    check (supplier_bank_account = '' or supplier_bank_account ~ '^[0-9]{20}$'),
  supplier_bank_name text not null default '' check (char_length(supplier_bank_name) <= 200),
  supplier_bank_bik text not null default ''
    check (supplier_bank_bik = '' or supplier_bank_bik ~ '^[0-9]{9}$'),
  supplier_bank_corr_account text not null default ''
    check (supplier_bank_corr_account = '' or supplier_bank_corr_account ~ '^[0-9]{20}$'),
  payment_purpose_template text not null default ''
    check (char_length(payment_purpose_template) <= 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references pharmacy.operators (id)
);
insert into pharmacy.platform_settings (id) values (1);

-- The catalog of one-time services. name/description: {"ru": …, "tj": …}, Tajik optional.
create table pharmacy.services (
  id uuid primary key,
  name jsonb not null check (jsonb_typeof(name) = 'object' and name ? 'ru'),
  description jsonb not null check (jsonb_typeof(description) = 'object' and description ? 'ru'),
  base_price_dirams bigint not null check (base_price_dirams between 1 and 10000000000),
  visible boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A request of a network. Its state is derived from tenant_services: no row there — pending. A
-- request with a decision cannot be deleted (the foreign key of tenant_services refuses it).
create table pharmacy.service_requests (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  service_id uuid not null references pharmacy.services (id),
  comment text check (comment is null or char_length(comment) between 1 and 500),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, requested_by) references pharmacy.employees (tenant_id, id)
);
create index service_requests_service_idx on pharmacy.service_requests (tenant_id, service_id);
create index service_requests_requested_by_idx on pharmacy.service_requests (tenant_id, requested_by);

-- A decision of the operator on a request (one per request), or a service added without one. The
-- price is the operator's (null only for a rejection); provided_on is the day the work was done.
-- Operators are never deleted, so the references to them carry no index of their own.
create table pharmacy.tenant_services (
  id uuid primary key,
  tenant_id uuid not null references pharmacy.tenants (id),
  service_id uuid not null references pharmacy.services (id),
  request_id uuid,
  price_dirams bigint check (price_dirams between 1 and 10000000000),
  status text not null check (status in ('approved', 'rejected', 'cancelled', 'provided')),
  reason text check (reason is null or char_length(reason) between 5 and 500),
  decided_by uuid not null references pharmacy.operators (id),
  decided_at timestamptz not null default now(),
  provided_on date,
  provided_by uuid references pharmacy.operators (id),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, request_id) references pharmacy.service_requests (tenant_id, id),
  check ((status = 'rejected') = (price_dirams is null)),
  check ((status = 'provided') = (provided_on is not null)),
  check ((status = 'provided') = (provided_by is not null)),
  check ((status in ('rejected', 'cancelled')) = (reason is not null))
);
create unique index tenant_services_request_uq on pharmacy.tenant_services (tenant_id, request_id)
  where request_id is not null;
create index tenant_services_tenant_idx on pharmacy.tenant_services (tenant_id, decided_at);
create index tenant_services_status_idx on pharmacy.tenant_services (status, decided_at);
create index tenant_services_service_idx on pharmacy.tenant_services (service_id);

alter table pharmacy.service_requests enable row level security;
alter table pharmacy.service_requests force row level security;
alter table pharmacy.tenant_services enable row level security;
alter table pharmacy.tenant_services force row level security;

create policy tenant_isolation on pharmacy.service_requests for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_read on pharmacy.service_requests for select to pharmacy_platform
  using (true);
create policy tenant_own_read on pharmacy.tenant_services for select to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_all on pharmacy.tenant_services for all to pharmacy_platform
  using (true) with check (true);

grant select on pharmacy.platform_settings to pharmacy_app;
grant select, update on pharmacy.platform_settings to pharmacy_platform;
grant select on pharmacy.services to pharmacy_app;
grant select, insert, update on pharmacy.services to pharmacy_platform;
grant select, insert, delete on pharmacy.service_requests to pharmacy_app;
grant select on pharmacy.service_requests to pharmacy_platform;
grant select on pharmacy.tenant_services to pharmacy_app;
grant select, insert, update on pharmacy.tenant_services to pharmacy_platform;

-- New notification kinds: the CHECKs of the owner-cabinet migration are rebuilt with them.
alter table pharmacy.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in ('batch_expiring', 'low_stock',
    'supplier_payment_due', 'transfer_in_transit', 'shift_discrepancy', 'negative_stock',
    'sync_conflict', 'license_expiring', 'service_decided', 'invoice_overdue'));
alter table pharmacy.tenant_settings
  drop constraint tenant_settings_disabled_notifications_check,
  add constraint tenant_settings_disabled_notifications_check
    check (disabled_notifications <@ array['batch_expiring', 'low_stock', 'supplier_payment_due',
      'transfer_in_transit', 'shift_discrepancy', 'negative_stock', 'sync_conflict',
      'license_expiring', 'service_decided', 'invoice_overdue']::text[]);
