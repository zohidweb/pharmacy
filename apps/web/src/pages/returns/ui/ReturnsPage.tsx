'use client';

import type {
  ReturnableLine,
  ReturnableReceipt,
  ReturnReason,
  SaleSearchItem,
} from '@pharmacy/shared-dto';
import {
  formatDateTime,
  formatMoney,
  toAppDate,
  uuidv7,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  EmptyState,
  Pagination,
  Select,
  StatusPill,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useCatalog } from '@/entities/catalog';
import { can, canWrite, currentStoreOf, useSession } from '@/entities/session';
import { shiftQueryKey, useCurrentShift } from '@/entities/shift';
import { useTerminalRuntime } from '@/entities/terminal';
import {
  ApiError,
  apiRequest,
  isOnline,
  subscribeConnectivity,
  useApiErrorMessage,
} from '@/shared/api';
import { useBarcodeScanner } from '@/shared/lib/scanner';
import { PageHeader } from '@/widgets/app-shell';
import {
  refundOf,
  refundPayments,
  type ReturnQuantities,
} from '../lib/refund';
import { WithMessages } from '@/shared/i18n';

const PAGE = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Lookup = { number?: string; id?: string; productId?: string };

/** The policy of the network closes the kind for a return at the customer's wish (R3). */
const closedByPolicy = (line: ReturnableLine, reason: ReturnReason) =>
  reason === 'customer' && !line.customerReturnAllowed;

/** A defect and an expired batch are written off by the return (E9). */
const writtenOff = (line: ReturnableLine, reason: ReturnReason) =>
  reason === 'defect' || line.batchExpired;

function ReceiptLines({
  receipt,
  quantities,
  reason,
  onChange,
}: {
  receipt: ReturnableReceipt;
  quantities: ReturnQuantities;
  reason: ReturnReason;
  onChange: (lineId: string, quantity: number) => void;
}) {
  const t = useTranslations('returns');
  const tPos = useTranslations('pos');
  const left = (line: ReturnableLine) => line.quantity - line.returnedQuantity;
  return (
    <DataTable
      caption={t('lines')}
      minWidth="none"
      rowKey={(line) => line.lineId}
      rows={receipt.lines}
      rowVariant={(line) => (left(line) === 0 ? 'muted' : 'default')}
      columns={[
        {
          key: 'pick',
          header: <span className="ph-visually-hidden">{t('pick')}</span>,
          cell: (line) => (
            <Checkbox
              label={
                <span className="ph-visually-hidden">
                  {t('pickLine', { name: line.productName })}
                </span>
              }
              disabled={left(line) === 0 || closedByPolicy(line, reason)}
              checked={(quantities[line.lineId] ?? 0) > 0}
              onChange={(event) =>
                onChange(line.lineId, event.target.checked ? 1 : 0)
              }
            />
          ),
        },
        {
          key: 'product',
          header: t('product'),
          cell: (line) => (
            <span className="flex flex-col gap-1">
              <span className="font-medium">{line.productName}</span>
              {closedByPolicy(line, reason) && (
                <span className="text-xs text-fg-subtle">
                  {t('notAllowedKind')}
                </span>
              )}
              {left(line) > 0 &&
                !closedByPolicy(line, reason) &&
                writtenOff(line, reason) && (
                  <StatusPill tone="warning" icon="triangle-alert">
                    {t('writtenOff')}
                  </StatusPill>
                )}
            </span>
          ),
        },
        { key: 'batch', header: t('batch'), cell: (line) => line.batchNumber },
        {
          key: 'sold',
          header: t('sold'),
          numeric: true,
          cell: (line) =>
            `${line.quantity} ${tPos(`units.${line.unit}`)}${
              line.returnedQuantity
                ? ` · ${t('alreadyReturned', { count: line.returnedQuantity })}`
                : ''
            }`,
        },
        {
          key: 'qty',
          header: t('returnQty'),
          cell: (line) =>
            (quantities[line.lineId] ?? 0) > 0 ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t('decrease', { name: line.productName })}
                  onClick={() =>
                    onChange(line.lineId, (quantities[line.lineId] ?? 0) - 1)
                  }
                  className="grid min-h-touch min-w-touch place-items-center rounded-md border border-border"
                >
                  −
                </button>
                <output
                  aria-label={t('qtyOf', { name: line.productName })}
                  className="min-w-touch text-center font-bold tabular-nums"
                >
                  {quantities[line.lineId]}
                </output>
                <button
                  type="button"
                  aria-label={t('increase', { name: line.productName })}
                  disabled={(quantities[line.lineId] ?? 0) >= left(line)}
                  onClick={() =>
                    onChange(line.lineId, (quantities[line.lineId] ?? 0) + 1)
                  }
                  className="grid min-h-touch min-w-touch place-items-center rounded-md border border-border disabled:text-on-disabled"
                >
                  +
                </button>
              </span>
            ) : (
              '—'
            ),
        },
        {
          key: 'sum',
          header: t('sum'),
          numeric: true,
          nowrap: true,
          cell: (line) =>
            formatMoney(
              (quantities[line.lineId] || line.quantity) * line.unitPriceMinor,
            ),
        },
      ]}
    />
  );
}

