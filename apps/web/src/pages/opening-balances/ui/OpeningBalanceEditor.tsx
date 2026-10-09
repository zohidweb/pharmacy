'use client';

import type {
  OpeningBalance,
  OpeningBalanceInput,
  StockProductOption,
} from '@pharmacy/shared-dto';
import { formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  IconButton,
  Select,
  TextField,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { DocumentStatusPill } from '@/entities/stock-document';
import {
  MoneyInput,
  ProductSearch,
  QuantityInput,
  UnpostDialog,
  type StockAccess,
} from '@/features/stock-document';
import { apiFieldErrors, apiRequest, useApiErrorMessage } from '@/shared/api';

interface Line {
  key: string;
  productId: string;
  productName: string;
  batchNumber: string;
  expiresOn: string;
  quantity: number;
  costMinor: number;
  retailPriceMinor: number | null;
  starting: boolean;
}

interface Draft {
  date: string;
  storeId: string;
  comment: string;
  lines: Line[];
}

function fromDocument(doc: OpeningBalance): Draft {
  return {
    date: doc.date,
    storeId: doc.storeId,
    comment: doc.comment,
    lines: doc.lines.map((line, index) => ({
      ...line,
      key: `${line.productId}-${index}`,
    })),
  };
}

/**
 * Opening balance (spec 2026-10-09-inventory-purchasing, section 4.1): the stock that was on the
 * shelf before the system — like a goods receipt without a supplier, an invoice and a debt. The
 * retail price of a line is optional: empty keeps the price of the store.
 */
export function OpeningBalanceEditor({
  document,
  access,
  onClose,
}: {
  /** null — a new document. */
  document: OpeningBalance | null;
  access: StockAccess;
  onClose: () => void;
}) {
  const t = useTranslations('openingBalances.editor');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [doc, setDoc] = useState<OpeningBalance | null>(document);
  const [draft, setDraft] = useState<Draft>(() =>
    document
      ? fromDocument(document)
      : {
          date: today,
          storeId: access.writableStores[0]?.id ?? '',
          comment: '',
          lines: [],
        },
  );
  const [touched, setTouched] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const editable = (!doc || doc.status === 'draft') && access.canUpdate;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['opening-balances'] }),
      queryClient.invalidateQueries({ queryKey: ['stock'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-products'] }),
    ]);
  const input = (): OpeningBalanceInput => ({
    date: draft.date,
    storeId: draft.storeId,
    comment: draft.comment,
    lines: draft.lines.map(({ key: _k, productName: _n, ...line }) => line),
  });
  const write = () =>
    doc
      ? apiRequest('openingBalances.update', {
          params: { id: doc.id },
          body: input(),
        })
      : apiRequest('openingBalances.create', { body: input() });
  const save = useMutation({
    mutationFn: write,
    onSuccess: (saved) => {
      setDoc(saved);
      void invalidate();
    },
  });
  const post = useMutation({
    mutationFn: async () => {
      const saved = await write();
      // a rejected posting leaves the saved draft: a retry updates it, not a new one
      setDoc(saved);
      return apiRequest('openingBalances.post', { params: { id: saved.id } });
    },
    onSuccess: (posted) => {
      setDoc(posted);
      void invalidate();
    },
  });
  const unpost = useMutation({
    mutationFn: () =>
      apiRequest('openingBalances.unpost', { params: { id: doc?.id ?? '' } }),
    onSuccess: (draftDoc) => {
      setDoc(draftDoc);
      setDraft(fromDocument(draftDoc));
      setUnposting(false);
      void invalidate();
    },
  });
  const fieldErrors = apiFieldErrors(post.error ?? save.error);
  const serverError = (field: string) => {
    const code = fieldErrors.find((e) => e.field === field)?.code;
    if (code === undefined) return undefined;
    if (code === 'period_closed') return t('periodClosed');
    if (code === 'future') return t('dateFuture');
    if (code === 'too_old') return t('dateTooOld');
    if (code === 'above_max_price') return t('aboveMax');
    if (code === 'product_archived') return t('productArchived');
    return tDocs('checkValue');
  };
  const error = useApiErrorMessage(save.error ?? post.error);

  const setLine = (key: string, change: (line: Line) => Line) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.key === key ? change(line) : line,
      ),
    }));
  const addProduct = (product: StockProductOption) =>
    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: `${product.id}-${Date.now()}`,
          productId: product.id,
          productName: product.name,
          batchNumber: '',
          expiresOn: '',
          quantity: 1,
          costMinor: 0,
          retailPriceMinor: null,
          starting: false,
        },
      ],
    }));

  const problems = draft.lines.map((line) => ({
    expires: !line.expiresOn,
    quantity: line.quantity < 1,
  }));
  const valid =
    draft.lines.length > 0 && problems.every((p) => !p.expires && !p.quantity);
  const total = draft.lines.reduce(
    (sum, l) => sum + l.quantity * l.costMinor,
    0,
  );

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={doc ? t('title', { number: doc.number }) : t('newTitle')}
        description={t('hint')}
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
                  disabled={!draft.storeId}
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
          {doc && <DocumentStatusPill status={doc.status} />}
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <div className="grid grid-cols-3 gap-4">
            <Select
              label={t('store')}
              disabled={!editable || doc !== null}
              value={draft.storeId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  storeId: event.target.value,
                }))
              }
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
              value={draft.date}
              error={serverError('date')}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  date: event.target.value,
                }))
              }
            />
            <TextField
              label={t('comment')}
              disabled={!editable}
              value={draft.comment}
              maxLength={500}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  comment: event.target.value,
                }))
              }
            />
          </div>

          <section
            aria-labelledby="ob-lines-title"
            className="flex flex-col gap-3"
          >
            <h3 id="ob-lines-title" className="text-md font-bold">
              {t('lines')}
            </h3>
            {editable && draft.storeId && (
              <ProductSearch storeId={draft.storeId} onPick={addProduct} />
            )}
            {touched && draft.lines.length === 0 && (
              <Alert tone="warning">{t('linesRequired')}</Alert>
            )}
            {draft.lines.length === 0 ? (
              <EmptyState icon="inbox" title={t('empty')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-(--ph-size-table-lg) border-collapse text-sm">
                  <caption className="ph-visually-hidden">{t('lines')}</caption>
                  <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
                    <tr>
                      {(
                        [
                          'product',
                          'batch',
                          'expires',
                          'quantity',
                          'cost',
                          'retail',
                          'starting',
                        ] as const
                      ).map((key) => (
                        <th
                          key={key}
                          scope="col"
                          className="px-2 py-2 text-start font-medium"
                        >
                          {t(`columns.${key}`)}
                        </th>
                      ))}
                      <th scope="col">
                        <span className="ph-visually-hidden">
                          {tDocs('actions')}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((line, index) => {
                      const p = problems[index];
                      const lineError =
                        serverError(`lines.${index}.retailPriceMinor`) ??
                        serverError(`lines.${index}.productId`);
                      return (
                        <tr
                          key={line.key}
                          className="border-b border-border align-top"
                        >
                          <td className="px-2 py-2">
                            <span className="font-medium">
                              {line.productName}
                            </span>
                            {lineError && (
                              <span
                                role="alert"
                                className="block text-xs text-danger"
                              >
                                {lineError}
                              </span>
                            )}
                          </td>
                          <td className="w-cell-md px-2 py-2">
                            <TextField
                              label={t('batchOf', { name: line.productName })}
                              hideLabel
                              disabled={!editable}
                              value={line.batchNumber}
                              maxLength={60}
                              onChange={(event) =>
                                setLine(line.key, (l) => ({
                                  ...l,
                                  batchNumber: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td className="w-cell-lg px-2 py-2">
                            <TextField
                              label={t('expiresOf', { name: line.productName })}
                              hideLabel
                              type="date"
                              disabled={!editable}
                              value={line.expiresOn}
                              error={
                                touched && p.expires
                                  ? t('expiresRequired')
                                  : undefined
                              }
                              onChange={(event) =>
                                setLine(line.key, (l) => ({
                                  ...l,
                                  expiresOn: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td className="w-cell-sm px-2 py-2">
                            <QuantityInput
                              label={t('quantityOf', {
                                name: line.productName,
                              })}
                              disabled={!editable}
                              value={line.quantity}
                              invalid={
                                touched && p.quantity
                                  ? t('quantityRequired')
                                  : undefined
                              }
                              onChange={(value) =>
                                setLine(line.key, (l) => ({
                                  ...l,
                                  quantity: value ?? 0,
                                }))
                              }
                            />
                          </td>
                          <td className="w-cell-md px-2 py-2">
                            <MoneyInput
                              label={t('costOf', { name: line.productName })}
                              disabled={!editable}
                              valueMinor={line.costMinor}
                              invalidText={tDocs('amountFormat')}
                              onChange={(costMinor) =>
                                setLine(line.key, (l) => ({ ...l, costMinor }))
                              }
                            />
                          </td>
                          <td className="w-cell-md px-2 py-2">
                            <MoneyInput
                              label={t('retailOf', { name: line.productName })}
                              disabled={!editable}
                              valueMinor={line.retailPriceMinor ?? 0}
                              invalidText={tDocs('amountFormat')}
                              allowEmpty
                              onChange={(retail) =>
                                setLine(line.key, (l) => ({
                                  ...l,
                                  retailPriceMinor: retail > 0 ? retail : null,
                                }))
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Checkbox
                              label={
                                <span className="ph-visually-hidden">
                                  {t('startingOf', { name: line.productName })}
                                </span>
                              }
                              disabled={!editable}
                              checked={line.starting}
                              onChange={(event) =>
                                setLine(line.key, (l) => ({
                                  ...l,
                                  starting: event.target.checked,
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-2">
                            {editable && (
                              <IconButton
                                icon="trash-2"
                                label={tDocs('removeLine', {
                                  name: line.productName,
                                })}
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    lines: current.lines.filter(
                                      (l) => l.key !== line.key,
                                    ),
                                  }))
                                }
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="flex justify-end gap-2 text-md">
              <span>{t('total')}</span>
              <b className="tabular-nums">{formatMoney(total)}</b>
            </p>
            <p className="text-xs text-fg-subtle">{t('retailHint')}</p>
          </section>
        </div>
      </Dialog>
      {doc && (
        <UnpostDialog
          kind="opening-balances"
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
