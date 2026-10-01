'use client';

import type {
  InstallationFilter,
  InstallationItem,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Chip,
  ChipGroup,
  DataTable,
  Dialog,
  EmptyState,
  KpiTile,
  StatusPill,
  TextField,
  useToast,
  type DataTableColumn,
  type StatusTone,
} from '@pharmacy/ui';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { APP_TIME_ZONE } from '@/shared/i18n';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const filters: InstallationFilter[] = ['all', 'outdated', 'critical'];
const stateTone: Record<InstallationItem['state'], StatusTone> = {
  current: 'success',
  behind: 'warning',
  unsupported: 'danger',
};
/** Dushanbe is UTC+5 all year (no DST): a local date + time maps to a fixed-offset instant. */
const DUSHANBE_OFFSET = '+05:00';

function ScheduleUpdateDialog({
  installation,
  targetVersion,
  onClose,
}: {
  installation: InstallationItem | null;
  targetVersion: string;
  onClose: () => void;
}) {
  const t = useTranslations('installations.schedule');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('20:00');
  const [access, setAccess] = useState('');
  const [touched, setTouched] = useState(false);
  const scheduledAt =
    date && time ? new Date(`${date}T${time}:00${DUSHANBE_OFFSET}`) : null;
  const invalidWhen =
    !scheduledAt ||
    Number.isNaN(scheduledAt.getTime()) ||
    scheduledAt.getTime() < Date.now();
  const invalidAccess = access.trim().length < 3;
  const close = () => {
    setDate('');
    setAccess('');
    setTouched(false);
    schedule.reset();
    onClose();
  };
  const schedule = useMutation({
    mutationFn: () =>
      apiRequest('installations.scheduleUpdate', {
        params: { storeId: installation?.storeId ?? '' },
        body: {
          targetVersion,
          scheduledAt: scheduledAt?.toISOString() ?? '',
          accessMethod: access.trim(),
        },
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['installations'] });
      toast.show(
        t('done', { at: formatDateTime(saved.plannedUpdateAt ?? '') }),
      );
      close();
    },
  });
  const error = useApiErrorMessage(schedule.error);
  return (
    <Dialog
      open={installation !== null}
      onClose={close}
      title={t('title')}
      description={
        installation
          ? `${installation.storeName} · ${installation.version} → ${targetVersion}`
          : undefined
      }
      closeLabel={tCommon('close')}
      size="md"
      footer={
        <>
          <Button variant="tertiary" onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button
            iconStart="calendar-check"
            loading={schedule.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalidWhen && !invalidAccess) schedule.mutate();
            }}
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
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('date')}
          type="date"
          min={today}
          required
          value={date}
          error={touched && invalidWhen ? t('whenError') : undefined}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label={t('time')}
          type="time"
          required
          hint={t('timeHint', { zone: APP_TIME_ZONE })}
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </div>
      <TextField
        label={t('access')}
        placeholder={t('accessPlaceholder')}
        required
        value={access}
        error={touched && invalidAccess ? t('accessError') : undefined}
        onChange={(event) => setAccess(event.target.value)}
      />
      <Alert tone="info">{t('note')}</Alert>
    </Dialog>
  );
}

