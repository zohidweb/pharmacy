'use client';

import type {
  CatalogDuplicate,
  OfflineQueueItem,
  OfflineStoreSync,
} from '@pharmacy/shared-dto';
import {
  daysBetween,
  formatDateOnly,
  formatDateTime,
  formatMoney,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiTile,
  StatusPill,
  useToast,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

/** Days of the license key that make the cloud warn (ADR-0014: an expired key stops the store). */
const KEY_WARNING_DAYS = 14;

const OFFLINE_SCOPE = [
  'pos',
  'receipts',
  'returns',
  'stockCounts',
  'writeOffs',
  'catalog',
  'pricing',
  'shift',
  'reports',
] as const;

function ScopeCard() {
  const t = useTranslations('offline.scope');
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title={t('title')} />
      <ul className="flex flex-wrap gap-2">
        {OFFLINE_SCOPE.map((key) => (
          <li key={key}>
            <StatusPill tone="neutral" icon={null}>
              {t(`items.${key}`)}
            </StatusPill>
          </li>
        ))}
      </ul>
      <Alert tone="warning">{t('keyExpired')}</Alert>
    </Card>
  );
}

/** The cloud: synchronisation of the offline stores of the network (ADR-0014). */
function CloudView() {
  const t = useTranslations('offline.cloud');
  const sync = useQuery({
    queryKey: ['sync', 'stores'],
    queryFn: ({ signal }) => apiRequest('sync.stores', { signal }),
  });
  const today = toAppDate();
  const columns: DataTableColumn<OfflineStoreSync>[] = [
    { key: 'store', header: t('store'), cell: (row) => <b>{row.storeName}</b> },
    {
      key: 'lastSync',
      header: t('lastSync'),
      nowrap: true,
      cell: (row) => (row.lastSyncAt ? formatDateTime(row.lastSyncAt) : '—'),
    },
    {
      key: 'applied',
      header: t('applied'),
      numeric: true,
      cell: (row) => row.appliedLastDay,
    },
    {
      key: 'quarantine',
      header: t('quarantine'),
      numeric: true,
      cell: (row) => row.quarantined,
    },
    {
      key: 'key',
      header: t('key'),
      nowrap: true,
      cell: (row) => {
        if (!row.licenseValidUntil) return '—';
        const days = daysBetween(today, row.licenseValidUntil);
        return (
          <span className="flex flex-col items-start gap-1">
            {formatDateOnly(row.licenseValidUntil)}
            {days <= KEY_WARNING_DAYS && (
              <StatusPill tone={days < 0 ? 'danger' : 'warning'}>
                {days < 0 ? t('keyExpired') : t('keyDays', { days })}
              </StatusPill>
            )}
          </span>
        );
      },
    },
    {
      key: 'conflicts',
      header: t('conflicts'),
      cell: (row) => (
        <div className="flex flex-col gap-1 text-sm">
          <Link href={routes.pricing()} className="text-primary underline">
            {t('priceConflicts', { count: row.priceConflicts })}
          </Link>
          <Link href={routes.catalog()} className="text-primary underline">
            {t('duplicates', { count: row.pendingDuplicates })}
          </Link>
        </div>
      ),
    },
  ];
  return (
    <>
      <Alert tone="info">{t('hint')}</Alert>
      <Card padding="none">
        <CardHeader title={t('title')} inset />
        <QueryState query={sync}>
          {(data) => (
            <DataTable
              caption={t('title')}
              rowKey={(row) => row.storeId}
              rows={data}
              columns={columns}
              empty={<EmptyState icon="cloud" title={t('empty')} />}
            />
          )}
        </QueryState>
      </Card>
      <ScopeCard />
    </>
  );
}

