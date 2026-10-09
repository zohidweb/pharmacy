-- Up Migration
-- Inventory core and suppliers (spec 2026-10-09-inventory-purchasing, section 3.1; data model
-- 03-batches-warehouse.md, 05-purchasing.md): suppliers, document counters, the stock document
-- header with goods receipt and opening balance lines, batches, stock movements (append-only,
-- monthly partitions) and the supplier ledger (append-only). Stock is never stored: it is the sum
-- of the movements of a batch. All tables are of class `tenant` (ADR-0013).

-- suppliers - the supplier directory of the network; names are not translated.
create table pharmacy.suppliers (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  name text not null check (name <> ''),
  tax_id text check (tax_id ~ '^[0-9]{9}$'),
  phone text,
  email text,
  address text,
  bank_details text,
  payment_term_days integer not null default 0 check (payment_term_days between 0 and 365),
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  check (status <> 'archived' or archived_at is not null)
);

-- document_counters - numbers of documents per store, kind and year (data model 03).
create table pharmacy.document_counters (
  tenant_id uuid not null references pharmacy.tenants (id),
  store_id uuid not null,
  kind text not null,
  year integer not null check (year between 2000 and 2999),
  last_number bigint not null check (last_number >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, store_id, kind, year),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id)
);

-- documents - the header of a stock document (D1); the types grow with their modules.
create table pharmacy.documents (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  type text not null check (type in ('goods_receipt', 'opening_balance')),
  number text not null,
  document_date date not null,
  status text not null default 'draft' check (status in ('draft', 'posted')),
  created_by uuid not null,
  posted_by uuid,
  posted_at timestamptz,
  unposted_by uuid,
  unposted_at timestamptz,
  comment text,
  total_dirams bigint check (total_dirams >= 0),
  supplier_id uuid,
  supplier_invoice_number text,
  supplier_invoice_date date,
  payment_due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, store_id, type, number),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, supplier_id) references pharmacy.suppliers (tenant_id, id),
  foreign key (tenant_id, created_by) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, posted_by) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, unposted_by) references pharmacy.employees (tenant_id, id),
  check (type <> 'goods_receipt' or supplier_id is not null),
  check ((status = 'posted') = (posted_at is not null)),
  check ((posted_by is null) = (posted_at is null))
);
create index documents_store_type_date_idx on pharmacy.documents (tenant_id, store_id, type, document_date);
create index documents_supplier_idx on pharmacy.documents (tenant_id, supplier_id);
create index documents_created_by_idx on pharmacy.documents (tenant_id, created_by);
create index documents_posted_by_idx on pharmacy.documents (tenant_id, posted_by);
create index documents_unposted_by_idx on pharmacy.documents (tenant_id, unposted_by);

-- batches - a batch belongs to one store (D2); no quantity column.
create table pharmacy.batches (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  product_id uuid not null,
  expiry_date date not null,
  lot_number text,
  purchase_price_per_pack_dirams bigint not null check (purchase_price_per_pack_dirams >= 0),
  cost_per_piece_dirams bigint not null check (cost_per_piece_dirams >= 0),
  supplier_id uuid,
  origin text not null check (origin in ('goods_receipt', 'opening_balance')),
  source_document_id uuid not null,
  is_starting boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id),
  foreign key (tenant_id, supplier_id) references pharmacy.suppliers (tenant_id, id),
  foreign key (tenant_id, source_document_id) references pharmacy.documents (tenant_id, id)
);
create index batches_fefo_idx on pharmacy.batches (tenant_id, store_id, product_id, expiry_date);
create index batches_expiry_idx on pharmacy.batches (tenant_id, store_id, expiry_date);
create index batches_product_idx on pharmacy.batches (tenant_id, product_id);
create index batches_supplier_idx on pharmacy.batches (tenant_id, supplier_id);
create index batches_source_document_idx on pharmacy.batches (tenant_id, source_document_id);

create table pharmacy.goods_receipt_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null,
  qty_pieces integer not null check (qty_pieces > 0),
  expiry_date date not null,
  lot_number text,
  purchase_price_per_pack_dirams bigint not null check (purchase_price_per_pack_dirams >= 0),
  retail_price_draft_dirams bigint not null check (retail_price_draft_dirams > 0),
  batch_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id),
  foreign key (tenant_id, batch_id) references pharmacy.batches (tenant_id, id)
);
create index goods_receipt_lines_product_idx on pharmacy.goods_receipt_lines (tenant_id, product_id);
create index goods_receipt_lines_batch_idx on pharmacy.goods_receipt_lines (tenant_id, batch_id);

create table pharmacy.opening_balance_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null,
  qty_pieces integer not null check (qty_pieces > 0),
  expiry_date date not null,
  lot_number text,
  purchase_price_per_pack_dirams bigint not null check (purchase_price_per_pack_dirams >= 0),
  retail_price_draft_dirams bigint check (retail_price_draft_dirams > 0),
  supplier_id uuid,
  is_starting boolean not null default false,
  batch_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id),
  foreign key (tenant_id, supplier_id) references pharmacy.suppliers (tenant_id, id),
  foreign key (tenant_id, batch_id) references pharmacy.batches (tenant_id, id)
);
create index opening_balance_lines_product_idx on pharmacy.opening_balance_lines (tenant_id, product_id);
create index opening_balance_lines_supplier_idx on pharmacy.opening_balance_lines (tenant_id, supplier_id);
create index opening_balance_lines_batch_idx on pharmacy.opening_balance_lines (tenant_id, batch_id);

