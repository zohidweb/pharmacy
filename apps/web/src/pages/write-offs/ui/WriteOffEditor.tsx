'use client';

import type {
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { DocumentStatusPill } from '@/entities/stock-document';
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
  const products = useStoreProducts(storeId);
  const editable = (!doc || doc.status === 'draft') && access.canUpdate;

  useEffect(() => {
    if (loaded || !doc || products.isPending) return;
    setLines(toEditableLines(doc.lines, products.byId));
    setLoaded(true);
  }, [doc, loaded, products.isPending, products.byId]);

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
  const save = useMutation({
    mutationFn: saveDoc,
    onSuccess: (saved) => {
      setDoc(saved);
      void invalidate();
    },
  });
  const post = useMutation({
    mutationFn: async () =>
      apiRequest('writeOffs.post', { params: { id: (await saveDoc()).id } }),
    onSuccess: (posted) => {
      setDoc(posted);
      void invalidate();
    },
  });
  const unpost = useMutation({
    mutationFn: () =>
      apiRequest('writeOffs.unpost', { params: { id: doc?.id ?? '' } }),
    onSuccess: (draft) => {
      setDoc(draft);
      setUnposting(false);
      void invalidate();
    },
  });
  const error = useApiErrorMessage(save.error ?? post.error);

  const addExpired = () => {
    const present = new Set(lines.map((l) => l.batchId));
    const added: EditableStockLine[] = [];
    for (const product of products.data ?? []) {
      for (const batch of product.batches) {
        if (
          batch.expiresOn >= today ||
          batch.quantityPieces <= 0 ||
          present.has(batch.id)
        ) {
          continue;
        }
        const line = lineOf(product, { batch, includeExpired: true });
        if (line) {
          added.push({
            ...line,
            quantity:
              Math.floor(batch.quantityPieces / product.piecesPerPack) ||
              batch.quantityPieces,
            unit:
              batch.quantityPieces % product.piecesPerPack === 0 ||
              !product.divisible
                ? 'pack'
                : 'piece',
          });
        }
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
              options={WRITE_OFF_REASONS.map((value) => ({
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
                disabled={products.isPending}
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
