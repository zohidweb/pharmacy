'use client';

import type { TenantServiceStatus } from '@pharmacy/shared-dto';
import { StatusPill } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

const tone: Record<
  TenantServiceStatus,
  'info' | 'success' | 'danger' | 'neutral'
> = {
  approved: 'info',
  provided: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** The status of a network's service in words, not by color alone. */
export function TenantServiceStatusPill({
  status,
}: {
  status: TenantServiceStatus;
}) {
  const t = useTranslations('tenantServices.status');
  return <StatusPill tone={tone[status]}>{t(status)}</StatusPill>;
}
