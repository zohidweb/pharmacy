-- Up Migration
-- Transfers and transfer requests (spec 2026-10-12-supplier-returns-transfers, section 3.2; data
-- model 03 with the amendments of section 2.1 p. 4–7): a request of a store to another one, and a
-- transfer from a sender to a receiver — sent (the sender's stock goes down), recalled, accepted
-- with the actual quantities (the receiver gets its own batches). The tables are of class `tenant`
-- (ADR-0013).

alter table pharmacy.documents drop constraint documents_type_check;
alter table pharmacy.documents add constraint documents_type_check
  check (type in ('goods_receipt', 'opening_balance', 'write_off', 'inventory', 'supplier_return',
                  'transfer', 'transfer_request'));

-- the statuses of a transfer and of a request (amendment 2.1 p. 4–5); a transfer is never
-- `posted`: it is sent (`in_transit`) and accepted (`received`)
alter table pharmacy.documents drop constraint documents_status_check;
alter table pharmacy.documents add constraint documents_status_check
  check (status in ('draft', 'posted', 'cancelled', 'in_transit', 'received', 'sent', 'in_progress',
                    'partial', 'done', 'rejected'));
alter table pharmacy.documents drop constraint documents_cancelled_type_check;
alter table pharmacy.documents add constraint documents_cancelled_type_check
  check (status <> 'cancelled' or type in ('inventory', 'transfer'));
alter table pharmacy.documents add constraint documents_status_type_check
  check (case type
           when 'transfer' then status in ('draft', 'in_transit', 'received', 'cancelled')
           when 'transfer_request' then status in ('draft', 'sent', 'in_progress', 'partial', 'done',
                                                   'rejected')
           else status in ('draft', 'posted', 'cancelled')
         end);

-- the second store: the receiver of a transfer, the store asked by a request
alter table pharmacy.documents add column destination_store_id uuid;
alter table pharmacy.documents add foreign key (tenant_id, destination_store_id)
  references pharmacy.stores (tenant_id, id);
alter table pharmacy.documents add constraint documents_destination_store_check
  check ((type in ('transfer', 'transfer_request')) = (destination_store_id is not null)
         and destination_store_id is distinct from store_id);
create index documents_destination_store_idx on pharmacy.documents (tenant_id, destination_store_id);

-- a transfer by a request: one not cancelled transfer per request
alter table pharmacy.documents add column request_document_id uuid;
alter table pharmacy.documents add foreign key (tenant_id, request_document_id)
  references pharmacy.documents (tenant_id, id);
alter table pharmacy.documents add constraint documents_request_type_check
  check (request_document_id is null or type = 'transfer');
create index documents_request_document_idx on pharmacy.documents (tenant_id, request_document_id);
create unique index documents_request_transfer_uq on pharmacy.documents (tenant_id, request_document_id)
  where type = 'transfer' and status <> 'cancelled';

alter table pharmacy.documents add column dispatched_at timestamptz;
alter table pharmacy.documents add column dispatched_by uuid;
alter table pharmacy.documents add column received_at timestamptz;
alter table pharmacy.documents add column received_by uuid;
alter table pharmacy.documents add column received_comment text
  check (char_length(received_comment) <= 500);
alter table pharmacy.documents add foreign key (tenant_id, dispatched_by)
  references pharmacy.employees (tenant_id, id);
alter table pharmacy.documents add foreign key (tenant_id, received_by)
  references pharmacy.employees (tenant_id, id);
alter table pharmacy.documents add constraint documents_dispatched_check
  check ((dispatched_at is null) = (dispatched_by is null)
         and (status not in ('in_transit', 'received') or dispatched_at is not null));
alter table pharmacy.documents add constraint documents_received_check
  check ((received_at is null) = (received_by is null)
         and (status = 'received') = (type = 'transfer' and received_at is not null));

-- the rejection of a request
alter table pharmacy.documents add column rejection_reason text
  check (rejection_reason in ('no_stock', 'order_from_supplier', 'other'));
alter table pharmacy.documents add column rejection_comment text
  check (char_length(rejection_comment) <= 500);
alter table pharmacy.documents add constraint documents_rejection_check
  check ((status = 'rejected') = (rejection_reason is not null));

-- transfer_request_lines - a product and the requested pieces (packs × pieces per pack)
create table pharmacy.transfer_request_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null,
  qty_requested_pieces integer not null check (qty_requested_pieces > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  unique (tenant_id, document_id, product_id),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id)
);
create index transfer_request_lines_product_idx on pharmacy.transfer_request_lines (tenant_id, product_id);

-- transfer_lines - a batch of the sender; the receiver's batch is created at acceptance (D2)
create table pharmacy.transfer_lines (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no >= 1),
  source_batch_id uuid not null,
  product_id uuid not null,
  unit text not null check (unit in ('pack', 'piece')),
  qty_sent_pieces integer not null check (qty_sent_pieces > 0),
  qty_received_pieces integer check (qty_received_pieces between 0 and qty_sent_pieces),
  target_batch_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, line_no),
  unique (tenant_id, document_id, source_batch_id),
  foreign key (tenant_id, document_id) references pharmacy.documents (tenant_id, id),
  foreign key (tenant_id, source_batch_id) references pharmacy.batches (tenant_id, id),
  foreign key (tenant_id, target_batch_id) references pharmacy.batches (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id)
);
create index transfer_lines_source_batch_idx on pharmacy.transfer_lines (tenant_id, source_batch_id);
create index transfer_lines_target_batch_idx on pharmacy.transfer_lines (tenant_id, target_batch_id);
create index transfer_lines_product_idx on pharmacy.transfer_lines (tenant_id, product_id);

-- a batch of the receiver comes from the batch of the sender
alter table pharmacy.batches drop constraint batches_origin_check;
alter table pharmacy.batches add constraint batches_origin_check
  check (origin in ('goods_receipt', 'opening_balance', 'inventory_surplus', 'transfer'));
alter table pharmacy.batches add column source_batch_id uuid;
alter table pharmacy.batches add foreign key (tenant_id, source_batch_id)
  references pharmacy.batches (tenant_id, id);
alter table pharmacy.batches add constraint batches_source_batch_check
  check ((origin = 'transfer') = (source_batch_id is not null));
create index batches_source_batch_idx on pharmacy.batches (tenant_id, source_batch_id);

alter table pharmacy.stock_movements drop constraint stock_movements_kind_check;
alter table pharmacy.stock_movements add constraint stock_movements_kind_check
  check (kind in ('goods_receipt', 'opening_balance', 'write_off', 'inventory_gain', 'inventory_loss',
                  'supplier_return', 'transfer_out', 'transfer_in', 'reversal', 'sale'));

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML (the lines
-- of a draft are replaced, the received quantities are written at acceptance).
alter table pharmacy.transfer_request_lines enable row level security;
alter table pharmacy.transfer_request_lines force row level security;
alter table pharmacy.transfer_lines enable row level security;
alter table pharmacy.transfer_lines force row level security;
create policy tenant_isolation on pharmacy.transfer_request_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.transfer_lines for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on
  pharmacy.transfer_request_lines,
  pharmacy.transfer_lines
  to pharmacy_app;
