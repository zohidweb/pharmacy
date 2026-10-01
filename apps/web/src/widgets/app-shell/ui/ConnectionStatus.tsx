'use client';

import type { SessionStore } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import { Icon } from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';
import { apiRequest } from '@/shared/api';
import { useOnline } from '../model/use-online';

const SYNC_REFRESH_MS = 60_000;

/**
 * Connection of the working store: a cloud store shows browser connectivity; an offline store shows
 * its last sync with the cloud and the queue of operations waiting to be sent (ADR-0014).
 * Icon + text, never color alone; changes are announced politely.
 */
export function ConnectionStatus({ store }: { store: SessionStore | null }) {
  const t = useTranslations('shell.connection');
  const online = useOnline();
  const offlineStore = store?.mode === 'offline';
  const sync = useQuery({
    queryKey: ['sync', 'status', store?.id],
    queryFn: ({ signal }) => apiRequest('sync.status', { signal }),
    enabled: offlineStore,
    refetchInterval: SYNC_REFRESH_MS,
  });

  let icon: 'refresh-cw' | 'cloud' | 'cloud-off' = online
    ? 'cloud'
    : 'cloud-off';
  let text = online ? t('online') : t('offline');
  let tone = online ? 'text-fg-muted' : 'text-danger';

  if (offlineStore) {
    icon = 'refresh-cw';
    tone = 'text-fg-muted';
    text = sync.data
      ? t('synced', {
          at: sync.data.lastSyncAt
            ? formatDateTime(sync.data.lastSyncAt)
            : t('never'),
          count: sync.data.pendingOperations,
        })
      : sync.isError
        ? t('syncUnknown')
        : t('syncLoading');
  }

  return (
    <p
      role="status"
      className={`flex min-w-0 items-center gap-2 text-xs ${tone}`}
    >
      <Icon name={icon} size="sm" />
      <span className="truncate">{text}</span>
    </p>
  );
}
