/*
 * Mock handlers of the POS: the rules apps/api will enforce — idempotency by key (ADR-0015, 6в),
 * permissions (ADR-0018), an open shift for every sale, «продажа, совершённая физически, — факт»
 * (prices of the snapshot are accepted, differences are counted for the manager), expired batches
 * never sold, ПКУ only with the right and prescription data, the return window of the network.
 */
import { hasPermissions, returnRefund } from '@pharmacy/shared-domain';
import type {
  CatalogSnapshot,
  CreatedReceipt,
  CreatedReturn,
  PosProduct,
  ReceiptPaymentMethod,
  Shift,
  ZReport,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb } from './db';
import type { MockReceipt } from './db-pos';
import { stores } from './fixtures';
import { categories, storeSettings } from './fixtures-pos';
import {
  activeDiscountThresholds,
  discountThresholdById,
  piecePrice,
  storePrice,
} from './pricing';
import { authorize } from './session';
import type { MockHandlers } from './types';

type PosRoute = Extract<
  ApiRouteKey,
  | 'catalog.snapshot'
  | 'receipts.create'
  | 'heldReceipts.list'
  | 'heldReceipts.create'
  | 'heldReceipts.delete'
  | 'shifts.current'
  | 'shifts.open'
  | 'shifts.cashMovement'
  | 'shifts.close'
  | 'receipts.returnable'
  | 'returns.salesSearch'
  | 'returns.create'
  | 'returns.list'
  | 'health.get'
  | 'deployment.get'
>;

const pos = () => mockDb().pos;

const validation = (correlationId: string, field: string, code: string) =>
  new ApiError(422, 'validation_failed', correlationId, [{ field, code }]);

/** Same key and payload → the first response; same key, other payload → 409 (ADR-0015). */
function idempotent<T>(
  key: string,
  body: unknown,
  correlationId: string,
  compute: () => T,
): T {
  const fingerprint = JSON.stringify(body);
  const seen = pos().idempotency.get(key);
  if (seen) {
    if (seen.fingerprint !== fingerprint) {
      throw new ApiError(409, 'idempotency_conflict', correlationId);
    }
    return seen.response as T;
  }
  const response = compute();
  pos().idempotency.set(key, { fingerprint, response });
  return response;
}

function shortNameOf(employeeId: string): string {
  return mockDb().employees.find((e) => e.id === employeeId)?.shortName ?? '—';
}

function openShiftOf(storeId: string | null): Shift | undefined {
  return pos().shifts.find((s) => s.storeId === storeId && s.status === 'open');
}

function requireShift(id: string, correlationId: string): Shift {
  const shift = pos().shifts.find((s) => s.id === id);
  if (!shift || shift.status !== 'open') {
    throw new ApiError(409, 'no_open_shift', correlationId);
  }
  return shift;
}

function recomputeCash(shift: Shift): void {
  const c = shift.cash;
  c.expectedMinor =
    c.openingMinor + c.salesMinor + c.inMinor - c.outMinor - c.returnsMinor;
}

function product(id: string, correlationId: string): PosProduct {
  const found = pos().products.find((p) => p.id === id);
  if (!found) throw validation(correlationId, 'lines', 'unknown_product');
  return found;
}

const today = () => toAppDate();

const stockOf = (storeId: string) => (mockDb().stock.stock[storeId] ??= {});

/** The product with the stock and the price of one store (the mock keeps both by store). */
export function productAt(item: PosProduct, storeId: string): PosProduct {
  const stock = stockOf(storeId);
  const priceMinor = storePrice(storeId, item);
  return {
    ...item,
    priceMinor,
    piecePriceMinor:
      priceMinor === item.priceMinor
        ? item.piecePriceMinor
        : piecePrice(item, priceMinor),
    batches: item.batches.map((b) => ({
      ...b,
      quantityPieces: stock[b.id] ?? 0,
    })),
  };
}

/** FEFO: the batch with the nearest expiry that is not expired and has stock. */
function fefoBatch(item: PosProduct) {
  return [...item.batches]
    .filter((b) => b.expiresOn >= today() && b.quantityPieces > 0)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
}

