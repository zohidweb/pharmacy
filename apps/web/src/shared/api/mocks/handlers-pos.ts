/*
 * Mock handlers of the POS: the rules apps/api will enforce — idempotency by key (ADR-0015, 6в),
 * permissions (ADR-0018), an open shift for every sale, «продажа, совершённая физически, — факт»
 * (prices of the snapshot are accepted, differences are counted for the manager), expired batches
 * never sold, ПКУ only with the right and prescription data, the return window of the network.
 */
import { hasPermissions, returnRefundTotal } from '@pharmacy/shared-domain';
import type {
  CatalogSnapshot,
  CreatedReceipt,
  CreatedReturn,
  PosProduct,
  PrescriptionKind,
  ReceiptPaymentMethod,
  Shift,
  ZReport,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb } from './db';
import type { MockReceipt, MockShift } from './db-pos';
import { stores } from './fixtures';
import { categories, storeSettings } from './fixtures-pos';
import {
  activeDiscountThresholds,
  piecePrice,
  storePrice,
} from './pricing';
import { writeOffReturned } from './handlers-stock';
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
  | 'shifts.zReport'
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

/** The open shift of a terminal (K5); a session without a terminal sees the shift of the store. */
function openShiftOf(
  storeId: string | null,
  terminalId: string | null,
): MockShift | undefined {
  return pos().shifts.find(
    (s) =>
      s.storeId === storeId &&
      s.status === 'open' &&
      (terminalId === null || s.terminalId === terminalId),
  );
}

/** Numbers of the server: `<prefix>-<store code>-<year>-<6 digits>` (spec 2026-10-13, E2). */
function posNumber(
  prefix: 'ЧК' | 'СМ' | 'ВЗ',
  storeId: string,
  n: number,
): string {
  const code = storeId.replace(/\D/g, '').padStart(2, '0');
  return `${prefix}-${code}-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`;
}

function requireShift(id: string, correlationId: string): MockShift {
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
    returnWindowDays: mockDb().owner.returnPolicy.returnWindowDays,
    ...(store && {
      taxId:
        mockDb().owner.legalEntities.find((e) => e.id === store.legalEntityId)
          ?.taxId ?? base.taxId,
    }),
  };
}

/** A receipt of the stores of the session, by number or id, within the return window (E4). */
function findReturnable(
  by: { number?: string; id?: string },
  sessionStores: ReadonlyArray<{ id: string }>,
  correlationId: string,
): MockReceipt {
  const number = by.number?.replace(/^№\s*/, '').trim();
  const receipt = pos().receipts.find(
    (r) =>
      (by.id ? r.id === by.id : r.number === number) &&
      sessionStores.some((s) => s.id === r.storeId),
  );
  if (!receipt) throw new ApiError(404, 'not_found', correlationId);
  const window = mockDb().owner.returnPolicy.returnWindowDays;
  if (daysBetween(toAppDate(new Date(receipt.soldAt)), today()) > window) {
    throw new ApiError(422, 'return_window_expired', correlationId);
  }
  return receipt;
}

/** What is left to refund by kind: paid − refunded (E7). */
function refundable(receipt: MockReceipt) {
  return receipt.payments
    .map((p) => ({
      method: p.method,
      amountMinor: p.amountMinor - (receipt.refunded[p.method] ?? 0),
    }))
    .filter((p) => p.amountMinor > 0);
}

const kindOf = (productId: string): PrescriptionKind =>
  pos().products.find((p) => p.id === productId)?.prescription ?? 'none';

