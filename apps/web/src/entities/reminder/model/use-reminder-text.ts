'use client';

import type { ReminderKind, ReminderParams } from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import type { IconName, StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

export const reminderIcon: Record<ReminderKind, IconName> = {
  batch_expiring: 'clock',
  supplier_payment_due: 'truck',
  transfer_in_transit: 'arrow-left-right',
  low_stock: 'package',
  license_expiring: 'key-round',
  impersonation: 'user-check',
};

export const reminderTone: Record<ReminderKind, StatusTone> = {
  batch_expiring: 'warning',
  supplier_payment_due: 'danger',
  transfer_in_transit: 'info',
  low_stock: 'warning',
  license_expiring: 'warning',
  impersonation: 'info',
};

/** Title and detail of a reminder in the interface language (the API sends kind + parameters). */
export function useReminderText() {
  const t = useTranslations('reminder');
  return (kind: ReminderKind, params: ReminderParams) => {
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
    };
    return {
      title: t(`${kind}.title`, values),
      detail: t(`${kind}.detail`, values),
    };
  };
}
