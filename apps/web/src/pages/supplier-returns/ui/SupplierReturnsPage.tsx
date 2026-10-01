'use client';

import type {
  SupplierReturn,
  SupplierReturnListItem,
  SupplierReturnReason,
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
import { ClaimStatusPill, DocumentStatusPill } from '@/entities/stock-document';
import { StockNotices, useStockAccess } from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import {
  SUPPLIER_RETURN_REASONS,
  SupplierReturnEditor,
} from './SupplierReturnEditor';

const PAGE = 10;

/** Journal of returns to suppliers (UI mockup «Возврат поставщику»). */
export function SupplierReturnsPage() {
  const t = useTranslations('supplierReturns');
  const tDocs = useTranslations('stockDocs');
  const access = useStockAccess();
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState<SupplierReturnReason | ''>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<SupplierReturn | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['supplier-returns', supplierId, reason, offset],
    queryFn: ({ signal }) =>
      apiRequest('supplierReturns.list', {
        query: {
          supplierId: supplierId || undefined,
          reason: reason || undefined,
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
      apiRequest('supplierReturns.get', { params: { id } }),
    onSuccess: setEditing,
  });
  const openError = useApiErrorMessage(open.error);

  const columns: DataTableColumn<SupplierReturnListItem>[] = [
    {
      key: 'number',
      header: '№',
      cell: (row) => (
        <button
          type="button"
          onClick={() => open.mutate(row.id)}
          className="min-h-touch font-bold text-primary underline"
        >
          {row.number}
        </button>
      ),
    },
    {
      key: 'date',
      header: tDocs('date'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.date),
    },
    { key: 'supplier', header: t('supplier'), cell: (row) => row.supplierName },
    {
      key: 'receipt',
      header: t('receipt'),
      cell: (row) => row.receiptNumber ?? '—',
    },
    { key: 'store', header: tDocs('store'), cell: (row) => row.storeName },
    {
      key: 'reason',
      header: t('reason'),
      cell: (row) => t(`reasons.${row.reason}`),
    },
    ...(access.canSeeCost
      ? [
          {
            key: 'total',
            header: t('sumCost'),
            numeric: true,
            nowrap: true,
            cell: (row: SupplierReturnListItem) =>
              row.totalMinor !== undefined
                ? formatMoney(row.totalMinor, { withSign: false })
                : '—',
          },
        ]
      : []),
    {
      key: 'claim',
      header: t('claimHeader'),
      cell: (row) => <ClaimStatusPill claim={row.claim} />,
    },
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
            disabled={!access.canCreate}
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
                  label={t('kpi.month')}
                  value={
                    data.kpi.returnedThisMonthMinor !== undefined
                      ? formatMoney(data.kpi.returnedThisMonthMinor)
                      : data.kpi.documentsThisMonth
                  }
                  hint={t('kpi.documents', {
                    count: data.kpi.documentsThisMonth,
                  })}
                  icon="undo-2"
                />
                <KpiTile
                  label={t('kpi.claims')}
                  value={data.kpi.openClaims}
                  hint={t('kpi.claimsHint')}
                  icon="file-text"
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
                      <Select
                        label={t('reason')}
                        hideLabel
                        value={reason}
                        onChange={(event) => {
                          setReason(
                            event.target.value as SupplierReturnReason | '',
                          );
                          setOffset(0);
                        }}
                        options={[
                          { value: '', label: t('allReasons') },
                          ...SUPPLIER_RETURN_REASONS.map((value) => ({
                            value,
                            label: t(`reasons.${value}`),
                          })),
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
                  empty={<EmptyState icon="undo-2" title={t('empty')} />}
                />
                <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                  {tDocs('numberingHint')}
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
        <SupplierReturnEditor
          key={editing === 'new' ? 'new' : editing.id}
          document={editing === 'new' ? null : editing}
          access={access}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
