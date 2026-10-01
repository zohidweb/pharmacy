'use client';

import type { StoreMode, StoreSummary } from '@pharmacy/shared-dto';
import { formatDateOnly, toAppDate } from '@pharmacy/shared-util';
import { StatusPill } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { storeStatusKey, storeStatusTone } from '../lib/store-status';

export function StoreModePill({ mode }: { mode: StoreMode }) {
  const t = useTranslations('store.mode');
  return (
    <StatusPill
      tone={mode === 'cloud' ? 'info' : 'neutral'}
      icon={mode === 'cloud' ? null : 'key-round'}
    >
      {t(mode)}
    </StatusPill>
  );
}

export function StoreStatusPill({
  store,
}: {
  store: Pick<
    StoreSummary,
    'status' | 'mode' | 'licenseValidUntil' | 'lastSyncAt' | 'closedOn'
  >;
}) {
  const t = useTranslations('store.status');
  const key = storeStatusKey(store, toAppDate());
  return (
    <StatusPill
      tone={storeStatusTone[key]}
      icon={key === 'closed' ? 'ban' : undefined}
    >
      {key === 'closed' && store.closedOn
        ? t('closedOn', { date: formatDateOnly(store.closedOn) })
        : t(key)}
    </StatusPill>
  );
}
