/*
 * Mock handlers of purchasing — the rules apps/api will enforce: permissions `purchasing:*` and the
 * store scope (ADR-0018), purchase prices and debts only with `finance:view-cost`, only a draft
 * order is edited, a confirmed order is closed by its goods receipts, the supplier debt is derived
 * from posted receipts, posted supplier returns and payments (FIFO by due date), a payment is
 * idempotent by its id (financial operation, CLAUDE.md «Integrations»).
 */
import {
  deficitQuantity,
  supplierDebt,
  type SupplierInvoice,
} from '@pharmacy/shared-domain';
import type {
  DeficitLine,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderListItem,
  Supplier,
  SupplierDebtState,
  SupplierInput,
  SupplierLedgerEntry,
  SupplierListItem,
} from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb } from './db';
import {
  context,
  findDoc,
  inScope,
  page,
  productOf,
  stockAt,
  storeName,
  visible,
} from './handlers-stock';
import { authorize } from './session';
import type { MockHandlers } from './types';

type PurchasingRoute = Extract<
  ApiRouteKey,
  | `purchaseOrders.${'list' | 'get' | 'create' | 'update' | 'confirm' | 'deficit'}`
  | `suppliers.${'list' | 'get' | 'create' | 'update' | 'pay'}`
>;

const db = () => mockDb().stock;
const today = () => toAppDate();

const validation = (correlationId: string, field: string, code: string) =>
  new ApiError(422, 'validation_failed', correlationId, [{ field, code }]);

/* ---------------- orders ---------------- */

function buildOrder(
  input: PurchaseOrderInput,
  base: Pick<
    PurchaseOrder,
    'id' | 'number' | 'status' | 'date' | 'createdBy' | 'confirmedBy'
  >,
  correlationId: string,
): PurchaseOrder {
  const supplier = db().suppliers.find((s) => s.id === input.supplierId);
  if (!supplier) throw validation(correlationId, 'supplierId', 'required');
  if (
    input.lines.some(
      (l) =>
        !Number.isInteger(l.quantity) || l.quantity < 1 || l.priceMinor < 0,
    )
  ) {
    throw validation(correlationId, 'lines', 'invalid');
  }
  const lines = input.lines.map((l) => ({
    ...l,
    productName: productOf(l.productId, correlationId).name,
    receivedQuantity: 0,
  }));
  return {
    ...base,
    supplierId: supplier.id,
    supplierName: supplier.name,
    storeId: input.storeId,
    storeName: storeName(input.storeId),
    expectedOn: input.expectedOn,
    comment: input.comment.trim(),
    lines,
    totalMinor: lines.reduce((sum, l) => sum + l.quantity * l.priceMinor, 0),
    receivedPercent: 0,
  };
}

/** Last purchase price of a pack: from this supplier first, else from anyone, else 0. */
function lastPrice(productId: string, supplierId: string | undefined) {
  const posted = db()
    .goodsReceipts.filter((r) => r.status === 'posted')
    .sort((a, b) => b.date.localeCompare(a.date));
  const lineOf = (list: typeof posted) =>
    list.flatMap((r) => r.lines).find((l) => l.productId === productId)
      ?.costMinor;
  return (
    lineOf(posted.filter((r) => r.supplierId === supplierId)) ??
    lineOf(posted) ??
    0
  );
}

/* ---------------- suppliers ---------------- */

