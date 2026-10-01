'use client';

import type {
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
  Switch,
  TextField,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { ClaimStatusPill, DocumentStatusPill } from '@/entities/stock-document';
import {
  lineOf,
  StockLinesEditor,
  stockLineProblem,
  toEditableLines,
  UnpostDialog,
  useStoreProducts,
  type EditableStockLine,
  type StockAccess,
} from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

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
  const [createClaim, setCreateClaim] = useState(
    document ? document.claim !== 'none' : true,
  );
  const [lines, setLines] = useState<EditableStockLine[]>([]);
  const [loaded, setLoaded] = useState(!document);
  const [touched, setTouched] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const products = useStoreProducts(storeId);
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

  useEffect(() => {
    if (loaded || !doc || products.isPending) return;
    setLines(toEditableLines(doc.lines, products.byId));
    setLoaded(true);
  }, [doc, loaded, products.isPending, products.byId]);

  const fromReceipt = useMutation({
    mutationFn: () =>
      apiRequest('goodsReceipts.get', { params: { id: receiptId ?? '' } }),
    onSuccess: (receipt) => {
      const present = new Set(lines.map((l) => l.batchId));
      const added: EditableStockLine[] = [];
      for (const line of receipt.lines) {
        const product = products.byId.get(line.productId);
        const batch = product?.batches.find(
          (b) => b.number === line.batchNumber,
        );
        if (
          !product ||
          !batch ||
          batch.quantityPieces <= 0 ||
          present.has(batch.id)
        )
          continue;
        const editableLine = lineOf(product, { batch, includeExpired: true });
        if (editableLine) added.push(editableLine);
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
    createClaim,
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
  const save = useMutation({
    mutationFn: saveDoc,
    onSuccess: (saved) => {
      setDoc(saved);
      void invalidate();
    },
  });
  const post = useMutation({
    mutationFn: async () =>
      apiRequest('supplierReturns.post', {
        params: { id: (await saveDoc()).id },
      }),
    onSuccess: (posted) => {
      setDoc(posted);
      void invalidate();
    },
  });
  const unpost = useMutation({
    mutationFn: () =>
      apiRequest('supplierReturns.unpost', { params: { id: doc?.id ?? '' } }),
    onSuccess: (draft) => {
      setDoc(draft);
      setUnposting(false);
      void invalidate();
    },
  });
  const error = useApiErrorMessage(
    save.error ?? post.error ?? fromReceipt.error,
  );
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
            <Button
              variant="secondary"
              iconStart="printer"
              disabled
              title={tDocs('soonHint')}
            >
              {t('printClaim')}
            </Button>
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
                  disabled={!supplierId}
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
          <div className="flex items-center gap-2">
            <DocumentStatusPill status={doc?.status ?? 'draft'} />
            {doc && <ClaimStatusPill claim={doc.claim} />}
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
                setSupplierId(event.target.value);
                setReceiptId(null);
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
              onChange={(event) => setStoreId(event.target.value)}
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
            <Switch
              label={t('claim')}
              description={t('claimHint')}
              disabled={!editable}
              checked={createClaim}
              onCheckedChange={setCreateClaim}
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
          {loaded ? (
            <StockLinesEditor
              storeId={storeId}
              lines={lines}
              onChange={setLines}
              editable={editable}
              showCost={access.canSeeCost}
              withNote
              touched={touched}
            />
          ) : (
            <Spinner size="md" label={tDocs('loading')} />
          )}
          <p className="text-xs text-fg-subtle">{t('hint')}</p>
        </div>
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
