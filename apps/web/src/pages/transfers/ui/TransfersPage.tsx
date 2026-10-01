'use client';

import type { TransferListItem, TransferRequest } from '@pharmacy/shared-dto';
import { formatDateOnly } from '@pharmacy/shared-util';
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiTile,
  StatusPill,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  RequestStatusPill,
  TransferStatusPill,
} from '@/entities/stock-document';
import { StockNotices, useStockAccess } from '@/features/stock-document';
import { apiRequest } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import {
  RejectDialog,
  RequestDialog,
  TransferDetailDialog,
  TransferDialog,
} from './TransferDialogs';

type Open =
  | { kind: 'request' }
  | { kind: 'transfer'; request: TransferRequest | null }
  | { kind: 'reject'; request: TransferRequest }
  | { kind: 'detail'; id: string }
  | null;

/** Requests (ЗП) and transfers (ПМ) between stores (UI mockup «Перемещения и заявки»). */
export function TransfersPage() {
  const t = useTranslations('transfers');
  const tDocs = useTranslations('stockDocs');
  const access = useStockAccess();
  const [open, setOpen] = useState<Open>(null);
  const overview = useQuery({
    queryKey: ['transfers', 'overview'],
    queryFn: ({ signal }) => apiRequest('transfers.overview', { signal }),
  });
  const canAnswer = (request: TransferRequest) =>
    request.status === 'sent' &&
    access.canCreate &&
    access.writableStores.some((s) => s.id === request.fromStoreId);

  const requestColumns: DataTableColumn<TransferRequest>[] = [
    { key: 'number', header: '№', cell: (r) => <b>{r.number}</b> },
    {
      key: 'date',
      header: tDocs('date'),
      nowrap: true,
      cell: (r) => formatDateOnly(r.date),
    },
    {
      key: 'requester',
      header: t('requester'),
      cell: (r) => r.requesterStoreName,
    },
    { key: 'from', header: t('from'), cell: (r) => r.fromStoreName },
    {
      key: 'positions',
      header: tDocs('positions'),
      numeric: true,
      cell: (r) => r.lines.length,
    },
    {
      key: 'status',
      header: tDocs('statusHeader'),
      cell: (r) => <RequestStatusPill status={r.status} />,
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tDocs('actions')}</span>,
      align: 'end',
      cell: (r) =>
        canAnswer(r) ? (
          <span className="flex justify-end gap-2">
            <Button
              variant="secondary"
              aria-label={t('pickNamed', { number: r.number })}
              onClick={() => setOpen({ kind: 'transfer', request: r })}
            >
              {t('pick')}
            </Button>
            <Button
              variant="tertiary"
              aria-label={t('rejectNamed', { number: r.number })}
              onClick={() => setOpen({ kind: 'reject', request: r })}
            >
              {t('rejectAction')}
            </Button>
          </span>
        ) : null,
    },
  ];
  const transferColumns: DataTableColumn<TransferListItem>[] = [
    {
      key: 'number',
      header: '№',
      cell: (r) => (
        <button
          type="button"
          onClick={() => setOpen({ kind: 'detail', id: r.id })}
          className="min-h-touch font-bold text-primary underline"
        >
          {r.number}
        </button>
      ),
    },
    {
      key: 'date',
      header: tDocs('date'),
      nowrap: true,
      cell: (r) => formatDateOnly(r.date),
    },
    {
      key: 'route',
      header: t('route'),
      cell: (r) => `${r.fromStoreName} → ${r.toStoreName}`,
    },
    {
      key: 'request',
      header: t('byRequest'),
      cell: (r) => r.requestNumber ?? '—',
    },
    {
      key: 'positions',
      header: tDocs('positions'),
      numeric: true,
      cell: (r) => r.positions,
    },
    {
      key: 'status',
      header: tDocs('statusHeader'),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <TransferStatusPill status={r.status} />
          {r.openDiscrepancy && (
            <StatusPill tone="warning">{t('discrepancy')}</StatusPill>
          )}
        </span>
      ),
    },
    { key: 'sentBy', header: t('sentBy'), cell: (r) => r.sentByName ?? '—' },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Button
              variant="secondary"
              iconStart="clipboard-list"
              disabled={!access.canCreate}
              onClick={() => setOpen({ kind: 'request' })}
            >
              {t('newRequest')}
            </Button>
            <Button
              iconStart="truck"
              disabled={!access.canCreate}
              onClick={() => setOpen({ kind: 'transfer', request: null })}
            >
              {t('newTransfer')}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <StockNotices access={access} />
        <QueryState query={overview}>
          {(data) => (
            <>
              <div className="grid grid-cols-4 gap-4">
                <KpiTile
                  label={t('kpi.newRequests')}
                  value={data.kpi.newRequests}
                  icon="inbox"
                />
                <KpiTile
                  label={t('kpi.inTransit')}
                  value={data.kpi.inTransit}
                  icon="truck"
                />
                <KpiTile
                  label={t('kpi.awaiting')}
                  value={data.kpi.awaiting}
                  hint={t('kpi.awaitingHint')}
                  icon="refresh-cw"
                />
                <KpiTile
                  label={t('kpi.discrepancies')}
                  value={data.kpi.openDiscrepancies}
                  tone={data.kpi.openDiscrepancies > 0 ? 'warning' : 'default'}
                  icon="triangle-alert"
                />
              </div>
              <Card padding="none">
                <CardHeader title={t('requests')} inset />
                <DataTable
                  caption={t('requests')}
                  rowKey={(r) => r.id}
                  rows={data.requests}
                  columns={requestColumns}
                  empty={
                    <EmptyState
                      icon="clipboard-list"
                      title={t('requestsEmpty')}
                    />
                  }
                />
              </Card>
              <Card padding="none">
                <CardHeader title={t('transfers')} inset />
                <DataTable
                  caption={t('transfers')}
                  rowKey={(r) => r.id}
                  rows={data.transfers}
                  columns={transferColumns}
                  empty={
                    <EmptyState
                      icon="arrow-left-right"
                      title={t('transfersEmpty')}
                    />
                  }
                />
                <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                  {tDocs('numberingHint')}
                </p>
              </Card>
            </>
          )}
        </QueryState>
      </div>
      {open?.kind === 'request' && (
        <RequestDialog access={access} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'transfer' && (
        <TransferDialog
          access={access}
          request={open.request}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'reject' && (
        <RejectDialog request={open.request} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'detail' && (
        <TransferDetailDialog
          transferId={open.id}
          access={access}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
