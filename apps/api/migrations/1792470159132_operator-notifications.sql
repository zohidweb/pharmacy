-- Up Migration
-- Operator notifications and announcements to networks (spec 2026-10-19-operator-notifications, N1,
-- N9, N11; section 3). The notifications of the operators are refreshed on read from the platform
-- tables (the queue of the dashboard, payments, revoked keys): one open row per dedupe key, a state
-- that is gone gets resolved_at, events stay. «Read» is per operator. Announcements are written by the
-- platform and read by every network (class shared). Rows of these tables are never deleted.

set local lock_timeout = '5s';

create table pharmacy.platform_notifications (
  id uuid primary key,
  kind text not null check (kind in ('invoice_overdue', 'key_expiring', 'key_revoked',
    'service_requested', 'sync_stale', 'payment_recorded', 'update_available')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  tenant_id uuid references pharmacy.tenants (id),
  store_id uuid,
  entity_type text check (char_length(entity_type) <= 50),
  entity_id uuid,
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  check (store_id is null or tenant_id is not null)
);
create unique index platform_notifications_open_key_uq on pharmacy.platform_notifications (dedupe_key)
  where resolved_at is null;
create index platform_notifications_created_idx on pharmacy.platform_notifications (created_at);

create table pharmacy.platform_notification_reads (
  notification_id uuid not null references pharmacy.platform_notifications (id),
  operator_id uuid not null references pharmacy.operators (id),
  read_at timestamptz not null default now(),
  primary key (notification_id, operator_id)
);

-- One row: the last refresh and the mark of the events (N2, section 4).
create table pharmacy.platform_notification_refresh (
  id smallint primary key check (id = 1),
  refreshed_at timestamptz not null,
  events_after timestamptz not null
);

create table pharmacy.announcements (
  id uuid primary key,
  title text not null check (char_length(title) between 3 and 120),
  text text not null check (char_length(text) between 10 and 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  scope text not null check (scope in ('all', 'cloud', 'offline')),
  created_by uuid not null references pharmacy.operators (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references pharmacy.operators (id),
  check (ends_at > starts_at),
  check ((cancelled_at is null) = (cancelled_by is null))
);
create index announcements_ends_idx on pharmacy.announcements (ends_at);

-- The topics an operator keeps off for the bell and the menu counter (N9).
alter table pharmacy.operators
  add column muted_notification_topics text[] not null default '{}'
  check (muted_notification_topics <@ array['billing', 'keys', 'services', 'sync']::text[]);

alter table pharmacy.platform_notifications enable row level security;
alter table pharmacy.platform_notifications force row level security;
alter table pharmacy.platform_notification_reads enable row level security;
alter table pharmacy.platform_notification_reads force row level security;
alter table pharmacy.platform_notification_refresh enable row level security;
alter table pharmacy.platform_notification_refresh force row level security;
alter table pharmacy.announcements enable row level security;
alter table pharmacy.announcements force row level security;

create policy platform_all on pharmacy.platform_notifications for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.platform_notification_reads for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.platform_notification_refresh for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.announcements for all to pharmacy_platform
  using (true) with check (true);
-- every network reads the announcements; the scope is decided by the query (N13)
create policy tenant_read on pharmacy.announcements for select to pharmacy_app
  using (true);

grant select, insert, update on pharmacy.platform_notifications to pharmacy_platform;
grant select, insert, update on pharmacy.platform_notification_reads to pharmacy_platform;
grant select, insert, update on pharmacy.platform_notification_refresh to pharmacy_platform;
grant select, insert, update on pharmacy.announcements to pharmacy_platform;
grant select on pharmacy.announcements to pharmacy_app;
