'use client';

import {
  markupOf,
  priceDeviation,
  suggestRetail,
} from '@pharmacy/shared-domain';
import type {
  GoodsReceipt,
  GoodsReceiptInput,
  StockProductOption,
} from '@pharmacy/shared-dto';
import { formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Select,
  Spinner,
  TextField,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { DocumentStatusPill } from '@/entities/stock-document';
import {
  MoneyInput,
  ProductSearch,
  QuantityInput,
  UnpostDialog,
  type StockAccess,
} from '@/features/stock-document';
import {
  apiFieldErrors,
  apiRequest,
  isApiRouteAvailable,
  sameTransport,
  useApiErrorMessage,
} from '@/shared/api';

type Line = GoodsReceiptInput['lines'][number] & {
  key: string;
  productName: string;
  /** The manager typed the retail price: it is no longer recomputed from the cost. */
  retailTouched: boolean;
};

interface Draft extends Omit<GoodsReceiptInput, 'lines'> {
  lines: Line[];
}

function fromDocument(doc: GoodsReceipt): Draft {
  return {
    date: doc.date,
    supplierId: doc.supplierId,
    storeId: doc.storeId,
    orderId: doc.orderId,
    invoiceNumber: doc.invoiceNumber,
    paymentDueOn: doc.paymentDueOn,
    lines: doc.lines.map((line, index) => ({
      ...line,
      key: `${line.productId}-${index}`,
      retailTouched: true,
    })),
  };
}

function lineProblems(line: Line, today: string) {
  return {
    batch: line.batchNumber.trim() === '',
    expires: !line.expiresOn || line.expiresOn <= today,
    quantity: line.quantity < 1,
    cost: line.costMinor <= 0,
  };
}

/** A new receipt opened from a purchase order («Оформить приход»): its lines are filled once loaded. */
export interface GoodsReceiptPrefill {
  supplierId: string;
  storeId: string;
  orderId: string;
}

/**
 * Goods receipt (UI mockup «Приход»): one supplier and one invoice; lines with batch, expiry,
 * quantity, ordered vs actual price; the retail price is proposed by the markup as a draft.
 */
export function GoodsReceiptEditor({
  document,
  prefill,
  access,
  onClose,
}: {
  /** null — a new document. */
  document: GoodsReceipt | null;
  prefill?: GoodsReceiptPrefill;
  access: StockAccess;
  onClose: () => void;
}) {
  const t = useTranslations('goodsReceipts.editor');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [doc, setDoc] = useState<GoodsReceipt | null>(document);
  const [draft, setDraft] = useState<Draft>(() =>
    document
      ? fromDocument(document)
      : {
          date: today,
          supplierId: prefill?.supplierId ?? '',
          storeId: prefill?.storeId ?? access.writableStores[0]?.id ?? '',
          orderId: prefill?.orderId ?? null,
          invoiceNumber: '',
          // empty — the API takes the payment delay of the supplier
          paymentDueOn: null,
          lines: [],
        },
  );
  const [touched, setTouched] = useState(false);
  const [prefilled, setPrefilled] = useState(!prefill);
  const [unposting, setUnposting] = useState(false);
  const editable = (!doc || doc.status === 'draft') && access.canUpdate;

  const suppliers = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: ({ signal }) => apiRequest('suppliers.options', { signal }),
  });
  // an order of the mocks is unknown to a receipt of apps/api (partial mode until purchasing)
  const ordersAvailable =
    isApiRouteAvailable('purchaseOrders.open') &&
    sameTransport('purchaseOrders.open', 'goodsReceipts.create');
  const orders = useQuery({
    queryKey: ['purchase-orders', 'open', draft.supplierId],
    queryFn: ({ signal }) =>
      apiRequest('purchaseOrders.open', {
        query: { supplierId: draft.supplierId },
        signal,
      }),
    enabled: Boolean(draft.supplierId) && ordersAvailable,
  });
  const productList = useQuery({
    queryKey: ['stock-products', draft.storeId, 'all'],
    queryFn: ({ signal }) =>
      apiRequest('stock.products', {
        params: { storeId: draft.storeId },
        query: { limit: 500 },
        signal,
      }),
    enabled: Boolean(draft.storeId),
  });
  const productsById = useMemo(
    () => new Map((productList.data ?? []).map((p) => [p.id, p])),
    [productList.data],
  );
  const order = orders.data?.find((o) => o.id === draft.orderId) ?? null;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['goods-receipts'] }),
      queryClient.invalidateQueries({ queryKey: ['stock'] }),
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
    ]);

  const input = (): GoodsReceiptInput => ({
    ...draft,
    lines: draft.lines.map(
      ({ key: _k, productName: _n, retailTouched: _r, ...line }) => line,
    ),
  });
  const save = useMutation({
    mutationFn: async () =>
      doc
        ? apiRequest('goodsReceipts.update', {
            params: { id: doc.id },
            body: input(),
          })
        : apiRequest('goodsReceipts.create', { body: input() }),
    onSuccess: (saved) => {
      setDoc(saved);
      void invalidate();
    },
  });
  const post = useMutation({
    mutationFn: async () => {
      const saved = doc
        ? await apiRequest('goodsReceipts.update', {
            params: { id: doc.id },
            body: input(),
          })
        : await apiRequest('goodsReceipts.create', { body: input() });
      // a rejected posting leaves the saved draft: a retry updates it, not a new one
      setDoc(saved);
      return apiRequest('goodsReceipts.post', { params: { id: saved.id } });
    },
    onSuccess: (posted) => {
      setDoc(posted);
      void invalidate();
    },
  });
  const unpost = useMutation({
    mutationFn: () =>
      apiRequest('goodsReceipts.unpost', { params: { id: doc?.id ?? '' } }),
    onSuccess: (draftDoc) => {
      setDoc(draftDoc);
      setDraft(fromDocument(draftDoc));
      setUnposting(false);
      void invalidate();
    },
  });
  const fieldErrors = apiFieldErrors(post.error ?? save.error);
  /** Text of a rejected field of the last save or posting, at the field itself. */
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

  // without a markup the proposal is the current price of the store, else the cost itself
  const retailOf = (product: StockProductOption | undefined, cost: number) =>
    product && product.markupPercent !== null
      ? suggestRetail(cost, product.markupPercent)
      : (product?.retailPriceMinor ?? cost);

  const setLine = (key: string, change: (line: Line) => Line) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.key === key ? change(line) : line,
      ),
    }));

  const addProduct = (product: StockProductOption) => {
    const orderLine = order?.lines.find((l) => l.productId === product.id);
    const lastCost =
      orderLine?.priceMinor ??
      [...product.batches].reverse().find((b) => b.costMinor !== undefined)
        ?.costMinor ??
      0;
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
          quantity: orderLine
            ? orderLine.quantity - orderLine.receivedQuantity
            : 1,
          orderPriceMinor: orderLine?.priceMinor ?? null,
          costMinor: lastCost,
          retailPriceMinor: lastCost
            ? retailOf(product, lastCost)
            : (product.retailPriceMinor ?? 0),
          retailTouched: false,
        },
      ],
    }));
  };

  const fillFromOrder = () => {
    if (!order) return;
    setDraft((current) => ({
      ...current,
      lines: order.lines
        .filter((l) => l.quantity > l.receivedQuantity)
        .map((l) => ({
          key: `${l.productId}-${Date.now()}`,
          productId: l.productId,
          productName: l.productName,
          batchNumber: '',
          expiresOn: '',
          quantity: l.quantity - l.receivedQuantity,
          orderPriceMinor: l.priceMinor,
          costMinor: l.priceMinor,
          retailPriceMinor: retailOf(
            productsById.get(l.productId),
            l.priceMinor,
          ),
          retailTouched: false,
        })),
    }));
  };

  // opened from an order: its remaining lines once the order and the products are loaded
  if (!prefilled && order && productList.data) {
    setPrefilled(true);
    fillFromOrder();
  }

  const problems = draft.lines.map((line) => lineProblems(line, today));
  const headerInvalid = {
    supplier: !draft.supplierId,
    invoice: draft.invoiceNumber.trim() === '',
    lines: draft.lines.length === 0,
  };
  const valid =
    !headerInvalid.supplier &&
    !headerInvalid.invoice &&
    !headerInvalid.lines &&
    problems.every((p) => !p.batch && !p.expires && !p.quantity && !p.cost);
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
        description={
          doc?.orderNumber
            ? t('byOrder', { order: doc.orderNumber })
            : undefined
        }
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
                  disabled={headerInvalid.supplier}
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
          <div className="grid grid-cols-3 gap-4">
            <Select
              label={t('supplier')}
              required
              disabled={!editable}
              value={draft.supplierId}
              placeholder={t('supplierPlaceholder')}
              error={
                touched && headerInvalid.supplier
                  ? t('supplierRequired')
                  : undefined
              }
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  supplierId: event.target.value,
                  orderId: null,
                }))
              }
              options={(suppliers.data ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            />
            <Select
              label={t('store')}
              disabled={!editable}
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
            {ordersAvailable && (
              <Select
                label={t('order')}
                disabled={!editable || !draft.supplierId}
                value={draft.orderId ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    orderId: event.target.value || null,
                  }))
                }
                options={[
                  { value: '', label: t('noOrder') },
                  ...(orders.data ?? []).map((o) => ({
                    value: o.id,
                    label: `${o.number}${o.status === 'partially_received' ? ` (${t('partial')})` : ''}`,
                  })),
                ]}
              />
            )}
            <TextField
              label={t('invoice')}
              required
              disabled={!editable}
              value={draft.invoiceNumber}
              error={
                touched && headerInvalid.invoice
                  ? t('invoiceRequired')
                  : undefined
              }
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  invoiceNumber: event.target.value,
                }))
              }
            />
            <TextField
              label={t('paymentDue')}
              type="date"
              disabled={!editable}
              value={draft.paymentDueOn ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  paymentDueOn: event.target.value || null,
                }))
              }
            />
          </div>

          <section
            aria-labelledby="lines-title"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h3 id="lines-title" className="text-md font-bold">
                {t('lines', { count: draft.lines.length })}
              </h3>
              {editable && order && (
                <Button
                  variant="tertiary"
                  iconStart="clipboard-list"
                  onClick={fillFromOrder}
                >
                  {t('fillFromOrder', { order: order.number })}
                </Button>
              )}
            </div>
            {editable && draft.storeId && (
              <ProductSearch storeId={draft.storeId} onPick={addProduct} />
            )}
            {touched && headerInvalid.lines && (
              <Alert tone="warning">{t('linesRequired')}</Alert>
            )}
            {productList.isPending && draft.lines.length > 0 ? (
              <Spinner size="md" label={tDocs('loading')} />
            ) : draft.lines.length === 0 ? (
              <EmptyState
                icon="inbox"
                title={t('empty')}
                description={t('emptyHint')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-(--ph-size-table-lg) border-collapse text-sm">
                  <caption className="ph-visually-hidden">
                    {t('linesCaption')}
                  </caption>
                  <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
                    <tr>
                      {(
                        [
                          'product',
                          'batch',
                          'expires',
                          'quantity',
                          'orderPrice',
                          'cost',
                          'sum',
                          'retail',
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
                      const deviation = priceDeviation(
                        line.orderPriceMinor,
                        line.costMinor,
                      );
                      const markup = markupOf(
                        line.costMinor,
                        line.retailPriceMinor,
                      );
                      const product = productsById.get(line.productId);
                      return (
                        <tr
                          key={line.key}
                          className="border-b border-border align-top"
                        >
                          <td className="px-2 py-2">
                            <span className="font-medium">
                              {line.productName}
                            </span>
                            {serverError(`lines.${index}.productId`) && (
                              <span
                                role="alert"
                                className="block text-xs text-danger"
                              >
                                {serverError(`lines.${index}.productId`)}
                              </span>
                            )}
                            {deviation !== null && deviation !== 0 && (
                              <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                                {t('priceDiff', {
                                  percent:
                                    deviation > 0 ? `+${deviation}` : deviation,
                                })}
                              </span>
                            )}
                          </td>
                          <td className="w-cell-md px-2 py-2">
                            <TextField
                              label={t('batchOf', { name: line.productName })}
                              hideLabel
                              disabled={!editable}
                              value={line.batchNumber}
                              error={
                                touched && p.batch
                                  ? t('batchRequired')
                                  : undefined
                              }
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
                              min={today}
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
                          <td className="px-2 py-3 tabular-nums text-fg-muted">
                            {line.orderPriceMinor !== null
                              ? formatMoney(line.orderPriceMinor, {
                                  withSign: false,
                                })
                              : '—'}
                          </td>
                          <td className="w-cell-md px-2 py-2">
                            <MoneyInput
                              label={t('costOf', { name: line.productName })}
                              disabled={!editable}
                              valueMinor={line.costMinor}
                              invalidText={tDocs('amountFormat')}
                              onChange={(costMinor) =>
                                setLine(line.key, (l) => ({
                                  ...l,
                                  costMinor,
                                  retailPriceMinor: l.retailTouched
                                    ? l.retailPriceMinor
                                    : retailOf(product, costMinor),
                                }))
                              }
                            />
                          </td>
                          <td className="px-2 py-3 text-end tabular-nums">
                            {formatMoney(line.quantity * line.costMinor, {
                              withSign: false,
                            })}
                          </td>
                          <td className="w-cell-md px-2 py-2">
                            <MoneyInput
                              label={t('retailOf', { name: line.productName })}
                              disabled={!editable}
                              valueMinor={line.retailPriceMinor}
                              invalidText={tDocs('amountFormat')}
                              onChange={(retailPriceMinor) =>
                                setLine(line.key, (l) => ({
                                  ...l,
                                  retailPriceMinor,
                                  retailTouched: true,
                                }))
                              }
                            />
                            {markup !== null && (
                              <span className="text-xs text-fg-subtle">
                                {t('markup', { percent: markup })}
                              </span>
                            )}
                            {(serverError(`lines.${index}.retailPriceMinor`) ??
                              (product?.maxPriceMinor != null &&
                              line.retailPriceMinor > product.maxPriceMinor
                                ? t('aboveMax')
                                : undefined)) && (
                              <span
                                role="alert"
                                className="block text-xs text-warning"
                              >
                                {serverError(
                                  `lines.${index}.retailPriceMinor`,
                                ) ?? t('aboveMax')}
                              </span>
                            )}
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
            <p className="text-xs text-fg-subtle">{t('oneSupplierHint')}</p>
          </section>
        </div>
      </Dialog>
      {doc && (
        <UnpostDialog
          kind="goods-receipts"
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