-- stock_movements - every change of a batch stock (append-only, monthly partitions by
-- recorded_at). No foreign keys point here (partitioned); batch and source ids are written by the
-- application in the transaction of the operation.
create table pharmacy.stock_movements (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  recorded_at timestamptz not null default now(),
  store_id uuid not null,
  batch_id uuid not null,
  qty_delta_pieces integer not null check (qty_delta_pieces <> 0),
  kind text not null check (kind in ('goods_receipt', 'opening_balance', 'reversal', 'sale')),
  source_type text not null check (source_type in ('document')),
  source_id uuid not null,
  source_line_id uuid,
  business_date date not null,
  origin text not null default 'local' check (origin in ('local')),
  reverses_movement_id uuid,
  primary key (tenant_id, id, recorded_at)
) partition by range (recorded_at);
create index stock_movements_batch_idx on pharmacy.stock_movements (tenant_id, store_id, batch_id)
  include (qty_delta_pieces);
create index stock_movements_source_idx on pharmacy.stock_movements (tenant_id, source_id);
create index stock_movements_date_idx on pharmacy.stock_movements (tenant_id, store_id, business_date);

-- Monthly partitions (UTC boundaries) up to 2028-12. No DEFAULT partition: an insert outside them
-- fails loudly. Later partitions are created ahead by a scheduled job (out of scope). Partitions
-- get no grants: access goes through the parent only.
create table pharmacy.stock_movements_2026_10 partition of pharmacy.stock_movements
  for values from ('2026-10-01 00:00:00+00') to ('2026-11-01 00:00:00+00');
create table pharmacy.stock_movements_2026_11 partition of pharmacy.stock_movements
  for values from ('2026-11-01 00:00:00+00') to ('2026-12-01 00:00:00+00');
create table pharmacy.stock_movements_2026_12 partition of pharmacy.stock_movements
  for values from ('2026-12-01 00:00:00+00') to ('2027-01-01 00:00:00+00');
create table pharmacy.stock_movements_2027_01 partition of pharmacy.stock_movements
  for values from ('2027-01-01 00:00:00+00') to ('2027-02-01 00:00:00+00');
create table pharmacy.stock_movements_2027_02 partition of pharmacy.stock_movements
  for values from ('2027-02-01 00:00:00+00') to ('2027-03-01 00:00:00+00');
create table pharmacy.stock_movements_2027_03 partition of pharmacy.stock_movements
  for values from ('2027-03-01 00:00:00+00') to ('2027-04-01 00:00:00+00');
create table pharmacy.stock_movements_2027_04 partition of pharmacy.stock_movements
  for values from ('2027-04-01 00:00:00+00') to ('2027-05-01 00:00:00+00');
create table pharmacy.stock_movements_2027_05 partition of pharmacy.stock_movements
  for values from ('2027-05-01 00:00:00+00') to ('2027-06-01 00:00:00+00');
create table pharmacy.stock_movements_2027_06 partition of pharmacy.stock_movements
  for values from ('2027-06-01 00:00:00+00') to ('2027-07-01 00:00:00+00');
create table pharmacy.stock_movements_2027_07 partition of pharmacy.stock_movements
  for values from ('2027-07-01 00:00:00+00') to ('2027-08-01 00:00:00+00');
create table pharmacy.stock_movements_2027_08 partition of pharmacy.stock_movements
  for values from ('2027-08-01 00:00:00+00') to ('2027-09-01 00:00:00+00');
create table pharmacy.stock_movements_2027_09 partition of pharmacy.stock_movements
  for values from ('2027-09-01 00:00:00+00') to ('2027-10-01 00:00:00+00');
create table pharmacy.stock_movements_2027_10 partition of pharmacy.stock_movements
  for values from ('2027-10-01 00:00:00+00') to ('2027-11-01 00:00:00+00');
create table pharmacy.stock_movements_2027_11 partition of pharmacy.stock_movements
  for values from ('2027-11-01 00:00:00+00') to ('2027-12-01 00:00:00+00');
create table pharmacy.stock_movements_2027_12 partition of pharmacy.stock_movements
  for values from ('2027-12-01 00:00:00+00') to ('2028-01-01 00:00:00+00');
create table pharmacy.stock_movements_2028_01 partition of pharmacy.stock_movements
  for values from ('2028-01-01 00:00:00+00') to ('2028-02-01 00:00:00+00');
create table pharmacy.stock_movements_2028_02 partition of pharmacy.stock_movements
  for values from ('2028-02-01 00:00:00+00') to ('2028-03-01 00:00:00+00');
create table pharmacy.stock_movements_2028_03 partition of pharmacy.stock_movements
  for values from ('2028-03-01 00:00:00+00') to ('2028-04-01 00:00:00+00');
