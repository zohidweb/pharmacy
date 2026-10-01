'use client';

import type { LicenseListItem } from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { StatusPill } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import {
  daysLeft,
  licenseStatusKey,
  licenseStatusTone,
} from '../lib/license-status';

export function LicenseStatusPill({
  license,
}: {
  license: Pick<LicenseListItem, 'state' | 'validUntil' | 'notifyDaysBefore'>;
}) {
  const t = useTranslations('license.status');
  const today = toAppDate();
  const key = licenseStatusKey(license, today);
  return (
    <StatusPill
      tone={licenseStatusTone[key]}
      icon={key === 'revoked' ? 'ban' : undefined}
    >
      {key === 'expiring'
        ? t('expiring', { days: daysLeft(license.validUntil, today) })
        : t(key)}
    </StatusPill>
  );
}