function Journal() {
  const t = useTranslations('returns');
  const tPos = useTranslations('pos');
  const [reason, setReason] = useState<ReturnReason | ''>('');
  const [offset, setOffset] = useState(0);
  const list = useQuery({
    queryKey: ['returns', reason, offset],
    queryFn: ({ signal }) =>
      apiRequest('returns.list', {
        query: { reason: reason || undefined, limit: PAGE, offset },
        signal,
      }),
  });
  return (
    <Card padding="none">
      <CardHeader
        title={t('journal')}
        inset
        actions={
          <Select
            label={t('reasonFilter')}
            hideLabel
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as ReturnReason | '');
              setOffset(0);
            }}
            options={[
              { value: '', label: t('allReasons') },
              { value: 'customer', label: t('reasons.customer') },
              { value: 'defect', label: t('reasons.defect') },
            ]}
          />
        }
      />
      <DataTable
        caption={t('journal')}
        rowKey={(row) => row.id}
        rows={list.data?.items ?? []}
        empty={<EmptyState icon="undo-2" title={t('journalEmpty')} />}
        columns={[
          { key: 'number', header: '№', cell: (r) => <b>{r.number}</b> },
          {
            key: 'at',
            header: t('date'),
            nowrap: true,
            cell: (r) => formatDateTime(r.at),
          },
          { key: 'store', header: t('store'), cell: (r) => r.storeName },
          {
            key: 'receipt',
            header: t('receipt'),
            cell: (r) => `№${r.receiptNumber}`,
          },
          { key: 'summary', header: t('product'), cell: (r) => r.summary },
          {
            key: 'reason',
            header: t('reason'),
            cell: (r) => t(`reasons.${r.reason}`),
          },
          {
            key: 'refund',
            header: t('refund'),
            numeric: true,
            nowrap: true,
            cell: (r) => formatMoney(r.refundMinor),
          },
          {
            key: 'method',
            header: t('method'),
            cell: (r) => r.methods.map((m) => tPos(`methods.${m}`)).join(', '),
          },
          { key: 'cashier', header: t('cashier'), cell: (r) => r.cashierName },
          {
            key: 'notes',
            header: t('notes'),
            cell: (r) => (
              <span className="flex flex-col gap-1">
                {r.foundWithoutReceipt && (
                  <StatusPill tone="attention">{t('withoutReceiptPill')}</StatusPill>
                )}
                {r.writeOffNumber && (
                  <span className="text-xs">
                    {t('writeOffRef', { number: r.writeOffNumber })}
                  </span>
                )}
              </span>
            ),
          },
        ]}
      />
      {list.data && list.data.total > PAGE && (
        <Pagination
          className="px-(--ph-card-padding) py-3"
          total={list.data.total}
          limit={PAGE}
          offset={offset}
          onOffsetChange={setOffset}
          labels={{
            nav: t('pagination'),
            previous: t('previous'),
            next: t('next'),
            range: (range) => t('shown', range),
          }}
        />
      )}
    </Card>
  );
}

