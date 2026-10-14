'use client';

import type {
  StockProductOption,
  WriteOff,
  WriteOffInput,
  WriteOffReason,
} from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  Select,
  Spinner,
  TextField,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { DocumentStatusPill } from '@/entities/stock-document';
import {
  lineOf,
  StockLinesEditor,
  stockLineProblem,
  toEditableLines,
  UnpostDialog,
  useLineErrors,
  wholeBatchQuantity,
  type EditableStockLine,
  type StockAccess,
} from '@/features/stock-document';
import { apiFieldErrors, apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';

export const WRITE_OFF_REASONS: WriteOffReason[] = [
  'expired',
  'broken',
  'defect',
  'misgrade',
  'transfer_discrepancy',
];

/** Write-off (UI mockup «Списание»): reasons, «добавить просроченные партии», cost by role. */
export function WriteOffEditor({
  document,
  access,
  onClose,
}: {
  document: WriteOff | null;
  access: StockAccess;
  onClose: () => void;
}) {
  const t = useTranslations('writeOffs.editor');
  const tReasons = useTranslations('writeOffs.reasons');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [doc, setDoc] = useState<WriteOff | null>(document);
  const [storeId, setStoreId] = useState(
    document?.storeId ?? access.writableStores[0]?.id ?? '',
  );
  const [date, setDate] = useState(document?.date ?? today);
  const [reason, setReason] = useState<WriteOffReason>(
    document?.reason ?? 'expired',
  );
  const [comment, setComment] = useState(document?.comment ?? '');
  const [lines, setLines] = useState<EditableStockLine[]>([]);
  const [loaded, setLoaded] = useState(!document);
  const [touched, setTouched] = useState(false);
  const [unposting, setUnposting] = useState(false);
  // every product with an expired batch in stock, archived ones too — not limited by the page (B4)
  const expired = useQuery({
    queryKey: ['stock-products', storeId, 'expired'],
    queryFn: ({ signal }) =>
      apiRequest('stock.products', {
        params: { storeId },
        query: { expired: true },
        signal,
      }),
    enabled: Boolean(storeId),
  });
  /** Exactly these products of the store, archived ones too, with their batches in stock. */
  const productsById = (ids: readonly string[]) =>
    queryClient.fetchQuery({
      queryKey: ['stock-products', storeId, 'ids', [...ids].sort().join(',')],
      queryFn: ({ signal }) =>
        apiRequest('stock.products', {
          params: { storeId },
          query: { ids: [...new Set(ids)].join(',') },
          signal,
        }),
      staleTime: 0,
    });
  // the write-off of a transfer shortage is made by the acceptance: only shown (spec T6)
  // made by an acceptance or a customer return: never changed by hand (T6; returns spec E9)
  const fromTransfer = Boolean(doc?.transferId ?? doc?.customerReturnId);
  const editable =
    (!doc || doc.status === 'draft') && access.canUpdate && !fromTransfer;

  // a saved document reopens with its own products, whatever the page of the store list (I2)
  useEffect(() => {
    if (loaded || !doc) return;
    let cancelled = false;
    void productsById(doc.lines.map((l) => l.productId)).then((found) => {
      if (cancelled) return;
      setLines(
        toEditableLines(
          doc.lines,
          new Map<string, StockProductOption>(found.map((p) => [p.id, p])),
        ),
      );
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, loaded]);

  /** After a rejected posting: the lines take the current stock, so a short row shows at itself. */
  const refreshBatches = async () => {
    const fresh = new Map(
      (await productsById(lines.map((l) => l.productId))).map((p) => [p.id, p]),
    );
    setLines((current) =>
      current.map((line) => {
        const product = fresh.get(line.productId);
        return product
          ? {
              ...line,
              batches: product.batches.filter(
                (b) => b.quantityPieces > 0 || b.id === line.batchId,
              ),
            }
          : line;
      }),
    );
  };

  const input = (): WriteOffInput => ({
    date,
    storeId,
    reason,
    comment: comment.trim(),
    lines: lines.map((l) => ({
      productId: l.productId,
      batchId: l.batchId,
      unit: l.unit,
      quantity: l.quantity,
    })),
  });
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['write-offs'] }),
      queryClient.invalidateQueries({ queryKey: ['stock'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-products'] }),
    ]);
  const saveDoc = () =>
    doc
      ? apiRequest('writeOffs.update', {
          params: { id: doc.id },
          body: input(),
        })
      : apiRequest('writeOffs.create', { body: input() });
  // one error at a time: a save or a posting clears what the other one left
  const save = useMutation({
    mutationFn: saveDoc,
    onMutate: (): void => post.reset(),
    onSuccess: (saved) => {
      setDoc(saved);
      void invalidate();
    },
  });
  const post = useMutation({
    mutationFn: async () => {
      const saved = await saveDoc();
      // the draft exists now: a rejected posting must not create another one
      setDoc(saved);
      return apiRequest('writeOffs.post', { params: { id: saved.id } });
    },
    onMutate: (): void => save.reset(),
    onSuccess: (posted) => {
      setDoc(posted);
      void invalidate();
    },
    // the stock may have moved: the short lines show it at themselves (I3)
    onError: (failure) => {
      void invalidate();
      if (
        apiFieldErrors(failure).some((e) => e.code === 'stock_insufficient')
      ) {
        void refreshBatches();
      }
    },
  });
  const unpost = useMutation({
    mutationFn: () =>
      apiRequest('writeOffs.unpost', { params: { id: doc?.id ?? '' } }),
    onSuccess: (draft) => {
      setDoc(draft);
      setUnposting(false);
      void invalidate();
      // the stock came back: the lines show it
      void refreshBatches();
    },
  });
  const failure = post.error ?? save.error;
  const error = useApiErrorMessage(failure);
  const dateError = apiFieldErrors(failure).find(
    (e) => e.field === 'date',
  )?.code;
  const lineErrors = useLineErrors(post.error, lines.length);

  const addExpired = () => {
    const present = new Set(lines.map((l) => l.batchId));
    const added: EditableStockLine[] = [];
    for (const product of expired.data ?? []) {
      for (const batch of product.batches) {
        if (
          batch.expiresOn >= today ||
          batch.quantityPieces <= 0 ||
          present.has(batch.id)
        ) {
          continue;
        }
        const line = lineOf(product, { batch, includeExpired: true });
        if (line)
          added.push({ ...line, ...wholeBatchQuantity(product, batch) });
      }
    }
    setLines([...lines, ...added]);
    setReason('expired');
  };

  const valid =
    lines.length > 0 && lines.every((l) => stockLineProblem(l) === null);
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={doc ? t('title', { number: doc.number }) : t('newTitle')}
        closeLabel={tDocs('close')}
        size="xl"
        footer={
          <>
            {doc?.status === 'posted' && access.canUnpost && !fromTransfer && (
              <Button
                variant="secondary"
                iconStart="undo-2"
                onClick={() => setUnposting(true)}
              >
                {tDocs('unpostAction')}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {tDocs('close')}
            </Button>
            {editable && (
              <>
                <Button
                  variant="secondary"
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {tDocs('saveDraft')}
                </Button>
                {access.canPost && (
                  <Button
                    iconStart="check"
                    loading={post.isPending}
                    onClick={() => {
                      setTouched(true);
                      if (valid) post.mutate();
                    }}
                  >
                    {tDocs('post')}
                  </Button>
                )}
              </>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {doc?.customerReturnNumber && (
            <Alert tone="info">
              {t('fromReturn', { number: doc.customerReturnNumber })}{' '}
              <Link
                href={routes.returns()}
                className="font-medium text-primary underline"
              >
                {t('openReturns')}
              </Link>
            </Alert>
          )}
          {doc?.transferNumber && (
            <Alert tone="info">
              {t('fromTransfer', { number: doc.transferNumber })}{' '}
              <Link
                href={routes.transfers()}
                className="font-medium text-primary underline"
              >
                {t('openTransfers')}
              </Link>
            </Alert>
          )}
          <div className="flex items-center gap-2">
            <DocumentStatusPill status={doc?.status ?? 'draft'} />
            {doc?.postedBy && (
              <span className="text-xs text-fg-subtle">
                {tDocs('postedBy', { name: doc.postedBy.name })}
              </span>
            )}
          </div>
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <div className="grid grid-cols-4 gap-4">
            <Select
              label={t('store')}
              disabled={!editable || lines.length > 0}
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              options={access.writableStores.map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            />
            <TextField
              label={t('date')}
              type="date"
              max={today}
              disabled={!editable}
              error={
                dateError === 'period_closed'
                  ? t('periodClosed')
                  : dateError
                    ? tDocs('checkValue')
                    : undefined
              }
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <Select
              label={t('reason')}
              disabled={!editable}
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as WriteOffReason)
              }
              options={(WRITE_OFF_REASONS.includes(reason)
                ? WRITE_OFF_REASONS
                : [...WRITE_OFF_REASONS, reason]
              ).map((value) => ({
                value,
                label: tReasons(value),
              }))}
            />
            <TextField
              label={t('comment')}
              placeholder={t('commentPlaceholder')}
              disabled={!editable}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          {editable && (
            <div className="flex justify-end">
              <Button
                variant="secondary"
                iconStart="clock"
                onClick={addExpired}
                disabled={expired.isPending}
              >
                {t('addExpired')}
              </Button>
            </div>
          )}
          {touched && lines.length === 0 && (
            <Alert tone="warning">{t('linesRequired')}</Alert>
          )}
          {loaded ? (
            <StockLinesEditor
              storeId={storeId}
              lines={lines}
              onChange={setLines}
              editable={editable}
              showCost={access.canSeeCost}
              touched={touched}
              valuation="piece"
              totalMinor={doc?.status === 'posted' ? doc.totalMinor : undefined}
              lineErrors={lineErrors}
            />
          ) : (
            <Spinner size="md" label={tDocs('loading')} />
          )}
        </div>
      </Dialog>
      {doc && (
        <UnpostDialog
          kind="write-offs"
          id={unposting ? doc.id : null}
          number={doc.number}
          busy={unpost.isPending}
          error={unpost.error}
          onConfirm={() => unpost.mutate()}
          onClose={() => setUnposting(false)}
        />
      )}
    </>
  );
}
