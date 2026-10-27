'use client';

import type { ShiftListItem, ShiftStatus } from '@pharmacy/shared-dto';
import { formatDateTime, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Card,
  DataTable,
  EmptyState,
  Pagination,
  Select,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;

const daysAgo = (days: number) =>
  toAppDate(new Date(Date.now() - days * 86_400_000));

/**
 * «Отчёты → Смены» (plan 2026-10-27-shift-history, S1, S7): the shifts of the stores of the scope, opened within the
 * period (by default the last 7 days), newest first; a row opens the card of the shift.
 */
function ShiftHistoryView() {
  const t = useTranslations('shiftHistory');
  const { data: session } = useSession();
  const [from, setFrom] = useState(() => daysAgo(6));
  const [to, setTo] = useState(toAppDate);
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<ShiftStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const list = useQuery({
    queryKey: ['shifts', 'list', from, to, storeId, status, offset],
    queryFn: ({ signal }) =>
      apiRequest('shifts.list', {
        query: {
          from: from || undefined,
          to: to || undefined,
          storeId: storeId || undefined,
          status: status || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
    placeholderData: (previous) => previous,
  });
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };

  const columns: DataTableColumn<ShiftListItem>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      nowrap: true,
      cell: (row) => (
        <Link
          href={routes.shiftCard(row.id)}
          className="min-h-touch content-center font-bold text-primary underline"
        >
          {row.number}
        </Link>
      ),
    },
    {
      key: 'store',
      header: t('columns.store'),
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.storeName}</span>
          <span className="text-xs text-fg-subtle">{row.terminalName}</span>
        </div>
      ),
    },
    {
      key: 'opened',
      header: t('columns.opened'),
      cell: (row) => (
        <div className="flex flex-col">
          <span>{formatDateTime(row.openedAt)}</span>
          <span className="text-xs text-fg-subtle">{row.openedByName}</span>
        </div>
      ),
    },
    {
      key: 'closed',
      header: t('columns.closed'),
      cell: (row) =>
        row.status === 'open' ? (
          <StatusPill tone="info" icon={null}>
            {t('open')}
          </StatusPill>
        ) : (
          <div className="flex flex-col">
            <span>{row.closedAt ? formatDateTime(row.closedAt) : '—'}</span>
            <span className="text-xs text-fg-subtle">
              {row.closedByName ?? '—'}
            </span>
            {row.forced && (
              <StatusPill tone="warning" icon={null}>
                {t('forced')}
              </StatusPill>
            )}
          </div>
        ),
    },
    {
      key: 'receipts',
      header: t('columns.receipts'),
      align: 'end',
      cell: (row) => row.receipts,
    },
    {
      key: 'revenue',
      header: t('columns.revenue'),
      align: 'end',
      nowrap: true,
      cell: (row) => formatMoney(row.revenueMinor),
    },
    {
      key: 'discrepancy',
      header: t('columns.discrepancy'),
      align: 'end',
      nowrap: true,
      cell: (row) =>
        row.discrepancyMinor === null ? '—' : formatMoney(row.discrepancyMinor),
    },
    {
      key: 'marks',
      header: t('columns.marks'),
      cell: (row) => (
        <div className="flex flex-col gap-1 text-xs">
          {row.reasonMissing && <span>{t('reasonMissing')}</span>}
          {row.discrepancyReceipts > 0 && (
            <span>
              {t('discrepancyReceipts', { count: row.discrepancyReceipts })}
            </span>
          )}
          {row.afterClosingReceipts > 0 && (
            <span className="font-medium text-attention">
              {t('afterClosing', { count: row.afterClosingReceipts })}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <Card padding="none">
          <div className="flex flex-wrap items-end gap-3 p-(--ph-card-padding)">
            <TextField
              label={t('from')}
              type="date"
              max={to}
              value={from}
              onChange={(event) => reset(setFrom)(event.target.value)}
            />
            <TextField
              label={t('to')}
              type="date"
              min={from}
              value={to}
              onChange={(event) => reset(setTo)(event.target.value)}
            />
            {(session?.stores.length ?? 0) > 1 && (
              <Select
                label={t('store')}
                value={storeId}
                onChange={(event) => reset(setStoreId)(event.target.value)}
                options={[
                  { value: '', label: t('allStores') },
                  ...(session?.stores ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              />
            )}
            <Select
              label={t('status')}
              value={status}
              onChange={(event) =>
                reset(setStatus)(event.target.value as ShiftStatus | '')
              }
              options={[
                { value: '', label: t('allStatuses') },
                { value: 'open', label: t('open') },
                { value: 'closed', label: t('closedStatus') },
              ]}
            />
          </div>
          <QueryState query={list}>
            {(data) => (
              <>
                <DataTable
                  caption={t('title')}
                  rowKey={(row) => row.id}
                  rows={data.items}
                  columns={columns}
                  empty={<EmptyState icon="clock" title={t('empty')} />}
                />
                {data.total > PAGE && (
                  <Pagination
                    className="px-4 py-3"
                    total={data.total}
                    limit={PAGE}
                    offset={offset}
                    onOffsetChange={setOffset}
                    labels={{
                      nav: t('pagination'),
                      previous: t('previous'),
                      next: t('next'),
                      range: (range) => t('shown', range),
                    }}
                  />
                )}
              </>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}

export function ShiftHistoryPage() {
  return (
    <WithMessages groups={['pos']}>
      <ShiftHistoryView />
    </WithMessages>
  );
}
