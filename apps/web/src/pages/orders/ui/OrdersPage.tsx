'use client';

import type {
  PurchaseOrder,
  PurchaseOrderListItem,
  PurchaseOrderStatus,
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
import { OrderStatusPill } from '@/entities/purchasing';
import { can, canWrite, useSession } from '@/entities/session';
import { useStockAccess } from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import {
  GoodsReceiptEditor,
  type GoodsReceiptPrefill,
} from '@/widgets/goods-receipt-editor';
import { OrderEditor } from './OrderEditor';
import { WithMessages } from '@/shared/i18n';

const PAGE = 10;
const STATUSES: PurchaseOrderStatus[] = [
  'draft',
  'confirmed',
  'partially_received',
  'closed',
];

/** Purchase orders (UI mockup «Заказы поставщикам»). */
function OrdersPageView() {
  const t = useTranslations('orders');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const stockAccess = useStockAccess();
  const canSeeCost = can(session, 'finance:view-cost');
  const access = {
    canCreate: canWrite(session, 'purchasing:create') && canSeeCost,
    canUpdate: canWrite(session, 'purchasing:update') && canSeeCost,
    canConfirm: canWrite(session, 'purchasing:post') && canSeeCost,
  };
  const [status, setStatus] = useState<PurchaseOrderStatus | 'open' | ''>(
    'open',
  );
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<PurchaseOrder | 'new' | null>(null);
  const [receiving, setReceiving] = useState<GoodsReceiptPrefill | null>(null);

  const list = useQuery({
    queryKey: ['purchase-orders', 'list', status, offset],
    queryFn: ({ signal }) =>
      apiRequest('purchaseOrders.list', {
        query: { status: status || undefined, limit: PAGE, offset },
        signal,
      }),
  });
  const open = useMutation({
    mutationFn: (id: string) =>
      apiRequest('purchaseOrders.get', { params: { id } }),
    onSuccess: setEditing,
  });
  const openError = useApiErrorMessage(open.error);

  /** A receipt goes to a cloud store of the scope (ADR-0014: an offline store receives itself). */
  const canReceiveAt = (storeName: string) =>
    stockAccess.canCreate &&
    stockAccess.canSeeCost &&
    stockAccess.writableStores.some((s) => s.name === storeName);
  const receive = (
    order: Pick<PurchaseOrder, 'id' | 'storeId'> & {
      supplierId: string;
    },
  ) => {
    setEditing(null);
    setReceiving({
      orderId: order.id,
      supplierId: order.supplierId,
      storeId: order.storeId,
    });
  };
  const receiveFromList = useMutation({
    mutationFn: (id: string) =>
      apiRequest('purchaseOrders.get', { params: { id } }),
    onSuccess: receive,
  });

  const columns: DataTableColumn<PurchaseOrderListItem>[] = [
    {
      key: 'number',
      header: t('numberDate'),
      nowrap: true,
      cell: (row) => (
        <div className="flex flex-col">
          {canSeeCost ? (
            <button
              type="button"
              onClick={() => open.mutate(row.id)}
              className="min-h-touch text-start font-bold text-primary underline"
            >
              {row.number}
            </button>
          ) : (
            <span className="font-bold">{row.number}</span>
          )}
          <span className="text-xs text-fg-subtle">
            {formatDateOnly(row.date)}
          </span>
        </div>
      ),
    },
    { key: 'supplier', header: t('supplier'), cell: (row) => row.supplierName },
    { key: 'store', header: t('store'), cell: (row) => row.storeName },
    ...(canSeeCost
      ? [
          {
            key: 'total',
            header: tDocs('sum'),
            numeric: true,
            nowrap: true,
            cell: (row: PurchaseOrderListItem) =>
              row.totalMinor !== undefined
                ? formatMoney(row.totalMinor, { withSign: false })
                : '—',
          },
        ]
      : []),
    {
      key: 'status',
      header: tDocs('statusHeader'),
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <OrderStatusPill status={row.status} />
          {row.status === 'partially_received' && (
            <span className="text-xs text-fg-subtle">
              {t('received', { percent: row.receivedPercent })}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tDocs('actions')}</span>,
      cell: (row) =>
        (row.status === 'confirmed' || row.status === 'partially_received') &&
        canReceiveAt(row.storeName) ? (
          <Button
            variant="secondary"
            iconStart="inbox"
            loading={
              receiveFromList.isPending && receiveFromList.variables === row.id
            }
            onClick={() => receiveFromList.mutate(row.id)}
          >
            {t('receive')}
          </Button>
        ) : null,
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
        {session?.impersonation && (
          <Alert tone="info">{tDocs('notices.impersonation')}</Alert>
        )}
        {!canSeeCost && <Alert tone="info">{t('costHidden')}</Alert>}
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
                  label={t('kpi.open')}
                  value={data.kpi.open}
                  hint={t('kpi.breakdown', {
                    draft: data.kpi.draft,
                    confirmed: data.kpi.confirmed,
                    partial: data.kpi.partiallyReceived,
                  })}
                  icon="clipboard-list"
                />
              </div>
              <Card padding="none">
                <CardHeader
                  title={t('journal')}
                  inset
                  actions={
                    <Select
                      label={tDocs('statusHeader')}
                      hideLabel
                      value={status}
                      onChange={(event) => {
                        setStatus(
                          event.target.value as
                            PurchaseOrderStatus | 'open' | '',
                        );
                        setOffset(0);
                      }}
                      options={[
                        { value: 'open', label: t('openOnly') },
                        { value: '', label: tDocs('allStatuses') },
                        ...STATUSES.map((value) => ({
                          value,
                          label: t(`status.${value}`),
                        })),
                      ]}
                    />
                  }
                />
                <DataTable
                  caption={t('journal')}
                  rowKey={(row) => row.id}
                  rows={data.items}
                  columns={columns}
                  empty={
                    <EmptyState icon="clipboard-list" title={t('empty')} />
                  }
                />
                <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                  {t('sendHint')}
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
        <OrderEditor
          key={editing === 'new' ? 'new' : editing.id}
          order={editing === 'new' ? null : editing}
          access={access}
          onClose={() => setEditing(null)}
          onReceive={(order) => {
            if (canReceiveAt(order.storeName)) receive(order);
          }}
        />
      )}
      {receiving && (
        <GoodsReceiptEditor
          document={null}
          prefill={receiving}
          access={stockAccess}
          onClose={() => setReceiving(null)}
        />
      )}
    </>
  );
}

export function OrdersPage() {
  return (
    <WithMessages groups={['stock', 'purchasing']}>
      <OrdersPageView />
    </WithMessages>
  );
}
