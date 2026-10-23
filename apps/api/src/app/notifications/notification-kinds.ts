import type { Permission } from '@pharmacy/shared-domain';
import type { NotificationKind } from '@pharmacy/shared-dto';

/** Every kind of the network settings and the notifications (spec 2026-10-14-owner-cabinet, 6.3). */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'batch_expiring',
  'low_stock',
  'supplier_payment_due',
  'transfer_in_transit',
  'shift_discrepancy',
  'negative_stock',
  'receipt_discrepancy',
  'login_locked',
  'sync_conflict',
  'license_expiring',
  'service_decided',
  'invoice_overdue',
];

/** Facts that never resolve: shown for 30 days after they appear (E12). */
export const EVENT_KINDS: readonly NotificationKind[] = [
  'shift_discrepancy',
  'negative_stock',
  'receipt_discrepancy',
  'login_locked',
  'service_decided',
];

/**
 * Kinds seen only by an employee whose scope is the whole network: a sign-in lock names an employee
 * of any store, the owner included (final review of security review A2, I3).
 */
export const NETWORK_SCOPE_KINDS: readonly NotificationKind[] = [
  'login_locked',
];

/** The permission of the area of a kind, besides `notifications:view` (E10). */
export const KIND_PERMISSION: Readonly<Record<NotificationKind, Permission>> = {
  batch_expiring: 'inventory:view',
  low_stock: 'inventory:view',
  negative_stock: 'inventory:view',
  receipt_discrepancy: 'shifts:view',
  // whoever can set a new password and so lift the lock (security review A2)
  login_locked: 'employees:update',
  transfer_in_transit: 'inventory:view',
  supplier_payment_due: 'purchasing:view',
  shift_discrepancy: 'shifts:view',
  sync_conflict: 'sync:view',
  license_expiring: 'stores:view',
  service_decided: 'services:view',
  invoice_overdue: 'billing:view',
};
