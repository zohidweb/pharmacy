'use client';

import type { StoreMode } from '@pharmacy/shared-dto';
import { StatusPill } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

/** Cloud or offline store (ADR-0014): icon + text, never color alone. */
export function StoreModeBadge({ mode }: { mode: StoreMode }) {
  const t = useTranslations('store.mode');
  return mode === 'cloud' ? (
    <StatusPill tone="info" icon="cloud">
      {t('cloud')}
    </StatusPill>
  ) : (
    <StatusPill tone="neutral" icon="cloud-off">
      {t('offline')}
    </StatusPill>
  );
}
