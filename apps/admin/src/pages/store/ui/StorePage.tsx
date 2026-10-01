'use client';

import type { StoreDetails, SyncHistoryEntry } from '@pharmacy/shared-dto';
import {
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
  Dialog,
  EmptyState,
  Icon,
  KpiTile,
  Spinner,
  StatusPill,
  TextField,
  useToast,
  type DataTableColumn,
} from '@pharmacy/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { StoreModePill, StoreStatusPill, useStore } from '@/entities/store';
import { useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { useMigrateToCloud, useRequestSync } from '../api/store-mutations';
import { LicenseSettingsForm, StoreParamsForm } from './StoreForms';

const syncTone = {
  ok: 'success',
  ok_with_conflicts: 'warning',
  no_connection: 'danger',
} as const;

function RequestSync({ store }: { store: StoreDetails }) {
  const t = useTranslations('store.requestSync');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const request = useRequestSync(store.id);
  const error = useApiErrorMessage(request.error);
  const close = () => {
    setOpen(false);
    request.reset();
  };
  return (
    <>
      <Button
        variant="tertiary"
        iconStart="refresh-cw"
        onClick={() => setOpen(true)}
      >
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('title')}
        description={t('description', { name: store.name })}
        closeLabel={tCommon('close')}
        icon="refresh-cw"
        tone="info"
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              loading={request.isPending}
              onClick={() =>
                request.mutate(undefined, {
                  onSuccess: () => {
                    toast.show(t('sent'));
                    close();
                  },
                })
              }
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
      </Dialog>
    </>
  );
}

const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

function MigrateToCloud({ store }: { store: StoreDetails }) {
  const t = useTranslations('store.migrate');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [paidUntil, setPaidUntil] = useState('');
  const [touched, setTouched] = useState(false);
  const migrate = useMigrateToCloud(store.id);
  const error = useApiErrorMessage(migrate.error);
  const today = toAppDate();
  const invalid = !DATE_INPUT.test(paidUntil) || paidUntil < today;
  const close = () => {
    setOpen(false);
    setPaidUntil('');
    setTouched(false);
    migrate.reset();
  };
  return (
    <>
      <Button
        variant="secondary"
        iconStart="store"
        onClick={() => setOpen(true)}
      >
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('title')}
        description={t('description', { name: store.name })}
        closeLabel={tCommon('close')}
        size="md"
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              loading={migrate.isPending}
              onClick={() => {
                setTouched(true);
                if (invalid) return;
                migrate.mutate(
                  { paidUntil },
                  {
                    onSuccess: () => {
                      toast.show(t('done'));
                      close();
                    },
                  },
                );
              }}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <ol className="m-0 flex list-decimal flex-col gap-2 ps-5 text-sm text-fg-muted">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
        </ol>
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <TextField
          label={t('paidUntil')}
          type="date"
          min={today}
          value={paidUntil}
          required
          error={touched && invalid ? t('paidUntilError') : undefined}
          onChange={(event) => setPaidUntil(event.target.value)}
        />
        <Alert tone="attention">{t('warning')}</Alert>
      </Dialog>
    </>
  );
}

