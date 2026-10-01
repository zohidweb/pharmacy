'use client';

import type { EventKind, EventParams } from '@pharmacy/shared-dto';
import { formatMoney } from '@pharmacy/shared-util';
import type { IconName, StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

export const eventIcon: Record<EventKind, IconName> = {
  invoice_overdue: 'receipt',
  key_expiring: 'key-round',
  key_revoked: 'ban',
  service_requested: 'sparkles',
  sync_stale: 'refresh-cw',
  payment_recorded: 'circle-check',
  update_available: 'package',
};

export const eventTone: Record<EventKind, StatusTone> = {
  invoice_overdue: 'danger',
  key_expiring: 'warning',
  key_revoked: 'danger',
  service_requested: 'info',
  sync_stale: 'warning',
  payment_recorded: 'success',
  update_available: 'info',
};

/** Title and detail of an event in the interface language (the API sends kind + parameters). */
export function useEventText() {
  const t = useTranslations('event');
  return (kind: EventKind, params: EventParams) => {
    const values = {
      tenant: params.tenantName ?? '—',
      store: params.storeName ?? '—',
      invoice: params.invoiceNumber ?? '—',
      service: params.serviceName ?? '—',
      amount:
        params.amountMinor !== undefined
          ? formatMoney(params.amountMinor)
          : '—',
      days: params.days ?? 0,
      version: params.version ?? '—',
    };
    return {
      title: t(`${kind}.title`, values),
      detail: t(`${kind}.detail`, values),
    };
  };
}
