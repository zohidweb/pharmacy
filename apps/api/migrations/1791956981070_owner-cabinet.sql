-- Up Migration
-- Owner cabinet, PR 1 (spec 2026-10-14-owner-cabinet, amendments 3.1 items 1-2; data model 01, 06):
-- two network settings, the notifications of the network with the read marks of each employee and
-- the refresh state, and the new permission `notifications:view` for the existing manager roles.
-- Notifications are refreshed on read (E11): no background job writes them. The tables are of class
-- `tenant`; a notification is updated (its parameters) and resolved, so they are not append-only.

-- the network settings of the owner cabinet (E14, E15)
alter table pharmacy.tenant_settings
  add column warn_below_cost boolean not null default true,
  add column disabled_notifications text[] not null default '{}'
    check (disabled_notifications <@ array['batch_expiring', 'low_stock', 'supplier_payment_due',
      'transfer_in_transit', 'shift_discrepancy', 'negative_stock', 'sync_conflict',
      'license_expiring']::text[]);

-- notifications - a state (a batch near expiry, low stock, a supplier payment due, a transfer in
-- transit) or an event (a shift closed with a discrepancy, a sale into minus) of a store or of the
-- whole network (store_id null). Recipients are not stored: the kind's permission and the store
-- scope decide (E10). One open notification per dedupe key; a resolved state gets resolved_at.
create table pharmacy.notifications (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  kind text not null check (kind in ('batch_expiring', 'low_stock', 'supplier_payment_due',
    'transfer_in_transit', 'shift_discrepancy', 'negative_stock', 'sync_conflict', 'license_expiring')),
  store_id uuid,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  entity_type text,
  entity_id uuid,
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id)
);
create unique index notifications_open_key_uq on pharmacy.notifications (tenant_id, dedupe_key)
  where resolved_at is null;
create index notifications_created_idx on pharmacy.notifications (tenant_id, created_at);
create index notifications_store_idx on pharmacy.notifications (tenant_id, store_id);

-- notification_reads - «read» marks of an employee (E12)
create table pharmacy.notification_reads (
  tenant_id uuid not null references pharmacy.tenants (id),
  notification_id uuid not null,
  employee_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (tenant_id, notification_id, employee_id),
  foreign key (tenant_id, notification_id) references pharmacy.notifications (tenant_id, id),
  foreign key (tenant_id, employee_id) references pharmacy.employees (tenant_id, id)
);
create index notification_reads_employee_idx on pharmacy.notification_reads (tenant_id, employee_id);

-- notification_refresh - when the notifications of the network were refreshed last, and from which
-- moment the facts of the events are read next time (E11)
create table pharmacy.notification_refresh (
  tenant_id uuid not null references pharmacy.tenants (id),
  refreshed_at timestamptz,
  events_after timestamptz not null default now(),
  primary key (tenant_id)
);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app.
alter table pharmacy.notifications enable row level security;
alter table pharmacy.notifications force row level security;
alter table pharmacy.notification_reads enable row level security;
alter table pharmacy.notification_reads force row level security;
alter table pharmacy.notification_refresh enable row level security;
alter table pharmacy.notification_refresh force row level security;

create policy tenant_isolation on pharmacy.notifications for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.notification_reads for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.notification_refresh for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

-- not append-only: the full DML set of a tenant table (ADR-0013 p. 8; checked by catalog.int-spec)
grant select, insert, update, delete on
  pharmacy.notifications,
  pharmacy.notification_reads,
  pharmacy.notification_refresh
to pharmacy_app;

-- The manager roles of the existing networks get `notifications:view` (E10): the roles holding
-- `settings:view` (of the default roles only «Заведующий точкой»). New networks get it from
-- roleTemplates. The owner of the tables lifts FORCE for the copy within this transaction only; the
-- sessions of the employees of these roles reload their permissions (permissions_version).
alter table pharmacy.role_permissions no force row level security;
alter table pharmacy.employees no force row level security;
insert into pharmacy.role_permissions (tenant_id, role_id, permission)
select tenant_id, role_id, 'notifications:view'
from pharmacy.role_permissions
where permission = 'settings:view'
on conflict do nothing;
update pharmacy.employees e
set permissions_version = e.permissions_version + 1
where exists (
  select 1 from pharmacy.role_permissions rp
  where rp.tenant_id = e.tenant_id and rp.role_id = e.role_id and rp.permission = 'notifications:view');
alter table pharmacy.role_permissions force row level security;
alter table pharmacy.employees force row level security;
