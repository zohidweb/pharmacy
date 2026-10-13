-- Up Migration
-- POS shift and sale (spec 2026-10-13-pos-shift-sale, section 3; data model 04 with the amendments
-- of section 2.1): shifts of a terminal and their cash operations, held receipts, paid receipts with
-- lines, payments and ПКУ records, idempotency keys of the POS buffer (data model 06). The ids of a
-- shift, a cash operation and a receipt are the operation ids of the client (E1). A sale moves the
-- batches with `sale` movements of source `receipt`. The tables are of class `tenant` (ADR-0013).

-- shifts - one open shift per terminal (D3, K5); the number is the Z-report number (counter z_report)
create table pharmacy.shifts (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  terminal_id uuid not null,
  number text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid not null,
  opened_at timestamptz not null,
  received_at timestamptz not null,
  opening_cash_dirams bigint not null check (opening_cash_dirams >= 0),
  opened_author_flagged boolean not null default false,
  closed_by uuid,
  closed_at timestamptz,
  closed_author_flagged boolean not null default false,
  expected_cash_dirams bigint,
  counted_cash_dirams bigint check (counted_cash_dirams >= 0),
  discrepancy_dirams bigint,
  -- may stay empty at a discrepancy: the closing is a fact (E24), the Z-report says «not given»
  discrepancy_reason text check (char_length(discrepancy_reason) <= 500),
  terminal_totals jsonb,
  z_report jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, store_id, number),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, terminal_id) references pharmacy.terminals (tenant_id, id),
  foreign key (tenant_id, opened_by) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, closed_by) references pharmacy.employees (tenant_id, id),
  check ((status = 'closed') = (closed_at is not null)),
  check ((closed_at is null) = (closed_by is null)
         and (closed_at is null) = (expected_cash_dirams is null)
         and (closed_at is null) = (counted_cash_dirams is null)
         and (closed_at is null) = (discrepancy_dirams is null)
         and (closed_at is null) = (z_report is null))
);
create unique index shifts_open_terminal_uq on pharmacy.shifts (tenant_id, terminal_id)
  where status = 'open';
create index shifts_terminal_idx on pharmacy.shifts (tenant_id, terminal_id);
create index shifts_opened_by_idx on pharmacy.shifts (tenant_id, opened_by);
create index shifts_closed_by_idx on pharmacy.shifts (tenant_id, closed_by);

-- shift_cash_operations - cash in and out of the drawer (append-only)
create table pharmacy.shift_cash_operations (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  shift_id uuid not null,
  kind text not null check (kind in ('deposit', 'withdrawal')),
  amount_dirams bigint not null check (amount_dirams > 0),
  reason text not null,
  comment text check (char_length(comment) <= 200),
  employee_id uuid not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  author_flagged boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shift_id) references pharmacy.shifts (tenant_id, id),
  foreign key (tenant_id, employee_id) references pharmacy.employees (tenant_id, id),
  check ((kind = 'deposit' and reason in ('change_fund', 'other'))
         or (kind = 'withdrawal' and reason in ('collection', 'expense')))
);
create index shift_cash_operations_shift_idx on pharmacy.shift_cash_operations (tenant_id, shift_id);
create index shift_cash_operations_employee_idx on pharmacy.shift_cash_operations (tenant_id, employee_id);

-- held_receipts - a receipt put aside, seen by the cashiers of the store; deleted at payment, by
-- hand or at the close of its shift (the only POS table with DELETE, data model 04)
create table pharmacy.held_receipts (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  shift_id uuid not null,
  held_by uuid not null,
  held_at timestamptz not null,
  subtotal_dirams bigint not null check (subtotal_dirams >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'array'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, shift_id) references pharmacy.shifts (tenant_id, id),
  foreign key (tenant_id, held_by) references pharmacy.employees (tenant_id, id)
);
create index held_receipts_store_idx on pharmacy.held_receipts (tenant_id, store_id);
create index held_receipts_shift_idx on pharmacy.held_receipts (tenant_id, shift_id);
create index held_receipts_held_by_idx on pharmacy.held_receipts (tenant_id, held_by);

