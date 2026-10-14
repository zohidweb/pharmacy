-- Up Migration
-- Customer returns (spec 2026-10-13-customer-returns, section 3 and the amendments 2.1; data model
-- 04): a return of a receipt of the store, its lines and the ways the money went back. The id of a
-- return is the operation id of the client (E1). Goods go back to the batch of the receipt line with
-- `customer_return` movements; a defect and an expired batch are written off by a posted write-off
-- linked to the return (E9). The return policy of the network lives in tenant_settings (R3). The
-- tables are of class `tenant` and append-only: a return is a fact (E15).

-- customer_returns - a return of a receipt at the store of the sale, into the open shift of the
-- terminal (E3)
create table pharmacy.customer_returns (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  shift_id uuid not null,
  terminal_id uuid not null,
  cashier_id uuid not null,
  receipt_id uuid not null,
  number text not null,
  returned_at timestamptz not null,
  business_date date not null,
  reason text not null check (reason in ('customer', 'defect')),
  -- the sale was found by a product and a date, not by the receipt (R8, E12)
  found_without_receipt boolean not null default false,
  discount_returned_dirams bigint not null check (discount_returned_dirams >= 0),
  refund_dirams bigint not null check (refund_dirams >= 0),
  correlation_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, store_id, number),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  -- a return only at the store of the sale
  foreign key (tenant_id, store_id, receipt_id) references pharmacy.receipts (tenant_id, store_id, id),
  foreign key (tenant_id, shift_id) references pharmacy.shifts (tenant_id, id),
  foreign key (tenant_id, terminal_id) references pharmacy.terminals (tenant_id, id),
  foreign key (tenant_id, cashier_id) references pharmacy.employees (tenant_id, id)
);
create index customer_returns_store_date_idx
  on pharmacy.customer_returns (tenant_id, store_id, business_date);
create index customer_returns_shift_idx on pharmacy.customer_returns (tenant_id, shift_id);
create index customer_returns_receipt_idx on pharmacy.customer_returns (tenant_id, receipt_id);
create index customer_returns_terminal_idx on pharmacy.customer_returns (tenant_id, terminal_id);
create index customer_returns_cashier_idx on pharmacy.customer_returns (tenant_id, cashier_id);

-- customer_return_lines - a returned part of a receipt line: pieces, the amount at the price and the
-- share of the discount taken back by this return (E6)
create table pharmacy.customer_return_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  customer_return_id uuid not null,
  receipt_line_id uuid not null,
  qty_pieces integer not null check (qty_pieces > 0),
  amount_dirams bigint not null check (amount_dirams >= 0),
  discount_share_dirams bigint not null check (discount_share_dirams >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, customer_return_id, receipt_line_id),
  foreign key (tenant_id, customer_return_id) references pharmacy.customer_returns (tenant_id, id),
  foreign key (tenant_id, receipt_line_id) references pharmacy.receipt_lines (tenant_id, id),
  check (discount_share_dirams <= amount_dirams)
);
create index customer_return_lines_receipt_line_idx
  on pharmacy.customer_return_lines (tenant_id, receipt_line_id);

-- customer_return_refunds - the money back by kind, the kinds of the receipt payments (E7)
create table pharmacy.customer_return_refunds (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  customer_return_id uuid not null,
  kind text not null check (kind in ('cash', 'card', 'qr', 'nfc')),
  amount_dirams bigint not null check (amount_dirams > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, customer_return_id, kind),
  foreign key (tenant_id, customer_return_id) references pharmacy.customer_returns (tenant_id, id)
);

-- the goods of a return go back to the batch of the receipt line
alter table pharmacy.stock_movements drop constraint stock_movements_kind_check;
alter table pharmacy.stock_movements add constraint stock_movements_kind_check
  check (kind in ('goods_receipt', 'opening_balance', 'write_off', 'inventory_gain', 'inventory_loss',
                  'supplier_return', 'transfer_out', 'transfer_in', 'reversal', 'sale',
                  'customer_return'));
alter table pharmacy.stock_movements drop constraint stock_movements_source_type_check;
alter table pharmacy.stock_movements add constraint stock_movements_source_type_check
  check (source_type in ('document', 'receipt', 'customer_return'));

-- a defect and an expired batch of a return are written off by the system (E9)
alter table pharmacy.documents drop constraint documents_write_off_reason_check;
alter table pharmacy.documents add constraint documents_write_off_reason_check
  check (write_off_reason in ('expired', 'broken', 'defect', 'misgrade', 'transfer_discrepancy',
                              'customer_return_defect', 'customer_return_expired'));
alter table pharmacy.documents add column source_customer_return_id uuid;
alter table pharmacy.documents add foreign key (tenant_id, source_customer_return_id)
  references pharmacy.customer_returns (tenant_id, id);
alter table pharmacy.documents add constraint documents_source_customer_return_check
  check (source_customer_return_id is null or type = 'write_off');
create index documents_source_customer_return_idx
  on pharmacy.documents (tenant_id, source_customer_return_id);

-- the return policy of the network: a return at the customer's wish by the kind of the product (R3);
-- a defect is accepted always
alter table pharmacy.tenant_settings
  add column customer_return_otc boolean not null default true,
  add column customer_return_rx boolean not null default false,
  add column customer_return_controlled boolean not null default false;

-- a return carries its idempotency key (E1)
alter table pharmacy.idempotency_keys drop constraint idempotency_keys_scope_check;
alter table pharmacy.idempotency_keys add constraint idempotency_keys_scope_check
  check (scope in ('receipt', 'shift.open', 'shift.cash', 'shift.close', 'return'));

-- Append-only: no UPDATE/DELETE grants, and the trigger of the audit log rejects them for any role.
create trigger customer_returns_no_update_delete
  before update or delete on pharmacy.customer_returns
  for each row execute function pharmacy.forbid_mutation();
create trigger customer_returns_no_truncate
  before truncate on pharmacy.customer_returns
  for each statement execute function pharmacy.forbid_mutation();
create trigger customer_return_lines_no_update_delete
  before update or delete on pharmacy.customer_return_lines
  for each row execute function pharmacy.forbid_mutation();
create trigger customer_return_lines_no_truncate
  before truncate on pharmacy.customer_return_lines
  for each statement execute function pharmacy.forbid_mutation();
create trigger customer_return_refunds_no_update_delete
  before update or delete on pharmacy.customer_return_refunds
  for each row execute function pharmacy.forbid_mutation();
create trigger customer_return_refunds_no_truncate
  before truncate on pharmacy.customer_return_refunds
  for each statement execute function pharmacy.forbid_mutation();

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app.
alter table pharmacy.customer_returns enable row level security;
alter table pharmacy.customer_returns force row level security;
alter table pharmacy.customer_return_lines enable row level security;
alter table pharmacy.customer_return_lines force row level security;
alter table pharmacy.customer_return_refunds enable row level security;
alter table pharmacy.customer_return_refunds force row level security;

create policy tenant_isolation on pharmacy.customer_returns for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.customer_return_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.customer_return_refunds for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

grant select, insert on
  pharmacy.customer_returns,
  pharmacy.customer_return_lines,
  pharmacy.customer_return_refunds
to pharmacy_app;
