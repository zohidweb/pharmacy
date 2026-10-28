'use client';

import type { ConnectionRequestStatus } from '@pharmacy/shared-dto';
import { StatusPill, type StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

const tone: Record<ConnectionRequestStatus, StatusTone> = {
  new: 'attention',
  in_progress: 'info',
  connected: 'success',
  rejected: 'neutral',
  spam: 'danger',
};

/** The status of a connection request of the public site. */
export function RequestStatusPill({
  status,
}: {
  status: ConnectionRequestStatus;
}) {
  const t = useTranslations('site.requestStatus');
  return <StatusPill tone={tone[status]}>{t(status)}</StatusPill>;
}