/** Customer return (UI mockup «Возврат покупателя»); online only (ADR-0015). */
function ReturnsPageView() {
  const t = useTranslations('returns');
  const tPos = useTranslations('pos');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const storeId = currentStoreOf(session)?.id ?? null;
  // a return goes into the shift of the terminal (K6): no PIN session — no shift
  const shift = useCurrentShift(storeId, session?.terminalId != null);
  const online = useSyncExternalStore(
    subscribeConnectivity,
    isOnline,
    () => true,
  );
  const [number, setNumber] = useState('');
  const [product, setProduct] = useState('');
  const [date, setDate] = useState(toAppDate());
  const [receipt, setReceipt] = useState<ReturnableReceipt | null>(null);
  const [quantities, setQuantities] = useState<ReturnQuantities>({});
  const [reason, setReason] = useState<ReturnReason>('customer');
  // the product of the search when the sale was found without the receipt (R8)
  const [foundProductId, setFoundProductId] = useState<string | null>(null);
  // one key per return of the opened receipt: a repeat after a network error is the same return (E1)
  const returnKey = useRef<string | null>(null);
  const withoutReceipt = can(session, 'returns:without-receipt');
  const runtime = useTerminalRuntime();
  const windowDays =
    useCatalog(runtime, storeId).data?.snapshot.settings.returnWindowDays ??
    null;

  const lookup = useMutation({
    mutationFn: (query: Lookup) =>
      apiRequest('receipts.returnable', { query }),
    onSuccess: (found, query) => {
      setReceipt(found);
      setQuantities({});
      // every receipt starts at the customer's wish: a defect is chosen on purpose (it writes off)
      setReason('customer');
      setFoundProductId(query.productId ?? null);
      returnKey.current = null;
    },
  });
  const findByCode = (code: string) =>
    lookup.mutate(UUID.test(code) ? { id: code } : { number: code });
  const search = useMutation({
    mutationFn: () =>
      apiRequest('returns.salesSearch', { query: { query: product, date } }),
  });
  const create = useMutation({
    mutationFn: () => {
      if (!receipt || !session || !shift.data) throw new Error('not ready');
      const refund = refundOf(receipt, quantities);
      const lines = Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([lineId, quantity]) => ({ lineId, quantity }));
      returnKey.current ??= uuidv7();
      const id = returnKey.current;
      return apiRequest('returns.create', {
        idempotencyKey: id,
        body: {
          id,
          storeId: storeId ?? '',
          terminalId: session.terminalId,
          employeeId: session.employee.id,
          occurredAt: new Date().toISOString(),
          receiptId: receipt.id,
          shiftId: shift.data.id,
          lines,
          reason,
          refunds: refundPayments(receipt.payments, refund.refundMinor),
          refundMinor: refund.refundMinor,
          foundProductId,
        },
      });
    },
    onSuccess: (created) => {
      toast.show(
        created.writeOffNumber
          ? t('doneWithWriteOff', {
              number: created.number,
              amount: formatMoney(created.refundMinor),
              writeOff: created.writeOffNumber,
            })
          : t('done', {
              number: created.number,
              amount: formatMoney(created.refundMinor),
            }),
      );
      returnKey.current = null;
      setReceipt(null);
      setQuantities({});
      setReason('customer');
      setFoundProductId(null);
      setNumber('');
      void queryClient.invalidateQueries({ queryKey: ['returns'] });
      void queryClient.invalidateQueries({ queryKey: shiftQueryKey(storeId) });
    },
  });
  const lookupError =
    lookup.error instanceof ApiError &&
    lookup.error.code === 'return_window_expired'
      ? t('windowExpired')
      : lookup.error instanceof ApiError && lookup.error.status === 404
        ? t('notFound')
        : null;
  const lookupOther = useApiErrorMessage(lookupError ? null : lookup.error);
  const searchError = useApiErrorMessage(search.error);
  const createError = useApiErrorMessage(create.error);

  // a QR / barcode of the receipt is its number
  useBarcodeScanner(
    (code) => {
      setNumber(code);
      findByCode(code);
    },
    { minLength: 3, enabled: online },
  );

  const picked = Object.values(quantities).some((quantity) => quantity > 0);
  const refund = receipt && picked ? refundOf(receipt, quantities) : null;
  const payments =
    receipt && refund
      ? refundPayments(receipt.payments, refund.refundMinor)
      : [];
  const cashOut = payments.find((p) => p.method === 'cash')?.amountMinor ?? 0;
  // the drawer holds less cash than the return gives back: a warning only (R6)
  const cashShort =
    cashOut > 0 &&
    shift.data !== undefined &&
    shift.data !== null &&
    cashOut > shift.data.cash.expectedMinor;
  const willWriteOff =
    receipt?.lines.some(
      (line) =>
        (quantities[line.lineId] ?? 0) > 0 && writtenOff(line, reason),
    ) ?? false;
  const blocked = !online
    ? t('offline')
    : !shift.data
      ? t('noShift')
      : !canWrite(session, 'returns:create')
        ? t('readOnly')
        : null;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          windowDays === null ? undefined : t('subtitle', { days: windowDays })
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        {!online && <Alert tone="warning">{t('offline')}</Alert>}
        <Card
          as="section"
          aria-labelledby="find-title"
          className="flex flex-col gap-4"
        >
          <CardHeader title={t('find')} titleId="find-title" />
          <form
            className="grid grid-cols-(--ph-search-columns) items-end gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (number.trim()) findByCode(number.trim());
            }}
          >
            <TextField
              label={t('receiptNumber')}
              hint={t('receiptNumberHint')}
              inputMode="numeric"
              value={number}
              disabled={!online}
              onChange={(event) => setNumber(event.target.value)}
            />
            <Button
              type="submit"
              iconStart="search"
              loading={lookup.isPending}
              disabled={!online}
            >
              {t('findAction')}
            </Button>
          </form>
          {(lookupError ?? lookupOther) && (
            <Alert tone="danger" live="assertive">
              {lookupError ?? lookupOther}
            </Alert>
          )}
          {withoutReceipt ? (
            <form
              className="grid grid-cols-(--ph-search-columns-2) items-end gap-4 border-t border-border pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (product.trim()) search.mutate();
              }}
            >
              <TextField
                label={t('withoutReceipt')}
                hint={t('withoutReceiptHint')}
                value={product}
                disabled={!online}
                onChange={(event) => setProduct(event.target.value)}
              />
              <TextField
                label={t('date')}
                type="date"
                max={toAppDate()}
                value={date}
                disabled={!online}
                onChange={(event) => setDate(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                loading={search.isPending}
                disabled={!online}
              >
                {t('findSales')}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-fg-subtle">
              {t('noRightWithoutReceipt')}
            </p>
          )}
          {searchError && (
            <Alert tone="danger" live="assertive">
              {searchError}
            </Alert>
          )}
          {search.data && (
            <DataTable<SaleSearchItem>
              caption={t('salesFound')}
              minWidth="none"
              rowKey={(row) => `${row.receiptId}-${row.productId}`}
              rows={search.data}
              empty={<EmptyState icon="search" title={t('salesEmpty')} />}
              columns={[
                {
                  key: 'receipt',
                  header: t('receipt'),
                  cell: (r) => `№${r.receiptNumber}`,
                },
                {
                  key: 'at',
                  header: t('date'),
                  cell: (r) => formatDateTime(r.soldAt),
                },
                {
                  key: 'product',
                  header: t('product'),
                  cell: (r) => r.productName,
                },
                {
                  key: 'qty',
                  header: t('sold'),
                  numeric: true,
                  cell: (r) => `${r.quantity} ${tPos(`units.${r.unit}`)}`,
                },
                {
                  key: 'open',
                  header: (
                    <span className="ph-visually-hidden">{t('open')}</span>
                  ),
                  align: 'end',
                  cell: (r) => (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setNumber(r.receiptNumber);
                        lookup.mutate({
                          id: r.receiptId,
                          productId: r.productId,
                        });
                      }}
                    >
                      {t('open')}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>

        {receipt && (
          <div className="grid grid-cols-(--ph-return-columns) items-start gap-4">
            <Card padding="none">
              <CardHeader
                title={t('receiptTitle', {
                  number: receipt.number,
                  at: formatDateTime(receipt.soldAt),
                })}
                description={t('receiptMeta', {
                  store: receipt.storeName,
                  cashier: receipt.cashierName,
                })}
                actions={
                  <StatusPill
                    tone={receipt.daysLeft <= 2 ? 'warning' : 'info'}
                    icon="clock"
                  >
                    {t('daysLeft', { days: receipt.daysLeft })}
                  </StatusPill>
                }
                inset
              />
              {foundProductId && (
                <div className="px-(--ph-card-padding) pb-2">
                  <Alert tone="info">{t('foundWithoutReceipt')}</Alert>
                </div>
              )}
              <ReceiptLines
                receipt={receipt}
                quantities={quantities}
                reason={reason}
                onChange={(lineId, quantity) =>
                  setQuantities((current) => ({
                    ...current,
                    [lineId]: Math.max(0, quantity),
                  }))
                }
              />
              <div className="px-(--ph-card-padding) py-4">
                <Select
                  label={t('reason')}
                  value={reason}
                  onChange={(event) => {
                    const next = event.target.value as ReturnReason;
                    setReason(next);
                    // a kind closed for a return at the customer's wish leaves the return (R3)
                    setQuantities((current) =>
                      Object.fromEntries(
                        Object.entries(current).filter(([lineId]) => {
                          const line = receipt.lines.find(
                            (l) => l.lineId === lineId,
                          );
                          return line !== undefined && !closedByPolicy(line, next);
                        }),
                      ),
                    );
                  }}
                  options={[
                    { value: 'customer', label: t('reasons.customer') },
                    { value: 'defect', label: t('reasons.defect') },
                  ]}
                />
              </div>
            </Card>
            <Card
              as="section"
              aria-labelledby="calc-title"
              className="flex flex-col gap-3"
            >
              <CardHeader title={t('calc')} titleId="calc-title" />
              <dl className="m-0 flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt>{t('receiptTotal')}</dt>
                  <dd className="m-0 tabular-nums">
                    {formatMoney(receipt.subtotalMinor)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t('discountOfReceipt')}</dt>
                  <dd className="m-0 tabular-nums">
                    −{formatMoney(receipt.discountMinor)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t('returnAmount')}</dt>
                  <dd className="m-0 tabular-nums">
                    {formatMoney(refund?.amountMinor ?? 0)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t('discountShare')}</dt>
                  <dd className="m-0 tabular-nums">
                    −{formatMoney(refund?.discountMinor ?? 0)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-border pt-2">
                  <dt className="text-md font-bold">{t('toRefund')}</dt>
                  <dd className="m-0 text-2xl font-bold tabular-nums">
                    {formatMoney(refund?.refundMinor ?? 0)}
                  </dd>
                </div>
              </dl>
              {cashShort && (
                <Alert tone="warning">
                  {t('cashShort', {
                    amount: formatMoney(shift.data?.cash.expectedMinor ?? 0),
                  })}
                </Alert>
              )}
              {payments.length > 0 && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-fg-subtle">{t('refundMethod')}</span>
                  {payments.map((p) => (
                    <span key={p.method} className="flex justify-between">
                      <span>{tPos(`methods.${p.method}`)}</span>
                      <b className="tabular-nums">
                        {formatMoney(p.amountMinor)}
                      </b>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-fg-subtle">
                {willWriteOff ? t('writeOffNote') : t('sameBatch')}
              </p>
              {blocked && <Alert tone="info">{blocked}</Alert>}
              {createError && (
                <Alert tone="danger" live="assertive">
                  {createError}
                </Alert>
              )}
              <Button
                size="lg"
                block
                loading={create.isPending}
                disabled={!refund || Boolean(blocked)}
                onClick={() => create.mutate()}
              >
                {t('doReturn', {
                  amount: formatMoney(refund?.refundMinor ?? 0),
                })}
              </Button>
            </Card>
          </div>
        )}

        {online && <Journal />}
      </div>
    </>
  );
}

export function ReturnsPage() {
  return (
    <WithMessages groups={['pos']}>
      <ReturnsPageView />
    </WithMessages>
  );
}
