'use client';

import type {
  PurchaseOrder,
  PurchaseOrderInput,
  StockProductOption,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Select,
  TextField,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { OrderStatusPill } from '@/entities/purchasing';
import {
  MoneyInput,
  ProductSearch,
  QuantityInput,
} from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

interface Line {
  key: string;
  productId: string;
  productName: string;
  quantity: number;
  priceMinor: number;
  receivedQuantity: number;
  /** From «заполнить по дефициту»: stock, minimum and consumption for the hint. */
  deficit?: { stockPacks: number; minPacks: number; sales30Packs: number };
}

interface Draft extends Omit<PurchaseOrderInput, 'lines'> {
  lines: Line[];
}

export interface OrderAccess {
  canCreate: boolean;
  canUpdate: boolean;
  canConfirm: boolean;
}

const plusDays = (days: number) =>
  toAppDate(new Date(Date.now() + days * 86_400_000));

function fromOrder(order: PurchaseOrder): Draft {
  return {
    supplierId: order.supplierId,
    storeId: order.storeId,
    expectedOn: order.expectedOn,
    comment: order.comment,
    lines: order.lines.map((line) => ({ ...line, key: line.productId })),
  };
}

/**
 * Purchase order (UI mockup «Новый заказ»): supplier, receiving store, expected delivery, lines in
 * packs with the order price; «заполнить по дефициту» proposes products below the minimum.
 */
export function OrderEditor({
  order,
  access,
  onClose,
  onReceive,
}: {
  /** null — a new order. */
  order: PurchaseOrder | null;
  access: OrderAccess;
  onClose: () => void;
  onReceive: (order: PurchaseOrder) => void;
}) {
  const t = useTranslations('orders.editor');
  const tOrders = useTranslations('orders');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [doc, setDoc] = useState<PurchaseOrder | null>(order);
  const [draft, setDraft] = useState<Draft>(() =>
    order
      ? fromOrder(order)
      : {
          supplierId: '',
          storeId: session?.currentStoreId ?? session?.stores[0]?.id ?? '',
          expectedOn: plusDays(7),
          comment: '',
          lines: [],
        },
  );
  const [touched, setTouched] = useState(false);
  const [deficitNotice, setDeficitNotice] = useState<number | null>(null);
  const editable =
    (!doc || doc.status === 'draft') &&
    (doc ? access.canUpdate : access.canCreate);

  const suppliers = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: ({ signal }) => apiRequest('suppliers.options', { signal }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  const input = (): PurchaseOrderInput => ({
    ...draft,
    lines: draft.lines.map(({ productId, quantity, priceMinor }) => ({
      productId,
      quantity,
      priceMinor,
    })),
  });
  const persist = () =>
    doc
      ? apiRequest('purchaseOrders.update', {
          params: { id: doc.id },
          body: input(),
        })
      : apiRequest('purchaseOrders.create', { body: input() });
  const save = useMutation({
    mutationFn: persist,
    onSuccess: (saved) => {
      setDoc(saved);
      void invalidate();
    },
  });
  const confirm = useMutation({
    mutationFn: async () => {
      const saved = await persist();
      return apiRequest('purchaseOrders.confirm', { params: { id: saved.id } });
    },
    onSuccess: (confirmed) => {
      setDoc(confirmed);
      void invalidate();
    },
  });
  const deficit = useMutation({
    mutationFn: () =>
      apiRequest('purchaseOrders.deficit', {
        query: {
          storeId: draft.storeId,
          supplierId: draft.supplierId || undefined,
        },
      }),
    onSuccess: (lines) => {
      const known = new Set(draft.lines.map((l) => l.productId));
      const added = lines.filter((l) => !known.has(l.productId));
      setDeficitNotice(added.length);
      setDraft((current) => ({
        ...current,
        lines: [
          ...current.lines,
          ...added.map((l) => ({
            key: l.productId,
            productId: l.productId,
            productName: l.productName,
            quantity: l.quantity,
            priceMinor: l.priceMinor,
            receivedQuantity: 0,
            deficit: {
              stockPacks: l.stockPacks,
              minPacks: l.minPacks,
              sales30Packs: l.sales30Packs,
            },
          })),
        ],
      }));
    },
  });
  const error = useApiErrorMessage(
    save.error ?? confirm.error ?? deficit.error,
  );

  const addProduct = (product: StockProductOption) => {
    if (draft.lines.some((l) => l.productId === product.id)) return;
    const lastCost =
      [...product.batches].reverse().find((b) => b.costMinor !== undefined)
        ?.costMinor ?? 0;
    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: product.id,
          productId: product.id,
          productName: product.name,
          quantity: 1,
          priceMinor: lastCost,
          receivedQuantity: 0,
        },
      ],
    }));
  };
  const setLine = (key: string, change: (line: Line) => Line) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((l) => (l.key === key ? change(l) : l)),
    }));

  const invalid = {
    supplier: !draft.supplierId,
    lines: draft.lines.length === 0,
    quantity: draft.lines.some((l) => l.quantity < 1),
    price: draft.lines.some((l) => l.priceMinor <= 0),
  };
  const valid =
    !invalid.supplier && !invalid.lines && !invalid.quantity && !invalid.price;
  const total = draft.lines.reduce((s, l) => s + l.quantity * l.priceMinor, 0);
  const receivable =
    doc?.status === 'confirmed' || doc?.status === 'partially_received';
  const columns = ['product', 'stock', 'quantity', 'price', 'sum'] as const;

  return (
    <Dialog
      open
      onClose={onClose}
      title={doc ? t('title', { number: doc.number }) : t('newTitle')}
      description={
        doc?.confirmedBy
          ? t('confirmedBy', {
              name: doc.confirmedBy.name,
              date: formatDateOnly(doc.confirmedBy.at.slice(0, 10)),
            })
          : undefined
      }
      closeLabel={tDocs('close')}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('close')}
          </Button>
          {editable && (
            <Button
              variant="secondary"
              loading={save.isPending}
              disabled={invalid.supplier}
              onClick={() => {
                setTouched(true);
                if (!invalid.supplier) save.mutate();
              }}
            >
              {tDocs('saveDraft')}
            </Button>
          )}
          {editable && access.canConfirm && (
            <Button
              iconStart="check"
              loading={confirm.isPending}
              onClick={() => {
                setTouched(true);
                if (valid) confirm.mutate();
              }}
            >
              {t('confirm')}
            </Button>
          )}
          {doc && receivable && (
            <Button iconStart="inbox" onClick={() => onReceive(doc)}>
              {tOrders('receive')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <OrderStatusPill status={doc?.status ?? 'draft'} />
          {doc && doc.status !== 'draft' && (
            <span className="text-xs text-fg-subtle">
              {tOrders('received', { percent: doc.receivedPercent })}
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
              touched && invalid.supplier ? t('supplierRequired') : undefined
            }
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                supplierId: event.target.value,
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
            options={(session?.stores ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <TextField
            label={t('expectedOn')}
            type="date"
            min={toAppDate()}
            disabled={!editable}
            value={draft.expectedOn ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                expectedOn: event.target.value || null,
              }))
            }
          />
        </div>

        <section aria-labelledby="order-lines" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="order-lines" className="text-md font-bold">
              {t('lines', { count: draft.lines.length })}
            </h3>
            {editable && (
              <Button
                variant="tertiary"
                iconStart="calculator"
                loading={deficit.isPending}
                disabled={!draft.storeId}
                onClick={() => deficit.mutate()}
              >
                {t('fillFromDeficit')}
              </Button>
            )}
          </div>
          {editable && (
            <p className="text-xs text-fg-subtle">{t('deficitHint')}</p>
          )}
          {deficitNotice !== null && (
            <Alert tone={deficitNotice > 0 ? 'info' : 'success'} live="polite">
              {deficitNotice > 0
                ? t('deficitAdded', { count: deficitNotice })
                : t('deficitNone')}
            </Alert>
          )}
          {editable && draft.storeId && (
            <ProductSearch storeId={draft.storeId} onPick={addProduct} />
          )}
          {touched && invalid.lines && (
            <Alert tone="warning">{t('linesRequired')}</Alert>
          )}
          {touched && invalid.price && (
            <Alert tone="warning">{t('pricesRequired')}</Alert>
          )}
          {draft.lines.length === 0 ? (
            <EmptyState
              icon="clipboard-list"
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
                    {columns.map((key) => (
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
                  {draft.lines.map((line) => (
                    <tr
                      key={line.key}
                      className="border-b border-border align-top"
                    >
                      <td className="px-2 py-2 font-medium">
                        {line.productName}
                        {!editable && line.receivedQuantity > 0 && (
                          <span className="mt-1 block text-xs font-normal text-fg-subtle">
                            {t('receivedOf', {
                              received: line.receivedQuantity,
                              ordered: line.quantity,
                            })}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-xs text-fg-muted">
                        {line.deficit ? t('deficitLine', line.deficit) : '—'}
                      </td>
                      <td className="w-cell-sm px-2 py-2">
                        <QuantityInput
                          label={t('quantityOf', { name: line.productName })}
                          disabled={!editable}
                          value={line.quantity}
                          invalid={
                            touched && line.quantity < 1
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
                          label={t('priceOf', { name: line.productName })}
                          disabled={!editable}
                          valueMinor={line.priceMinor}
                          invalidText={tDocs('amountFormat')}
                          onChange={(priceMinor) =>
                            setLine(line.key, (l) => ({ ...l, priceMinor }))
                          }
                        />
                      </td>
                      <td className="px-2 py-3 text-end tabular-nums">
                        {formatMoney(line.quantity * line.priceMinor, {
                          withSign: false,
                        })}
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="flex justify-end gap-2 text-md">
            <span>{t('total')}</span>
            <b className="tabular-nums">{formatMoney(total)}</b>
          </p>
        </section>
        <TextField
          label={t('comment')}
          placeholder={t('commentPlaceholder')}
          disabled={!editable}
          value={draft.comment}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              comment: event.target.value,
            }))
          }
        />
        <p className="text-xs text-fg-subtle">{t('sendHint')}</p>
      </div>
    </Dialog>
  );
}
