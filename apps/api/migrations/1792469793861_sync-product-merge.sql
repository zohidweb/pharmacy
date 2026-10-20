-- Up Migration
-- The product merge document of offline stores (spec 2026-10-16-offline-sync, E35; data model 03): when the store
-- merges its own product L into a card X of the network, its posting moves the stock of every batch of L to a new
-- batch of X with the same lot, expiry and purchase price.
--   documents            - type `product_merge` with the two products (merge_from_product_id, merge_into_product_id);
--   batches              - origin `product_merge` (source_batch_id = the batch of L);
--   stock_movements      - kinds `merge_out` (−pieces on the batch of L) and `merge_in` (+pieces on the batch of X);
--                          the check of the big partitioned table is added NOT VALID and validated by the next
--                          migration file (rule cr-N3);
--   product_merge_lines  - class `tenant`: one line per moved batch.
set local lock_timeout = '5s';

alter table pharmacy.documents drop constraint documents_type_check;
alter table pharmacy.documents add constraint documents_type_check
  check (type in ('goods_receipt', 'opening_balance', 'write_off', 'inventory', 'supplier_return',
                  'transfer', 'transfer_request', 'product_merge'));
alter table pharmacy.documents
  add column merge_from_product_id uuid,
  add column merge_into_product_id uuid,
  add foreign key (tenant_id, merge_from_product_id) references pharmacy.products (tenant_id, id),
  add foreign key (tenant_id, merge_into_product_id) references pharmacy.products (tenant_id, id),
  add constraint documents_merge_type_check check (
    (type = 'product_merge') = (merge_from_product_id is not null)
    and (type = 'product_merge') = (merge_into_product_id is not null)
  );
create index documents_merge_from_idx on pharmacy.documents (tenant_id, merge_from_product_id)
  where merge_from_product_id is not null;
create index documents_merge_into_idx on pharmacy.documents (tenant_id, merge_into_product_id)
  where merge_into_product_id is not null;

alter table pharmacy.batches drop constraint batches_origin_check;
alter table pharmacy.batches add constraint batches_origin_check
  check (origin in ('goods_receipt', 'opening_balance', 'inventory_surplus', 'transfer', 'product_merge'));

alter table pharmacy.stock_movements drop constraint stock_movements_kind_check;
alter table pharmacy.stock_movements add constraint stock_movements_kind_check
  check (kind in ('goods_receipt', 'opening_balance', 'write_off', 'inventory_gain', 'inventory_loss',
                  'supplier_return', 'transfer_out', 'transfer_in', 'reversal', 'sale', 'customer_return',
                  'merge_out', 'merge_in')) not valid;

create table pharmacy.product_merge_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  from_batch_id uuid not null,
  to_batch_id uuid not null,
  qty_pieces integer not null check (qty_pieces > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  unique (tenant_id, document_id, from_batch_id),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, from_batch_id) references pharmacy.batches (tenant_id, id),
  foreign key (tenant_id, to_batch_id) references pharmacy.batches (tenant_id, id),
  check (from_batch_id <> to_batch_id)
);
create index product_merge_lines_from_batch_idx on pharmacy.product_merge_lines (tenant_id, from_batch_id);
create index product_merge_lines_to_batch_idx on pharmacy.product_merge_lines (tenant_id, to_batch_id);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML as on every tenant table.
alter table pharmacy.product_merge_lines enable row level security;
alter table pharmacy.product_merge_lines force row level security;
create policy tenant_isolation on pharmacy.product_merge_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.product_merge_lines to pharmacy_app;
