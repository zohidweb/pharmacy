'use client';

import type {
  DashboardPeriod,
  DashboardStoreRow,
  TenantDashboard,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  BarChart,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Icon,
  KpiTile,
  Select,
  type DataTableColumn,
  type StatusTone,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import {
  reminderIcon,
  reminderTone,
  useReminderText,
} from '@/entities/reminder';
import { useSession } from '@/entities/session';
import { StoreModeBadge } from '@/entities/store';
import { apiRequest } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { WithMessages } from '@/shared/i18n';

const periods: DashboardPeriod[] = ['today', 'week', 'month'];

const toneSurface: Record<StatusTone, string> = {
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
  attention: 'bg-attention-subtle text-attention',
  neutral: 'bg-surface-sunken text-fg-muted',
};

function Kpis({ data }: { data: TenantDashboard }) {
  const t = useTranslations('dashboard.kpi');
  const format = useFormatter();
  const { kpi, period } = data;
  const change = kpi.revenueChangePercent;
  return (
    <div className="grid grid-cols-4 gap-4">
      <KpiTile
        label={t(`revenue.${period}`)}
        value={formatMoney(kpi.revenueMinor)}
        hint={
          change === null
            ? t('noComparison')
            : t('revenueChange', {
                change: format.number(change / 100, {
                  style: 'percent',
                  signDisplay: 'exceptZero',
                }),
                period,
              })
        }
        tone={change !== null && change < 0 ? 'danger' : 'default'}
        icon="shopping-cart"
      />
      <KpiTile
        label={t('receipts')}
        value={kpi.receipts}
        hint={t('averageReceipt', {
          amount: formatMoney(kpi.averageReceiptMinor),
        })}
        icon="receipt"
      />
      <KpiTile
        label={t('lowStock')}
        value={kpi.lowStockItems}
        hint={t('lowStockHint')}
        tone={kpi.lowStockItems > 0 ? 'warning' : 'success'}
        icon="package"
      />
      <KpiTile
        label={t('expiring')}
        value={kpi.expiringBatches}
        hint={t('expiringHint', { count: kpi.expiringCritical })}
        tone={kpi.expiringCritical > 0 ? 'warning' : 'default'}
        icon="clock"
      />
    </div>
  );
}

function StoresTable({ rows }: { rows: DashboardStoreRow[] }) {
  const t = useTranslations('dashboard.stores');
  const columns: DataTableColumn<DashboardStoreRow>[] = [
    {
      key: 'name',
      header: t('store'),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'mode',
      header: t('mode'),
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <StoreModeBadge mode={row.mode} />
          {row.mode === 'offline' && (
            <span className="text-xs text-fg-subtle">
              {row.lastSyncAt
                ? t('syncedAt', { at: formatDateTime(row.lastSyncAt) })
                : t('neverSynced')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'receipts',
      header: t('receipts'),
      numeric: true,
      cell: (row) => row.receipts,
    },
    {
      key: 'revenue',
      header: t('revenue'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.revenueMinor, { withSign: false }),
    },
  ];
  return (
    // the table itself is the labelled region: no second landmark with the same name
    <Card padding="none">
      <CardHeader title={t('title')} description={t('hint')} inset />
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.storeId}
        minWidth="none"
        empty={<EmptyState icon="store" title={t('empty')} />}
      />
    </Card>
  );
}

function Reminders({ data }: { data: TenantDashboard }) {
  const t = useTranslations('dashboard');
  const text = useReminderText();
  return (
    <Card as="section" padding="none" aria-labelledby="reminders-title">
      <CardHeader title={t('reminders')} titleId="reminders-title" inset />
      {data.reminders.length === 0 ? (
        <EmptyState icon="circle-check" title={t('noReminders')} />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {data.reminders.map((item) => {
            const { title, detail } = text(item.kind, item.params);
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 border-t border-border px-(--ph-card-padding) py-3"
              >
                <span
                  className={`grid size-avatar-sm shrink-0 place-items-center rounded-md ${toneSurface[reminderTone[item.kind]]}`}
                >
                  <Icon name={reminderIcon[item.kind]} size="sm" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-fg">{title}</span>
                  <span className="text-xs text-fg-subtle">{detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Activity({ data }: { data: TenantDashboard }) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  return (
    <Card as="section" padding="none" aria-labelledby="activity-title">
      <CardHeader title={t('activity')} titleId="activity-title" inset />
      {data.recentActivity.length === 0 ? (
        <EmptyState icon="scroll-text" title={t('noActivity')} />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {data.recentActivity.map((entry) => (
            <li
              key={entry.id}
              className="flex gap-4 border-t border-border px-(--ph-card-padding) py-3 text-sm"
            >
              <time
                dateTime={entry.at}
                className="shrink-0 text-fg-subtle tabular-nums"
              >
                {format.dateTime(new Date(entry.at), {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              <span className="flex min-w-0 flex-col">
                <span className="text-fg">{entry.description}</span>
                <span className="text-xs text-fg-subtle">
                  {entry.storeName
                    ? `${entry.actorName} · ${entry.storeName}`
                    : entry.actorName}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Network overview (UI mockup «Дашборд») over the stores of the employee scope. */
function DashboardPageView() {
  const t = useTranslations('dashboard');
  const { data: session } = useSession();
  const [period, setPeriod] = useState<DashboardPeriod>('today');
  const dashboard = useQuery({
    queryKey: ['dashboard', period],
    queryFn: ({ signal }) =>
      apiRequest('dashboard.get', { query: { period }, signal }),
  });

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', {
          network: session?.tenant.name ?? '—',
          stores: session?.stores.length ?? 0,
          date: formatDateOnly(toAppDate()),
        })}
        actions={
          <Select
            label={t('period')}
            hideLabel
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as DashboardPeriod)
            }
            options={periods.map((value) => ({
              value,
              label: t(`periods.${value}`),
            }))}
          />
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <QueryState query={dashboard}>
          {(data) => (
            <>
              <Kpis data={data} />
              <div className="grid grid-cols-2 items-start gap-4">
                <StoresTable rows={data.stores} />
                <Card as="section" aria-labelledby="revenue-title">
                  <CardHeader title={t('revenue7')} titleId="revenue-title" />
                  <BarChart
                    caption={t('revenue7')}
                    columnLabels={{ label: t('day'), value: t('revenue') }}
                    items={data.revenueByDay.map((day) => ({
                      key: day.date,
                      label: formatDateOnly(day.date).slice(0, 5),
                      value: day.revenueMinor,
                      valueText: formatMoney(day.revenueMinor),
                    }))}
                  />
                </Card>
              </div>
              <div className="grid grid-cols-2 items-start gap-4">
                <Reminders data={data} />
                <Activity data={data} />
              </div>
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}

export function DashboardPage() {
  return (
    <WithMessages groups={['home']}>
      <DashboardPageView />
    </WithMessages>
  );
}
