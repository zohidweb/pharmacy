'use client';

import type {
  DocumentStatus,
  GoodsReceipt,
  GoodsReceiptListItem,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiTile,
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
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { GoodsReceiptEditor } from './GoodsReceiptEditor';

const PAGE = 10;

/** Journal of goods receipts (UI mockup «Приход товара»). */
export function GoodsReceiptsPage() {
  const t = useTranslations('goodsReceipts');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const access = useStockAccess();
  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<DocumentStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<GoodsReceipt | 'new' | null>(null);

  const list = useQuery({
    queryKey: ['goods-receipts', supplierId, storeId, status, offset],
    queryFn: ({ signal }) =>
      apiRequest('goodsReceipts.list', {
        query: {
          supplierId: supplierId || undefined,
          storeId: storeId || undefined,
          status: status || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: ({ signal }) => apiRequest('suppliers.options', { signal }),
  });
  const open = useMutation({
    mutationFn: (id: string) =>
      apiRequest('goodsReceipts.get', { params: { id } }),
    onSuccess: setEditing,
  });
  const openError = useApiErrorMessage(open.error);

  const columns: DataTableColumn<GoodsReceiptListItem>[] = [
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
    { key: 'supplier', header: t('supplier'), cell: (row) => row.supplierName },
    { key: 'order', header: t('order'), cell: (row) => row.orderNumber ?? '—' },
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
            cell: (row: GoodsReceiptListItem) =>
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
        {openError && (
          <Alert tone="danger" live="assertive">
            {openError}
          </Alert>
        )}
        <QueryState query={list}>
          {(data) => (
            <>
              <div className="grid grid-cols-3 gap-4">
                <KpiTile
                  label={t('kpi.posted')}
                  value={data.kpi.postedThisMonth}
                  hint={
                    data.kpi.postedThisMonthMinor !== undefined
                      ? formatMoney(data.kpi.postedThisMonthMinor)
                      : undefined
                  }
                  icon="inbox"
                />
                <KpiTile
                  label={t('kpi.drafts')}
                  value={data.kpi.drafts}
                  hint={t('kpi.draftsHint')}
                  tone={data.kpi.drafts > 0 ? 'warning' : 'default'}
                  icon="pencil"
                />
              </div>
              <Card padding="none">
                <CardHeader
                  title={t('journal')}
                  inset
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <Select
                        label={t('supplier')}
                        hideLabel
                        value={supplierId}
                        onChange={(event) => {
                          setSupplierId(event.target.value);
                          setOffset(0);
                        }}
                        options={[
                          { value: '', label: t('allSuppliers') },
                          ...(suppliers.data ?? []).map((s) => ({
                            value: s.id,
                            label: s.name,
                          })),
                        ]}
                      />
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
                <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                  {t('oneSupplierHint')} {tDocs('numberingHint')}
                </p>
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
            </>
          )}
        </QueryState>
      </div>
      {editing && (
        <GoodsReceiptEditor
          key={editing === 'new' ? 'new' : editing.id}
          document={editing === 'new' ? null : editing}
          access={access}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
