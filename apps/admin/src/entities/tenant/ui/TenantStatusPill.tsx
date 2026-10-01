'use client';

import type { TenantListItem } from '@pharmacy/shared-dto';
import { StatusPill } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { tenantStatusKey, tenantStatusTone } from '../lib/tenant-status';

export function TenantStatusPill({
  tenant,
}: {
  tenant: Pick<TenantListItem, 'status' | 'overdue'>;
}) {
  const t = useTranslations('tenant.status');
  const key = tenantStatusKey(tenant);
  return (
    <StatusPill
      tone={tenantStatusTone[key]}
      icon={key === 'blocked' ? 'ban' : undefined}
    >
      {t(key)}
    </StatusPill>
  );
}
