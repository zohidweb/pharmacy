-- Up Migration
-- Stock counts (spec 2026-10-12-write-offs-stock-counts, section 3.2; data model 03 with the
-- amendments of section 2.1): a count of a store is a document of type `inventory` with a snapshot
-- of its batches, the entries of the counting employees, found products without a batch, and the
-- `cancelled` status. Posting writes `inventory_gain` / `inventory_loss` and creates
-- `inventory_surplus` batches. The tables are of class `tenant` (ADR-0013).

alter table pharmacy.documents drop constraint documents_type_check;
alter table pharmacy.documents add constraint documents_type_check
  check (type in ('goods_receipt', 'opening_balance', 'write_off', 'inventory'));

-- cancelled: a count closed without movements (amendment 2.1 p. 3)
alter table pharmacy.documents drop constraint documents_status_check;
alter table pharmacy.documents add constraint documents_status_check
  check (status in ('draft', 'posted', 'cancelled'));
alter table pharmacy.documents add constraint documents_cancelled_type_check
  check (status <> 'cancelled' or type = 'inventory');

alter table pharmacy.documents add column inventory_scope text
  check (inventory_scope in ('all', 'category'));
alter table pharmacy.documents add column inventory_category_id uuid;
alter table pharmacy.documents add column inventory_started_at timestamptz;
alter table pharmacy.documents add column cancelled_by uuid;
alter table pharmacy.documents add column cancelled_at timestamptz;
alter table pharmacy.documents add foreign key (tenant_id, inventory_category_id)
  references pharmacy.categories (tenant_id, id);
alter table pharmacy.documents add foreign key (tenant_id, cancelled_by)
  references pharmacy.employees (tenant_id, id);
alter table pharmacy.documents add constraint documents_inventory_scope_type_check
  check ((type = 'inventory') = (inventory_scope is not null));
alter table pharmacy.documents add constraint documents_inventory_started_check
  check ((type = 'inventory') = (inventory_started_at is not null));
alter table pharmacy.documents add constraint documents_inventory_category_check
  check ((inventory_category_id is null or inventory_scope = 'category')
         and (inventory_scope is distinct from 'category' or inventory_category_id is not null));
alter table pharmacy.documents add constraint documents_cancelled_check
  check ((status = 'cancelled') = (cancelled_at is not null)
         and (cancelled_by is null) = (cancelled_at is null));
create index documents_inventory_category_idx on pharmacy.documents (tenant_id, inventory_category_id);
create index documents_cancelled_by_idx on pharmacy.documents (tenant_id, cancelled_by);
-- one running count per store (spec S5); the index also serves the freeze check
create unique index documents_running_count_uq on pharmacy.documents (tenant_id, store_id)
  where type = 'inventory' and status = 'draft';

-- inventory_lines - the snapshot of a batch at the start, or a found product without a batch (S1)
create table pharmacy.inventory_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null,
  batch_id uuid,
  is_found boolean not null default false,
  book_qty_pieces integer not null check (book_qty_pieces >= 0),
  counted_qty_pieces integer check (counted_qty_pieces >= 0),
  sold_since_start_pieces integer,
  surplus_lot_number text,
  surplus_expiry_date date,
  surplus_purchase_price_per_pack_dirams bigint check (surplus_purchase_price_per_pack_dirams >= 0),
  surplus_batch_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id),
  foreign key (tenant_id, batch_id) references pharmacy.batches (tenant_id, id),
  foreign key (tenant_id, surplus_batch_id) references pharmacy.batches (tenant_id, id),
  check (is_found = (batch_id is null)),
  check (is_found or (surplus_lot_number is null and surplus_expiry_date is null
                      and surplus_purchase_price_per_pack_dirams is null and surplus_batch_id is null))
);
create unique index inventory_lines_batch_uq on pharmacy.inventory_lines (tenant_id, document_id, batch_id)
  where batch_id is not null;
create index inventory_lines_product_idx on pharmacy.inventory_lines (tenant_id, product_id);
create index inventory_lines_batch_idx on pharmacy.inventory_lines (tenant_id, batch_id);
create index inventory_lines_surplus_batch_idx on pharmacy.inventory_lines (tenant_id, surplus_batch_id);

-- inventory_count_entries - «counted N pieces» of a line by one employee (amendment 2.1 p. 4); the
-- fact of a line is their sum. `id` is the idempotency key sent by the tablet (UUIDv7).
create table pharmacy.inventory_count_entries (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_id uuid not null,
  qty_pieces integer not null,
  entered_by uuid not null,
  entered_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, line_id) references pharmacy.inventory_lines (tenant_id, id),
  foreign key (tenant_id, entered_by) references pharmacy.employees (tenant_id, id)
);
create index inventory_count_entries_line_idx on pharmacy.inventory_count_entries (tenant_id, line_id);
create index inventory_count_entries_document_idx on pharmacy.inventory_count_entries (tenant_id, document_id);
create index inventory_count_entries_entered_by_idx on pharmacy.inventory_count_entries (tenant_id, entered_by);

alter table pharmacy.batches drop constraint batches_origin_check;
alter table pharmacy.batches add constraint batches_origin_check
  check (origin in ('goods_receipt', 'opening_balance', 'inventory_surplus'));

alter table pharmacy.stock_movements drop constraint stock_movements_kind_check;
alter table pharmacy.stock_movements add constraint stock_movements_kind_check
  check (kind in ('goods_receipt', 'opening_balance', 'write_off', 'inventory_gain', 'inventory_loss',
                  'reversal', 'sale'));

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML (a count
-- edits its lines; entries are draft input and may be deleted).
alter table pharmacy.inventory_lines enable row level security;
alter table pharmacy.inventory_lines force row level security;
alter table pharmacy.inventory_count_entries enable row level security;
alter table pharmacy.inventory_count_entries force row level security;
create policy tenant_isolation on pharmacy.inventory_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.inventory_count_entries for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.inventory_lines, pharmacy.inventory_count_entries
  to pharmacy_app;