function ledgerOf(supplierId: string): {
  invoices: SupplierInvoice[];
  entries: Array<{ ref?: string; entry: SupplierLedgerEntry }>;
  credits: number;
} {
  const raw: Array<
    Omit<SupplierLedgerEntry, 'balanceMinor'> & { dueOn?: string; ref?: string }
  > = [
    ...db()
      .openingDebts.filter((d) => d.supplierId === supplierId)
      .map((d) => ({
        date: d.date,
        dueOn: d.dueOn,
        kind: 'opening' as const,
        document: '',
        comment: '',
        amountMinor: d.amountMinor,
      })),
    ...db()
      .goodsReceipts.filter(
        (r) => r.supplierId === supplierId && r.status === 'posted',
      )
      .map((r) => ({
        date: r.date,
        dueOn: r.paymentDueOn ?? r.date,
        kind: 'receipt' as const,
        document: r.number,
        comment: r.storeName,
        amountMinor: r.totalMinor,
      })),
    ...db()
      .supplierReturns.filter(
        (r) => r.supplierId === supplierId && r.status === 'posted',
      )
      .map((r) => ({
        date: r.date,
        kind: 'return' as const,
        document: r.number,
        comment: r.storeName,
        amountMinor: -(r.totalMinor ?? 0),
      })),
    ...db()
      .payments.filter((p) => p.supplierId === supplierId)
      .map((p) => ({
        date: p.date,
        kind: 'payment' as const,
        document: '',
        comment: p.comment,
        method: p.method,
        amountMinor: -p.amountMinor,
        ref: p.id,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  const entries = raw.map(({ dueOn: _due, ref, ...entry }) => {
    balance += entry.amountMinor;
    return { ref, entry: { ...entry, balanceMinor: balance } };
  });
  return {
    invoices: raw
      .filter((e) => e.amountMinor > 0)
      .map((e, index) => ({
        document: e.document || `opening-${index}`,
        dueOn: e.dueOn ?? e.date,
        amountMinor: e.amountMinor,
      })),
    entries,
    credits: -raw
      .filter((e) => e.amountMinor < 0)
      .reduce((sum, e) => sum + e.amountMinor, 0),
  };
}

export function debtOf(supplierId: string) {
  const { invoices, credits } = ledgerOf(supplierId);
  return supplierDebt(invoices, credits, today());
}

function listItem(supplier: Supplier, canSeeCost: boolean): SupplierListItem {
  const debt = debtOf(supplier.id);
  const debtState: SupplierDebtState =
    debt.debtMinor === 0
      ? 'none'
      : debt.overdueMinor > 0
        ? 'overdue'
        : 'on_time';
  return {
    ...supplier,
    debtState,
    nextDueOn: debt.nextDueOn,
    overdueDays: debt.overdueDays,
    ...(canSeeCost && {
      debtMinor: debt.debtMinor,
      overdueMinor: debt.overdueMinor,
    }),
  };
}

function supplierInput(body: SupplierInput, correlationId: string) {
  const name = body.name.trim();
  if (!name) throw validation(correlationId, 'name', 'required');
  if (body.taxId && !/^\d{9}$/.test(body.taxId.trim())) {
    throw validation(correlationId, 'taxId', 'format');
  }
  if (!Number.isInteger(body.paymentDelayDays) || body.paymentDelayDays < 0) {
    throw validation(correlationId, 'paymentDelayDays', 'invalid');
  }
  return {
    name,
    taxId: body.taxId.trim(),
    phone: body.phone.trim(),
    address: body.address.trim(),
    paymentDelayDays: body.paymentDelayDays,
  };
}

const supplierOf = (id: string, correlationId: string) =>
  findDoc(db().suppliers, id, correlationId);

export const purchasingHandlers: Pick<MockHandlers, PurchasingRoute> = {
  'purchaseOrders.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'purchasing:view');
    const scoped = visible(session, db().orders);
    const all = scoped
      .filter(
        (o) =>
          !query?.status ||
          (query.status === 'open'
            ? o.status !== 'closed'
            : o.status === query.status),
      )
      .filter((o) => !query?.supplierId || o.supplierId === query.supplierId)
      .filter((o) => !query?.storeId || o.storeId === query.storeId)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
      );
    const count = (status: PurchaseOrder['status']) =>
      scoped.filter((o) => o.status === status).length;
    return {
      ...page(
        all.map((o): PurchaseOrderListItem => ({
          id: o.id,
          number: o.number,
          status: o.status,
          date: o.date,
          supplierName: o.supplierName,
          storeName: o.storeName,
          positions: o.lines.length,
          receivedPercent: o.receivedPercent,
          ...(canSeeCost && { totalMinor: o.totalMinor }),
        })),
        query,
      ),
      kpi: {
        open: scoped.filter((o) => o.status !== 'closed').length,
        draft: count('draft'),
        confirmed: count('confirmed'),
        partiallyReceived: count('partially_received'),
      },
    };
  },
  'purchaseOrders.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'purchasing:view');
    // an order is its purchase prices: opening it needs the cost
    authorize(correlationId, 'finance:view-cost');
    const order = findDoc(db().orders, params.id, correlationId);
    inScope(session, order.storeId, correlationId);
    return order;
  },
  'purchaseOrders.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'purchasing:create', {
      write: true,
    });
    authorize(correlationId, 'finance:view-cost');
    inScope(session, body.storeId, correlationId);
    const order = buildOrder(
      body,
      {
        id: `po-${Date.now()}`,
        number: `ЗК-${String(db().counters.zk++).padStart(6, '0')}`,
        status: 'draft',
        date: today(),
        createdBy: author(),
        confirmedBy: null,
      },
      correlationId,
    );
    db().orders.unshift(order);
    return order;
  },
  'purchaseOrders.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'purchasing:update', {
      write: true,
    });
    const order = findDoc(db().orders, params.id, correlationId);
    if (order.status !== 'draft') {
      throw new ApiError(409, 'order_confirmed', correlationId);
    }
    inScope(session, body.storeId, correlationId);
    Object.assign(order, buildOrder(body, order, correlationId));
    return order;
  },
  'purchaseOrders.confirm': ({ params, correlationId }) => {
    const { session, author } = context(correlationId, 'purchasing:post', {
      write: true,
    });
    const order = findDoc(db().orders, params.id, correlationId);
    inScope(session, order.storeId, correlationId);
    if (order.status !== 'draft') {
      throw new ApiError(409, 'order_confirmed', correlationId);
    }
    if (order.lines.length === 0) {
      throw validation(correlationId, 'lines', 'required');
    }
    if (order.lines.some((l) => l.priceMinor <= 0)) {
      throw validation(correlationId, 'priceMinor', 'positive');
    }
    order.status = 'confirmed';
    order.confirmedBy = author();
    return order;
  },
  'purchaseOrders.deficit': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'purchasing:view');
    authorize(correlationId, 'finance:view-cost');
    inScope(session, query.storeId, correlationId);
    const stock = stockAt(query.storeId);
    return mockDb()
      .pos.products.map((product): DeficitLine | null => {
        const stockPieces = product.batches.reduce(
          (sum, b) => sum + (stock[b.id] ?? 0),
          0,
        );
        const minPacks = db().minPacks[product.id] ?? 0;
        const sales30Packs = db().sales30Packs[product.id] ?? 0;
        const quantity = deficitQuantity({
          stockPieces,
          piecesPerPack: product.piecesPerPack,
          minPacks,
          sales30Packs,
        });
        if (quantity === 0) return null;
        return {
          productId: product.id,
          productName: product.name,
          stockPacks: Math.floor(stockPieces / product.piecesPerPack),
          minPacks,
          sales30Packs,
          quantity,
          priceMinor: lastPrice(product.id, query.supplierId),
        };
      })
      .filter((line): line is DeficitLine => line !== null);
  },

  'suppliers.list': ({ query, correlationId }) => {
    const { canSeeCost } = context(correlationId, 'purchasing:view');
    const items = db().suppliers.map((s) => listItem(s, canSeeCost));
    return {
      ...page(items, query),
      ...(canSeeCost && {
        totals: {
          debtMinor: items.reduce((sum, s) => sum + (s.debtMinor ?? 0), 0),
          overdueMinor: items.reduce(
            (sum, s) => sum + (s.overdueMinor ?? 0),
            0,
          ),
        },
      }),
    };
  },
  'suppliers.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'purchasing:view');
    authorize(correlationId, 'finance:view-cost');
    const supplier = supplierOf(params.id, correlationId);
    const row = (d: {
      id: string;
      number: string;
      date: string;
      storeName: string;
      totalMinor?: number;
    }) => ({
      id: d.id,
      number: d.number,
      date: d.date,
      storeName: d.storeName,
      totalMinor: d.totalMinor ?? 0,
    });
    return {
      ...listItem(supplier, true),
      orders: visible(session, db().orders)
        .filter((o) => o.supplierId === supplier.id)
        .map((o) => ({ ...row(o), status: o.status })),
      receipts: visible(session, db().goodsReceipts)
        .filter((r) => r.supplierId === supplier.id && r.status === 'posted')
        .map(row),
      ledger: ledgerOf(supplier.id)
        .entries.map((e) => e.entry)
        .reverse(),
    };
  },
  'suppliers.create': ({ body, correlationId }) => {
    context(correlationId, 'purchasing:create', { write: true });
    const supplier: Supplier = {
      id: `sup-${Date.now()}`,
      ...supplierInput(body, correlationId),
    };
    db().suppliers.push(supplier);
    return supplier;
  },
  'suppliers.update': ({ params, body, correlationId }) => {
    context(correlationId, 'purchasing:update', { write: true });
    const supplier = supplierOf(params.id, correlationId);
    Object.assign(supplier, supplierInput(body, correlationId));
    return supplier;
  },
  'suppliers.pay': ({ params, body, correlationId }) => {
    context(correlationId, 'purchasing:post', { write: true });
    authorize(correlationId, 'finance:view-cost');
    const supplier = supplierOf(params.id, correlationId);
    const paymentEntry = (id: string) => {
      const found = ledgerOf(supplier.id).entries.find((e) => e.ref === id);
      if (!found) throw new ApiError(404, 'not_found', correlationId);
      return found.entry;
    };
    const seen = db().payments.find((p) => p.id === body.id);
    if (seen) {
      // a retry of the same payment: the same result; another payload with the key — a conflict
      if (
        seen.supplierId !== supplier.id ||
        seen.amountMinor !== body.amountMinor
      ) {
        throw new ApiError(409, 'idempotency_conflict', correlationId);
      }
      return paymentEntry(seen.id);
    }
    if (!Number.isInteger(body.amountMinor) || body.amountMinor <= 0) {
      throw validation(correlationId, 'amountMinor', 'positive');
    }
    if (body.amountMinor > debtOf(supplier.id).debtMinor) {
      throw validation(correlationId, 'amountMinor', 'above_debt');
    }
    db().payments.push({
      id: body.id,
      supplierId: supplier.id,
      date: body.date,
      method: body.method,
      comment: body.comment.trim(),
      amountMinor: body.amountMinor,
    });
    return paymentEntry(body.id);
  },
};
