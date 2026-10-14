'use client';

import type {
  SaleUnit,
  StockProductOption,
  Transfer,
  TransferOverview,
  TransferRequest,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Select,
  Spinner,
  TextField,
  type IconName,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { TransferStatusPill } from '@/entities/stock-document';
import {
  ProductSearch,
  QuantityInput,
  type StockAccess,
} from '@/features/stock-document';
import { ApiError, apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { useInvalidateTransfers, useProductsByIds } from '../api/queries';
import { useLineProblem } from './use-line-problem';

type Store = TransferOverview['stores'][number];

/* ---------------- transfer (new, by a request, or a draft) ---------------- */

interface PickLine {
  key: string;
  productId: string;
  productName: string;
  batchId: string;
  unit: SaleUnit;
  quantity: number;
}

/** Batches with stock that have not expired, earliest expiry first (FEFO). */
function fefoBatches(product: StockProductOption) {
  const today = toAppDate();
  return [...product.batches]
    .filter((b) => b.expiresOn >= today && b.quantityPieces > 0)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

const piecesOf = (
  line: Pick<PickLine, 'unit' | 'quantity'>,
  product: StockProductOption | undefined,
) =>
  line.unit === 'piece'
    ? line.quantity
    : line.quantity * (product?.piecesPerPack ?? 1);

/**
 * Transfer (ПМ) of the sender: FEFO batches within its stock, picked from a request (only its
 * products, not more than asked) or new; a draft is saved, sent or cancelled (spec
 * 2026-10-12-supplier-returns-transfers, 5.3).
 */
export function TransferDialog({
  access,
  request: givenRequest,
  transferId,
  stores,
  onClose,
}: {
  access: StockAccess;
  request: TransferRequest | null;
  /** A draft to edit. */
  transferId: string | null;
  stores: Store[];
  onClose: () => void;
}) {
  const t = useTranslations('transfers.transfer');
  const tDocs = useTranslations('stockDocs');
  const tLines = useTranslations('stockDocs.lines');
  const invalidate = useInvalidateTransfers();
  const draft = useQuery({
    queryKey: ['transfers', 'detail', transferId],
    queryFn: ({ signal }) =>
      apiRequest('transfers.get', { params: { id: transferId ?? '' }, signal }),
    enabled: transferId !== null,
  });
  const doc = draft.data ?? null;
  const requestOfDraft = useQuery({
    queryKey: ['transfers', 'request', doc?.requestId],
    queryFn: ({ signal }) =>
      apiRequest('transferRequests.get', {
        params: { id: doc?.requestId ?? '' },
        signal,
      }),
    enabled: Boolean(doc?.requestId) && givenRequest === null,
  });
  const request = givenRequest ?? requestOfDraft.data ?? null;
  const [fromStoreId, setFromStoreId] = useState(
    givenRequest?.fromStoreId ?? access.writableStores[0]?.id ?? '',
  );
  // the other side: any active cloud store of the network but the own one
  const othersOf = (own: string) =>
    stores.filter((s) => s.id !== own && s.mode !== 'offline');
  const others = othersOf(fromStoreId);
  const [toStoreId, setToStoreId] = useState(
    givenRequest?.requesterStoreId ?? others[0]?.id ?? '',
  );
  const [lines, setLines] = useState<PickLine[] | null>(
    givenRequest || transferId ? null : [],
  );
  const [extra, setExtra] = useState<StockProductOption[]>([]);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const productIds = [
    ...(givenRequest?.lines.map((l) => l.productId) ?? []),
    ...(doc?.lines.map((l) => l.productId) ?? []),
    ...(lines ?? []).map((l) => l.productId),
  ];
  const sender = useProductsByIds(fromStoreId, productIds);
  const productOf = (id: string) =>
    sender.byId.get(id) ?? extra.find((p) => p.id === id);

  // a request is picked by FEFO as soon as the sender stock is known; a draft opens as saved
  useEffect(() => {
    if (lines !== null) return;
    if (givenRequest && !sender.isPending) {
      setLines(
        givenRequest.lines.flatMap((asked): PickLine[] => {
          const product = sender.byId.get(asked.productId);
          if (!product) return [];
          let need = asked.quantity;
          const picked: PickLine[] = [];
          for (const batch of fefoBatches(product)) {
            if (need === 0) break;
            const take = Math.min(
              need,
              Math.floor(batch.quantityPieces / product.piecesPerPack),
            );
            if (take === 0) continue;
            picked.push({
              key: `${asked.productId}-${batch.id}`,
              productId: asked.productId,
              productName: asked.productName,
              batchId: batch.id,
              unit: 'pack',
              quantity: take,
            });
            need -= take;
          }
          return picked;
        }),
      );
    } else if (doc) {
      setFromStoreId(doc.fromStoreId);
      setToStoreId(doc.toStoreId);
      setLines(
        doc.lines.map((l) => ({
          key: l.batchId,
          productId: l.productId,
          productName: l.productName,
          batchId: l.batchId,
          unit: l.unit,
          quantity: l.sentQuantity,
        })),
      );
    }
  }, [lines, givenRequest, sender.isPending, sender.byId, doc]);

  const current = lines ?? [];
  // requested products the sender has no line of (no stock that has not expired)
  const missingFromStock = (request?.lines ?? [])
    .filter((asked) => !current.some((l) => l.productId === asked.productId))
    .map((asked) => asked.productName);
  const requestedPieces = (productId: string) => {
    const asked = request?.lines.find((l) => l.productId === productId);
    return asked === undefined
      ? null
      : asked.quantity * (productOf(productId)?.piecesPerPack ?? 1);
  };
  const sentPieces = (productId: string) =>
    current
      .filter((l) => l.productId === productId)
      .reduce((s, l) => s + piecesOf(l, productOf(l.productId)), 0);
  const problemOf = (line: PickLine) => {
    const product = productOf(line.productId);
    const batch = product?.batches.find((b) => b.id === line.batchId);
    if (line.quantity < 1) return tLines('quantityRequired');
    if (!batch || piecesOf(line, product) > batch.quantityPieces)
      return t('overStock');
    const asked = requestedPieces(line.productId);
    if (asked !== null && sentPieces(line.productId) > asked)
      return t('overRequest');
    return null;
  };

  const body = (send: boolean) => ({
    requestId: request?.id ?? null,
    fromStoreId,
    toStoreId,
    send,
    lines: current.map((l) => ({
      productId: l.productId,
      batchId: l.batchId,
      unit: l.unit,
      quantity: l.quantity,
    })),
  });
  const save = useMutation({
    mutationFn: (send: boolean) =>
      doc
        ? apiRequest('transfers.update', {
            params: { id: doc.id },
            body: body(send),
          })
        : apiRequest('transfers.create', { body: body(send) }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      apiRequest('transfers.cancel', { params: { id: doc?.id ?? '' } }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const failure = save.error ?? cancel.error ?? draft.error;
  const lineProblem = useLineProblem(failure);
  const generic = useApiErrorMessage(lineProblem ? null : failure);
  const error = lineProblem ?? generic;
  const valid =
    Boolean(toStoreId) &&
    current.length > 0 &&
    current.every((l) => problemOf(l) === null);
  const submit = (send: boolean) => {
    setTouched(true);
    if (valid) save.mutate(send);
  };
  const title = doc
    ? t('editTitle', { number: doc.number })
    : request
      ? t('pickTitle', { request: request.number })
      : t('newTitle');

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      closeLabel={tDocs('close')}
      size="xl"
      footer={
        <>
          {doc && access.canDelete && (
            <Button
              variant="destructive"
              iconStart="ban"
              loading={cancel.isPending}
              onClick={() => setConfirmingCancel(true)}
            >
              {t('cancelDraft')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            variant="secondary"
            loading={save.isPending}
            disabled={lines === null}
            onClick={() => submit(false)}
          >
            {tDocs('saveDraft')}
          </Button>
          {access.canPost && (
            <Button
              iconStart="truck"
              loading={save.isPending}
              disabled={lines === null}
              onClick={() => submit(true)}
            >
              {t('send')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <div className="grid grid-cols-3 gap-4">
          <Select
            label={t('from')}
            value={fromStoreId}
            disabled={Boolean(request) || doc !== null || current.length > 0}
            onChange={(event) => {
              const own = event.target.value;
              setFromStoreId(own);
              // the receiver may have become the own store: the first of the new list then
              const next = othersOf(own);
              if (!next.some((s) => s.id === toStoreId)) {
                setToStoreId(next[0]?.id ?? '');
              }
            }}
            options={(doc
              ? [{ id: doc.fromStoreId, name: doc.fromStoreName }]
              : access.writableStores
            ).map((s) => ({ value: s.id, label: s.name }))}
          />
          <Select
            label={t('to')}
            value={toStoreId}
            disabled={Boolean(request)}
            onChange={(event) => setToStoreId(event.target.value)}
            options={(request
              ? [
                  {
                    id: request.requesterStoreId,
                    name: request.requesterStoreName,
                  },
                ]
              : others
            ).map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField
            label={tDocs('date')}
            value={formatDateOnly(toAppDate())}
            readOnly
          />
        </div>
        {fromStoreId && lines !== null && (
          // a new transfer takes any product; by a request — another batch of a requested one
          <ProductSearch
            storeId={fromStoreId}
            onPick={(product) => {
              if (
                request &&
                !request.lines.some((l) => l.productId === product.id)
              ) {
                setNotice(t('notRequested', { name: product.name }));
                return;
              }
              const batch = fefoBatches(product).find(
                (b) => !current.some((l) => l.batchId === b.id),
              );
              if (!batch) {
                setNotice(t('noBatch', { name: product.name }));
                return;
              }
              setNotice(null);
              setExtra((list) => [
                ...list.filter((p) => p.id !== product.id),
                product,
              ]);
              setLines([
                ...current,
                {
                  key: `${product.id}-${batch.id}`,
                  productId: product.id,
                  productName: product.name,
                  batchId: batch.id,
                  unit: 'pack',
                  quantity: 1,
                },
              ]);
            }}
          />
        )}
        {notice && <Alert tone="warning">{notice}</Alert>}
        {request && lines !== null && missingFromStock.length > 0 && (
          <Alert tone="warning">
            {t('missingStock', { names: missingFromStock.join(', ') })}
          </Alert>
        )}
        {lines === null ? (
          <Spinner size="md" label={tDocs('loading')} />
        ) : current.length === 0 ? (
          <EmptyState icon="arrow-left-right" title={t('empty')} />
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="ph-visually-hidden">{t('caption')}</caption>
            <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('product')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('batch')}
                </th>
                {request && (
                  <th scope="col" className="px-2 py-2 text-end font-medium">
                    {t('requested')}
                  </th>
                )}
                <th scope="col" className="px-2 py-2 text-end font-medium">
                  {t('senderStock')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('quantity')}
                </th>
                <th scope="col">
                  <span className="ph-visually-hidden">{tDocs('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {current.map((line) => {
                const product = productOf(line.productId);
                const batch = product?.batches.find(
                  (b) => b.id === line.batchId,
                );
                const problem = problemOf(line);
                const asked = request?.lines.find(
                  (l) => l.productId === line.productId,
                );
                const set = (change: Partial<PickLine>) =>
                  setLines(
                    current.map((l) =>
                      l.key === line.key ? { ...l, ...change } : l,
                    ),
                  );
                return (
                  <tr
                    key={line.key}
                    className="border-b border-border align-top"
                  >
                    <td className="px-2 py-2">
                      <span className="font-medium">{line.productName}</span>
                      {asked &&
                        sentPieces(line.productId) <
                          asked.quantity * (product?.piecesPerPack ?? 1) && (
                          <span className="block text-xs text-warning">
                            {t('lessThanRequested')}
                          </span>
                        )}
                    </td>
                    <td className="w-cell-lg px-2 py-2">
                      <Select
                        label={t('batchOf', { name: line.productName })}
                        hideLabel
                        value={line.batchId}
                        onChange={(event) =>
                          set({ batchId: event.target.value })
                        }
                        options={(product?.batches ?? [])
                          .filter(
                            (b) =>
                              (b.quantityPieces > 0 &&
                                b.expiresOn >= toAppDate()) ||
                              b.id === line.batchId,
                          )
                          .map((b) => ({
                            value: b.id,
                            label: `${b.number} · ${formatDateOnly(b.expiresOn)}`,
                          }))}
                      />
                    </td>
                    {request && (
                      <td className="px-2 py-2 text-end tabular-nums">
                        {asked?.quantity ?? '—'}
                      </td>
                    )}
                    <td className="px-2 py-2 text-end tabular-nums">
                      {batch && product
                        ? tLines('stockValue', {
                            packs: Math.floor(
                              batch.quantityPieces / product.piecesPerPack,
                            ),
                            pieces:
                              batch.quantityPieces % product.piecesPerPack,
                          })
                        : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex gap-2">
                        <span className="w-cell-sm">
                          <QuantityInput
                            label={t('quantityOf', { name: line.productName })}
                            value={line.quantity}
                            invalid={touched && problem ? problem : undefined}
                            onChange={(value) => set({ quantity: value ?? 0 })}
                          />
                        </span>
                        {product?.divisible && (
                          <Select
                            label={tLines('unitOf', { name: line.productName })}
                            hideLabel
                            value={line.unit}
                            onChange={(event) =>
                              set({ unit: event.target.value as SaleUnit })
                            }
                            options={(['pack', 'piece'] as const).map(
                              (unit) => ({
                                value: unit,
                                label: tLines(`units.${unit}`),
                              }),
                            )}
                          />
                        )}
                      </span>
                    </td>
                    <td className="px-1 py-2">
                      <IconButton
                        icon="trash-2"
                        label={tDocs('removeLine', { name: line.productName })}
                        onClick={() =>
                          setLines(current.filter((l) => l.key !== line.key))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-xs text-fg-subtle">{t('fefoHint')}</p>
        {confirmingCancel && doc && (
          <Dialog
            open
            onClose={() => setConfirmingCancel(false)}
            title={t('confirmCancelTitle', { number: doc.number })}
            closeLabel={tDocs('close')}
            icon="triangle-alert"
            tone="danger"
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingCancel(false)}
                >
                  {tDocs('cancel')}
                </Button>
                <Button
                  variant="destructive"
                  loading={cancel.isPending}
                  onClick={() => {
                    setConfirmingCancel(false);
                    cancel.mutate();
                  }}
                >
                  {t('cancelDraft')}
                </Button>
              </>
            }
          >
            <p className="text-sm">{t('confirmCancelText')}</p>
          </Dialog>
        )}
      </div>
    </Dialog>
  );
}

/* ---------------- transfer card: acceptance, recall ---------------- */

function Step({
  icon,
  title,
  note,
  done,
}: {
  icon: IconName;
  title: string;
  note: string;
  done: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={
          done
            ? 'grid size-avatar-sm place-items-center rounded-full bg-success-subtle text-success'
            : 'grid size-avatar-sm place-items-center rounded-full bg-surface-sunken text-fg-subtle'
        }
      >
        <Icon name={icon} size="sm" />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-fg-subtle">{note}</span>
      </span>
    </li>
  );
}

/**
 * The card of a transfer: the receiver confirms the actual quantities (a shortage is written off
 * at the sender by the system); the sender recalls a transfer in transit.
 */
export function TransferDetailDialog({
  transferId,
  access,
  onClose,
}: {
  transferId: string;
  access: StockAccess;
  onClose: () => void;
}) {
  const t = useTranslations('transfers.detail');
  const tDocs = useTranslations('stockDocs');
  const tUnits = useTranslations('stockDocs.lines.units');
  const invalidate = useInvalidateTransfers();
  const queryClient = useQueryClient();
  const transfer = useQuery({
    queryKey: ['transfers', 'detail', transferId],
    queryFn: ({ signal }) =>
      apiRequest('transfers.get', { params: { id: transferId }, signal }),
  });
  const [received, setReceived] = useState<Record<string, number | null>>({});
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const doc = transfer.data;
  const isReceiver =
    doc !== undefined &&
    access.writableStores.some((s) => s.id === doc.toStoreId) &&
    access.canReceive;
  const isSender =
    doc !== undefined &&
    access.writableStores.some((s) => s.id === doc.fromStoreId);
  const receiving = doc?.status === 'in_transit' && isReceiver;
  const recalling =
    doc?.status === 'in_transit' && isSender && access.canUnpost;
  const valueOf = (line: Transfer['lines'][number]) =>
    received[line.batchId] === undefined
      ? line.sentQuantity
      : received[line.batchId];

  const update = (next: Transfer) => {
    queryClient.setQueryData(['transfers', 'detail', transferId], next);
    void invalidate();
  };
  const accept = useMutation({
    mutationFn: () =>
      apiRequest('transfers.accept', {
        params: { id: transferId },
        body: {
          dispatchedAt: doc?.sentBy?.at ?? '',
          comment: comment.trim(),
          lines: (doc?.lines ?? []).map((l) => ({
            batchId: l.batchId,
            receivedQuantity: valueOf(l) ?? 0,
          })),
        },
      }),
    onSuccess: update,
    onError: (error) => {
      // sent again since the card was read: the new lines, the quantities filled from scratch
      if (error instanceof ApiError && error.code === 'transfer_changed') {
        setReceived({});
        setTouched(false);
        void transfer.refetch();
      }
    },
  });
  // every line needs its actual quantity: an empty field is never taken for zero
  const incomplete = (doc?.lines ?? []).some((l) => {
    const value = valueOf(l);
    return value === null || value > l.sentQuantity;
  });
  const recall = useMutation({
    mutationFn: () =>
      apiRequest('transfers.recall', { params: { id: transferId } }),
    onSuccess: update,
  });
  const failure = accept.error ?? recall.error ?? transfer.error;
  const lineProblem = useLineProblem(failure);
  const generic = useApiErrorMessage(lineProblem ? null : failure);
  const error = lineProblem ?? generic;
  // the shortage by unit: «−2 уп.», «−2 уп., −3 шт.»
  const missing = (['pack', 'piece'] as const)
    .map((unit) => {
      const count = (doc?.lines ?? [])
        .filter((l) => l.unit === unit)
        .reduce(
          (s, l) =>
            s +
            Math.max(
              0,
              l.sentQuantity -
                (receiving
                  ? (valueOf(l) ?? 0)
                  : (l.receivedQuantity ?? l.sentQuantity)),
            ),
          0,
        );
      return count > 0 ? `−${count} ${tUnits(unit)}` : null;
    })
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    <Dialog
      open
      onClose={onClose}
      title={doc ? t('title', { number: doc.number }) : t('loading')}
      description={
        doc
          ? `${doc.fromStoreName} → ${doc.toStoreName}${doc.requestNumber ? ` · ${t('byRequest', { request: doc.requestNumber })}` : ''}`
          : undefined
      }
      closeLabel={tDocs('close')}
      size="xl"
      footer={
        <>
          {receiving && (
            <p className="me-auto text-xs text-fg-subtle">
              {t('stockAfterAccept')}
            </p>
          )}
          {recalling && !receiving && (
            <p className="me-auto text-xs text-fg-subtle">{t('recallHint')}</p>
          )}
          <Button variant="secondary" onClick={onClose}>
            {tDocs('close')}
          </Button>
          {recalling && (
            <Button
              variant="secondary"
              iconStart="undo-2"
              loading={recall.isPending}
              onClick={() => recall.mutate()}
            >
              {t('recall')}
            </Button>
          )}
          {receiving && (
            <Button
              iconStart="check"
              loading={accept.isPending}
              onClick={() => {
                setTouched(true);
                if (incomplete) return;
                // the shortage is written off at the sender at once and for good: confirm it
                if (missing) setConfirming(true);
                else accept.mutate();
              }}
            >
              {t('accept')}
            </Button>
          )}
        </>
      }
    >
      {doc && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <TransferStatusPill status={doc.status} />
          </div>
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <ol
            aria-label={t('steps')}
            className="m-0 grid list-none grid-cols-3 gap-4 p-0"
          >
            <Step
              icon="check"
              title={t('sent')}
              note={
                doc.sentBy
                  ? `${formatDateTime(doc.sentBy.at)} · ${doc.sentBy.name}`
                  : '—'
              }
              done={Boolean(doc.sentBy)}
            />
            <Step
              icon="truck"
              title={t('inTransit')}
              note={
                doc.status === 'awaiting'
                  ? t('awaitingSync')
                  : `${doc.fromStoreName} → ${doc.toStoreName}`
              }
              done={doc.status === 'in_transit' || doc.status === 'accepted'}
            />
            <Step
              icon="circle-check"
              title={t('received')}
              note={
                doc.receivedBy
                  ? `${formatDateTime(doc.receivedBy.at)} · ${doc.receivedBy.name}`
                  : t('notYet')
              }
              done={doc.status === 'accepted'}
            />
          </ol>
          <table className="w-full border-collapse text-sm">
            <caption className="ph-visually-hidden">{t('caption')}</caption>
            <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
              <tr>
                {(
                  ['product', 'batch', 'sent', 'received', 'diff'] as const
                ).map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="px-2 py-2 text-start font-medium"
                  >
                    {t(`columns.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => {
                const value = receiving ? valueOf(line) : line.receivedQuantity;
                const diff = value === null ? null : value - line.sentQuantity;
                return (
                  <tr
                    key={line.batchId}
                    className="border-b border-border align-top"
                  >
                    <td className="px-2 py-2 font-medium">
                      {line.productName}
                    </td>
                    <td className="px-2 py-2">
                      {line.batchNumber}
                      <span className="block text-xs text-fg-subtle">
                        {formatDateOnly(line.expiresOn)}
                      </span>
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {`${line.sentQuantity} ${tUnits(line.unit)}`}
                    </td>
                    <td className="w-cell-sm px-2 py-2">
                      {receiving ? (
                        <QuantityInput
                          label={t('receivedOf', { name: line.productName })}
                          value={valueOf(line)}
                          invalid={
                            valueOf(line) === null
                              ? touched
                                ? t('quantityRequired')
                                : undefined
                              : (valueOf(line) ?? 0) > line.sentQuantity
                                ? t('overSent')
                                : undefined
                          }
                          onChange={(next) =>
                            setReceived((current) => ({
                              ...current,
                              [line.batchId]: next,
                            }))
                          }
                        />
                      ) : (
                        <span className="tabular-nums">
                          {value === null
                            ? '—'
                            : `${value} ${tUnits(line.unit)}`}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {diff === null ? (
                        '—'
                      ) : diff === 0 ? (
                        '0'
                      ) : (
                        <b className="text-danger">{diff}</b>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {receiving && (
            <TextField
              label={t('comment')}
              hint={missing ? t('commentRequiredHint') : undefined}
              maxLength={500}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
          {confirming && (
            <Dialog
              open
              onClose={() => setConfirming(false)}
              title={t('confirmShortageTitle')}
              closeLabel={tDocs('close')}
              icon="triangle-alert"
              tone="danger"
              footer={
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setConfirming(false)}
                  >
                    {tDocs('cancel')}
                  </Button>
                  <Button
                    variant="destructive"
                    loading={accept.isPending}
                    onClick={() => {
                      setConfirming(false);
                      accept.mutate();
                    }}
                  >
                    {t('confirmShortage')}
                  </Button>
                </>
              }
            >
              <p className="text-sm">
                {t('confirmShortageText', { amount: missing })}
              </p>
            </Dialog>
          )}
          {doc.discrepancy && (
            <Alert
              tone="warning"
              title={t('discrepancyTitle', { amount: missing })}
            >
              <div className="flex flex-col gap-2">
                <span>
                  {t('writtenOff', {
                    document: doc.discrepancy.writeOffNumber,
                  })}
                  {/* the write-off is the sender's: seen only in its scope */}
                  {isSender && (
                    <>
                      {' '}
                      <Link
                        href={routes.writeOffs()}
                        className="font-medium text-primary underline"
                      >
                        {t('openWriteOffs')}
                      </Link>
                    </>
                  )}
                </span>
                {doc.discrepancy.comment && (
                  <span>{doc.discrepancy.comment}</span>
                )}
              </div>
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