create table pharmacy.stock_movements_2028_04 partition of pharmacy.stock_movements
  for values from ('2028-04-01 00:00:00+00') to ('2028-05-01 00:00:00+00');
create table pharmacy.stock_movements_2028_05 partition of pharmacy.stock_movements
  for values from ('2028-05-01 00:00:00+00') to ('2028-06-01 00:00:00+00');
create table pharmacy.stock_movements_2028_06 partition of pharmacy.stock_movements
  for values from ('2028-06-01 00:00:00+00') to ('2028-07-01 00:00:00+00');
create table pharmacy.stock_movements_2028_07 partition of pharmacy.stock_movements
  for values from ('2028-07-01 00:00:00+00') to ('2028-08-01 00:00:00+00');
create table pharmacy.stock_movements_2028_08 partition of pharmacy.stock_movements
  for values from ('2028-08-01 00:00:00+00') to ('2028-09-01 00:00:00+00');
create table pharmacy.stock_movements_2028_09 partition of pharmacy.stock_movements
  for values from ('2028-09-01 00:00:00+00') to ('2028-10-01 00:00:00+00');
create table pharmacy.stock_movements_2028_10 partition of pharmacy.stock_movements
  for values from ('2028-10-01 00:00:00+00') to ('2028-11-01 00:00:00+00');
create table pharmacy.stock_movements_2028_11 partition of pharmacy.stock_movements
  for values from ('2028-11-01 00:00:00+00') to ('2028-12-01 00:00:00+00');
create table pharmacy.stock_movements_2028_12 partition of pharmacy.stock_movements
  for values from ('2028-12-01 00:00:00+00') to ('2029-01-01 00:00:00+00');

-- supplier_ledger_entries - settlements with a supplier (append-only); the debt is the sum per
-- supplier and legal entity (D5: the legal entity of the receiving store owes).
create table pharmacy.supplier_ledger_entries (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  supplier_id uuid not null,
  legal_entity_id uuid not null,
  kind text not null check (kind in ('goods_receipt', 'payment', 'reversal')),
  amount_dirams bigint not null check (amount_dirams <> 0),
  due_date date,
  source_type text not null check (source_type in ('document', 'payment')),
  source_id uuid not null,
  business_date date not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, supplier_id) references pharmacy.suppliers (tenant_id, id),
  foreign key (tenant_id, legal_entity_id) references pharmacy.legal_entities (tenant_id, id),
  foreign key (tenant_id, recorded_by) references pharmacy.employees (tenant_id, id)
);
create index supplier_ledger_supplier_idx on pharmacy.supplier_ledger_entries
  (tenant_id, supplier_id, legal_entity_id);
create index supplier_ledger_source_idx on pharmacy.supplier_ledger_entries (tenant_id, source_id);
create index supplier_ledger_legal_entity_idx on pharmacy.supplier_ledger_entries (tenant_id, legal_entity_id);
create index supplier_ledger_recorded_by_idx on pharmacy.supplier_ledger_entries (tenant_id, recorded_by);

-- Append-only: no UPDATE/DELETE grants, and the trigger of the audit log rejects them for any role.
create trigger stock_movements_no_update_delete
  before update or delete on pharmacy.stock_movements
  for each row execute function pharmacy.forbid_mutation();
create trigger stock_movements_no_truncate
  before truncate on pharmacy.stock_movements
  for each statement execute function pharmacy.forbid_mutation();
create trigger supplier_ledger_entries_no_update_delete
  before update or delete on pharmacy.supplier_ledger_entries
  for each row execute function pharmacy.forbid_mutation();
create trigger supplier_ledger_entries_no_truncate
  before truncate on pharmacy.supplier_ledger_entries
  for each statement execute function pharmacy.forbid_mutation();

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app.
alter table pharmacy.suppliers enable row level security;
alter table pharmacy.suppliers force row level security;
alter table pharmacy.document_counters enable row level security;
alter table pharmacy.document_counters force row level security;
alter table pharmacy.documents enable row level security;
alter table pharmacy.documents force row level security;
alter table pharmacy.batches enable row level security;
alter table pharmacy.batches force row level security;
alter table pharmacy.goods_receipt_lines enable row level security;
alter table pharmacy.goods_receipt_lines force row level security;
alter table pharmacy.opening_balance_lines enable row level security;
alter table pharmacy.opening_balance_lines force row level security;
alter table pharmacy.stock_movements enable row level security;
alter table pharmacy.stock_movements force row level security;
alter table pharmacy.supplier_ledger_entries enable row level security;
alter table pharmacy.supplier_ledger_entries force row level security;

create policy tenant_isolation on pharmacy.suppliers for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.document_counters for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.documents for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.batches for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.goods_receipt_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.opening_balance_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.stock_movements for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.supplier_ledger_entries for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

grant select, insert, update, delete on
  pharmacy.suppliers,
  pharmacy.document_counters,
  pharmacy.documents,
  pharmacy.batches,
  pharmacy.goods_receipt_lines,
  pharmacy.opening_balance_lines
to pharmacy_app;
grant select, insert on pharmacy.stock_movements, pharmacy.supplier_ledger_entries to pharmacy_app;
