'use client';

import type {
  WriteOff,
  WriteOffListItem,
  WriteOffReason,
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
import { WRITE_OFF_REASONS, WriteOffEditor } from './WriteOffEditor';
import { WithMessages } from '@/shared/i18n';

const PAGE = 10;

/** Journal of write-offs (UI mockup «Списание»). */
function WriteOffsPageView() {
  const t = useTranslations('writeOffs');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const access = useStockAccess();
  const [storeId, setStoreId] = useState('');
  const [reason, setReason] = useState<WriteOffReason | ''>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<WriteOff | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['write-offs', storeId, reason, offset],
    queryFn: ({ signal }) =>
      apiRequest('writeOffs.list', {
        query: {
          storeId: storeId || undefined,
          reason: reason || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
  });
  const open = useMutation({
    mutationFn: (id: string) => apiRequest('writeOffs.get', { params: { id } }),
    onSuccess: setEditing,
  });
  const openError = useApiErrorMessage(open.error);

  const columns: DataTableColumn<WriteOffListItem>[] = [
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
    { key: 'store', header: tDocs('store'), cell: (row) => row.storeName },
    {
      key: 'reason',
      header: t('reason'),
      cell: (row) => t(`reasons.${row.reason}`),
    },
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
            header: t('sumCost'),
            numeric: true,
            nowrap: true,
            cell: (row: WriteOffListItem) =>
              row.totalMinor !== undefined
                ? formatMoney(row.totalMinor, { withSign: false })
                : '—',
          },
        ]
      : []),
    {
      key: 'postedBy',
      header: tDocs('postedByHeader'),
      cell: (row) => row.postedByName ?? '—',
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
                    data.kpi.writtenOffThisMonthMinor !== undefined
                      ? formatMoney(data.kpi.writtenOffThisMonthMinor)
                      : data.kpi.documentsThisMonth
                  }
                  hint={t('kpi.documents', {
                    count: data.kpi.documentsThisMonth,
                  })}
                  icon="trash-2"
                />
                <KpiTile
                  label={t('kpi.expired')}
                  value={data.kpi.expiredBatches}
                  hint={t('kpi.expiring', { count: data.kpi.expiringBatches })}
                  tone={data.kpi.expiredBatches > 0 ? 'danger' : 'default'}
                  icon="clock"
                />
              </div>
              <Card padding="none">
                <CardHeader
                  title={t('journal')}
                  inset
                  actions={
                    <div className="flex flex-wrap gap-2">
                      {(session?.stores.length ?? 0) > 1 && (
                        <Select
                          label={tDocs('store')}
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
                        label={t('reason')}
                        hideLabel
                        value={reason}
                        onChange={(event) => {
                          setReason(event.target.value as WriteOffReason | '');
                          setOffset(0);
                        }}
                        options={[
                          { value: '', label: t('allReasons') },
                          ...WRITE_OFF_REASONS.map((value) => ({
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
                  empty={<EmptyState icon="trash-2" title={t('empty')} />}
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
        <WriteOffEditor
          key={editing === 'new' ? 'new' : editing.id}
          document={editing === 'new' ? null : editing}
          access={access}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function WriteOffsPage() {
  return (
    <WithMessages groups={['stock']}>
      <WriteOffsPageView />
    </WithMessages>
  );
}
