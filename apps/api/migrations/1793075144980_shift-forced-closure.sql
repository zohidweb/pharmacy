-- Up Migration
-- Shift history and closing the shift of a broken till from another computer (plan 2026-10-27-shift-history, S3, S4,
-- S9; spec 2026-10-13-pos-shift-sale, amendment 2026-10-27): a shift closed from another computer is marked with its
-- reason; the late receipts and cash operations of its till are accepted and marked `after_closing` (they are not in
-- the Z-report, the snapshot of the closing). The list of the shifts reads them by store and opening time.
-- receipts and shifts are read by every POS request: do not queue them behind a long lock.
set local lock_timeout = '5s';

alter table pharmacy.shifts
  add column forced boolean not null default false,
  add column forced_reason text,
  add constraint shifts_forced_reason_check check (
    forced = (forced_reason is not null)
    and (forced_reason is null or length(forced_reason) between 1 and 500)
  ),
  add constraint shifts_forced_closed_check check (not forced or status = 'closed');

alter table pharmacy.shift_cash_operations
  add column after_closing boolean not null default false;

alter table pharmacy.receipts
  drop constraint receipts_discrepancy_kinds_check,
  add constraint receipts_discrepancy_kinds_check
    check (discrepancy_kinds <@ array['stock', 'price', 'discount', 'catalog', 'author', 'closed_period',
                                      'after_closing']::text[]);

-- the closing from another computer carries its idempotency key (S3)
alter table pharmacy.idempotency_keys
  drop constraint idempotency_keys_scope_check,
  add constraint idempotency_keys_scope_check
    check (scope in ('receipt', 'shift.open', 'shift.cash', 'shift.close', 'return', 'shift.force-close'));

create index shifts_store_opened_idx on pharmacy.shifts (tenant_id, store_id, opened_at desc);
