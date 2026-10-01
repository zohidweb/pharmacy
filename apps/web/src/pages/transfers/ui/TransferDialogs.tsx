'use client';

import type {
  RejectionReason,
  StockProductOption,
  Transfer,
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
  TextField,
  type IconName,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { TransferStatusPill } from '@/entities/stock-document';
import {
  ProductSearch,
  QuantityInput,
  useStoreProducts,
  type StockAccess,
} from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

const invalidateKeys = [['transfers'], ['stock'], ['stock-products']] as const;

function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      invalidateKeys.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

/* ---------------- request ---------------- */

interface RequestLine {
  productId: string;
  productName: string;
  quantity: number;
  senderPacks: number;
  ourPacks: number;
}

const packsOf = (product: StockProductOption | undefined) =>
  product
    ? Math.floor(
        product.batches.reduce((s, b) => s + Math.max(0, b.quantityPieces), 0) /
          product.piecesPerPack,
      )
    : 0;

/** Request of goods from another store (ЗП). */
export function RequestDialog({
  access,
  onClose,
}: {
  access: StockAccess;
  onClose: () => void;
}) {
  const t = useTranslations('transfers.request');
  const tDocs = useTranslations('stockDocs');
  const invalidate = useInvalidate();
  const { data: session } = useSession();
  const [toStoreId, setToStoreId] = useState(
    access.writableStores[0]?.id ?? '',
  );
  const others = (session?.stores ?? []).filter((s) => s.id !== toStoreId);
  const [fromStoreId, setFromStoreId] = useState(others[0]?.id ?? '');
  const [lines, setLines] = useState<RequestLine[]>([]);
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const ours = useStoreProducts(toStoreId);
  const create = useMutation({
    mutationFn: (send: boolean) =>
      apiRequest('transferRequests.create', {
        body: {
          fromStoreId,
          toStoreId,
          comment: comment.trim(),
          send,
          lines: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
          })),
        },
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const error = useApiErrorMessage(create.error);
  const valid =
    Boolean(fromStoreId) &&
    lines.length > 0 &&
    lines.every((l) => l.quantity > 0);
  const submit = (send: boolean) => {
    setTouched(true);
    if (valid) create.mutate(send);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={tDocs('close')}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            variant="secondary"
            loading={create.isPending}
            onClick={() => submit(false)}
          >
            {tDocs('saveDraft')}
          </Button>
          <Button
            iconStart="arrow-up"
            loading={create.isPending}
            onClick={() => submit(true)}
          >
            {t('send')}
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
        <div className="grid grid-cols-3 gap-4">
          <Select
            label={t('to')}
            value={toStoreId}
            disabled={lines.length > 0}
            onChange={(event) => setToStoreId(event.target.value)}
            options={access.writableStores.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <Select
            label={t('from')}
            value={fromStoreId}
            disabled={lines.length > 0}
            onChange={(event) => setFromStoreId(event.target.value)}
            options={others.map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField
            label={tDocs('date')}
            value={formatDateOnly(toAppDate())}
            readOnly
          />
        </div>
        {fromStoreId && (
          <ProductSearch
            storeId={fromStoreId}
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
                        senderPacks: packsOf(product),
                        ourPacks: packsOf(ours.byId.get(product.id)),
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
                <th scope="col">
                  <span className="ph-visually-hidden">{tDocs('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.productId} className="border-b border-border">
                  <td className="px-2 py-2 font-medium">{line.productName}</td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {line.ourPacks}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {line.senderPacks}
                  </td>
                  <td className="w-cell-sm px-2 py-2">
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
                  </td>
                  <td className="px-1 py-2">
                    <IconButton
                      icon="trash-2"
                      label={tDocs('removeLine', { name: line.productName })}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((l) => l.productId !== line.productId),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <TextField
          label={t('comment')}
          placeholder={t('commentPlaceholder')}
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

export function RejectDialog({
  request,
  onClose,
}: {
  request: TransferRequest;
  onClose: () => void;
}) {
  const t = useTranslations('transfers.reject');
  const tDocs = useTranslations('stockDocs');
  const invalidate = useInvalidate();
  const [reason, setReason] = useState<RejectionReason>('no_stock');
  const [comment, setComment] = useState('');
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
            onClick={() => reject.mutate()}
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
          placeholder={t('commentPlaceholder')}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

/* ---------------- transfer (new or picked from a request) ---------------- */

interface PickLine {
  key: string;
  product: StockProductOption;
  batchId: string;
  quantity: number;
  requested: number | null;
}

function fefoBatchId(product: StockProductOption) {
  const today = toAppDate();
  return (
    [...product.batches]
      .filter((b) => b.expiresOn >= today && b.quantityPieces > 0)
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0]?.id ?? ''
  );
}

const batchPacks = (line: PickLine) => {
  const batch = line.product.batches.find((b) => b.id === line.batchId);
  return batch
    ? Math.floor(batch.quantityPieces / line.product.piecesPerPack)
    : 0;
};

/** Transfer (ПМ): FEFO batches within the sender stock, picked from a request or new. */
export function TransferDialog({
  access,
  request,
  onClose,
}: {
  access: StockAccess;
  request: TransferRequest | null;
  onClose: () => void;
}) {
  const t = useTranslations('transfers.transfer');
  const tDocs = useTranslations('stockDocs');
  const invalidate = useInvalidate();
  const { data: session } = useSession();
  const [fromStoreId, setFromStoreId] = useState(
    request?.fromStoreId ?? access.writableStores[0]?.id ?? '',
  );
  const [toStoreId, setToStoreId] = useState(
    request?.requesterStoreId ??
      (session?.stores ?? []).find((s) => s.id !== fromStoreId)?.id ??
      '',
  );
  const sender = useStoreProducts(fromStoreId);
  const [lines, setLines] = useState<PickLine[] | null>(request ? null : []);
  const [touched, setTouched] = useState(false);

  // a request is picked by FEFO as soon as the sender stock is known
  if (lines === null && request && !sender.isPending) {
    setLines(
      request.lines.flatMap((l) => {
        const product = sender.byId.get(l.productId);
        if (!product) return [];
        const line: PickLine = {
          key: l.productId,
          product,
          batchId: fefoBatchId(product),
          quantity: 0,
          requested: l.quantity,
        };
        return [{ ...line, quantity: Math.min(l.quantity, batchPacks(line)) }];
      }),
    );
  }

  const create = useMutation({
    mutationFn: (send: boolean) =>
      apiRequest('transfers.create', {
        body: {
          requestId: request?.id ?? null,
          fromStoreId,
          toStoreId,
          send,
          lines: (lines ?? [])
            .filter((l) => l.quantity > 0)
            .map((l) => ({
              productId: l.product.id,
              batchId: l.batchId,
              quantity: l.quantity,
            })),
        },
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const error = useApiErrorMessage(create.error);
  const current = lines ?? [];
  const valid =
    Boolean(toStoreId) &&
    current.some((l) => l.quantity > 0) &&
    current.every((l) => l.quantity <= batchPacks(l));
  const submit = (send: boolean) => {
    setTouched(true);
    if (valid) create.mutate(send);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        request ? t('pickTitle', { request: request.number }) : t('newTitle')
      }
      closeLabel={tDocs('close')}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            variant="secondary"
            loading={create.isPending}
            onClick={() => submit(false)}
          >
            {tDocs('saveDraft')}
          </Button>
          <Button
            iconStart="truck"
            loading={create.isPending}
            onClick={() => submit(true)}
          >
            {t('send')}
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
        <div className="grid grid-cols-3 gap-4">
          <Select
            label={t('from')}
            value={fromStoreId}
            disabled={Boolean(request) || current.length > 0}
            onChange={(event) => setFromStoreId(event.target.value)}
            options={access.writableStores.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <Select
            label={t('to')}
            value={toStoreId}
            disabled={Boolean(request)}
            onChange={(event) => setToStoreId(event.target.value)}
            options={(session?.stores ?? [])
              .filter((s) => s.id !== fromStoreId)
              .map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField
            label={tDocs('date')}
            value={formatDateOnly(toAppDate())}
            readOnly
          />
        </div>
        {!request && fromStoreId && (
          <ProductSearch
            storeId={fromStoreId}
            onPick={(product) => {
              const batchId = fefoBatchId(product);
              if (!batchId) return;
              setLines([
                ...current,
                {
                  key: `${product.id}-${Date.now()}`,
                  product,
                  batchId,
                  quantity: 1,
                  requested: null,
                },
              ]);
            }}
          />
        )}
        {current.length === 0 ? (
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
              </tr>
            </thead>
            <tbody>
              {current.map((line) => {
                const available = batchPacks(line);
                const over = line.quantity > available;
                const less =
                  line.requested !== null && line.quantity < line.requested;
                return (
                  <tr
                    key={line.key}
                    className="border-b border-border align-top"
                  >
                    <td className="px-2 py-2">
                      <span className="font-medium">{line.product.name}</span>
                      {less && !over && (
                        <span className="block text-xs text-warning">
                          {t('lessThanRequested')}
                        </span>
                      )}
                    </td>
                    <td className="w-cell-lg px-2 py-2">
                      <Select
                        label={t('batchOf', { name: line.product.name })}
                        hideLabel
                        value={line.batchId}
                        onChange={(event) =>
                          setLines(
                            current.map((l) =>
                              l.key === line.key
                                ? { ...l, batchId: event.target.value }
                                : l,
                            ),
                          )
                        }
                        options={line.product.batches
                          .filter(
                            (b) =>
                              b.quantityPieces > 0 &&
                              b.expiresOn >= toAppDate(),
                          )
                          .map((b) => ({
                            value: b.id,
                            label: `${b.number} · ${formatDateOnly(b.expiresOn)}`,
                          }))}
                      />
                    </td>
                    {request && (
                      <td className="px-2 py-2 text-end tabular-nums">
                        {line.requested}
                      </td>
                    )}
                    <td className="px-2 py-2 text-end tabular-nums">
                      {available}
                    </td>
                    <td className="w-cell-sm px-2 py-2">
                      <QuantityInput
                        label={t('quantityOf', { name: line.product.name })}
                        value={line.quantity}
                        invalid={touched && over ? t('overStock') : undefined}
                        onChange={(value) =>
                          setLines(
                            current.map((l) =>
                              l.key === line.key
                                ? { ...l, quantity: value ?? 0 }
                                : l,
                            ),
                          )
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
      </div>
    </Dialog>
  );
}

/* ---------------- transfer card: acceptance and discrepancy ---------------- */

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
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const transfer = useQuery({
    queryKey: ['transfers', 'detail', transferId],
    queryFn: ({ signal }) =>
      apiRequest('transfers.get', { params: { id: transferId }, signal }),
  });
  const [received, setReceived] = useState<Record<string, number | null>>({});
  const [comment, setComment] = useState('');
  const doc = transfer.data;
  const isReceiver =
    doc !== undefined &&
    access.writableStores.some((s) => s.id === doc.toStoreId) &&
    access.canReceive;
  const isSender =
    doc !== undefined &&
    access.writableStores.some((s) => s.id === doc.fromStoreId);
  const receiving = doc?.status === 'in_transit' && isReceiver;
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
          comment: comment.trim(),
          lines: (doc?.lines ?? []).map((l) => ({
            batchId: l.batchId,
            receivedQuantity: valueOf(l) ?? 0,
          })),
        },
      }),
    onSuccess: update,
  });
  const resolve = useMutation({
    mutationFn: (resolution: 'write_off' | 'resend') =>
      apiRequest('transfers.resolve', {
        params: { id: transferId },
        body: { resolution },
      }),
    onSuccess: update,
  });
  const error = useApiErrorMessage(
    accept.error ?? resolve.error ?? transfer.error,
  );
  const missing = (doc?.lines ?? []).reduce(
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
  void session;

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
          <Button variant="secondary" onClick={onClose}>
            {tDocs('close')}
          </Button>
          {receiving && (
            <Button
              iconStart="check"
              loading={accept.isPending}
              onClick={() => accept.mutate()}
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
              done={doc.status !== 'draft'}
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
                      {t('packs', { count: line.sentQuantity })}
                    </td>
                    <td className="w-cell-sm px-2 py-2">
                      {receiving ? (
                        <QuantityInput
                          label={t('receivedOf', { name: line.productName })}
                          value={valueOf(line)}
                          onChange={(next) =>
                            setReceived((current) => ({
                              ...current,
                              [line.batchId]: next,
                            }))
                          }
                        />
                      ) : (
                        <span className="tabular-nums">{value ?? '—'}</span>
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
              hint={missing > 0 ? t('commentRequiredHint') : undefined}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
          {doc.discrepancy && (
            <Alert
              tone={doc.discrepancy.resolution ? 'success' : 'warning'}
              title={t('discrepancyTitle', { count: missing })}
            >
              <div className="flex flex-col gap-2">
                {doc.discrepancy.comment && (
                  <span>{doc.discrepancy.comment}</span>
                )}
                {doc.discrepancy.resolution ? (
                  <span>
                    {t(`resolved.${doc.discrepancy.resolution}`, {
                      document: doc.discrepancy.documentNumber ?? '—',
                    })}
                  </span>
                ) : (
                  <>
                    <span>{t('discrepancyHint')}</span>
                    {isSender && access.canPost && (
                      <span className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          loading={resolve.isPending}
                          onClick={() => resolve.mutate('write_off')}
                        >
                          {t('writeOff')}
                        </Button>
                        <Button
                          variant="secondary"
                          loading={resolve.isPending}
                          onClick={() => resolve.mutate('resend')}
                        >
                          {t('resend')}
                        </Button>
                      </span>
                    )}
                  </>
                )}
              </div>
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
