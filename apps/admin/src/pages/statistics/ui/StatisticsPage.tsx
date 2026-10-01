'use client';

import type { UsageStoreRow, UsageTenantRow } from '@pharmacy/shared-dto';
import { daysBetween, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  DataTable,
  KpiTile,
  Select,
  useToast,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { StoreModePill } from '@/entities/store';
import { useTenantList } from '@/entities/tenant';
import { apiMocksEnabled, apiRequest } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

type Row =
  | ({ kind: 'tenant'; key: string } & UsageTenantRow)
  | ({ kind: 'store'; key: string } & UsageStoreRow);

function recentPeriods(count: number): string[] {
  const [year, month] = toAppDate().split('-').map(Number);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(year, month - 1 - i, 1)).toISOString().slice(0, 7),
  );
}

/** Usage statistics by company and store (UI mockup «Статистика»). */
export function StatisticsPage() {
  const t = useTranslations('statistics');
  const format = useFormatter();
  const toast = useToast();
  const periods = recentPeriods(6);
  const [period, setPeriod] = useState(periods[0]);
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);
  const tenants = useTenantList({ limit: 100 });
  const stats = useQuery({
    queryKey: ['usage-stats', period, tenantId],
    queryFn: ({ signal }) =>
      apiRequest('usage.stats', { query: { period, tenantId }, signal }),
  });
  const today = toAppDate();
  const periodLabel = (value: string) =>
    format.dateTime(new Date(`${value}-15T00:00:00Z`), {
      month: 'long',
      year: 'numeric',
    });
  const exportHref = `/api/v1/platform/usage-stats/export?period=${period}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}`;

  const activity = (row: Row) => {
    if (!row.lastActivityAt) return '—';
    const stale =
      daysBetween(toAppDate(new Date(row.lastActivityAt)), today) >= 1;
    return (
      <span className={stale ? 'font-medium text-warning' : undefined}>
        {format.relativeTime(new Date(row.lastActivityAt), new Date())}
      </span>
    );
  };

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      cell: (row) =>
        row.kind === 'tenant' ? (
          row.tenantName
        ) : (
          <span className="ps-6 font-normal">{row.storeName}</span>
        ),
    },
    {
      key: 'mode',
      header: t('columns.mode'),
      nowrap: true,
      cell: (row) =>
        row.kind === 'store' ? <StoreModePill mode={row.mode} /> : '—',
    },
    {
      key: 'receipts',
      header: t('columns.receipts'),
      numeric: true,
      cell: (row) => format.number(row.receipts),
    },
    {
      key: 'sales',
      header: t('columns.sales'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.salesMinor, { withSign: false }),
    },
    {
      key: 'average',
      header: t('columns.average'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.averageReceiptMinor, { withSign: false }),
    },
    {
      key: 'activity',
      header: t('columns.activity'),
      nowrap: true,
      cell: activity,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          apiMocksEnabled ? (
            <Button
              variant="tertiary"
              iconStart="download"
              onClick={() => toast.show(t('exportMock'))}
            >
              {t('export')}
            </Button>
          ) : (
            <a
              href={exportHref}
              download
              className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary-hover"
            >
              {t('export')}
            </a>
          )
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ChipGroup label={t('scopeLabel')}>
            <Chip
              selected={tenantId === undefined}
              onClick={() => setTenantId(undefined)}
            >
              {t('allTenants')}
            </Chip>
            {(tenants.data?.items ?? []).map((tenant) => (
              <Chip
                key={tenant.id}
                selected={tenantId === tenant.id}
                onClick={() => setTenantId(tenant.id)}
              >
                {tenant.name}
              </Chip>
            ))}
          </ChipGroup>
          <Select
            label={t('period')}
            value={period}
            options={periods.map((value) => ({
              value,
              label: periodLabel(value),
            }))}
            onChange={(event) => setPeriod(event.target.value)}
            className="w-(--ph-size-dialog-sm)"
          />
        </div>
        <QueryState query={stats}>
          {(data) => {
            const rows: Row[] = data.rows.flatMap((tenant) => [
              { ...tenant, kind: 'tenant' as const, key: tenant.tenantId },
              ...tenant.stores.map((store) => ({
                ...store,
                kind: 'store' as const,
                key: store.storeId,
              })),
            ]);
            return (
              <>
                <div className="grid grid-cols-4 gap-4">
                  <KpiTile
                    label={t('kpi.receipts')}
                    value={format.number(data.kpi.receipts)}
                    icon="receipt"
                  />
                  <KpiTile
                    label={t('kpi.sales')}
                    value={formatMoney(data.kpi.salesMinor)}
                    icon="chart-column"
                  />
                  <KpiTile
                    label={t('kpi.average')}
                    value={formatMoney(data.kpi.averageReceiptMinor)}
                    icon="calculator"
                  />
                  <KpiTile
                    label={t('kpi.cashiers')}
                    value={data.kpi.activeCashiers}
                    icon="user-check"
                  />
                </div>
                <Card padding="none">
                  <DataTable
                    caption={t('tableCaption', {
                      period: periodLabel(data.period),
                    })}
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.key}
                    rowVariant={(row) =>
                      row.kind === 'tenant' ? 'group' : 'default'
                    }
                  />
                  <p className="border-t border-border px-(--ph-table-cell-padding-x) py-3 text-xs text-fg-subtle">
                    {t('note')}
                  </p>
                </Card>
              </>
            );
          }}
        </QueryState>
      </div>
    </>
  );
}