/** The offline store itself: its queue to the cloud, sync now and its product duplicates. */
function StoreView() {
  const t = useTranslations('offline.store');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const status = useQuery({
    queryKey: ['sync', 'status'],
    queryFn: ({ signal }) => apiRequest('sync.status', { signal }),
  });
  const queue = useQuery({
    queryKey: ['sync', 'queue'],
    queryFn: ({ signal }) =>
      apiRequest('sync.queue', { query: { limit: 50 }, signal }),
  });
  const duplicates = useQuery({
    queryKey: ['catalog', 'duplicates'],
    queryFn: ({ signal }) => apiRequest('catalog.duplicates', { signal }),
  });
  const run = useMutation({
    mutationFn: () => apiRequest('sync.run'),
    onSuccess: (result) => {
      toast.show(t('synced', { sent: result.sent, received: result.received }));
      void queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
  const resolve = useMutation({
    mutationFn: (input: { id: string; decision: 'merge' | 'keep' }) =>
      apiRequest('catalog.resolveDuplicate', {
        params: { id: input.id },
        body: { decision: input.decision },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['catalog', 'duplicates'] }),
  });
  const error = useApiErrorMessage(run.error ?? resolve.error);
  const canDecide = canWrite(session, 'catalog:update');
  const today = toAppDate();
  const pending = (duplicates.data ?? []).filter(
    (d: CatalogDuplicate) =>
      d.status === 'pending' && d.storeId === session?.currentStoreId,
  );
  const queueColumns: DataTableColumn<OfflineQueueItem>[] = [
    {
      key: 'at',
      header: t('time'),
      nowrap: true,
      cell: (row) => formatDateTime(row.at),
    },
    {
      key: 'operation',
      header: t('operation'),
      cell: (row) => `${t(`kinds.${row.kind}`)} · ${row.label}`,
    },
    {
      key: 'amount',
      header: t('amount'),
      numeric: true,
      nowrap: true,
      cell: (row) =>
        row.amountMinor === null
          ? '—'
          : formatMoney(row.amountMinor, { withSign: false }),
    },
  ];
  const keyDays = status.data?.licenseValidUntil
    ? daysBetween(today, status.data.licenseValidUntil)
    : null;

  return (
    <>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <div className="flex justify-end">
        <Button
          iconStart="refresh-cw"
          loading={run.isPending}
          disabled={!canWrite(session, 'sync:run')}
          onClick={() => run.mutate()}
        >
          {t('syncNow')}
        </Button>
      </div>
      <QueryState query={status}>
        {(data) => (
          <div className="grid grid-cols-3 gap-4">
            <KpiTile
              label={t('lastSync')}
              value={data.lastSyncAt ? formatDateTime(data.lastSyncAt) : '—'}
              icon="refresh-cw"
            />
            <KpiTile
              label={t('queue')}
              value={queue.data?.total ?? data.pendingOperations}
              hint={t('queueHint')}
              icon="clock"
            />
            <KpiTile
              label={t('key')}
              value={
                data.licenseValidUntil
                  ? formatDateOnly(data.licenseValidUntil)
                  : '—'
              }
              hint={
                keyDays !== null ? t('keyDays', { days: keyDays }) : undefined
              }
              tone={
                keyDays !== null && keyDays <= KEY_WARNING_DAYS
                  ? 'warning'
                  : 'default'
              }
              icon="key-round"
            />
          </div>
        )}
      </QueryState>
      {keyDays !== null && keyDays <= KEY_WARNING_DAYS && (
        <Alert tone="warning">{t('keyWarning')}</Alert>
      )}
      <div className="grid grid-cols-2 items-start gap-4">
        <Card padding="none">
          <CardHeader title={t('queueTitle')} inset />
          <QueryState query={queue}>
            {(data) => (
              <DataTable
                caption={t('queueTitle')}
                rowKey={(row) => row.id}
                rows={data.items}
                columns={queueColumns}
                empty={
                  <EmptyState icon="circle-check" title={t('queueEmpty')} />
                }
              />
            )}
          </QueryState>
          <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
            {t('queueOrder')}
          </p>
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHeader
            title={t('duplicatesTitle')}
            description={t('duplicatesHint')}
          />
          {pending.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noDuplicates')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <b>{d.newName}</b>
                  <span className="text-sm text-fg-muted">
                    {t('existing', {
                      name: d.existingName,
                      match:
                        d.matchedBy === 'barcode'
                          ? t('byBarcode', { code: d.barcode ?? '' })
                          : t('byName'),
                    })}
                  </span>
                  {canDecide && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        aria-label={t('mergeOf', { name: d.newName })}
                        onClick={() =>
                          resolve.mutate({ id: d.id, decision: 'merge' })
                        }
                      >
                        {t('merge')}
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={t('keepOf', { name: d.newName })}
                        onClick={() =>
                          resolve.mutate({ id: d.id, decision: 'keep' })
                        }
                      >
                        {t('keep')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-fg-subtle">{t('priceHint')}</p>
          <p className="text-xs text-fg-subtle">{t('backupHint')}</p>
        </Card>
      </div>
      <ScopeCard />
    </>
  );
}

/** Offline stores (UI mockup «Офлайн-точка»): the view depends on where the app runs (ADR-0014). */
function OfflinePageView() {
  const t = useTranslations('offline');
  const { data: session } = useSession();
  const deployment = useQuery({
    queryKey: ['deployment'],
    queryFn: ({ signal }) => apiRequest('deployment.get', { signal }),
    staleTime: Infinity,
  });
  const store = session?.stores.find((s) => s.id === session.currentStoreId);
  const offlineStore = deployment.data?.kind === 'offline-store';
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          offlineStore && store
            ? t('storeSubtitle', { store: store.name })
            : t('cloudSubtitle')
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <QueryState query={deployment}>
          {() => (offlineStore ? <StoreView /> : <CloudView />)}
        </QueryState>
      </div>
    </>
  );
}

export function OfflinePage() {
  return (
    <WithMessages groups={['owner']}>
      <OfflinePageView />
    </WithMessages>
  );
}