function StoreView() {
  const t = useTranslations('store');
  const format = useFormatter();
  const id = useSearchParams()?.get('id') ?? '';
  const store = useStore(id);

  const historyColumns: DataTableColumn<SyncHistoryEntry>[] = [
    {
      key: 'at',
      header: t('history.columns.at'),
      nowrap: true,
      cell: (entry) => formatDateTime(entry.at),
    },
    {
      key: 'operations',
      header: t('history.columns.operations'),
      numeric: true,
      cell: (entry) => entry.operations,
    },
    {
      key: 'version',
      header: t('history.columns.version'),
      nowrap: true,
      cell: (entry) => <span className="font-mono">{entry.version}</span>,
    },
    {
      key: 'result',
      header: t('history.columns.result'),
      nowrap: true,
      cell: (entry) => (
        <StatusPill tone={syncTone[entry.result]}>
          {t(`history.result.${entry.result}`, { count: entry.conflicts })}
        </StatusPill>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={store.data?.name ?? t('title')}
        subtitle={store.data?.tenantName}
      />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={store}>
          {(data) => {
            const queued = data.syncQueue.reduce(
              (sum, item) => sum + item.operations,
              0,
            );
            const offline = data.mode === 'offline';
            return (
              <>
                <Link
                  href={routes.company(data.tenantId)}
                  className="inline-flex items-center gap-1 self-start text-sm text-primary hover:text-primary-hover"
                >
                  <Icon name="arrow-left" size="sm" />
                  {t('back', { company: data.tenantName })}
                </Link>
                <Card className="flex flex-wrap items-center gap-5">
                  <span className="grid size-avatar-lg place-items-center rounded-lg bg-primary-subtle text-primary">
                    <Icon name="store" size="xl" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold tracking-tight">
                        {data.name}
                      </h2>
                      <StoreModePill mode={data.mode} />
                      <StoreStatusPill store={data} />
                    </div>
                    <p className="text-sm text-fg-muted">
                      {t('meta', {
                        manager: data.managerName || '—',
                        cashiers: data.cashiers,
                        since: formatDateOnly(data.connectedOn),
                      })}
                    </p>
                  </div>
                  {offline && data.status === 'active' && (
                    <div className="flex flex-wrap gap-2">
                      <RequestSync store={data} />
                      <MigrateToCloud store={data} />
                    </div>
                  )}
                </Card>

                <div className="grid grid-cols-4 gap-4">
                  {offline ? (
                    <>
                      <KpiTile
                        label={t('kpi.lastSync')}
                        value={
                          data.lastSyncAt
                            ? format.relativeTime(
                                new Date(data.lastSyncAt),
                                new Date(),
                              )
                            : t('kpi.never')
                        }
                        hint={
                          data.lastSyncAt
                            ? formatDateTime(data.lastSyncAt)
                            : undefined
                        }
                        icon="refresh-cw"
                      />
                      <KpiTile
                        label={t('kpi.queue')}
                        value={queued}
                        hint={t('kpi.queueHint')}
                        tone={queued > 0 ? 'warning' : 'default'}
                        icon="package"
                      />
                      <KpiTile
                        label={t('kpi.version')}
                        value={data.installedVersion ?? '—'}
                        hint={
                          data.installedVersion === data.latestVersion
                            ? t('kpi.versionCurrent')
                            : t('kpi.versionAvailable', {
                                version: data.latestVersion,
                              })
                        }
                        tone={
                          data.installedVersion === data.latestVersion
                            ? 'default'
                            : 'warning'
                        }
                        icon="monitor"
                      />
                    </>
                  ) : (
                    <>
                      <KpiTile
                        label={t('kpi.paidUntil')}
                        value={
                          data.paidUntil ? formatDateOnly(data.paidUntil) : '—'
                        }
                        icon="calendar-check"
                      />
                      <KpiTile
                        label={t('kpi.receipts')}
                        value={data.monthReceipts}
                        icon="receipt"
                      />
                      <KpiTile
                        label={t('kpi.cashiers')}
                        value={data.cashiers}
                        icon="user-check"
                      />
                    </>
                  )}
                  <KpiTile
                    label={t('kpi.sales')}
                    value={formatMoney(data.monthSalesMinor)}
                    hint={t('kpi.salesHint', { receipts: data.monthReceipts })}
                    icon="chart-column"
                  />
                </div>

                <div className="grid grid-cols-2 items-start gap-4">
                  <StoreParamsForm store={data} />
                  {offline ? (
                    <LicenseSettingsForm store={data} />
                  ) : (
                    <Card>
                      <EmptyState
                        icon="store"
                        title={t('cloudTitle')}
                        description={t('cloudDescription')}
                      />
                    </Card>
                  )}
                </div>

                {offline && (
                  <div className="grid grid-cols-3 items-start gap-4">
                    <Card padding="none" className="col-span-2">
                      <CardHeader title={t('history.title')} inset />
                      <DataTable
                        caption={t('history.title')}
                        columns={historyColumns}
                        rows={data.syncHistory}
                        rowKey={(entry) => entry.at}
                        empty={
                          <EmptyState
                            icon="refresh-cw"
                            title={t('history.empty')}
                          />
                        }
                        minWidth="none"
                      />
                    </Card>
                    <Card as="section" aria-labelledby="sync-queue-title">
                      <CardHeader
                        title={t('queue.title')}
                        titleId="sync-queue-title"
                      />
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {data.syncQueue.map((item) => (
                          <li
                            key={item.kind}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span>{t(`queue.kind.${item.kind}`)}</span>
                            <span className="font-bold tabular-nums">
                              {item.operations}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {data.syncQueue.length === 0 && (
                        <p className="text-sm text-fg-subtle">
                          {t('queue.empty')}
                        </p>
                      )}
                      <Alert tone="attention" className="mt-4">
                        {t('queue.responsibility')}
                      </Alert>
                    </Card>
                  </div>
                )}
              </>
            );
          }}
        </QueryState>
      </div>
    </>
  );
}

/** Store card (UI mockup «Точка»), `/stores/view?id=…`. */
export function StorePage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center text-primary">
          <Spinner size="xl" />
        </div>
      }
    >
      <StoreView />
    </Suspense>
  );
}
