'use client';

import type { InvoiceStatus } from '@pharmacy/shared-dto';
import { StatusPill, type StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

const tone: Record<InvoiceStatus, StatusTone> = {
  issued: 'info',
  paid: 'success',
  overdue: 'danger',
};

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  const t = useTranslations('invoice.status');
  return <StatusPill tone={tone[status]}>{t(status)}</StatusPill>;
}
