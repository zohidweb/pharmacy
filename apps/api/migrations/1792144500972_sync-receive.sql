-- Up Migration
-- Offline-store sync, PR 1 (spec 2026-10-16-offline-sync, E10–E20, E40; ADR-0014 §2, §6–8; data model 06, 01):
-- the cloud receives the operations of an offline store.
--   license_keys       - class `platform`: the key of an offline store (only its SHA-256 is kept); the network
--                        reads its own rows;
--   sync_inbox         - class `tenant`: the idempotency gate and the raw envelope of every operation of a store.
--                        Not partitioned (E40): the key is exactly (tenant_id, store_id, operation_id), so a
--                        repeat months later still meets ON CONFLICT;
--   sync_runs          - class `tenant`: one run of a store (handshake … complete);
--   sync_conflicts     - class `tenant`: price and duplicate conflicts (written from PR 2 on);
--   store_sync_status  - class `tenant-export`: the last state of a store, read by the owner and the operator;
--   resolve_license_key - the pre-context resolver of the sync contour (ADR-0013 p. 3).
-- platform_settings gains the offline settings (E13); receipts.origin gains `offline_store`.

create table pharmacy.license_keys (
  id uuid primary key,
  key_id text not null unique check (key_id ~ '^[0-9a-f]{16}$'),
  key_hash bytea not null unique check (octet_length(key_hash) = 32),
  tenant_id uuid not null references pharmacy.tenants (id),
  store_id uuid not null,
  valid_until timestamptz not null,
  notify_before_days integer not null default 7 check (notify_before_days between 0 and 365),
  status text not null default 'active' check (status in ('active', 'revoked', 'revoked_hard')),
  issued_by uuid references pharmacy.operators (id),
  issued_at timestamptz not null default now(),
  revoked_by uuid references pharmacy.operators (id),
  revoked_at timestamptz,
  replaces_key_id uuid references pharmacy.license_keys (id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  check ((status = 'active') = (revoked_at is null))
);
-- At most one active key per store (data model 01).
create unique index license_keys_active_uq on pharmacy.license_keys (tenant_id, store_id)
  where status = 'active';
create index license_keys_store_idx on pharmacy.license_keys (tenant_id, store_id, issued_at);

create table pharmacy.sync_inbox (
  tenant_id uuid not null references pharmacy.tenants (id),
  store_id uuid not null,
  operation_id uuid not null,
  store_seq bigint not null check (store_seq >= 0),
  type text not null,
  type_version integer not null check (type_version >= 1),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object'),
  status text not null
    check (status in ('applied', 'quarantined', 'rejected', 'pending_dependency')),
  reason text check (char_length(reason) <= 200),
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  primary key (tenant_id, store_id, operation_id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  check ((status = 'applied') = (applied_at is not null))
);
create index sync_inbox_status_idx on pharmacy.sync_inbox (tenant_id, store_id, status, store_seq);

create table pharmacy.sync_runs (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  protocol_version integer not null,
  app_version text not null check (char_length(app_version) <= 50),
  schema_version text not null check (char_length(schema_version) <= 100),
  outbox_depth integer not null check (outbox_depth >= 0),
  oldest_pending_at timestamptz,
  feed_cursor text check (char_length(feed_cursor) <= 40),
  operations_received integer not null default 0,
  applied integer not null default 0,
  duplicate integer not null default 0,
  quarantined integer not null default 0,
  rejected integer not null default 0,
  pending_dependency integer not null default 0,
  bytes_received bigint not null default 0,
  client_report jsonb check (jsonb_typeof(client_report) = 'object'),
  result text not null default 'open' check (result in ('open', 'ok', 'errors')),
  correlation_id text not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  check ((result = 'open') = (finished_at is null))
);
create index sync_runs_store_idx on pharmacy.sync_runs (tenant_id, store_id, started_at);

create table pharmacy.sync_conflicts (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  kind text not null check (kind in ('price', 'duplicate_product')),
  store_id uuid not null,
  entity_id uuid not null,
  local_value jsonb not null check (jsonb_typeof(local_value) = 'object'),
  cloud_value jsonb not null check (jsonb_typeof(cloud_value) = 'object'),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('cloud', 'local', 'merge', 'keep')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, resolved_by) references pharmacy.employees (tenant_id, id),
  check ((status = 'resolved') = (resolved_at is not null)),
  check ((status = 'resolved') = (resolution is not null))
);
create index sync_conflicts_open_idx on pharmacy.sync_conflicts (tenant_id, store_id, kind)
  where status = 'open';
create index sync_conflicts_resolved_by_idx on pharmacy.sync_conflicts (tenant_id, resolved_by);

create table pharmacy.store_sync_status (
  tenant_id uuid not null references pharmacy.tenants (id),
  store_id uuid not null,
  last_contact_at timestamptz not null,
  last_success_at timestamptz,
  last_run_id uuid,
  protocol_version integer not null,
  app_version text not null check (char_length(app_version) <= 50),
  schema_version text not null check (char_length(schema_version) <= 100),
  outbox_depth integer not null check (outbox_depth >= 0),
  oldest_pending_at timestamptz,
  feed_cursor text check (char_length(feed_cursor) <= 40),
  clock_skew_sec integer not null default 0,
  license_status text not null,
  quarantined integer not null default 0 check (quarantined >= 0),
  last_checkpoint jsonb check (jsonb_typeof(last_checkpoint) = 'object'),
  checkpoint_mismatch boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, store_id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id)
);