function batchExpired(productId: string, batchId: string): boolean {
  const batch = pos()
    .products.find((p) => p.id === productId)
    ?.batches.find((b) => b.id === batchId);
  return batch !== undefined && batch.expiresOn < today();
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
          throw validation(
            correlationId,
            `lines.${index}.batchId`,
            'batch_expired',
          );
        }
        // the sale happened: rights of the author and catalog changes are marks, not refusals
        if (
          (line.controlled !== null &&
            !hasPermissions(session.permissions, 'pos:sell-controlled')) ||
          (line.batchChosenManually &&
            !hasPermissions(session.permissions, 'pos:choose-batch')) ||
          line.piecesPerPack !== item.piecesPerPack
        ) {
          discrepancies += 1;
        }
        const pieces =
          line.unit === 'pack'
            ? line.quantity * line.piecesPerPack
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
          discountShareMinor: 0,
        };
      });
      // the discount share of a line: proportional to its amount, the rest on the last line (the
      // shares of the server, spec 2026-10-13-pos-shift-sale, E9)
      let shared = 0;
      lines.forEach((line, i) => {
        line.discountShareMinor =
          i === lines.length - 1
            ? body.discountMinor - shared
            : Math.floor(
                (body.discountMinor * line.amountMinor) /
                  Math.max(1, body.subtotalMinor),
              );
        shared += line.discountShareMinor;
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
      const number = posNumber('ЧК', body.storeId, pos().nextReceipt++);
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
        payments: body.payments,
        refunded: {},
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
      if (discrepancies > 0) shift.discrepancyReceipts += 1;
      recomputeCash(shift);
      shift.events.unshift({
        id: `e-${body.id}`,
        at: body.occurredAt,
        kind: 'sale',
        reference: number,
        employeeName: receipt.cashierName,
        amountMinor: body.totalMinor,
        flagged: discrepancies > 0,
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
    const shift = openShiftOf(session.currentStoreId, session.terminalId);
    if (!shift) throw new ApiError(404, 'no_open_shift', correlationId);
    return shift;
  },
  'shifts.open': ({ body, correlationId }) => {
    const { session } = authorize(correlationId, 'shifts:create', {
      write: true,
    });
    return idempotent(body.id, body, correlationId, () => {
      const terminalId = body.terminalId ?? session.terminalId;
      if (openShiftOf(body.storeId, terminalId)) {
        throw new ApiError(409, 'shift_open', correlationId);
      }
      const by = shortNameOf(session.employee.id);
      const zero = () => ({ count: 0, amountMinor: 0 });
      const shift: MockShift = {
        id: body.id,
        number: posNumber('СМ', body.storeId, pos().nextShift++),
        storeId: body.storeId,
        terminalId,
        status: 'open',
        openedAt: body.occurredAt,
        openedBy: by,
        closedAt: null,
        receipts: 0,
        byMethod: { cash: zero(), card: zero(), qr: zero(), nfc: zero() },
        returns: zero(),
        returnsByMethod: { cash: zero(), card: zero(), qr: zero(), nfc: zero() },
        revenueMinor: 0,
        cash: {
          openingMinor: body.openingCashMinor,
          salesMinor: 0,
          inMinor: 0,
          outMinor: 0,
          returnsMinor: 0,
          expectedMinor: body.openingCashMinor,
        },
        discrepancyReceipts: 0,
        events: [
          {
            id: `e-${body.id}`,
            at: body.occurredAt,
            kind: 'opened',
            reference: null,
            employeeName: by,
            amountMinor: body.openingCashMinor,
            flagged: false,
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
        flagged: false,
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
        flagged: false,
      });
      // held receipts live until the shift closes (ТЗ)
      pos().held[shift.storeId] = [];
      const methods: Array<Exclude<ReceiptPaymentMethod, 'cash'>> = [
        'card',
        'qr',
        'nfc',
      ];
      const discrepancyMinor = body.actualCashMinor - shift.cash.expectedMinor;
      const report: ZReport = {
        shift,
        actualCashMinor: body.actualCashMinor,
        discrepancyMinor,
        terminalDiff: Object.fromEntries(
          methods.map((m) => [
            m,
            body.terminalTotals[m] -
              (shift.byMethod[m].amountMinor -
                shift.returnsByMethod[m].amountMinor),
          ]),
        ) as ZReport['terminalDiff'],
        // the closing is a fact: a discrepancy without a reason is accepted and marked (E24)
        discrepancyReasonMissing:
          discrepancyMinor !== 0 && body.discrepancyReason.trim() === '',
      };
      pos().zReports[shift.id] = report;
      return report;
    });
  },
  'shifts.zReport': ({ params, correlationId }) => {
    authorize(correlationId, 'shifts:view');
    const report = pos().zReports[params.id];
    if (!report) throw new ApiError(404, 'not_found', correlationId);
    return report;
  },

  'receipts.returnable': ({ query, correlationId }) => {
    const { session } = authorize(correlationId, 'returns:create');
    if (query.productId) authorize(correlationId, 'returns:without-receipt');
    const receipt = findReturnable(query, session.stores, correlationId);
    // as apps/api: a product the receipt did not sell is no such sale
    if (
      query.productId &&
      !receipt.lines.some((l) => l.productId === query.productId)
    ) {
      throw new ApiError(404, 'not_found', correlationId);
    }
    const window = mockDb().owner.returnPolicy.returnWindowDays;
    const age = daysBetween(toAppDate(new Date(receipt.soldAt)), today());
    return {
      id: receipt.id,
      number: receipt.number,
      soldAt: receipt.soldAt,
      storeName: stores.find((s) => s.id === receipt.storeId)?.name ?? '—',
      cashierName: receipt.cashierName,
      daysLeft: window - age,
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      payments: refundable(receipt),
      lines: receipt.lines
        .filter((l) => !query.productId || l.productId === query.productId)
        .map((l) => {
          const kind = kindOf(l.productId);
          return {
            lineId: l.lineId,
            productId: l.productId,
            productName: l.productName,
            batchId: l.batchId,
            batchNumber: l.batchNumber,
            unit: l.unit,
            quantity: l.quantity,
            returnedQuantity: l.returnedQuantity,
            unitPriceMinor: l.unitPriceMinor,
            discountShareMinor: l.discountShareMinor,
            kind,
            customerReturnAllowed:
              mockDb().owner.returnPolicy.customerReturns[kind],
            batchExpired: batchExpired(l.productId, l.batchId),
          };
        }),
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
            productId: l.productId,
            productName: l.productName,
            quantity: l.quantity,
            unit: l.unit,
            amountMinor: l.amountMinor,
          })),
      )
      .slice(0, 50);
  },
  'returns.create': ({ body, correlationId }) => {
    const { session } = authorize(correlationId, 'returns:create', {
      write: true,
    });
    if (body.foundProductId) {
      authorize(correlationId, 'returns:without-receipt');
    }
    return idempotent(body.id, body, correlationId, (): CreatedReturn => {
      const shift = requireShift(body.shiftId, correlationId);
      const receipt = findReturnable(
        { id: body.receiptId },
        session.stores,
        correlationId,
      );
      const policy = mockDb().owner.returnPolicy.customerReturns;
      const picked = body.lines.map((item, i) => {
        const line = receipt.lines.find((l) => l.lineId === item.lineId);
        if (!line) {
          throw validation(correlationId, `lines.${i}.lineId`, 'unknown_line');
        }
        if (item.quantity > line.quantity - line.returnedQuantity) {
          throw new ApiError(409, 'return_exceeds_sold', correlationId, [
            { field: `lines.${i}.quantity`, code: 'return_exceeds_sold' },
          ]);
        }
        if (body.foundProductId && line.productId !== body.foundProductId) {
          throw new ApiError(422, 'return_not_allowed', correlationId, [
            { field: `lines.${i}.lineId`, code: 'other_product' },
          ]);
        }
        if (body.reason === 'customer' && !policy[kindOf(line.productId)]) {
          throw new ApiError(422, 'return_not_allowed', correlationId, [
            { field: `lines.${i}.lineId`, code: 'return_not_allowed' },
          ]);
        }
        return { line, quantity: item.quantity };
      });
      const refund = returnRefundTotal(
        picked.map(({ line, quantity }) => ({
          soldQuantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          discountShareMinor: line.discountShareMinor,
          returnedQuantity: line.returnedQuantity,
          quantity,
        })),
      );
      if (refund.refundMinor !== body.refundMinor) {
        throw validation(correlationId, 'refundMinor', 'total_mismatch');
      }
      const left = refundable(receipt);
      for (const r of body.refunds) {
        const can = left.find((p) => p.method === r.method)?.amountMinor ?? 0;
        if (r.amountMinor > can) {
          throw validation(correlationId, 'refunds', 'refund_exceeds_paid');
        }
      }
      const refunds = body.refunds.reduce((sum, r) => sum + r.amountMinor, 0);
      if (refunds !== body.refundMinor) {
        throw validation(correlationId, 'refunds', 'total_mismatch');
      }
      const number = posNumber('ВЗ', receipt.storeId, pos().nextReturn++);
      const cashier = shortNameOf(session.employee.id);
      const toWriteOff = picked.filter(
        ({ line }) =>
          body.reason === 'defect' ||
          batchExpired(line.productId, line.batchId),
      );
      for (const { line, quantity } of picked) {
        line.returnedQuantity += quantity;
        // goods go back into the batch of the line (ТЗ)
        const perUnit = line.unit === 'pack' ? line.piecesPerPack : 1;
        move(receipt.storeId, line.batchId, number, quantity * perUnit);
      }
      // a defect and an expired batch leave the batch again by a write-off (E9)
      const written =
        toWriteOff.length > 0
          ? writeOffReturned({
              storeId: receipt.storeId,
              reason:
                body.reason === 'defect'
                  ? 'customer_return_defect'
                  : 'customer_return_expired',
              customerReturnId: body.id,
              customerReturnNumber: number,
              authorName: cashier,
              lines: toWriteOff.map(({ line, quantity }) => ({
                productId: line.productId,
                productName: line.productName,
                batchId: line.batchId,
                unit: line.unit,
                quantity,
              })),
              correlationId,
            })
          : null;
      for (const r of body.refunds) {
        receipt.refunded[r.method] =
          (receipt.refunded[r.method] ?? 0) + r.amountMinor;
        const total = shift.returnsByMethod[r.method];
        total.count += 1;
        total.amountMinor += r.amountMinor;
      }
      shift.returns.count += 1;
      shift.returns.amountMinor += body.refundMinor;
      shift.revenueMinor -= body.refundMinor;
      shift.cash.returnsMinor +=
        body.refunds.find((r) => r.method === 'cash')?.amountMinor ?? 0;
      recomputeCash(shift);
      shift.events.unshift({
        id: `e-${body.id}`,
        at: body.occurredAt,
        kind: 'return',
        reference: number,
        employeeName: cashier,
        amountMinor: -body.refundMinor,
        flagged: false,
      });
      const first = picked[0]?.line;
      const more = picked.length > 1 ? ` +${picked.length - 1}` : '';
      pos().returns.unshift({
        id: body.id,
        number,
        at: body.occurredAt,
        storeName: stores.find((s) => s.id === receipt.storeId)?.name ?? '—',
        receiptNumber: receipt.number,
        summary: first ? `${first.productName}${more}` : '—',
        reason: body.reason,
        refundMinor: body.refundMinor,
        methods: body.refunds.map((r) => r.method),
        cashierName: cashier,
        foundWithoutReceipt: body.foundProductId !== null,
        writeOffNumber: written?.number ?? null,
      });
      return {
        id: body.id,
        number,
        refundMinor: body.refundMinor,
        writeOffNumber: written?.number ?? null,
      };
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
