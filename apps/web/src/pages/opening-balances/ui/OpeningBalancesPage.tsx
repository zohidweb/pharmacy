'use client';

import type {
  DocumentStatus,
  OpeningBalance,
  OpeningBalanceListItem,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Pagination,
  Select,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { DocumentStatusPill } from '@/entities/stock-document';
import { StockNotices, useStockAccess } from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { OpeningBalanceEditor } from './OpeningBalanceEditor';

const PAGE = 10;

/** Journal of opening balances (spec 2026-10-09-inventory-purchasing, section 8). */
function OpeningBalancesPageView() {
  const t = useTranslations('openingBalances');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const access = useStockAccess();
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<DocumentStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<OpeningBalance | 'new' | null>(null);

  const list = useQuery({
    queryKey: ['opening-balances', storeId, status, offset],
    queryFn: ({ signal }) =>
      apiRequest('openingBalances.list', {
        query: {
          storeId: storeId || undefined,
          status: status || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
  });
  const open = useMutation({
    mutationFn: (id: string) =>
      apiRequest('openingBalances.get', { params: { id } }),
    onSuccess: setEditing,
  });
  const openError = useApiErrorMessage(open.error);

  const columns: DataTableColumn<OpeningBalanceListItem>[] = [
    {
      key: 'number',
      header: '№',
      cell: (row) =>
        access.canSeeCost ? (
          <button
            type="button"
            onClick={() => open.mutate(row.id)}
            className="min-h-touch font-bold text-primary underline"
          >
            {row.number}
          </button>
        ) : (
          <b>{row.number}</b>
        ),
    },
    {
      key: 'date',
      header: tDocs('date'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.date),
    },
    { key: 'store', header: t('store'), cell: (row) => row.storeName },
    {
      key: 'positions',
      header: tDocs('positions'),
      numeric: true,
      cell: (row) => row.positions,
    },
    ...(access.canSeeCost
      ? [
          {
            key: 'total',
            header: tDocs('sum'),
            numeric: true,
            nowrap: true,
            cell: (row: OpeningBalanceListItem) =>
              row.totalMinor !== undefined
                ? formatMoney(row.totalMinor, { withSign: false })
                : '—',
          },
        ]
      : []),
    {
      key: 'status',
      header: tDocs('statusHeader'),
      cell: (row) => <DocumentStatusPill status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button
            iconStart="plus"
            disabled={!access.canCreate || !access.canSeeCost}
            onClick={() => setEditing('new')}
          >
            {t('new')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <StockNotices access={access} />
        <Alert tone="info">{t('hint')}</Alert>
        {openError && (
          <Alert tone="danger" live="assertive">
            {openError}
          </Alert>
        )}
        <QueryState query={list}>
          {(data) => (
            <Card padding="none">
              <CardHeader
                title={t('journal')}
                inset
                actions={
                  <div className="flex flex-wrap gap-2">
                    {(session?.stores.length ?? 0) > 1 && (
                      <Select
                        label={t('store')}
                        hideLabel
                        value={storeId}
                        onChange={(event) => {
                          setStoreId(event.target.value);
                          setOffset(0);
                        }}
                        options={[
                          { value: '', label: tDocs('allStores') },
                          ...(session?.stores ?? []).map((s) => ({
                            value: s.id,
                            label: s.name,
                          })),
                        ]}
                      />
                    )}
                    <Select
                      label={tDocs('statusHeader')}
                      hideLabel
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value as DocumentStatus | '');
                        setOffset(0);
                      }}
                      options={[
                        { value: '', label: tDocs('allStatuses') },
                        { value: 'draft', label: tDocs('status.draft') },
                        { value: 'posted', label: tDocs('status.posted') },
                      ]}
                    />
                  </div>
                }
              />
              <DataTable
                caption={t('journal')}
                rowKey={(row) => row.id}
                rows={data.items}
                columns={columns}
                empty={<EmptyState icon="inbox" title={t('empty')} />}
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
                    previous: tDocs('previous'),
                    next: tDocs('next'),
                    range: (range) => tDocs('shown', range),
                  }}
                />
              )}
            </Card>
          )}
        </QueryState>
      </div>
      {editing && (
        <OpeningBalanceEditor
          key={editing === 'new' ? 'new' : editing.id}
          document={editing === 'new' ? null : editing}
          access={access}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function OpeningBalancesPage() {
  return (
    <WithMessages groups={['stock']}>
      <OpeningBalancesPageView />
    </WithMessages>
  );
}