alter table pharmacy.license_keys enable row level security;
alter table pharmacy.license_keys force row level security;
alter table pharmacy.sync_inbox enable row level security;
alter table pharmacy.sync_inbox force row level security;
alter table pharmacy.sync_runs enable row level security;
alter table pharmacy.sync_runs force row level security;
alter table pharmacy.sync_conflicts enable row level security;
alter table pharmacy.sync_conflicts force row level security;
alter table pharmacy.store_sync_status enable row level security;
alter table pharmacy.store_sync_status force row level security;

create policy tenant_own_read on pharmacy.license_keys for select to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_all on pharmacy.license_keys for all to pharmacy_platform
  using (true) with check (true);
create policy tenant_isolation on pharmacy.sync_inbox for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.sync_runs for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.sync_conflicts for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.store_sync_status for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy platform_read on pharmacy.store_sync_status for select to pharmacy_platform
  using (true);

grant select on pharmacy.license_keys to pharmacy_app;
grant select, insert, update on pharmacy.license_keys to pharmacy_platform;
-- Full DML of a tenant table (ADR-0013 p. 8); the code never deletes inbox keys (ADR-0014 §8).
grant select, insert, update, delete on pharmacy.sync_inbox to pharmacy_app;
grant select, insert, update, delete on pharmacy.sync_runs to pharmacy_app;
grant select, insert, update, delete on pharmacy.sync_conflicts to pharmacy_app;
grant select, insert, update, delete on pharmacy.store_sync_status to pharmacy_app;
grant select on pharmacy.store_sync_status to pharmacy_platform;

-- resolve_license_key - pre-context resolver of the sync contour: the open key id to the key hash, its
-- network and store and what decides the license state. Exact match on the unique key_id.
create function pharmacy.resolve_license_key(p_key_id text)
returns table (key_hash bytea, tenant_id uuid, store_id uuid, status text, valid_until timestamptz,
  revoked_at timestamptz, notify_before_days integer, store_status text, store_closed_at timestamptz,
  store_mode text, tenant_status text)
language sql stable security definer set search_path = '' as $$
  select k.key_hash, k.tenant_id, k.store_id, k.status, k.valid_until, k.revoked_at,
         k.notify_before_days, s.status, s.closed_at, s.mode, n.status
  from pharmacy.license_keys k
  join pharmacy.stores s on s.tenant_id = k.tenant_id and s.id = k.store_id
  join pharmacy.tenants n on n.id = k.tenant_id
  where k.key_id = p_key_id
$$;
alter function pharmacy.resolve_license_key(text) owner to pharmacy_resolver;
revoke all on function pharmacy.resolve_license_key(text) from public;
grant execute on function pharmacy.resolve_license_key(text) to pharmacy_app;

-- The resolver reads only the columns it needs; FORCE RLS applies to it, hence the policies.
create policy resolver_read on pharmacy.license_keys for select to pharmacy_resolver using (true);
grant select (key_id, key_hash, tenant_id, store_id, status, valid_until, revoked_at, notify_before_days)
  on pharmacy.license_keys to pharmacy_resolver;
create policy resolver_read on pharmacy.stores for select to pharmacy_resolver using (true);
grant select (tenant_id, id, status, closed_at, mode) on pharmacy.stores to pharmacy_resolver;

-- Offline settings of the platform (E13): the feed window, the grace days of a revoked key, the protocols.
alter table pharmacy.platform_settings
  add column feed_window_days integer not null default 90 check (feed_window_days between 1 and 3650),
  add column revoked_key_grace_days integer not null default 30
    check (revoked_key_grace_days between 0 and 365),
  add column min_supported_protocol integer not null default 1 check (min_supported_protocol >= 1),
  add column recommended_protocol integer not null default 1
    check (recommended_protocol >= min_supported_protocol);

-- A receipt of an offline store comes with its sync operation (ADR-0014 §4; data model 04).
alter table pharmacy.receipts
  drop constraint receipts_origin_check,
  add constraint receipts_origin_check check (origin in ('online', 'offline_buffer', 'offline_store'));