-- receipts - a paid sale (append-only); a sale is a fact, the differences are marked (E5)
create table pharmacy.receipts (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  terminal_id uuid not null,
  shift_id uuid not null,
  cashier_id uuid not null,
  number text not null,
  sold_at timestamptz not null,
  received_at timestamptz not null,
  business_date date not null,
  subtotal_dirams bigint not null check (subtotal_dirams >= 0),
  discount_rule_id uuid,
  discount_percent_bp integer not null default 0 check (discount_percent_bp between 0 and 10000),
  discount_min_total_dirams bigint check (discount_min_total_dirams >= 0),
  discount_dirams bigint not null default 0 check (discount_dirams >= 0),
  total_dirams bigint not null check (total_dirams >= 0),
  cash_tendered_dirams bigint not null default 0 check (cash_tendered_dirams >= 0),
  change_dirams bigint not null default 0 check (change_dirams >= 0),
  status text not null default 'paid' check (status in ('paid')),
  discrepancy_kinds text[] not null default '{}'
    check (discrepancy_kinds <@ array['stock', 'price', 'discount', 'catalog', 'author',
                                      'closed_period']::text[]),
  correlation_id text not null,
  origin text not null check (origin in ('online', 'offline_buffer')),
  fiscal_status text not null default 'not_required'
    check (fiscal_status in ('not_required', 'pending', 'sent', 'failed')),
  fiscal_data jsonb,
  language text not null check (language in ('ru', 'tj')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  -- the key of the customer returns of the next PR: a return only at the store of the sale
  unique (tenant_id, store_id, id),
  unique (tenant_id, store_id, number),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, terminal_id) references pharmacy.terminals (tenant_id, id),
  foreign key (tenant_id, shift_id) references pharmacy.shifts (tenant_id, id),
  foreign key (tenant_id, cashier_id) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, discount_rule_id) references pharmacy.discount_rules (tenant_id, id),
  check (discount_dirams <= subtotal_dirams),
  check (total_dirams = subtotal_dirams - discount_dirams),
  check ((discount_rule_id is null) = (discount_min_total_dirams is null))
);
create index receipts_store_date_idx on pharmacy.receipts (tenant_id, store_id, business_date);
create index receipts_shift_idx on pharmacy.receipts (tenant_id, shift_id);
create index receipts_terminal_idx on pharmacy.receipts (tenant_id, terminal_id);
create index receipts_cashier_idx on pharmacy.receipts (tenant_id, cashier_id);
create index receipts_discount_rule_idx on pharmacy.receipts (tenant_id, discount_rule_id);

-- receipt_lines - a line is one batch (append-only)
create table pharmacy.receipt_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  receipt_id uuid not null,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null,
  batch_id uuid not null,
  sale_unit text not null check (sale_unit in ('pack', 'piece')),
  -- the value of the POS snapshot the pieces were counted by (E23)
  pieces_per_pack integer not null check (pieces_per_pack >= 1),
  qty_pieces integer not null check (qty_pieces > 0),
  unit_price_dirams bigint not null check (unit_price_dirams >= 0),
  line_amount_dirams bigint not null check (line_amount_dirams >= 0),
  discount_share_dirams bigint not null default 0 check (discount_share_dirams >= 0),
  cost_dirams bigint not null check (cost_dirams >= 0),
  batch_chosen_manually boolean not null default false,
  shortfall_pieces integer not null default 0 check (shortfall_pieces between 0 and qty_pieces),
  current_price_dirams bigint check (current_price_dirams >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, receipt_id, line_no),
  foreign key (tenant_id, receipt_id) references pharmacy.receipts (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id),
  foreign key (tenant_id, batch_id) references pharmacy.batches (tenant_id, id)
);
create index receipt_lines_product_idx on pharmacy.receipt_lines (tenant_id, product_id);
create index receipt_lines_batch_idx on pharmacy.receipt_lines (tenant_id, batch_id);

-- payments - by kind, without a payment_methods table (E10); the cash line holds the cash handed
-- over: Σ payments = total + change (data model 04)
create table pharmacy.payments (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  receipt_id uuid not null,
  kind text not null check (kind in ('cash', 'card', 'qr', 'nfc')),
  amount_dirams bigint not null check (amount_dirams > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, receipt_id, kind),
  foreign key (tenant_id, receipt_id) references pharmacy.receipts (tenant_id, id)
);

-- controlled_sale_records - a ПКУ line, even without prescription data (K3); every field of the
-- note is optional. The purge by the retention term comes with the ПКУ journal (PR 3); until then
-- the table is append-only.
create table pharmacy.controlled_sale_records (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  receipt_line_id uuid not null,
  prescription_file_id uuid,
  prescription_note jsonb check (jsonb_typeof(prescription_note) = 'object'),
  recorded_by uuid not null,
  recorded_at timestamptz not null,
  prescription_purged_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, receipt_line_id),
  foreign key (tenant_id, receipt_line_id) references pharmacy.receipt_lines (tenant_id, id),
  foreign key (tenant_id, recorded_by) references pharmacy.employees (tenant_id, id)
);
create index controlled_sale_records_recorded_by_idx on pharmacy.controlled_sale_records
  (tenant_id, recorded_by);

