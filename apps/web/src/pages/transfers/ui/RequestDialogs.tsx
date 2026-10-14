'use client';

import type {
  RejectionReason,
  StockProductOption,
  TransferOverview,
  TransferRequest,
} from '@pharmacy/shared-dto';
import { formatDateOnly, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Select,
  TextField,
} from '@pharmacy/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { RequestStatusPill } from '@/entities/stock-document';
import {
  ProductSearch,
  QuantityInput,
  type StockAccess,
} from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { useInvalidateTransfers, useProductsByIds } from '../api/queries';
import { useLineProblem } from './use-line-problem';

type Store = TransferOverview['stores'][number];

interface RequestLine {
  productId: string;
  productName: string;
  /** Packs. */
  quantity: number;
}

const packsOf = (product: StockProductOption | undefined) =>
  product
    ? Math.floor(
        product.batches.reduce((s, b) => s + Math.max(0, b.quantityPieces), 0) /
          product.piecesPerPack,
      )
    : null;

/**
 * Request of goods from another store (ЗП): a draft is edited, sent or deleted by the requesting
 * store; a sent one is only shown (spec 2026-10-12-supplier-returns-transfers, 5.2).
 */
export function RequestDialog({
  access,
  request,
  stores,
  onClose,
}: {
  access: StockAccess;
  request: TransferRequest | null;
  stores: Store[];
  onClose: () => void;
}) {
  const t = useTranslations('transfers.request');
  const tDocs = useTranslations('stockDocs');
  const invalidate = useInvalidateTransfers();
  const editable =
    request === null ||
    (request.status === 'draft' &&
      access.canUpdate &&
      access.writableStores.some((s) => s.id === request.requesterStoreId));
  const [toStoreId, setToStoreId] = useState(
    request?.requesterStoreId ?? access.writableStores[0]?.id ?? '',
  );
  // the other side: any active cloud store of the network, not only of the scope
  const others = stores.filter(
    (s) => s.id !== toStoreId && s.mode !== 'offline',
  );
  const [fromStoreId, setFromStoreId] = useState(
    request?.fromStoreId ?? others[0]?.id ?? '',
  );
  const [lines, setLines] = useState<RequestLine[]>(
    request?.lines.map((l) => ({ ...l })) ?? [],
  );
  const [comment, setComment] = useState(request?.comment ?? '');
  const [touched, setTouched] = useState(false);
  const ids = lines.map((l) => l.productId);
  // the stock of the asked store is shown only when it is in the scope of the employee
  const senderVisible = access.writableStores.some((s) => s.id === fromStoreId);
  const sender = useProductsByIds(senderVisible ? fromStoreId : '', ids);
  const ours = useProductsByIds(toStoreId, ids);

  const body = (send: boolean) => ({
    fromStoreId,
    toStoreId,
    comment: comment.trim(),
    send,
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
  });
  const save = useMutation({
    mutationFn: (send: boolean) =>
      request
        ? apiRequest('transferRequests.update', {
            params: { id: request.id },
            body: body(send),
          })
        : apiRequest('transferRequests.create', { body: body(send) }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      apiRequest('transferRequests.delete', {
        params: { id: request?.id ?? '' },
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const failure = save.error ?? remove.error;
  const lineProblem = useLineProblem(failure);
  const generic = useApiErrorMessage(lineProblem ? null : failure);
  const error = lineProblem ?? generic;
  const valid =
    Boolean(fromStoreId) &&
    lines.length > 0 &&
    lines.every((l) => l.quantity > 0);
  const submit = (send: boolean) => {
    setTouched(true);
    if (valid) save.mutate(send);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={request ? t('editTitle', { number: request.number }) : t('title')}
      closeLabel={tDocs('close')}
      size="xl"
      footer={
        <>
          {request && editable && (
            <Button
              variant="destructive"
              iconStart="trash-2"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('delete')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {editable ? tDocs('cancel') : tDocs('close')}
          </Button>
          {editable && (
            <>
              <Button
                variant="secondary"
                loading={save.isPending}
                onClick={() => submit(false)}
              >
                {tDocs('saveDraft')}
              </Button>
              <Button
                iconStart="arrow-up"
                loading={save.isPending}
                onClick={() => submit(true)}
              >
                {t('send')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {request && (
          <div className="flex flex-wrap items-center gap-3">
            <RequestStatusPill status={request.status} />
            {request.transferNumber && (
              <span className="text-sm text-fg-muted">
                {t('transfer', { number: request.transferNumber })}
              </span>
            )}
          </div>
        )}
        {request?.rejection && (
          <Alert tone="warning" title={t('rejected')}>
            {[
              t(`rejectReasons.${request.rejection.reason}`),
              request.rejection.comment,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Alert>
        )}
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <div className="grid grid-cols-3 gap-4">
          <Select
            label={t('to')}
            value={toStoreId}
            disabled={!editable || request !== null || lines.length > 0}
            onChange={(event) => setToStoreId(event.target.value)}
            options={(request
              ? [
                  {
                    id: request.requesterStoreId,
                    name: request.requesterStoreName,
                  },
                ]
              : access.writableStores
            ).map((s) => ({ value: s.id, label: s.name }))}
          />
          <Select
            label={t('from')}
            value={fromStoreId}
            disabled={!editable || lines.length > 0}
            onChange={(event) => setFromStoreId(event.target.value)}
            options={(request && !editable
              ? [{ id: request.fromStoreId, name: request.fromStoreName }]
              : others
            ).map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField
            label={tDocs('date')}
            value={formatDateOnly(request?.date ?? toAppDate())}
            readOnly
          />
        </div>
        {editable && fromStoreId && toStoreId && (
          // the catalog through the own store: the asked store may be out of the scope
          <ProductSearch
            storeId={toStoreId}
            onPick={(product) =>
              setLines((current) =>
                current.some((l) => l.productId === product.id)
                  ? current
                  : [
                      ...current,
                      {
                        productId: product.id,
                        productName: product.name,
                        quantity: 1,
                      },
                    ],
              )
            }
          />
        )}
        {touched && lines.length === 0 && (
          <Alert tone="warning">{t('linesRequired')}</Alert>
        )}
        {lines.length === 0 ? (
          <EmptyState icon="clipboard-list" title={t('empty')} />
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="ph-visually-hidden">{t('caption')}</caption>
            <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('product')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-medium">
                  {t('ours')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-medium">
                  {t('sender')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('quantity')}
                </th>
                {editable && (
                  <th scope="col">
                    <span className="ph-visually-hidden">
                      {tDocs('actions')}
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.productId} className="border-b border-border">
                  <td className="px-2 py-2 font-medium">{line.productName}</td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {packsOf(ours.byId.get(line.productId)) ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {packsOf(sender.byId.get(line.productId)) ?? '—'}
                  </td>
                  <td className="w-cell-sm px-2 py-2">
                    {editable ? (
                      <QuantityInput
                        label={t('quantityOf', { name: line.productName })}
                        value={line.quantity}
                        invalid={
                          touched && line.quantity < 1
                            ? t('quantityRequired')
                            : undefined
                        }
                        onChange={(value) =>
                          setLines((current) =>
                            current.map((l) =>
                              l.productId === line.productId
                                ? { ...l, quantity: value ?? 0 }
                                : l,
                            ),
                          )
                        }
                      />
                    ) : (
                      <span className="tabular-nums">{line.quantity}</span>
                    )}
                  </td>
                  {editable && (
                    <td className="px-1 py-2">
                      <IconButton
                        icon="trash-2"
                        label={tDocs('removeLine', { name: line.productName })}
                        onClick={() =>
                          setLines((current) =>
                            current.filter(
                              (l) => l.productId !== line.productId,
                            ),
                          )
                        }
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <TextField
          label={t('comment')}
          placeholder={t('commentPlaceholder')}
          maxLength={500}
          readOnly={!editable}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

const REJECTION_REASONS: RejectionReason[] = [
  'no_stock',
  'order_from_supplier',
  'other',
];

/** The asked store rejects a request; its transfer draft, if any, is cancelled. */
export function RejectDialog({
  request,
  onClose,
}: {
  request: TransferRequest;
  onClose: () => void;
}) {
  const t = useTranslations('transfers.reject');
  const tDocs = useTranslations('stockDocs');
  const invalidate = useInvalidateTransfers();
  const [reason, setReason] = useState<RejectionReason>('no_stock');
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const reject = useMutation({
    mutationFn: () =>
      apiRequest('transferRequests.reject', {
        params: { id: request.id },
        body: { reason, comment: comment.trim() },
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const error = useApiErrorMessage(reject.error);
  const commentMissing = reason === 'other' && !comment.trim();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={`${request.number} · ${request.requesterStoreName}`}
      closeLabel={tDocs('close')}
      icon="ban"
      tone="danger"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={reject.isPending}
            onClick={() => {
              setTouched(true);
              if (!commentMissing) reject.mutate();
            }}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <Select
          label={t('reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value as RejectionReason)}
          options={REJECTION_REASONS.map((value) => ({
            value,
            label: t(`reasons.${value}`),
          }))}
        />
        <TextField
          label={t('comment')}
          placeholder={
            reason === 'other' ? t('commentRequired') : t('commentPlaceholder')
          }
          maxLength={500}
          error={touched && commentMissing ? t('commentRequired') : undefined}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
