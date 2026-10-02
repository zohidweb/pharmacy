'use client';

import type {
  PurchaseOrderStatus,
  SupplierDebtState,
} from '@pharmacy/shared-dto';
import { StatusPill, type IconName, type StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

const orderTone: Record<
  PurchaseOrderStatus,
  { tone: StatusTone; icon?: IconName }
> = {
  draft: { tone: 'neutral', icon: 'pencil' },
  confirmed: { tone: 'info', icon: 'circle-check' },
  partially_received: { tone: 'attention', icon: 'package' },
  closed: { tone: 'success' },
};

/** Status of a purchase order: draft → confirmed → partially received → closed. */
export function OrderStatusPill({ status }: { status: PurchaseOrderStatus }) {
  const t = useTranslations('orders.status');
  const { tone, icon } = orderTone[status];
  return (
    <StatusPill tone={tone} icon={icon}>
      {t(status)}
    </StatusPill>
  );
}

/** Debt to a supplier by due date: icon + text, the days in words. */
export function DebtStatePill({
  state,
  overdueDays,
}: {
  state: SupplierDebtState;
  overdueDays: number;
}) {
  const t = useTranslations('suppliers.debtState');
  if (state === 'overdue') {
    return (
      <StatusPill tone="danger">
        {t('overdue', { days: overdueDays })}
      </StatusPill>
    );
  }
  return state === 'on_time' ? (
    <StatusPill tone="success">{t('onTime')}</StatusPill>
  ) : (
    <StatusPill tone="neutral">{t('none')}</StatusPill>
  );
}
