-- Up Migration
-- The payment QR of a store (spec 2026-11-03-pos-store-ideas, D37, D38; ADR-0022, amendment 2026-11-03): the payment
-- link the bank gave the store and the recipient shown under the QR, set together or not at all. The rules of the
-- link are checked by the API (paymentQrTemplateProblem of shared-domain); these CHECKs are the last line. A change
-- notifies the owner: a new notification kind, the CHECKs of the login-locked migration are rebuilt with it.
-- stores and tenant_settings are read by every POS request: do not queue them behind a long lock.
set local lock_timeout = '5s';

alter table pharmacy.stores
  add column payment_qr_template text
    check (payment_qr_template ~ '^https://' and char_length(payment_qr_template) <= 500
      and payment_qr_template !~ '[[:space:][:cntrl:]]'),
  add column payment_qr_recipient text
    check (char_length(payment_qr_recipient) between 1 and 100),
  add constraint stores_payment_qr_pair_check
    check ((payment_qr_template is null) = (payment_qr_recipient is null));

alter table pharmacy.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in ('batch_expiring', 'low_stock',
    'supplier_payment_due', 'transfer_in_transit', 'shift_discrepancy', 'negative_stock',
    'sync_conflict', 'license_expiring', 'service_decided', 'invoice_overdue', 'receipt_discrepancy',
    'login_locked', 'payment_qr_changed'));
alter table pharmacy.tenant_settings
  drop constraint tenant_settings_disabled_notifications_check,
  add constraint tenant_settings_disabled_notifications_check
    check (disabled_notifications <@ array['batch_expiring', 'low_stock', 'supplier_payment_due',
      'transfer_in_transit', 'shift_discrepancy', 'negative_stock', 'sync_conflict',
      'license_expiring', 'service_decided', 'invoice_overdue', 'receipt_discrepancy',
      'login_locked', 'payment_qr_changed']::text[]);