-- idempotency_keys - the HTTP operations of the POS buffer of cloud stores (data model 06, E11):
-- the same key with the same body returns the stored answer, another body is refused
create table pharmacy.idempotency_keys (
  tenant_id uuid not null references pharmacy.tenants (id),
  scope text not null check (scope in ('receipt', 'shift.open', 'shift.cash', 'shift.close')),
  key uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  status_code integer,
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (tenant_id, scope, key),
  check ((status_code is null) = (response is null))
);
create index idempotency_keys_expires_idx on pharmacy.idempotency_keys (tenant_id, expires_at);

-- a sale moves the batches from a receipt
alter table pharmacy.stock_movements drop constraint stock_movements_source_type_check;
alter table pharmacy.stock_movements add constraint stock_movements_source_type_check
  check (source_type in ('document', 'receipt'));

-- stock counts (K2): a batch in the minus is counted too; the line keeps what was sold after it
-- was counted
alter table pharmacy.inventory_lines drop constraint inventory_lines_book_qty_pieces_check;
alter table pharmacy.inventory_lines add column sold_after_count_pieces integer;

-- Append-only: no UPDATE/DELETE grants, and the trigger of the audit log rejects them for any role.
create trigger shift_cash_operations_no_update_delete
  before update or delete on pharmacy.shift_cash_operations
  for each row execute function pharmacy.forbid_mutation();
create trigger shift_cash_operations_no_truncate
  before truncate on pharmacy.shift_cash_operations
  for each statement execute function pharmacy.forbid_mutation();
create trigger receipts_no_update_delete
  before update or delete on pharmacy.receipts
  for each row execute function pharmacy.forbid_mutation();
create trigger receipts_no_truncate
  before truncate on pharmacy.receipts
  for each statement execute function pharmacy.forbid_mutation();
create trigger receipt_lines_no_update_delete
  before update or delete on pharmacy.receipt_lines
  for each row execute function pharmacy.forbid_mutation();
create trigger receipt_lines_no_truncate
  before truncate on pharmacy.receipt_lines
  for each statement execute function pharmacy.forbid_mutation();
create trigger payments_no_update_delete
  before update or delete on pharmacy.payments
  for each row execute function pharmacy.forbid_mutation();
create trigger payments_no_truncate
  before truncate on pharmacy.payments
  for each statement execute function pharmacy.forbid_mutation();
create trigger controlled_sale_records_no_update_delete
  before update or delete on pharmacy.controlled_sale_records
  for each row execute function pharmacy.forbid_mutation();
create trigger controlled_sale_records_no_truncate
  before truncate on pharmacy.controlled_sale_records
  for each statement execute function pharmacy.forbid_mutation();

-- shifts: never deleted, and a closed shift is not changed — its Z-report is reprinted as it was
-- (spec 3; full DML stays granted, as the catalog check of the tenant tables wants).
create function pharmacy.shifts_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'closed' then
    raise exception 'pharmacy.shifts: % of a % shift is not allowed', tg_op, old.status
      using errcode = '42501';  -- insufficient_privilege
  end if;
  return new;
end;
$$;
create trigger shifts_guard
  before update or delete on pharmacy.shifts
  for each row execute function pharmacy.shifts_guard();
create trigger shifts_no_truncate
  before truncate on pharmacy.shifts
  for each statement execute function pharmacy.forbid_mutation();

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app.
alter table pharmacy.shifts enable row level security;
alter table pharmacy.shifts force row level security;
alter table pharmacy.shift_cash_operations enable row level security;
alter table pharmacy.shift_cash_operations force row level security;
alter table pharmacy.held_receipts enable row level security;
alter table pharmacy.held_receipts force row level security;
alter table pharmacy.receipts enable row level security;
alter table pharmacy.receipts force row level security;
alter table pharmacy.receipt_lines enable row level security;
alter table pharmacy.receipt_lines force row level security;
alter table pharmacy.payments enable row level security;
alter table pharmacy.payments force row level security;
alter table pharmacy.controlled_sale_records enable row level security;
alter table pharmacy.controlled_sale_records force row level security;
alter table pharmacy.idempotency_keys enable row level security;
alter table pharmacy.idempotency_keys force row level security;

create policy tenant_isolation on pharmacy.shifts for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.shift_cash_operations for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.held_receipts for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.receipts for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.receipt_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.payments for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.controlled_sale_records for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.idempotency_keys for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

grant select, insert, update, delete on
  pharmacy.shifts,
  pharmacy.held_receipts,
  pharmacy.idempotency_keys
to pharmacy_app;
grant select, insert on
  pharmacy.shift_cash_operations,
  pharmacy.receipts,
  pharmacy.receipt_lines,
  pharmacy.payments,
  pharmacy.controlled_sale_records
to pharmacy_app;
