-- Up Migration
-- Write-offs (spec 2026-10-12-write-offs-stock-counts, section 3.1; data model 03 with the
-- amendments of section 2.1): a write-off document has one reason in its header and lines by batch;
-- posting writes `write_off` movements. The table is of class `tenant` (ADR-0013).

alter table pharmacy.documents drop constraint documents_type_check;
alter table pharmacy.documents add constraint documents_type_check
  check (type in ('goods_receipt', 'opening_balance', 'write_off'));

-- one reason per document (amendment 2.1 p. 1): a fixed list, no dictionary of the network
alter table pharmacy.documents add column write_off_reason text;
alter table pharmacy.documents add constraint documents_write_off_reason_check
  check (write_off_reason in ('expired', 'broken', 'defect', 'misgrade', 'transfer_discrepancy'));
alter table pharmacy.documents add constraint documents_write_off_reason_type_check
  check ((type = 'write_off') = (write_off_reason is not null));

-- write_off_lines - a batch of the store of the document; the stock is in pieces, `unit` only
-- says how the quantity was entered (amendment 2.1 p. 2).
create table pharmacy.write_off_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  batch_id uuid not null,
  product_id uuid not null,
  qty_pieces integer not null check (qty_pieces > 0),
  unit text not null check (unit in ('pack', 'piece')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  unique (tenant_id, document_id, batch_id),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, batch_id) references pharmacy.batches (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id)
);
create index write_off_lines_batch_idx on pharmacy.write_off_lines (tenant_id, batch_id);
create index write_off_lines_product_idx on pharmacy.write_off_lines (tenant_id, product_id);

alter table pharmacy.stock_movements drop constraint stock_movements_kind_check;
alter table pharmacy.stock_movements add constraint stock_movements_kind_check
  check (kind in ('goods_receipt', 'opening_balance', 'write_off', 'reversal', 'sale'));

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML (the lines
-- of a draft are replaced).
alter table pharmacy.write_off_lines enable row level security;
alter table pharmacy.write_off_lines force row level security;
create policy tenant_isolation on pharmacy.write_off_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.write_off_lines to pharmacy_app;
