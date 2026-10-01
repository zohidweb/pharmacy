'use client';

import type { SessionStore } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import { Icon, type IconName } from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useOutboxCounts, useTerminalRuntime } from '@/entities/terminal';
import { apiRequest, isOnline, subscribeConnectivity } from '@/shared/api';

const SYNC_REFRESH_MS = 60_000;

/**
 * Connection of the working store and the unsent POS operations the cashier always sees
 * (ADR-0015): a cloud store shows the API reachability and the browser buffer; an offline store
 * also shows its last sync with the cloud (ADR-0014). Icon + text, never color alone.
 */
export function ConnectionStatus({ store }: { store: SessionStore | null }) {
  const t = useTranslations('shell.connection');
  const online = useSyncExternalStore(
    subscribeConnectivity,
    isOnline,
    () => true,
  );
  const counts = useOutboxCounts(useTerminalRuntime());
  const offlineStore = store?.mode === 'offline';
  const sync = useQuery({
    queryKey: ['sync', 'status', store?.id],
    queryFn: ({ signal }) => apiRequest('sync.status', { signal }),
    enabled: offlineStore,
    refetchInterval: SYNC_REFRESH_MS,
  });

  let icon: IconName = online ? 'cloud' : 'cloud-off';
  let text = online
    ? t('online', { count: counts.pending })
    : t('offline', { count: counts.pending });
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
    <p role="status" className="flex min-w-0 flex-col items-end text-xs">
      <span className={`flex items-center gap-2 ${tone}`}>
        <Icon name={icon} size="sm" />
        <span className="truncate">{text}</span>
      </span>
      {counts.quarantine > 0 && (
        <span className="flex items-center gap-1 font-medium text-danger">
          <Icon name="triangle-alert" size="xs" />
          {t('quarantine', { count: counts.quarantine })}
        </span>
      )}
      {counts.paused && <span className="text-warning">{t('paused')}</span>}
    </p>
  );
}
