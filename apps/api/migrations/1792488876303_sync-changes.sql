-- Up Migration
-- The change feed of offline stores, cloud → store (spec 2026-10-16-offline-sync, E4, E5, E22; data model 06):
--   sync_changes    - class `tenant`: one row per change of an entity («entity X changed»), written by the writer in
--                     its own transaction; change_seq is given at read time, under the advisory lock of the network,
--                     so a cursor never skips a change committed late (ADR-0014 §3, amendment E5). No `op`: the state
--                     of the entity is read when the feed is read, a missing entity is a tombstone;
--   sync_feed_state - class `tenant`: the horizon of the network — the highest change_seq removed with the window; a
--                     cursor below it must resync from snapshots.
create sequence pharmacy.sync_change_seq;

create table pharmacy.sync_changes (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  change_seq bigint,
  scope_store_id uuid,
  entity_type text not null check (entity_type in (
    'product', 'category', 'store_price', 'discount_rule', 'role', 'employee', 'supplier', 'tenant_settings',
    'return_policy', 'legal_entity', 'store', 'transfer_in_transit', 'transfer_result', 'purchase_order',
    'transfer_request', 'price_conflict', 'duplicate_conflict')),
  entity_id uuid not null,
  changed_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, scope_store_id) references pharmacy.stores (tenant_id, id)
);
create unique index sync_changes_seq_uq on pharmacy.sync_changes (tenant_id, change_seq)
  where change_seq is not null;
create index sync_changes_unsequenced_idx on pharmacy.sync_changes (tenant_id, id)
  where change_seq is null;
create index sync_changes_scope_idx on pharmacy.sync_changes (tenant_id, scope_store_id);

create table pharmacy.sync_feed_state (
  tenant_id uuid primary key references pharmacy.tenants (id),
  horizon_seq bigint not null default 0 check (horizon_seq >= 0),
  updated_at timestamptz not null default now()
);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML as on every tenant table.
alter table pharmacy.sync_changes enable row level security;
alter table pharmacy.sync_changes force row level security;
create policy tenant_isolation on pharmacy.sync_changes for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.sync_changes to pharmacy_app;

alter table pharmacy.sync_feed_state enable row level security;
alter table pharmacy.sync_feed_state force row level security;
create policy tenant_isolation on pharmacy.sync_feed_state for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.sync_feed_state to pharmacy_app;

grant usage, select on sequence pharmacy.sync_change_seq to pharmacy_app;
