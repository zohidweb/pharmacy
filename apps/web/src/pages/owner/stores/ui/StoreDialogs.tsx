'use client';

import type { OwnerStore, StoreClosingLine } from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Select,
  Stepper,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { sessionQueryKey, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage, withFreshAuth } from '@/shared/api';
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
                {tStores('columns.license')}
              </dt>
              <dd className="font-bold">
                {store.licenseValidUntil
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
 * Closing a store (UI mockup «Закрытие точки»; spec 2026-10-15-store-closing): pick the receiver,
 * see the stock that moves and what forbids or stays behind the closing, confirm by the password.
 * The stock leaves by transfers of 500 lines; the store closes when the receiver accepts the last
 * one, a store without stock closes at once.
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
  const [done, setDone] = useState<string[] | null>(null);
  const preview = useQuery({
    queryKey: ['stores', 'closing', store.id],
    queryFn: ({ signal }) =>
      apiRequest('stores.closingPreview', { params: { id: store.id }, signal }),
    // a check, as the unposting check: a blocker resolved elsewhere is gone on the next opening
    staleTime: 0,
    // once closed the store has no preview (409): the invalidation after the closing must not ask
    enabled: done === null,
  });
  const empty = preview.data?.positions === 0;
  const close = useMutation({
    mutationFn: () =>
      withFreshAuth(() =>
        apiRequest('stores.close', {
          params: { id: store.id },
          body: { receiverStoreId: empty ? null : receiverId },
        }),
      ),
    onSuccess: (result) => {
      setDone(result.transferNumbers);
      // not the preview of this dialog: a closing or closed store has none (409, final review I3)
      void queryClient.invalidateQueries({
        queryKey: ['stores'],
        predicate: (query) => query.queryKey[1] !== 'closing',
      });
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
  const error = useApiErrorMessage(close.error);
  const blocked = (preview.data?.blockers.length ?? 0) > 0;
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
              disabled={
                !preview.data || blocked || (!empty && !receiverId)
              }
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
            {done.length === 0
              ? t('closed')
              : t('created', { number: done.join(', ') })}
          </Alert>
        ) : (
          !empty &&
          preview.data && (
            <Select
              label={t('receiver')}
              value={receiverId}
              onChange={(event) => setReceiverId(event.target.value)}
              options={receivers.map((s) => ({ value: s.id, label: s.name }))}
            />
          )
        )}
        <QueryState query={preview}>
          {(data) => (
            <>
              {data.blockers.length > 0 && (
                <Alert tone="warning" title={t('blockersTitle')}>
                  <ul className="m-0 list-disc ps-5">
                    {data.blockers.map((blocker) => (
                      <li key={blocker.code}>
                        {t(`blockers.${blocker.code}`, { count: blocker.count })}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {data.warnings.length > 0 && (
                <Alert tone="info" title={t('warningsTitle')}>
                  <ul className="m-0 list-disc ps-5">
                    {data.warnings.map((warning) => (
                      <li key={warning.code}>
                        {t(`warnings.${warning.code}`, {
                          count: warning.count,
                          amount:
                            warning.amountMinor === undefined
                              ? ''
                              : formatMoney(warning.amountMinor, {
                                  withSign: false,
                                }),
                        })}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {data.positions === 0 ? (
                !done && <Alert tone="info">{t('emptyStore')}</Alert>
              ) : (
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
                  {data.transfers > 1 && (
                    <p className="text-sm">
                      {t('transfersCount', { count: data.transfers })}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </QueryState>
        {!empty && <Alert tone="warning">{t('warning')}</Alert>}
      </div>
    </Dialog>
  );
}

/**
 * Cancelling a closing (spec 2026-10-15-store-closing, E10): the transfers still in transit come
 * back to the store and it works again. Confirmed by the password.
 */
export function CancelClosingDialog({
  store,
  onClose,
}: {
  store: OwnerStore;
  onClose: () => void;
}) {
  const t = useTranslations('ownerStores.closing');
  const tStores = useTranslations('ownerStores');
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () =>
      withFreshAuth(() =>
        apiRequest('stores.cancelClosing', { params: { id: store.id } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stores'] });
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      onClose();
    },
  });
  const error = useApiErrorMessage(cancel.error);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('cancelTitle')}
      description={store.name}
      closeLabel={tStores('close')}
      icon="undo-2"
      tone="warning"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tStores('cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('cancel')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <p className="text-sm">
          {t('cancelText', {
            transfers: store.closingTransfers.map((x) => x.number).join(', '),
          })}
        </p>
      </div>
    </Dialog>
  );
}
