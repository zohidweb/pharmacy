'use client';

import type {
  StockProductOption,
  SupplierReturn,
  SupplierReturnInput,
  SupplierReturnReason,
} from '@pharmacy/shared-dto';
import { formatDateOnly, toAppDate } from '@pharmacy/shared-util';
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

export const SUPPLIER_RETURN_REASONS: SupplierReturnReason[] = [
  'defect',
  'expired',
  'broken',
];

/** Return to a supplier (UI mockup «Возврат поставщику»): posting lowers the debt to the supplier. */
export function SupplierReturnEditor({
  document,
  access,
  onClose,
}: {
  document: SupplierReturn | null;
  access: StockAccess;
  onClose: () => void;
}) {
  const t = useTranslations('supplierReturns.editor');
  const tReasons = useTranslations('supplierReturns.reasons');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [doc, setDoc] = useState<SupplierReturn | null>(document);
  const [supplierId, setSupplierId] = useState(document?.supplierId ?? '');
  const [storeId, setStoreId] = useState(
    document?.storeId ?? access.writableStores[0]?.id ?? '',
  );
  const [receiptId, setReceiptId] = useState<string | null>(
    document?.receiptId ?? null,
  );
  const [date, setDate] = useState(document?.date ?? today);
  const [reason, setReason] = useState<SupplierReturnReason>(
    document?.reason ?? 'defect',
  );
  const [comment, setComment] = useState(document?.comment ?? '');
  const [lines, setLines] = useState<EditableStockLine[]>([]);
  const [loaded, setLoaded] = useState(!document);
  const [touched, setTouched] = useState(false);
  const [unposting, setUnposting] = useState(false);
  // another supplier for a return with lines: its lines are of the old one (sr-M6, 2026-10-16)
  const [nextSupplier, setNextSupplier] = useState<string | null>(null);
  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    setReceiptId(null);
    setLines([]);
  };
  /** Exactly these products of the store with their batches of the supplier in stock. */
  const productsById = (ids: readonly string[]) =>
    queryClient.fetchQuery({
      queryKey: [
        'stock-products',
        storeId,
        'ids',
        supplierId,
        [...ids].sort().join(','),
      ],
      queryFn: ({ signal }) =>
        apiRequest('stock.products', {
          params: { storeId },
          query: { ids: [...new Set(ids)].join(','), supplierId },
          signal,
        }),
      staleTime: 0,
    });
  const editable = (!doc || doc.status === 'draft') && access.canUpdate;

  const suppliers = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: ({ signal }) => apiRequest('suppliers.options', { signal }),
  });
  const receipts = useQuery({
    queryKey: ['goods-receipts', supplierId, storeId, 'posted', 'options'],
    queryFn: ({ signal }) =>
      apiRequest('goodsReceipts.list', {
        query: { supplierId, storeId, status: 'posted', limit: 50 },
        signal,
      }),
    enabled: Boolean(supplierId && storeId),
  });

  // a saved document reopens with its own products, whatever the page of the store list
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

  // the batches of the receipt still in stock (reading the receipt needs the cost right)
  const fromReceipt = useMutation({
    mutationFn: () =>
      apiRequest('stock.products', {
        params: { storeId },
        query: { receiptId: receiptId ?? '', supplierId },
      }),
    onSuccess: (found) => {
      const present = new Set(lines.map((l) => l.batchId));
      const added: EditableStockLine[] = [];
      for (const product of found) {
        for (const batch of product.batches) {
          if (batch.quantityPieces <= 0 || present.has(batch.id)) continue;
          const editableLine = lineOf(product, {
            batch,
            includeExpired: true,
          });
          // the whole rest of the batch, not 1 pack (it may be less than a pack)
          if (editableLine) {
            added.push({
              ...editableLine,
              ...wholeBatchQuantity(product, batch),
            });
          }
        }
      }
      setLines([...lines, ...added]);
    },
  });

  const input = (): SupplierReturnInput => ({
    date,
    supplierId,
    storeId,
    receiptId,
    reason,
    comment: comment.trim(),
    lines: lines.map((l) => ({
      productId: l.productId,
      batchId: l.batchId,
      unit: l.unit,
      quantity: l.quantity,
      note: l.note.trim(),
    })),
  });
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['supplier-returns'] }),
      queryClient.invalidateQueries({ queryKey: ['stock'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-products'] }),
    ]);
  const saveDoc = () =>
    doc
      ? apiRequest('supplierReturns.update', {
          params: { id: doc.id },
          body: input(),
        })
      : apiRequest('supplierReturns.create', { body: input() });
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
    // the keys of the lines as sent: the errors of the answer go to these lines
    mutationFn: async (_sent: readonly string[]) => {
      const saved = await saveDoc();
      // the draft exists now: a rejected posting must not create another one
      setDoc(saved);
      return apiRequest('supplierReturns.post', { params: { id: saved.id } });
    },
    onMutate: (): void => save.reset(),
    onSuccess: (posted) => {
      setDoc(posted);
      void invalidate();
    },
    // the stock may have moved: the short lines show it at themselves
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
      apiRequest('supplierReturns.unpost', { params: { id: doc?.id ?? '' } }),
    onSuccess: (draft) => {
      setDoc(draft);
      setUnposting(false);
      void invalidate();
      // the stock came back: the lines show it
      void refreshBatches();
    },
  });
  const failure = post.error ?? save.error;
  const error = useApiErrorMessage(failure ?? fromReceipt.error);
  const dateError = apiFieldErrors(failure).find(
    (e) => e.field === 'date',
  )?.code;
  const lineErrors = useLineErrors(post.error, post.variables);
  const valid =
    Boolean(supplierId) &&
    lines.length > 0 &&
    lines.every((l) => stockLineProblem(l) === null);

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
            {doc?.status === 'posted' && access.canUnpost && (
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
                  // one of the two at a time: each one clears the other's error
                  disabled={!supplierId || post.isPending}
                  onClick={() => save.mutate()}
                >
                  {tDocs('saveDraft')}
                </Button>
                {access.canPost && (
                  <Button
                    iconStart="check"
                    loading={post.isPending}
                    disabled={save.isPending}
                    onClick={() => {
                      setTouched(true);
                      if (valid) post.mutate(lines.map((l) => l.key));
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
          <div className="flex items-center gap-2">
            <DocumentStatusPill status={doc?.status ?? 'draft'} />
          </div>
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <div className="grid grid-cols-3 gap-4">
            <Select
              label={t('supplier')}
              required
              disabled={!editable}
              placeholder={t('supplierPlaceholder')}
              value={supplierId}
              error={touched && !supplierId ? t('supplierRequired') : undefined}
              onChange={(event) => {
                if (lines.length > 0) setNextSupplier(event.target.value);
                else chooseSupplier(event.target.value);
              }}
              options={(suppliers.data ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            />
            <Select
              label={t('store')}
              disabled={!editable || lines.length > 0}
              value={storeId}
              onChange={(event) => {
                setStoreId(event.target.value);
                // the receipt is of the store: picked again for the new one
                setReceiptId(null);
              }}
              options={access.writableStores.map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            />
            <Select
              label={t('receipt')}
              disabled={!editable || !supplierId}
              value={receiptId ?? ''}
              onChange={(event) => setReceiptId(event.target.value || null)}
              options={[
                { value: '', label: t('noReceipt') },
                ...(receipts.data?.items ?? []).map((r) => ({
                  value: r.id,
                  label: `${r.number} · ${formatDateOnly(r.date)}`,
                })),
              ]}
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
                setReason(event.target.value as SupplierReturnReason)
              }
              options={SUPPLIER_RETURN_REASONS.map((value) => ({
                value,
                label: tReasons(value),
              }))}
            />
            <TextField
              label={t('comment')}
              placeholder={t('commentPlaceholder')}
              maxLength={500}
              disabled={!editable}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          {editable && receiptId && (
            <div className="flex justify-end">
              <Button
                variant="secondary"
                iconStart="inbox"
                loading={fromReceipt.isPending}
                onClick={() => fromReceipt.mutate()}
              >
                {t('fromReceipt')}
              </Button>
            </div>
          )}
          {touched && lines.length === 0 && (
            <Alert tone="warning">{t('linesRequired')}</Alert>
          )}
          {editable && !supplierId && (
            <Alert tone="info">{t('supplierFirst')}</Alert>
          )}
          {loaded ? (
            <StockLinesEditor
              storeId={storeId}
              supplierId={supplierId || undefined}
              lines={lines}
              onChange={setLines}
              editable={editable && Boolean(supplierId)}
              showCost={access.canSeeCost}
              withNote
              touched={touched}
              totalMinor={doc?.status === 'posted' ? doc.totalMinor : undefined}
              lineErrors={lineErrors}
            />
          ) : (
            <Spinner size="md" label={tDocs('loading')} />
          )}
          <p className="text-xs text-fg-subtle">{t('hint')}</p>
        </div>
      </Dialog>
      <Dialog
        open={nextSupplier !== null}
        onClose={() => setNextSupplier(null)}
        title={t('changeSupplier.title')}
        closeLabel={tDocs('close')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNextSupplier(null)}>
              {tDocs('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (nextSupplier !== null) chooseSupplier(nextSupplier);
                setNextSupplier(null);
              }}
            >
              {t('changeSupplier.confirm')}
            </Button>
          </>
        }
      >
        <p className="m-0">{t('changeSupplier.body')}</p>
      </Dialog>
      {doc && (
        <UnpostDialog
          kind="supplier-returns"
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
