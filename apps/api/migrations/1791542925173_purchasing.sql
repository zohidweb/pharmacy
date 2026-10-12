-- Up Migration
-- Purchasing (spec 2026-10-09-inventory-purchasing, section 3.2; data model 05-purchasing.md):
-- payments to suppliers with their allocation to goods receipts, purchase orders with their lines,
-- and the link of a goods receipt to its order. All tables are of class `tenant` (ADR-0013).

-- supplier_payments - a payment of the accounting; `id` is the idempotency key of the client
-- (UUIDv7): a repeat of the same payment finds this row.
create table pharmacy.supplier_payments (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  supplier_id uuid not null,
  legal_entity_id uuid not null,
  amount_dirams bigint not null check (amount_dirams > 0),
  paid_on date not null,
  method text not null check (method in ('cash', 'bank_transfer')),
  comment text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, supplier_id) references pharmacy.suppliers (tenant_id, id),
  foreign key (tenant_id, legal_entity_id) references pharmacy.legal_entities (tenant_id, id),
  foreign key (tenant_id, created_by) references pharmacy.employees (tenant_id, id)
);
create index supplier_payments_supplier_idx on pharmacy.supplier_payments
  (tenant_id, supplier_id, legal_entity_id);
create index supplier_payments_legal_entity_idx on pharmacy.supplier_payments (tenant_id, legal_entity_id);
create index supplier_payments_created_by_idx on pharmacy.supplier_payments (tenant_id, created_by);

-- supplier_payment_allocations - the part of a payment that covers a posted goods receipt; the
-- rest of a payment is a prepayment. Unposting a receipt removes its allocations.
create table pharmacy.supplier_payment_allocations (
  tenant_id uuid not null references pharmacy.tenants (id),
  payment_id uuid not null,
  goods_receipt_document_id uuid not null,
  amount_dirams bigint not null check (amount_dirams > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, payment_id, goods_receipt_document_id),
  foreign key (tenant_id, payment_id) references pharmacy.supplier_payments (tenant_id, id),
  foreign key (tenant_id, goods_receipt_document_id) references pharmacy.documents (tenant_id, id)
);
create index supplier_payment_allocations_document_idx on pharmacy.supplier_payment_allocations
  (tenant_id, goods_receipt_document_id);

-- purchase_orders - an order to a supplier for a store (not a stock document: no movements).
create table pharmacy.purchase_orders (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  store_id uuid not null,
  supplier_id uuid not null,
  number text not null,
  order_date date not null,
  expected_date date,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'partially_received', 'closed')),
  created_by uuid not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, store_id, number),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, supplier_id) references pharmacy.suppliers (tenant_id, id),
  foreign key (tenant_id, created_by) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, confirmed_by) references pharmacy.employees (tenant_id, id),
  check ((status = 'draft') = (confirmed_at is null)),
  check ((confirmed_by is null) = (confirmed_at is null))
);
create index purchase_orders_store_status_idx on pharmacy.purchase_orders (tenant_id, store_id, status);
create index purchase_orders_supplier_idx on pharmacy.purchase_orders (tenant_id, supplier_id);
create index purchase_orders_created_by_idx on pharmacy.purchase_orders (tenant_id, created_by);
create index purchase_orders_confirmed_by_idx on pharmacy.purchase_orders (tenant_id, confirmed_by);

create table pharmacy.purchase_order_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  order_id uuid not null,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null,
  qty_ordered_pieces integer not null check (qty_ordered_pieces > 0),
  price_per_pack_dirams bigint not null check (price_per_pack_dirams >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, order_id, line_no),
  foreign key (tenant_id, order_id) references pharmacy.purchase_orders (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id)
);
create index purchase_order_lines_product_idx on pharmacy.purchase_order_lines (tenant_id, product_id);

-- A goods receipt by an order: the header knows the order, a line knows the ordered line and its
-- price (the warning «цена отличается от заказа»).
alter table pharmacy.documents add column purchase_order_id uuid;
alter table pharmacy.documents add foreign key (tenant_id, purchase_order_id)
  references pharmacy.purchase_orders (tenant_id, id);
create index documents_purchase_order_idx on pharmacy.documents (tenant_id, purchase_order_id);

alter table pharmacy.goods_receipt_lines add column purchase_order_line_id uuid;
alter table pharmacy.goods_receipt_lines add column order_price_per_pack_dirams bigint
  check (order_price_per_pack_dirams >= 0);
alter table pharmacy.goods_receipt_lines add foreign key (tenant_id, purchase_order_line_id)
  references pharmacy.purchase_order_lines (tenant_id, id);
create index goods_receipt_lines_order_line_idx on pharmacy.goods_receipt_lines
  (tenant_id, purchase_order_line_id);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML.
alter table pharmacy.supplier_payments enable row level security;
alter table pharmacy.supplier_payments force row level security;
alter table pharmacy.supplier_payment_allocations enable row level security;
alter table pharmacy.supplier_payment_allocations force row level security;
alter table pharmacy.purchase_orders enable row level security;
alter table pharmacy.purchase_orders force row level security;
alter table pharmacy.purchase_order_lines enable row level security;
alter table pharmacy.purchase_order_lines force row level security;

create policy tenant_isolation on pharmacy.supplier_payments for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.supplier_payment_allocations for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.purchase_orders for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.purchase_order_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

grant select, insert, update, delete on
  pharmacy.supplier_payments,
  pharmacy.supplier_payment_allocations,
  pharmacy.purchase_orders,
  pharmacy.purchase_order_lines
to pharmacy_app;
