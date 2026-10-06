'use client';

import type { OwnerStore, StoreClosingLine } from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Select,
  Stepper,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { StoreForm } from '@/features/store-form';
import { QueryState } from '@/shared/ui';

/** New store or its card (UI mockup «Карточка точки»; spec 2026-10-06-owner-stores). */
export function StoreDialog({
  store,
  canEdit,
  canClose,
  onClose,
  onCloseStore,
}: {
  store: OwnerStore | null;
  canEdit: boolean;
  canClose: boolean;
  onClose: () => void;
  onCloseStore: (store: OwnerStore) => void;
}) {
  const t = useTranslations('ownerStores.dialog');
  const tStores = useTranslations('ownerStores');
  const editable = canEdit && store?.status !== 'closed';

  return (
    <Dialog
      open
      onClose={onClose}
      title={store ? store.name : t('newTitle')}
      description={store ? t('cardTitle') : t('newHint')}
      closeLabel={tStores('close')}
      size="lg"
    >
      <div className="flex flex-col gap-5">
        {store && (
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3">
              <dt className="text-xs text-fg-muted">
                {tStores('columns.paid')}
              </dt>
              <dd className="font-bold">
                {store.paidUntil
                  ? formatDateOnly(store.paidUntil)
                  : store.licenseValidUntil
                    ? formatDateOnly(store.licenseValidUntil)
                    : '—'}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3">
              <dt className="text-xs text-fg-muted">
                {tStores('columns.activity')}
              </dt>
              <dd className="font-bold">
                {tStores('receipts', { count: store.receiptsThisMonth })}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3">
              <dt className="text-xs text-fg-muted">
                {tStores('columns.status')}
              </dt>
              <dd className="font-bold">
                {tStores(`statuses.${store.status}`)}
              </dd>
            </div>
          </dl>
        )}
        <StoreForm
          store={store}
          readOnly={!editable}
          submitLabel={store ? tStores('save') : t('create')}
          onSaved={onClose}
          actions={
            <>
              {store?.status === 'active' && canClose && (
                <Button
                  variant="destructive"
                  iconStart="ban"
                  onClick={() => onCloseStore(store)}
                >
                  {t('closeStore')}
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                {tStores('cancel')}
              </Button>
            </>
          }
        />
        {store?.status === 'active' && canClose && (
          <p className="text-xs text-fg-subtle">{t('closeHint')}</p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Closing a store (UI mockup «Закрытие точки»): pick the receiver, see the stock that moves, create
 * the transfer. The store closes only when the receiver accepts it.
 */
export function CloseStoreDialog({
  store,
  onClose,
}: {
  store: OwnerStore;
  onClose: () => void;
}) {
  const t = useTranslations('ownerStores.closing');
  const tStores = useTranslations('ownerStores');
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const receivers = (session?.stores ?? []).filter(
    (s) => s.id !== store.id && s.mode === 'cloud',
  );
  const [receiverId, setReceiverId] = useState(receivers[0]?.id ?? '');
  const [closeOn, setCloseOn] = useState(toAppDate());
  const [done, setDone] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['stores', 'closing', store.id],
    queryFn: ({ signal }) =>
      apiRequest('stores.closingPreview', { params: { id: store.id }, signal }),
  });
  const close = useMutation({
    mutationFn: () =>
      apiRequest('stores.close', {
        params: { id: store.id },
        body: { receiverStoreId: receiverId, closeOn },
      }),
    onSuccess: (result) => {
      setDone(result.transferNumber);
      void queryClient.invalidateQueries({ queryKey: ['stores'] });
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
  });
  const error = useApiErrorMessage(close.error);
  const columns: DataTableColumn<StoreClosingLine>[] = [
    {
      key: 'product',
      header: t('product'),
      cell: (row) => <b>{row.productName}</b>,
    },
    { key: 'batch', header: t('batch'), cell: (row) => row.batchNumber },
    {
      key: 'expires',
      header: t('expires'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.expiresOn),
    },
    {
      key: 'stock',
      header: t('stock'),
      numeric: true,
      nowrap: true,
      cell: (row) =>
        t('quantity', {
          packs: Math.floor(row.quantityPieces / row.piecesPerPack),
          pieces: row.quantityPieces % row.piecesPerPack,
        }),
    },
    ...(preview.data?.totalCostMinor !== undefined
      ? [
          {
            key: 'cost',
            header: t('cost'),
            numeric: true,
            nowrap: true,
            cell: (row: StoreClosingLine) =>
              formatMoney(row.costMinor ?? 0, { withSign: false }),
          },
        ]
      : []),
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={store.name}
      closeLabel={tStores('close')}
      size="xl"
      footer={
        done ? (
          <Button onClick={onClose}>{tStores('close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tStores('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={close.isPending}
              disabled={!receiverId || (preview.data?.positions ?? 0) === 0}
              onClick={() => close.mutate()}
            >
              {t('confirm')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Stepper
          label={t('steps')}
          steps={[
            { label: t('stepReceiver') },
            { label: t('stepTransfer') },
            { label: t('stepClose') },
          ]}
          current={done ? 2 : 0}
          completedText={t('stepDone')}
        />
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {done ? (
          <Alert tone="success" live="polite">
            {t('created', { number: done })}
          </Alert>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Select
              label={t('receiver')}
              value={receiverId}
              onChange={(event) => setReceiverId(event.target.value)}
              options={receivers.map((s) => ({ value: s.id, label: s.name }))}
            />
            <TextField
              label={t('closeOn')}
              type="date"
              min={toAppDate()}
              value={closeOn}
              onChange={(event) => setCloseOn(event.target.value)}
            />
          </div>
        )}
        <QueryState query={preview}>
          {(data) => (
            <>
              <DataTable
                caption={t('stockTitle')}
                rowKey={(row) => `${row.productName}-${row.batchNumber}`}
                rows={data.lines}
                columns={columns}
              />
              <p className="flex justify-end gap-2 text-sm">
                <span>{t('positions', { count: data.positions })}</span>
                {data.totalCostMinor !== undefined && (
                  <b className="tabular-nums">
                    {formatMoney(data.totalCostMinor)}
                  </b>
                )}
              </p>
            </>
          )}
        </QueryState>
        <Alert tone="warning">{t('warning')}</Alert>
        <p className="text-xs text-fg-subtle">{t('billingHint')}</p>
      </div>
    </Dialog>
  );
}
