-- Up Migration
-- An employee's sign-in lock notifies the owner (security review 2026-10-22, A2, decision 7.5; ADR-0008, amendment
-- 2026-10-23): a new notification kind, the CHECKs of the receipt-discrepancy migration are rebuilt with it.
-- tenant_settings is read by every POS request: do not queue them behind a long lock.
set local lock_timeout = '5s';

alter table pharmacy.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in ('batch_expiring', 'low_stock',
    'supplier_payment_due', 'transfer_in_transit', 'shift_discrepancy', 'negative_stock',
    'sync_conflict', 'license_expiring', 'service_decided', 'invoice_overdue', 'receipt_discrepancy',
    'login_locked'));
alter table pharmacy.tenant_settings
  drop constraint tenant_settings_disabled_notifications_check,
  add constraint tenant_settings_disabled_notifications_check
    check (disabled_notifications <@ array['batch_expiring', 'low_stock', 'supplier_payment_due',
      'transfer_in_transit', 'shift_discrepancy', 'negative_stock', 'sync_conflict',
      'license_expiring', 'service_decided', 'invoice_overdue', 'receipt_discrepancy',
      'login_locked']::text[]);