/** «Версии установок» (UI mockup «Версии»): versions of offline stores and the release feed. */
export function InstallationsPage() {
  const t = useTranslations('installations');
  const tTable = useTranslations('table');
  const [filter, setFilter] = useState<InstallationFilter>('all');
  const [scheduling, setScheduling] = useState<InstallationItem | null>(null);
  const list = useQuery({
    queryKey: ['installations', filter],
    queryFn: ({ signal }) =>
      apiRequest('installations.list', { query: { filter }, signal }),
    placeholderData: keepPreviousData,
  });
  const releases = useQuery({
    queryKey: ['releases'],
    queryFn: ({ signal }) => apiRequest('releases.list', { signal }),
  });

  const columns: DataTableColumn<InstallationItem>[] = [
    {
      key: 'store',
      header: t('columns.store'),
      cell: (row) => (
        <div className="flex flex-col">
          <Link
            href={routes.store(row.storeId)}
            className="font-medium text-fg hover:text-primary"
          >
            {row.storeName}
          </Link>
          <span className="text-xs text-fg-subtle">{row.city}</span>
        </div>
      ),
    },
    {
      key: 'tenant',
      header: t('columns.tenant'),
      cell: (row) => row.tenantName,
    },
    {
      key: 'version',
      header: t('columns.version'),
      nowrap: true,
      cell: (row) => <span className="font-mono">{row.version}</span>,
    },
    {
      key: 'updated',
      header: t('columns.updated'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.updatedOn),
    },
    {
      key: 'host',
      header: t('columns.host'),
      nowrap: true,
      cell: (row) => t('host', { os: row.os, ram: row.ramGb }),
    },
    {
      key: 'state',
      header: t('columns.state'),
      nowrap: true,
      cell: (row) => (
        <StatusPill tone={stateTone[row.state]}>
          {row.state === 'current'
            ? t('state.current')
            : row.state === 'behind'
              ? t('state.behind', { count: row.behindBy })
              : t('state.unsupported', {
                  date: row.supportedUntil
                    ? formatDateOnly(row.supportedUntil)
                    : '—',
                })}
        </StatusPill>
      ),
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tTable('actions')}</span>,
      align: 'end',
      nowrap: true,
      cell: (row) =>
        row.plannedUpdateAt ? (
          <span className="text-xs text-fg-muted">
            {t('planned', { at: formatDateTime(row.plannedUpdateAt) })}
          </span>
        ) : row.state === 'current' ? null : (
          <Button
            variant={row.state === 'unsupported' ? 'destructive' : 'tertiary'}
            aria-label={t('scheduleFor', { store: row.storeName })}
            onClick={() => setScheduling(row)}
          >
            {row.state === 'unsupported'
              ? t('updateUrgent')
              : t('scheduleUpdate')}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={list}>
          {(data) => (
            <>
              <div className="grid grid-cols-4 gap-4">
                <KpiTile
                  label={t('kpi.latest')}
                  value={data.latest.version}
                  hint={t('kpi.latestHint', {
                    date: formatDateOnly(data.latest.releasedOn),
                  })}
                  icon="package"
                />
                <KpiTile
                  label={t('kpi.updated')}
                  value={t('kpi.updatedValue', {
                    updated: data.updated,
                    total: data.counts.all,
                  })}
                  tone="success"
                  icon="circle-check"
                />
                <KpiTile
                  label={t('kpi.outdated')}
                  value={data.counts.outdated}
                  tone={data.counts.outdated > 0 ? 'warning' : 'default'}
                  icon="refresh-cw"
                />
                <KpiTile
                  label={t('kpi.critical')}
                  value={data.counts.critical}
                  hint={t('kpi.criticalHint')}
                  tone={data.counts.critical > 0 ? 'danger' : 'default'}
                  icon="triangle-alert"
                />
              </div>
              <Card padding="none">
                <CardHeader
                  title={t('table')}
                  inset
                  actions={
                    <ChipGroup label={t('filterLabel')}>
                      {filters.map((value) => (
                        <Chip
                          key={value}
                          selected={filter === value}
                          count={data.counts[value]}
                          onClick={() => setFilter(value)}
                        >
                          {t(`filters.${value}`)}
                        </Chip>
                      ))}
                    </ChipGroup>
                  }
                />
                <DataTable
                  caption={t('table')}
                  columns={columns}
                  rows={data.items}
                  rowKey={(row) => row.storeId}
                  minWidth="lg"
                  empty={<EmptyState icon="package" title={t('empty')} />}
                />
              </Card>
              <ScheduleUpdateDialog
                installation={scheduling}
                targetVersion={data.latest.version}
                onClose={() => setScheduling(null)}
              />
            </>
          )}
        </QueryState>
        <Card as="section" aria-labelledby="releases-title">
          <CardHeader title={t('releases.title')} titleId="releases-title" />
          <QueryState query={releases}>
            {(rows) => (
              <ol className="m-0 flex list-none flex-col gap-4 p-0">
                {rows.map((release) => (
                  <li
                    key={release.version}
                    className="flex gap-4 border-b border-border pb-4 last:border-b-0 last:pb-0"
                  >
                    <span className="w-16 shrink-0 font-mono font-bold">
                      {release.version}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm">{release.notes}</span>
                      <span className="text-xs text-fg-subtle">
                        {formatDateOnly(release.releasedOn)}
                        {release.supportedUntil &&
                          ` · ${t('releases.supportedUntil', { date: formatDateOnly(release.supportedUntil) })}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}
