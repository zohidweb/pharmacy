'use client';

import type { NotificationKind, ReminderParams } from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import type { IconName, StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

export const reminderIcon: Record<NotificationKind, IconName> = {
  batch_expiring: 'clock',
  low_stock: 'package',
  supplier_payment_due: 'truck',
  transfer_in_transit: 'arrow-left-right',
  shift_discrepancy: 'banknote',
  negative_stock: 'triangle-alert',
  sync_conflict: 'refresh-cw',
  license_expiring: 'key-round',
  service_decided: 'sparkles',
  invoice_overdue: 'receipt',
};

export const reminderTone: Record<NotificationKind, StatusTone> = {
  batch_expiring: 'warning',
  low_stock: 'warning',
  supplier_payment_due: 'danger',
  transfer_in_transit: 'info',
  shift_discrepancy: 'danger',
  negative_stock: 'warning',
  sync_conflict: 'warning',
  license_expiring: 'warning',
  service_decided: 'info',
  invoice_overdue: 'danger',
};

/** Title and detail of a reminder in the interface language (the API sends kind + parameters). */
export function useReminderText() {
  const t = useTranslations('reminder');
  return (kind: NotificationKind, params: ReminderParams) => {
    const values = {
      product: params.productName ?? '—',
      batch: params.batchNumber ?? '—',
      days: params.days ?? 0,
      quantity: params.quantity ?? 0,
      store: params.storeName ?? '—',
      supplier: params.supplierName ?? '—',
      dueDate: params.dueDate ? formatDateOnly(params.dueDate) : '—',
      amount:
        params.amountMinor !== undefined
          ? formatMoney(params.amountMinor)
          : '—',
      document: params.documentNumber ?? '—',
      from: params.fromStore ?? '—',
      to: params.toStore ?? '—',
      positions: params.positions ?? 0,
      operator: params.operatorName ?? '—',
      shift: params.shiftNumber ?? '—',
      service: params.serviceName ?? '—',
      decision: params.decision ?? 'approved',
      price:
        params.priceMinor !== undefined ? formatMoney(params.priceMinor) : '—',
      reason: params.reason ?? '—',
    };
    // an expired batch counts its days back (the API sends a negative `days`)
    if (kind === 'batch_expiring' && values.days < 0) {
      return {
        title: t('batch_expiring.title', values),
        detail: t('batch_expiring.expired', { ...values, days: -values.days }),
      };
    }
    return {
      title: t(`${kind}.title`, values),
      detail: t(`${kind}.detail`, values),
    };
  };
}
