'use client';

import type { InvoiceStatus } from '@pharmacy/shared-dto';
import { StatusPill, type StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

const tone: Record<InvoiceStatus, StatusTone> = {
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
};

/**
 * The status of an invoice derived from what is paid on it, and the overdue mark beside it: overdue
 * is a remainder after the due date, not a status (spec 2026-10-15-billing-services, A8).
 */
export function InvoiceStatusPill({
  status,
  overdue = false,
}: {
  status: InvoiceStatus;
  overdue?: boolean;
}) {
  const t = useTranslations('invoice');
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusPill tone={tone[status]}>{t(`status.${status}`)}</StatusPill>
      {overdue && <StatusPill tone="danger">{t('overdue')}</StatusPill>}
    </span>
  );
}
