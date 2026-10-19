-- Up Migration
-- Decisions of the architect 2026-10-16 (APPROVAL.md): auth3-M3 — an index for the operator filter of
-- the operators' log (what was done to an operator's account: entity_type = 'operator'); cr-M9 —
-- composite keys of customer returns (spec 2026-10-13-customer-returns, 2.1 p. 4): the shift of a
-- return is a shift of its store, a return line is a line of the receipt of its return. The keys come
-- NOT VALID and are validated by the next migration in its own transaction (rule cr-N3).
set local lock_timeout = '5s';

-- auth3-M3
create index platform_audit_log_entity_idx
  on pharmacy.platform_audit_log (entity_type, entity_id, recorded_at);

-- cr-M9: the key a return line refers to first — it takes the strongest lock on customer_returns, so
-- the lock is not upgraded later in this transaction (a reader of returns cannot deadlock with it)
alter table pharmacy.customer_returns
  add constraint customer_returns_tenant_id_receipt_key unique (tenant_id, id, receipt_id);

-- cr-M9: the shift of a return is a shift of the store of the return
alter table pharmacy.shifts add constraint shifts_tenant_store_id_key unique (tenant_id, store_id, id);
alter table pharmacy.customer_returns
  add constraint customer_returns_store_shift_fkey
  foreign key (tenant_id, store_id, shift_id) references pharmacy.shifts (tenant_id, store_id, id)
  not valid;

-- cr-M9: a return line is a line of the receipt of its return — the line carries the receipt
alter table pharmacy.receipt_lines
  add constraint receipt_lines_tenant_receipt_id_key unique (tenant_id, receipt_id, id);
alter table pharmacy.customer_return_lines add column receipt_id uuid;

-- The receipt of the existing lines, filled once (decided by the architect 2026-10-16): the owner of
-- the tables lifts FORCE and the append-only trigger within this transaction only; for the roles of
-- the API the lines stay append-only.
alter table pharmacy.customer_return_lines no force row level security;
alter table pharmacy.customer_returns no force row level security;
alter table pharmacy.customer_return_lines disable trigger customer_return_lines_no_update_delete;
update pharmacy.customer_return_lines l
set receipt_id = r.receipt_id
from pharmacy.customer_returns r
where r.tenant_id = l.tenant_id and r.id = l.customer_return_id;
alter table pharmacy.customer_return_lines enable trigger customer_return_lines_no_update_delete;
alter table pharmacy.customer_returns force row level security;
alter table pharmacy.customer_return_lines force row level security;

alter table pharmacy.customer_return_lines alter column receipt_id set not null;
alter table pharmacy.customer_return_lines
  add constraint customer_return_lines_receipt_line_fkey
  foreign key (tenant_id, receipt_id, receipt_line_id)
  references pharmacy.receipt_lines (tenant_id, receipt_id, id) not valid,
  add constraint customer_return_lines_return_receipt_fkey
  foreign key (tenant_id, customer_return_id, receipt_id)
  references pharmacy.customer_returns (tenant_id, id, receipt_id) not valid;