function withoutCost(item: PosProduct): PosProduct {
  return {
    ...item,
    batches: item.batches.map(({ costMinor: _cost, ...rest }) => rest),
  };
}

function move(
  storeId: string,
  batchId: string,
  document: string,
  pieces: number,
) {
  const stock = stockOf(storeId);
  stock[batchId] = (stock[batchId] ?? 0) + pieces;
  mockDb().stock.movements.push({
    storeId,
    batchId,
    document,
    pieces,
    at: new Date().toISOString(),
  });
}

/** Receipt settings of the store: the network settings and the INN of the store's legal entity. */
function networkSettingsOf(storeName: string, storeAddress: string) {
  const base = storeSettings(storeName, storeAddress);
  const network = mockDb().owner.settings;
  const store = Object.entries(mockDb().owner.storeDetails).find(
    ([id]) => stores.find((s) => s.id === id)?.name === storeName,
  )?.[1];
  return {
    ...base,
    networkName: network.networkName,
    returnWindowDays: network.returnWindowDays,
    ...(store && {
      taxId:
        mockDb().owner.legalEntities.find((e) => e.id === store.legalEntityId)
          ?.taxId ?? base.taxId,
    }),
  };
}

export const posHandlers: Pick<MockHandlers, PosRoute> = {
  'health.get': () => ({ status: 'ok' }),
  'deployment.get': () => ({ kind: mockDb().owner.deployment }),

  'catalog.snapshot': ({ params, query, correlationId }) => {
    const { session } = authorize(correlationId, 'pos:view');
    const store = session.stores.find((s) => s.id === params.storeId);
    if (!store) throw new ApiError(403, 'store_not_in_scope', correlationId);
    const db = pos();
    const canSeeCost = hasPermissions(session.permissions, 'finance:view-cost');
    const upToDate = query?.sinceVersion === db.catalogVersion;
    const snapshot: CatalogSnapshot = {
      version: db.catalogVersion,
      full: !upToDate,
      products: upToDate
        ? []
        : db.products
            .map((p) => productAt(p, store.id))
            .map((p) => (canSeeCost ? p : withoutCost(p))),
      removedProductIds: [],
      categories,
      discountRules: activeDiscountThresholds(store.id),
      settings: networkSettingsOf(store.name, store.address),
    };
    return snapshot;
  },

  'receipts.create': ({ body, correlationId }) => {
    const { session } = authorize(correlationId, 'pos:create', { write: true });
    return idempotent(body.id, body, correlationId, (): CreatedReceipt => {
      const shift = requireShift(body.shiftId, correlationId);
      if (shift.storeId !== body.storeId) {
        throw new ApiError(409, 'no_open_shift', correlationId);
      }
      let discrepancies = 0;
      const lines = body.lines.map((line, index) => {
        const item = productAt(
          product(line.productId, correlationId),
          body.storeId,
        );
        const batch = item.batches.find((b) => b.id === line.batchId);
        if (!batch)
          throw validation(
            correlationId,
            `lines.${index}.batchId`,
            'unknown_batch',
          );
        if (batch.expiresOn < today()) {
          throw new ApiError(422, 'batch_expired', correlationId, [
            { field: `lines.${index}.batchId`, code: 'expired' },
          ]);
        }
        if (item.prescription === 'controlled') {
          if (!hasPermissions(session.permissions, 'pos:sell-controlled')) {
            throw new ApiError(403, 'forbidden', correlationId);
          }
          if (!line.controlled) {
            throw validation(
              correlationId,
              `lines.${index}.controlled`,
              'required',
            );
          }
        }
        const fefo = fefoBatch(item);
        if (
          fefo &&
          fefo.id !== batch.id &&
          !hasPermissions(session.permissions, 'pos:choose-batch')
        ) {
          throw new ApiError(403, 'forbidden', correlationId);
        }
        const pieces =
          line.unit === 'pack'
            ? line.quantity * item.piecesPerPack
            : line.quantity;
        const price =
          line.unit === 'pack' ? item.priceMinor : item.piecePriceMinor;
        if (price !== line.unitPriceMinor || pieces > batch.quantityPieces) {
          discrepancies += 1; // the sale happened: accepted, marked for the manager
        }
        move(body.storeId, batch.id, 'sale', -pieces);
        return {
          ...line,
          lineId: `${body.id}-${index}`,
          productName: item.name,
          batchNumber: batch.number,
          returnedQuantity: 0,
        };
      });
      const paid = body.payments.reduce((sum, p) => sum + p.amountMinor, 0);
      if (paid !== body.totalMinor) {
        throw validation(correlationId, 'payments', 'total_mismatch');
      }
      const cashPart =
        body.payments.find((p) => p.method === 'cash')?.amountMinor ?? 0;
      if (body.cashTenderedMinor < cashPart) {
        throw validation(correlationId, 'cashTenderedMinor', 'too_small');
      }
      const rule = discountThresholdById(body.discountRuleId);
      const number = String(pos().nextReceipt++);
      const receipt: MockReceipt = {
        id: body.id,
        number,
        storeId: body.storeId,
        shiftId: shift.id,
        soldAt: body.occurredAt,
        cashierName: shortNameOf(session.employee.id),
        lines,
        subtotalMinor: body.subtotalMinor,
        discountMinor: body.discountMinor,
        discountPercent: rule?.percent ?? 0,
        discountMinSubtotalMinor: rule?.minSubtotalMinor ?? 0,
        returnedSubtotalMinor: 0,
        payments: body.payments,
      };
      pos().receipts.unshift(receipt);
      shift.receipts += 1;
      for (const payment of body.payments) {
        const total = shift.byMethod[payment.method];
        total.count += 1;
        total.amountMinor += payment.amountMinor;
      }
      shift.revenueMinor += body.totalMinor;
      shift.cash.salesMinor += cashPart;
      recomputeCash(shift);
      shift.events.unshift({
        id: `e-${body.id}`,
        at: body.occurredAt,
        kind: 'sale',
        reference: number,
        employeeName: receipt.cashierName,
        amountMinor: body.totalMinor,
      });
      return { id: body.id, number, fiscal: null, discrepancies };
    });
  },

  'heldReceipts.list': ({ params, correlationId }) => {
    authorize(correlationId, 'pos:view');
    return pos().held[params.storeId] ?? [];
  },
  'heldReceipts.create': ({ body, correlationId }) => {
    const { session } = authorize(correlationId, 'pos:create', { write: true });
    const held = {
      id: body.id,
      lines: body.lines,
      subtotalMinor: body.subtotalMinor,
      heldAt: new Date().toISOString(),
      heldBy: shortNameOf(session.employee.id),
    };
    (pos().held[body.storeId] ??= []).unshift(held);
    return held;
  },
  'heldReceipts.delete': ({ params, correlationId }) => {
    authorize(correlationId, 'pos:create', { write: true });
    for (const [storeId, list] of Object.entries(pos().held)) {
      pos().held[storeId] = list.filter((h) => h.id !== params.id);
    }
  },

  'shifts.current': ({ correlationId }) => {
    const { session } = authorize(correlationId, 'shifts:view');
    const shift = openShiftOf(session.currentStoreId);
    if (!shift) throw new ApiError(404, 'no_open_shift', correlationId);
    return shift;
  },
  'shifts.open': ({ body, correlationId }) => {
    const { session } = authorize(correlationId, 'shifts:create', {
      write: true,
    });
    return idempotent(body.id, body, correlationId, () => {
      if (openShiftOf(body.storeId)) {
        throw new ApiError(409, 'shift_open', correlationId);
      }
      const by = shortNameOf(session.employee.id);
      const zero = () => ({ count: 0, amountMinor: 0 });
      const shift: Shift = {
        id: body.id,
        number: pos().nextShift++,
        storeId: body.storeId,
        status: 'open',
        openedAt: body.occurredAt,
        openedBy: by,
        closedAt: null,
        receipts: 0,
        byMethod: { cash: zero(), card: zero(), qr: zero(), nfc: zero() },
        returns: zero(),
        revenueMinor: 0,
        cash: {
          openingMinor: body.openingCashMinor,
          salesMinor: 0,
          inMinor: 0,
          outMinor: 0,
          returnsMinor: 0,
          expectedMinor: body.openingCashMinor,
        },
        events: [
          {
            id: `e-${body.id}`,
            at: body.occurredAt,
            kind: 'opened',
            reference: null,
            employeeName: by,
            amountMinor: body.openingCashMinor,
          },
        ],
      };
      pos().shifts.push(shift);
      return shift;
    });
  },
  'shifts.cashMovement': ({ params, body, correlationId }) => {
    const { session } = authorize(correlationId, 'shifts:update', {
      write: true,
    });
    return idempotent(body.id, body, correlationId, () => {
      const shift = requireShift(params.id, correlationId);
      if (body.amountMinor <= 0) {
        throw validation(correlationId, 'amountMinor', 'positive');
      }
      if (body.kind === 'in') shift.cash.inMinor += body.amountMinor;
      else shift.cash.outMinor += body.amountMinor;
      recomputeCash(shift);
      shift.events.unshift({
        id: `e-${body.id}`,
        at: body.occurredAt,
        kind: body.kind === 'in' ? 'cash_in' : 'cash_out',
        reference: body.reason,
        employeeName: shortNameOf(session.employee.id),
        amountMinor: body.kind === 'in' ? body.amountMinor : -body.amountMinor,
      });
      return shift;
    });
  },
  'shifts.close': ({ params, body, correlationId }) => {
    const { session } = authorize(correlationId, 'shifts:update', {
      write: true,
    });
    return idempotent(body.id, body, correlationId, (): ZReport => {
      const shift = requireShift(params.id, correlationId);
      shift.status = 'closed';
      shift.closedAt = body.occurredAt;
      shift.events.unshift({
        id: `e-${body.id}`,
        at: body.occurredAt,
        kind: 'closed',
        reference: null,
        employeeName: shortNameOf(session.employee.id),
        amountMinor: body.actualCashMinor,
      });
      // held receipts live until the shift closes (ТЗ)
      pos().held[shift.storeId] = [];
      const methods: Array<Exclude<ReceiptPaymentMethod, 'cash'>> = [
        'card',
        'qr',
        'nfc',
      ];
      return {
        shift,
        actualCashMinor: body.actualCashMinor,
        discrepancyMinor: body.actualCashMinor - shift.cash.expectedMinor,
        terminalDiff: Object.fromEntries(
          methods.map((m) => [
            m,
            body.terminalTotals[m] - shift.byMethod[m].amountMinor,
          ]),
        ) as ZReport['terminalDiff'],
      };
    });
  },

  'receipts.returnable': ({ query, correlationId }) => {
    const { session } = authorize(correlationId, 'returns:view');
    const number = query.number.replace(/^№\s*/, '').trim();
    const receipt = pos().receipts.find(
      (r) =>
        r.number === number && session.stores.some((s) => s.id === r.storeId),
    );
    if (!receipt) throw new ApiError(404, 'not_found', correlationId);
    const store = stores.find((s) => s.id === receipt.storeId);
    const window = mockDb().owner.settings.returnWindowDays;
    const age = daysBetween(toAppDate(new Date(receipt.soldAt)), today());
    if (age > window) {
      throw new ApiError(422, 'return_window_expired', correlationId);
    }
    return {
      id: receipt.id,
      number: receipt.number,
      soldAt: receipt.soldAt,
      storeName: store?.name ?? '—',
      cashierName: receipt.cashierName,
      daysLeft: window - age,
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      discountPercent: receipt.discountPercent,
      discountMinSubtotalMinor: receipt.discountMinSubtotalMinor,
      returnedSubtotalMinor: receipt.returnedSubtotalMinor,
      payments: receipt.payments,
      lines: receipt.lines.map((l) => ({
        lineId: l.lineId,
        productId: l.productId,
        productName: l.productName,
        batchId: l.batchId,
        batchNumber: l.batchNumber,
        unit: l.unit,
        quantity: l.quantity,
        returnedQuantity: l.returnedQuantity,
        unitPriceMinor: l.unitPriceMinor,
      })),
    };
  },
  'returns.salesSearch': ({ query, correlationId }) => {
    const { session } = authorize(correlationId, 'returns:without-receipt');
    const needle = query.query.trim().toLocaleLowerCase('ru');
    return pos()
      .receipts.filter(
        (r) =>
          session.stores.some((s) => s.id === r.storeId) &&
          toAppDate(new Date(r.soldAt)) === query.date,
      )
      .flatMap((r) =>
        r.lines
          .filter((l) => l.productName.toLocaleLowerCase('ru').includes(needle))
          .map((l) => ({
            receiptId: r.id,
            receiptNumber: r.number,
            soldAt: r.soldAt,
            productName: l.productName,
            quantity: l.quantity,
            unit: l.unit,
            amountMinor: l.amountMinor,
          })),
      );
  },
  'returns.create': ({ body, correlationId }) => {
    const { session } = authorize(correlationId, 'returns:create', {
      write: true,
    });
    return idempotent(body.id, body, correlationId, (): CreatedReturn => {
      const shift = requireShift(body.shiftId, correlationId);
      const receipt = pos().receipts.find((r) => r.id === body.receiptId);
      if (!receipt) throw new ApiError(404, 'not_found', correlationId);
      let returnedNow = 0;
      for (const item of body.lines) {
        const line = receipt.lines.find((l) => l.lineId === item.lineId);
        if (
          !line ||
          item.quantity <= 0 ||
          item.quantity > line.quantity - line.returnedQuantity
        ) {
          throw new ApiError(422, 'return_quantity_exceeded', correlationId);
        }
        returnedNow += item.quantity * line.unitPriceMinor;
      }
      const refund = returnRefund({
        subtotalMinor: receipt.subtotalMinor,
        discountMinor: receipt.discountMinor,
        returnedSubtotalMinor: receipt.returnedSubtotalMinor + returnedNow,
        previouslyReturnedSubtotalMinor: receipt.returnedSubtotalMinor,
        percent: receipt.discountPercent,
        minSubtotalMinor: receipt.discountMinSubtotalMinor,
      });
      const refunds = body.refunds.reduce((sum, r) => sum + r.amountMinor, 0);
      if (
        refund.refundMinor !== body.refundMinor ||
        refunds !== body.refundMinor
      ) {
        throw validation(correlationId, 'refundMinor', 'mismatch');
      }
      for (const item of body.lines) {
        const line = receipt.lines.find((l) => l.lineId === item.lineId);
        if (!line) continue;
        line.returnedQuantity += item.quantity;
        // goods go back into the same batch (ТЗ)
        const perUnit =
          line.unit === 'pack'
            ? (pos().products.find((p) => p.id === line.productId)
                ?.piecesPerPack ?? 1)
            : 1;
        move(receipt.storeId, line.batchId, 'return', item.quantity * perUnit);
      }
      receipt.returnedSubtotalMinor += returnedNow;
      const number = `ВЗ-${String(pos().nextReturn++).padStart(6, '0')}`;
      const cashRefund =
        body.refunds.find((r) => r.method === 'cash')?.amountMinor ?? 0;
      shift.returns.count += 1;
      shift.returns.amountMinor += body.refundMinor;
      shift.revenueMinor -= body.refundMinor;
      shift.cash.returnsMinor += cashRefund;
      recomputeCash(shift);
      const cashier = shortNameOf(session.employee.id);
      shift.events.unshift({
        id: `e-${body.id}`,
        at: body.occurredAt,
        kind: 'return',
        reference: number,
        employeeName: cashier,
        amountMinor: -body.refundMinor,
      });
      const first = receipt.lines.find(
        (l) => l.lineId === body.lines[0]?.lineId,
      );
      pos().returns.unshift({
        id: body.id,
        number,
        at: body.occurredAt,
        storeName: stores.find((s) => s.id === receipt.storeId)?.name ?? '—',
        receiptNumber: receipt.number,
        summary: first
          ? `${first.productName} · ${body.lines[0].quantity}`
          : '—',
        reason: body.reason,
        refundMinor: body.refundMinor,
        method: body.refunds[0]?.method ?? 'cash',
        cashierName: cashier,
      });
      return { id: body.id, number, refundMinor: body.refundMinor };
    });
  },
  'returns.list': ({ query, correlationId }) => {
    authorize(correlationId, 'returns:view');
    const items = pos().returns.filter(
      (r) => !query?.reason || r.reason === query.reason,
    );
    const limit = query?.limit ?? 10;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },
};
