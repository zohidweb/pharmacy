'use client';

import type {
  ReportCell,
  ReportColumn,
  ReportKind,
} from '@pharmacy/shared-dto';
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
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  Select,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { can, useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { Export1cDialog } from './Export1cDialog';

const KINDS: ReportKind[] = [
  'sales_by_store',
  'sales_by_category',
  'stock',
  'movement',
  'supplier_debts',
  'cashiers',
  'losses',
  'controlled',
];

type Row = Record<string, ReportCell> & { __key: string };

const monthStart = () => `${toAppDate().slice(0, 8)}01`;

/** Reports (UI mockup «Отчёты»): one table per report, the period and the store as filters. */
function ReportsPageView() {
  const t = useTranslations('reports');
  const format = useFormatter();
  const { data: session } = useSession();
  const [kind, setKind] = useState<ReportKind>('sales_by_store');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(toAppDate);
  const [storeId, setStoreId] = useState('');
  const [exporting, setExporting] = useState(false);
  const periodValid = from !== '' && to !== '' && from <= to;
  const report = useQuery({
    queryKey: ['reports', kind, from, to, storeId],
    queryFn: ({ signal }) =>
      apiRequest('reports.get', {
        params: { kind },
        query: { from, to, storeId: storeId || undefined },
        signal,
      }),
    enabled: periodValid,
    placeholderData: (previous) =>
      previous?.kind === kind ? previous : undefined,
  });

  const cell = (column: ReportColumn, value: ReportCell) => {
    if (value === null || value === undefined) return '—';
    switch (column.type) {
      case 'money':
        return formatMoney(Number(value), { withSign: false });
      case 'count':
        return format.number(Number(value));
      case 'percent':
        return `${format.number(Number(value), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} %`;
      case 'quantity':
        return t('packs', { count: Number(value) });
      case 'date':
        return formatDateOnly(String(value));
      case 'datetime':
        return formatDateTime(String(value));
      case 'reason':
        return t(`reasons.${String(value)}` as 'reasons.expired');
      default:
        return value === 'total' ? t('total') : String(value);
    }
  };
  const numeric = (column: ReportColumn) =>
    column.type !== 'text' && column.type !== 'reason';

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Button
              variant="secondary"
              iconStart="download"
              disabled
              aria-describedby="excel-pending"
            >
              {t('excel')}
            </Button>
            {can(session, 'export-1c:view') && (
              <Button
                variant="secondary"
                iconStart="file-text"
                disabled={!periodValid}
                onClick={() => setExporting(true)}
              >
                {t('export1cAction')}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <p id="excel-pending" className="text-xs text-fg-subtle">
          {t('excelPending')}
        </p>
        <ChipGroup label={t('kinds')} className="flex-wrap">
          {KINDS.map((value) => (
            <Chip
              key={value}
              selected={kind === value}
              onClick={() => setKind(value)}
            >
              {t(`kindNames.${value}`)}
            </Chip>
          ))}
        </ChipGroup>
        <Card padding="none">
          <div className="flex flex-wrap items-end gap-3 p-(--ph-card-padding)">
            <h2 className="me-auto text-lg font-bold">
              {t(`kindNames.${kind}`)}
            </h2>
            <TextField
              label={t('from')}
              type="date"
              max={to}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <TextField
              label={t('to')}
              type="date"
              min={from}
              max={toAppDate()}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            {(session?.stores.length ?? 0) > 1 && (
              <Select
                label={t('store')}
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                options={[
                  { value: '', label: t('allStores') },
                  ...(session?.stores ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              />
            )}
          </div>
          {!periodValid ? (
            <div className="px-(--ph-card-padding) pb-4">
              <Alert tone="warning">{t('periodInvalid')}</Alert>
            </div>
          ) : (
            <QueryState query={report}>
              {(data) => {
                const columns: DataTableColumn<Row>[] = data.columns.map(
                  (column) => ({
                    key: column.key,
                    header: t(`columns.${column.key}` as 'columns.store'),
                    numeric: numeric(column),
                    nowrap: numeric(column),
                    cell: (row: Row) => cell(column, row[column.key]),
                  }),
                );
                const rows: Row[] = data.rows.map((row, index) => ({
                  ...row,
                  __key: String(index),
                }));
                if (data.total) rows.push({ ...data.total, __key: 'total' });
                return (
                  <>
                    <DataTable
                      caption={t(`kindNames.${kind}`)}
                      rowKey={(row) => row.__key}
                      rows={rows}
                      columns={columns}
                      empty={
                        <EmptyState icon="chart-column" title={t('empty')} />
                      }
                    />
                    {!can(session, 'finance:view-cost') && (
                      <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                        {t('costHidden')}
                      </p>
                    )}
                    {kind === 'controlled' && (
                      <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                        {t('controlledHint')}
                      </p>
                    )}
                  </>
                );
              }}
            </QueryState>
          )}
        </Card>
      </div>
      {exporting && (
        <Export1cDialog
          from={from}
          to={to}
          storeId={storeId}
          onClose={() => setExporting(false)}
        />
      )}
    </>
  );
}

export function ReportsPage() {
  return (
    <WithMessages groups={['owner']}>
      <ReportsPageView />
    </WithMessages>
  );
}
