-- Up Migration
-- Receipts with price, discount or author marks notify the owner (security review 2026-10-22, I2; ADR-0015,
-- amendment 2026-10-23): a new notification kind, the CHECKs of the billing-services migration are rebuilt with it.
alter table pharmacy.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in ('batch_expiring', 'low_stock',
    'supplier_payment_due', 'transfer_in_transit', 'shift_discrepancy', 'negative_stock',
    'sync_conflict', 'license_expiring', 'service_decided', 'invoice_overdue', 'receipt_discrepancy'));
alter table pharmacy.tenant_settings
  drop constraint tenant_settings_disabled_notifications_check,
  add constraint tenant_settings_disabled_notifications_check
    check (disabled_notifications <@ array['batch_expiring', 'low_stock', 'supplier_payment_due',
      'transfer_in_transit', 'shift_discrepancy', 'negative_stock', 'sync_conflict',
      'license_expiring', 'service_decided', 'invoice_overdue', 'receipt_discrepancy']::text[]);
