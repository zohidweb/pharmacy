-- Up Migration
-- Supplier returns (spec 2026-10-12-supplier-returns-transfers, section 3.1; data models 03 and 05
-- with the amendments of section 2.1): a return has one supplier, one reason and lines by batch;
-- posting writes `supplier_return` movements and a credit of the supplier in the ledger, which is
-- allocated to the goods receipts like a payment. The tables are of class `tenant` (ADR-0013).

alter table pharmacy.documents drop constraint documents_type_check;
alter table pharmacy.documents add constraint documents_type_check
  check (type in ('goods_receipt', 'opening_balance', 'write_off', 'inventory', 'supplier_return'));

-- one reason per return (amendment 2.1 p. 1); the supplier is required as for a goods receipt
alter table pharmacy.documents add column supplier_return_reason text;
alter table pharmacy.documents add constraint documents_supplier_return_reason_check
  check (supplier_return_reason in ('defect', 'expired', 'broken'));
alter table pharmacy.documents add constraint documents_supplier_return_reason_type_check
  check ((type = 'supplier_return') = (supplier_return_reason is not null));
alter table pharmacy.documents add constraint documents_supplier_return_supplier_check
  check (type <> 'supplier_return' or supplier_id is not null);

-- the document this one comes from: a return -> its goods receipt (optional)
alter table pharmacy.documents add column source_document_id uuid;
alter table pharmacy.documents add foreign key (tenant_id, source_document_id)
  references pharmacy.documents (tenant_id, id);
create index documents_source_document_idx on pharmacy.documents (tenant_id, source_document_id);

-- supplier_return_lines - a batch of the store of the document with the supplier of the document
-- (checked by the application); `amount_dirams` is fixed at posting (amendment 2.1 p. 2).
create table pharmacy.supplier_return_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  batch_id uuid not null,
  product_id uuid not null,
  qty_pieces integer not null check (qty_pieces > 0),
  unit text not null check (unit in ('pack', 'piece')),
  note text check (char_length(note) <= 200),
  amount_dirams bigint check (amount_dirams >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  unique (tenant_id, document_id, batch_id),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, batch_id) references pharmacy.batches (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id)
);
create index supplier_return_lines_batch_idx on pharmacy.supplier_return_lines (tenant_id, batch_id);
create index supplier_return_lines_product_idx on pharmacy.supplier_return_lines (tenant_id, product_id);

alter table pharmacy.stock_movements drop constraint stock_movements_kind_check;
alter table pharmacy.stock_movements add constraint stock_movements_kind_check
  check (kind in ('goods_receipt', 'opening_balance', 'write_off', 'inventory_gain', 'inventory_loss',
                  'supplier_return', 'reversal', 'sale'));

alter table pharmacy.supplier_ledger_entries drop constraint supplier_ledger_entries_kind_check;
alter table pharmacy.supplier_ledger_entries add constraint supplier_ledger_entries_kind_check
  check (kind in ('goods_receipt', 'payment', 'supplier_return', 'reversal'));

-- supplier_return_allocations - the part of the credit of a posted return that covers a posted
-- goods receipt (amendment 2.1 p. 3); the rest of the credit waits for the next receipt.
create table pharmacy.supplier_return_allocations (
  tenant_id uuid not null references pharmacy.tenants (id),
  return_document_id uuid not null,
  goods_receipt_document_id uuid not null,
  amount_dirams bigint not null check (amount_dirams > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, return_document_id, goods_receipt_document_id),
  foreign key (tenant_id, return_document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, goods_receipt_document_id) references pharmacy.documents (tenant_id, id)
);
create index supplier_return_allocations_receipt_idx on pharmacy.supplier_return_allocations
  (tenant_id, goods_receipt_document_id);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML (the lines
-- of a draft are replaced, allocations are released on unposting).
alter table pharmacy.supplier_return_lines enable row level security;
alter table pharmacy.supplier_return_lines force row level security;
alter table pharmacy.supplier_return_allocations enable row level security;
alter table pharmacy.supplier_return_allocations force row level security;
create policy tenant_isolation on pharmacy.supplier_return_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.supplier_return_allocations for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on
  pharmacy.supplier_return_lines,
  pharmacy.supplier_return_allocations
  to pharmacy_app;
