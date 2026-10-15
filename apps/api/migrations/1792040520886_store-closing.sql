-- Up Migration
-- Store closing (spec 2026-10-15-store-closing, E2–E12; data models 01, 03): the whole stock of a store
-- leaves by transfers of at most 500 lines; while they are in transit the store is `closing` — it sells
-- and posts nothing — and it is `closed` when the receiver accepts the last one. A store without stock
-- closes at once. No data change: no store is closing or closed yet.

alter table pharmacy.stores drop constraint stores_status_check;
alter table pharmacy.stores
  add constraint stores_status_check check (status in ('active', 'closing', 'closed'));

-- who started the closing and when, and the receiver of the stock (null for a store without stock)
alter table pharmacy.stores
  add column closing_started_at timestamptz,
  add column closing_started_by uuid,
  add column closing_receiver_store_id uuid,
  add constraint stores_closing_started_by_fkey
    foreign key (tenant_id, closing_started_by) references pharmacy.employees (tenant_id, id),
  add constraint stores_closing_receiver_fkey
    foreign key (tenant_id, closing_receiver_store_id) references pharmacy.stores (tenant_id, id),
  add constraint stores_closing_check
    check (status <> 'closing' or (closing_started_at is not null and closing_started_by is not null));
create index stores_closing_started_by_idx on pharmacy.stores (tenant_id, closing_started_by);
create index stores_closing_receiver_idx on pharmacy.stores (tenant_id, closing_receiver_store_id);

-- a transfer made by the closing of its sender (documents.store_id)
alter table pharmacy.documents
  add column store_closing boolean not null default false,
  add constraint documents_store_closing_check check (not store_closing or type = 'transfer');
create index documents_store_closing_idx on pharmacy.documents (tenant_id, store_id)
  where store_closing;
