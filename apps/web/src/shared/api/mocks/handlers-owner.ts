/*
 * Mock handlers of the owner cabinet — stores, services, billing, reports, the 1C export, network
 * settings and offline stores. Rules apps/api will enforce: `stores:*`, `reports:view`,
 * `export-1c:*`, `settings:*`, `sync:*` (ADR-0018); cost and margin only with `finance:view-cost`;
 * a store closes by a transfer of its stock and only when the receiver accepts it; an offline
 * store's stock is not moved from the cloud (ADR-0014); duplicates are decided by the offline store.
 */
import {
  checkPin,
  composeInvoice,
  daysInMonth,
  expenseKinds,
  hasPermissions,
  posBufferBounds,
  prescriptionRetentionBounds,
  prorateExpense,
  stockState,
} from '@pharmacy/shared-domain';
import type {
  StoreClosingBlocker,
  StoreClosingWarning,
  CashExpensesOfStore,
  CreateExpenseRequest,
  EmployeeSession,
  Expense,
  NetworkSettings,
  UpdateNetworkSettingsRequest,
  OwnerStore,
  ReportCell,
  ReportColumn,
  ReportKind,
  ReportTable,
  CreateStoreRequest,
  LegalEntity,
  LegalEntityInput,
  ServiceOrder,
  TenantBilling,
  TenantInvoice,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb } from './db';
import type { MockServiceOrder } from './db-owner';
import { categories } from './fixtures-pos';
import { storeDay, stores } from './fixtures';
import { debtOf } from './handlers-purchasing';
import {
  invoiceState,
  MOCK_FIRST_SALE,
  MOCK_PRICE_PER_STORE_MINOR,
  MOCK_VAT_BP,
  shiftPeriod,
} from './owner-billing-seed';
import { closeStore, legalEntityName, ownerStore } from './owner-stores';
import { appendAudit } from './handlers-staff';
import { context, findDoc, stockAt, stockHandlers } from './handlers-stock';
import { storePrice } from './pricing';
import type { MockHandlers } from './types';

type OwnerRoute = Extract<
  ApiRouteKey,
  | `stores.${string}`
  | `legalEntities.${string}`
  | `services.${string}`
  | 'serviceRequests.create'
  | 'serviceRequests.withdraw'
  | 'billing.get'
  | 'billing.invoice'
  | 'reports.get'
  | `expenses.${string}`
  | `export1c.${string}`
  | `settings.${string}`
  | 'sync.stores'
  | 'sync.queue'
  | 'sync.run'
  | 'catalog.resolveDuplicate'
>;

const owner = () => mockDb().owner;

const localized = (ru: string, tj: string | null, locale: 'ru' | 'tg') =>
  locale === 'tg' && tj !== null ? tj : ru;

function withName(
  order: MockServiceOrder,
  locale: 'ru' | 'tg',
): ServiceOrder {
  const service = owner().services.find((s) => s.id === order.serviceId);
  return {
    ...order,
    serviceName: service
      ? localized(service.nameRu, service.nameTj, locale)
      : '',
  };
}
const activeCategories = () =>
  mockDb()
    .catalog.categories.filter((c) => c.status === 'active')
    .map((c) => ({ id: c.id, name: c.nameRu }));
const today = () => toAppDate();

const validation = (correlationId: string, field: string, code: string) =>
  new ApiError(422, 'validation_failed', correlationId, [{ field, code }]);

/* ---------------- stores ---------------- */

const TAX_ID = /^\d{9}$/;
const STORE_CODE = /^[A-Z0-9]{1,8}$/;

const invalid = (correlationId: string, field: string, code: string) =>
  new ApiError(400, 'validation_failed', correlationId, [{ field, code }]);

function legalEntityInput(
  body: Partial<LegalEntityInput>,
  correlationId: string,
  prefix = '',
): Partial<LegalEntityInput> {
  if (body.name !== undefined && !body.name.trim()) {
    throw invalid(correlationId, `${prefix}name`, 'required');
  }
  if (body.taxId !== undefined && !TAX_ID.test(body.taxId.trim())) {
    throw invalid(correlationId, `${prefix}taxId`, 'format');
  }
  if (body.legalAddress !== undefined && !body.legalAddress.trim()) {
    throw invalid(correlationId, `${prefix}legalAddress`, 'required');
  }
  const blankToNull = (value: string | null | undefined) =>
    value === undefined ? undefined : value?.trim() || null;
  return Object.fromEntries(
    Object.entries({
      name: body.name?.trim(),
      taxId: body.taxId?.trim(),
      legalAddress: body.legalAddress?.trim(),
      phone: blankToNull(body.phone),
      email: blankToNull(body.email),
      bankDetails: blankToNull(body.bankDetails),
    }).filter(([, value]) => value !== undefined),
  );
}

function taxIdTaken(taxId: string, exceptId: string | null) {
  return owner().legalEntities.some(
    (e) => e.taxId === taxId && e.id !== exceptId,
  );
}

function toLegalEntity(id: string): LegalEntity {
  const entity = owner().legalEntities.find((e) => e.id === id);
  if (!entity) throw new Error(`no legal entity ${id}`);
  const all = [...Object.values(owner().storeDetails), ...owner().extraStores];
  return {
    ...entity,
    stores: all.filter((s) => s.legalEntityId === id).length,
  };
}

function createLegalEntity(
  input: LegalEntityInput,
  correlationId: string,
  taxIdField: string,
): string {
  if (taxIdTaken(input.taxId, null)) {
    throw new ApiError(409, 'tax_id_taken', correlationId, [
      { field: taxIdField, code: 'tax_id_taken' },
    ]);
  }
  const id = `le-${owner().counters.legalEntity++}`;
  owner().legalEntities.push({
    id,
    name: input.name,
    taxId: input.taxId,
    legalAddress: input.legalAddress,
    phone: input.phone ?? null,
    email: input.email ?? null,
    bankDetails: input.bankDetails ?? null,
  });
  return id;
}

function storeCodes(): string[] {
  return [
    ...Object.values(owner().storeDetails).map((d) => d.code),
    ...owner().extraStores.map((s) => s.code),
  ];
}

function checkStore(body: CreateStoreRequest, correlationId: string) {
  if (!body.name.trim()) throw invalid(correlationId, 'name', 'required');
  if (!body.address.trim()) {
    throw invalid(correlationId, 'address', 'required');
  }
  if (!STORE_CODE.test(body.code.trim().toUpperCase())) {
    throw invalid(correlationId, 'code', 'format');
  }
  if (Boolean(body.legalEntityId) === Boolean(body.newLegalEntity)) {
    throw invalid(correlationId, 'legalEntityId', 'exactly_one');
  }
}

function activeLegalEntity(id: string, correlationId: string): string {
  if (!owner().legalEntities.some((e) => e.id === id)) {
    throw new ApiError(404, 'not_found', correlationId);
  }
  return id;
}

/* ---------------- reports ---------------- */

const CATEGORY_SHARE: Record<string, { share: number; cost: number }> = {
  'cat-analgesics': { share: 0.26, cost: 0.67 },
  'cat-antibiotics': { share: 0.23, cost: 0.72 },
  'cat-vitamins': { share: 0.2, cost: 0.66 },
  'cat-children': { share: 0.17, cost: 0.77 },
  'cat-other': { share: 0.14, cost: 0.7 },
};

const col = (key: string, type: ReportColumn['type']): ReportColumn => ({
  key,
  type,
});

const percentOf = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part * 1000) / whole) / 10;

const sumOf = (rows: Array<Record<string, ReportCell>>, key: string) =>
  rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);

function sumRows(
  rows: Array<Record<string, ReportCell>>,
  keys: string[],
  label: string,
  firstKey: string,
) {
  const total: Record<string, ReportCell> = { [firstKey]: label };
  for (const key of keys) {
    total[key] = rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  }
  return total;
}

const inPeriod = (date: string, from: string, to: string) =>
  date.slice(0, 10) >= from && date.slice(0, 10) <= to;

/* ---------------- store closing (spec 2026-10-15-store-closing) ---------------- */

/** Lines a transfer of the closing takes: the limit of the acceptance (E6). */
const CLOSING_LINES = 500;

/** The store to close: in scope, cloud, active, not the last one (E2, E3). */
function closingGuard(
  storeId: string,
  session: EmployeeSession,
  correlationId: string,
): OwnerStore {
  if (owner().extraStores.some((s) => s.id === storeId)) {
    throw new ApiError(409, 'store_closed', correlationId);
  }
  const store = ownerStore(storeId);
  if (!store) throw new ApiError(404, 'not_found', correlationId);
  if (!session.stores.some((s) => s.id === storeId)) {
    throw new ApiError(403, 'store_not_in_scope', correlationId);
  }
  if (store.mode !== 'cloud' || store.status === 'pending') {
    throw new ApiError(409, 'offline_store_read_only', correlationId);
  }
  if (store.status === 'closing') {
    throw new ApiError(409, 'store_closing', correlationId);
  }
  const active = Object.values(owner().storeDetails).filter(
    (d) => d.status === 'active',
  ).length;
  if (active <= 1) throw new ApiError(409, 'last_store', correlationId);
  return store;
}

/** The batches of the store with a positive stock, by product and batch. */
function closingStock(storeId: string) {
  const held = stockAt(storeId);
  return mockDb().pos.products.flatMap((product) =>
    product.batches
      .map((batch) => ({ product, batch, held: held[batch.id] ?? 0 }))
      .filter(({ held: pieces }) => pieces > 0),
  );
}

/** What forbids the closing (E7) — the facts the mocks keep. */
function closingBlockers(storeId: string): StoreClosingBlocker[] {
  const stock = mockDb().stock;
  const held = stockAt(storeId);
  const counts: Array<[StoreClosingBlocker['code'], number]> = [
    [
      'open_shift',
      mockDb().pos.shifts.filter((s) => s.storeId === storeId && !s.closedAt)
        .length,
    ],
    [
      'stock_count',
      stock.stockCounts.filter(
        (c) => c.storeId === storeId && c.status === 'in_progress',
      ).length,
    ],
    [
      'incoming_transfer',
      stock.transfers.filter(
        (t) => t.toStoreId === storeId && t.status === 'in_transit',
      ).length,
    ],
    [
      'outgoing_transfer',
      stock.transfers.filter(
        (t) => t.fromStoreId === storeId && t.status === 'in_transit',
      ).length,
    ],
    [
      'transfer_request',
      stock.transferRequests.filter(
        (r) =>
          (r.requesterStoreId === storeId || r.fromStoreId === storeId) &&
          ['draft', 'sent', 'in_progress'].includes(r.status),
      ).length,
    ],
    ['negative_stock', Object.values(held).filter((q) => q < 0).length],
  ];
  return counts
    .filter(([, count]) => count > 0)
    .map(([code, count]) => ({ code, count }));
}

/** What stays behind the closing (E8): the drafts of the stock documents of the store. */
function closingWarnings(storeId: string): StoreClosingWarning[] {
  const stock = mockDb().stock;
  const drafts = [
    ...stock.goodsReceipts,
    ...stock.writeOffs,
    ...stock.supplierReturns,
  ].filter((d) => d.storeId === storeId && d.status === 'draft').length;
  return drafts > 0 ? [{ code: 'draft_documents', count: drafts }] : [];
}

/* ---------------- other expenses (spec 2026-10-14-owner-cabinet, E16) ---------------- */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A record the employee may see: of a store of the scope, of the network for the whole network. */
const expenseVisible = (session: EmployeeSession, storeId: string | null) =>
  storeId === null
    ? session.scope === 'network'
    : session.scope === 'network' || session.stores.some((s) => s.id === storeId);

/** The cash withdrawals «на расходы» of the stores in [from, to], by the store of the shift. */
function cashExpensesOf(
  storeIds: readonly string[],
  from: string,
  to: string,
): { storeId: string; amountMinor: number; operations: number }[] {
  const result = new Map<string, { amountMinor: number; operations: number }>();
  for (const shift of mockDb().pos.shifts) {
    if (!storeIds.includes(shift.storeId)) continue;
    for (const event of shift.events) {
      const date = toAppDate(new Date(event.at));
      if (event.kind !== 'cash_out' || event.reference !== 'expense') continue;
      if (date < from || date > to) continue;
      const sum = result.get(shift.storeId) ?? { amountMinor: 0, operations: 0 };
      sum.amountMinor += Math.abs(event.amountMinor);
      sum.operations += 1;
      result.set(shift.storeId, sum);
    }
  }
  return [...result].map(([storeId, sum]) => ({ storeId, ...sum }));
}

function expenseInput(
  body: CreateExpenseRequest,
  session: EmployeeSession,
  correlationId: string,
): Expense {
  if (!MONTH.test(body.month)) throw invalid(correlationId, 'month', 'matches');
  if (!(expenseKinds as readonly string[]).includes(body.kind)) {
    throw invalid(correlationId, 'kind', 'is_in');
  }
  if (!Number.isInteger(body.amountMinor) || body.amountMinor < 1) {
    throw invalid(correlationId, 'amountMinor', 'min');
  }
  const comment = body.comment?.trim() || null;
  if (comment && comment.length > 500) {
    throw invalid(correlationId, 'comment', 'max_length');
  }
  if (body.month > today().slice(0, 7)) {
    throw validation(correlationId, 'month', 'range');
  }
  if (body.storeId === null ? session.scope !== 'network' : !session.stores.some((st) => st.id === body.storeId)) {
    throw new ApiError(403, 'store_not_in_scope', correlationId);
  }
  return {
    id: '',
    month: body.month,
    storeId: body.storeId,
    storeName:
      body.storeId === null
        ? null
        : (session.stores.find((st) => st.id === body.storeId)?.name ?? null),
    kind: body.kind,
    amountMinor: body.amountMinor,
    comment,
  };
}

function findExpense(
  id: string,
  session: EmployeeSession,
  correlationId: string,
): Expense {
  const record = owner().expenses.find((e) => e.id === id);
  if (!record) throw new ApiError(404, 'not_found', correlationId);
  if (!expenseVisible(session, record.storeId)) {
    throw new ApiError(403, 'store_not_in_scope', correlationId);
  }
  return record;
}

const expenseParams = (record: Expense) => ({
  amountMinor: record.amountMinor,
  expenseKind: record.kind,
  month: record.month,
});

function report(
  kind: ReportKind,
  session: EmployeeSession,
  canSeeCost: boolean,
  from: string,
  to: string,
  storeId: string | undefined,
): Omit<ReportTable, 'kind'> {
  const days = Math.max(1, daysBetween(from, to) + 1);
  const scoped = session.stores.filter((s) => !storeId || s.id === storeId);
  const costCols = (...columns: ReportColumn[]) => (canSeeCost ? columns : []);
  const products = mockDb().pos.products;
  const stock = mockDb().stock;

  switch (kind) {
    case 'sales_by_store': {
      const rows = scoped.map((store) => {
        const day = storeDay[store.id] ?? { receipts: 0, revenueMinor: 0 };
        const revenue = day.revenueMinor * days;
        const returns = -Math.round(revenue * 0.008);
        const cost = Math.round(revenue * 0.7);
        // write-offs and stock-count shortages at cost (spec 2026-10-14-owner-cabinet, E3)
        const losses = -Math.round(revenue * 0.004);
        const margin = revenue + returns - cost + losses;
        return {
          store: store.name,
          receipts: day.receipts * days,
          revenue,
          returns,
          cost,
          losses,
          margin,
          marginPercent: percentOf(margin, revenue + returns),
        };
      });
      const total = sumRows(
        rows,
        ['receipts', 'revenue', 'returns', 'cost', 'losses', 'margin'],
        'total',
        'store',
      );
      total.marginPercent = percentOf(
        Number(total.margin),
        Number(total.revenue) + Number(total.returns),
      );
      // net profit (spec E16): with finance:view-cost and expenses:view; the network records go to
      // the total only, for the whole network without a store filter
      const canSeeExpenses =
        canSeeCost && hasPermissions(session.permissions, 'expenses:view');
      if (canSeeExpenses) {
        const records = owner().expenses.filter(
          (e) => e.month >= from.slice(0, 7) && e.month <= to.slice(0, 7),
        );
        const cash = cashExpensesOf(
          scoped.map((st) => st.id),
          from,
          to,
        );
        scoped.forEach((store, index) => {
          const row: Record<string, ReportCell> = rows[index];
          const own = -records
            .filter((e) => e.storeId === store.id)
            .reduce((sum, e) => sum + prorateExpense(e.amountMinor, e.month, from, to), 0);
          const out = -(cash.find((c) => c.storeId === store.id)?.amountMinor ?? 0);
          row.expenses = own;
          row.cashExpenses = out;
          row.netProfit = Number(row.margin) + own + out;
        });
        const network =
          session.scope === 'network' && !storeId
            ? records
                .filter((e) => e.storeId === null)
                .reduce((sum, e) => sum + prorateExpense(e.amountMinor, e.month, from, to), 0)
            : 0;
        total.expenses = sumOf(rows, 'expenses') - network;
        total.cashExpenses = sumOf(rows, 'cashExpenses');
        total.netProfit =
          Number(total.margin) + Number(total.expenses) + Number(total.cashExpenses);
      }
      return {
        columns: [
          col('store', 'text'),
          col('receipts', 'count'),
          col('revenue', 'money'),
          col('returns', 'money'),
          ...costCols(
            col('cost', 'money'),
            col('losses', 'money'),
            col('margin', 'money'),
            col('marginPercent', 'percent'),
          ),
          ...(canSeeExpenses
            ? [
                col('expenses', 'money'),
                col('cashExpenses', 'money'),
                col('netProfit', 'money'),
              ]
            : []),
        ],
        rows,
        total,
      };
    }
    case 'sales_by_category': {
      const revenueAll = scoped.reduce(
        (sum, s) => sum + (storeDay[s.id]?.revenueMinor ?? 0) * days,
        0,
      );
      const rows = categories.map((category) => {
        const { share, cost: costRatio } = CATEGORY_SHARE[category.id] ?? {
          share: 0,
          cost: 0.7,
        };
        const revenue = Math.round(revenueAll * share);
        const cost = Math.round(revenue * costRatio);
        return {
          category: category.name,
          revenue,
          cost,
          margin: revenue - cost,
          marginPercent: percentOf(revenue - cost, revenue),
        };
      });
      const total = sumRows(
        rows,
        ['revenue', 'cost', 'margin'],
        'total',
        'category',
      );
      total.marginPercent = percentOf(
        Number(total.margin),
        Number(total.revenue),
      );
      return {
        columns: [
          col('category', 'text'),
          col('revenue', 'money'),
          ...costCols(
            col('cost', 'money'),
            col('margin', 'money'),
            col('marginPercent', 'percent'),
          ),
        ],
        rows,
        total,
      };
    }
    case 'stock': {
      const notice = owner().settings.expiryNoticeDays;
      const rows = scoped.map((store) => {
        let positions = 0;
        let cost = 0;
        let retail = 0;
        let low = 0;
        let expiring = 0;
        for (const product of products) {
          const pieces = product.batches.reduce(
            (sum, b) => sum + (stockAt(store.id)[b.id] ?? 0),
            0,
          );
          if (pieces > 0) positions += 1;
          retail += Math.round(
            (Math.max(0, pieces) * storePrice(store.id, product)) /
              product.piecesPerPack,
          );
          for (const batch of product.batches) {
            const held = stockAt(store.id)[batch.id] ?? 0;
            if (held <= 0) continue;
            cost += Math.round(
              (held * (batch.costMinor ?? 0)) / product.piecesPerPack,
            );
            if (daysBetween(today(), batch.expiresOn) <= notice) expiring += 1;
          }
          const state = stockState({
            quantityPieces: pieces,
            minPieces:
              (stock.minPacks[product.id] ?? 0) * product.piecesPerPack,
            daysToExpiry: null,
          });
          if (state === 'low' || state === 'out') low += 1;
        }
        return { store: store.name, positions, cost, retail, low, expiring };
      });
      return {
        columns: [
          col('store', 'text'),
          col('positions', 'count'),
          ...costCols(col('cost', 'money')),
          col('retail', 'money'),
          col('low', 'count'),
          col('expiring', 'count'),
        ],
        rows,
        total: sumRows(
          rows,
          ['positions', 'cost', 'retail', 'low', 'expiring'],
          'total',
          'store',
        ),
      };
    }
    case 'movement': {
      const ids = scoped.map((s) => s.id);
      const rows = products.map((product) => {
        const perPack = product.piecesPerPack;
        const receipt =
          stock.goodsReceipts
            .filter(
              (d) =>
                d.status === 'posted' &&
                ids.includes(d.storeId) &&
                inPeriod(d.date, from, to),
            )
            .flatMap((d) => d.lines)
            .filter((l) => l.productId === product.id)
            .reduce((sum, l) => sum + l.quantity, 0) * perPack;
        const transfers = Math.round(
          stock.transfers
            .filter(
              (t) => t.status === 'accepted' && inPeriod(t.date, from, to),
            )
            .reduce((sum, t) => {
              const moved = t.lines
                .filter((l) => l.productId === product.id)
                .reduce((s, l) => {
                  const quantity = l.receivedQuantity ?? l.sentQuantity;
                  return (
                    s + (l.unit === 'piece' ? quantity : quantity * perPack)
                  );
                }, 0);
              const sign =
                (ids.includes(t.toStoreId) ? 1 : 0) -
                (ids.includes(t.fromStoreId) ? 1 : 0);
              return sum + sign * moved;
            }, 0),
        );
        const sales = -mockDb()
          .pos.receipts.filter(
            (r) => ids.includes(r.storeId) && inPeriod(r.soldAt, from, to),
          )
          .flatMap((r) => r.lines)
          .filter((l) => l.productId === product.id)
          .reduce(
            (sum, l) =>
              sum + (l.unit === 'pack' ? l.quantity * perPack : l.quantity),
            0,
          );
        const writeOffs = -stock.writeOffs
          .filter(
            (d) =>
              d.status === 'posted' &&
              ids.includes(d.storeId) &&
              inPeriod(d.date, from, to),
          )
          .flatMap((d) => d.lines)
          .filter((l) => l.productId === product.id)
          .reduce(
            (sum, l) =>
              sum + (l.unit === 'pack' ? l.quantity * perPack : l.quantity),
            0,
          );
        const closing = ids.reduce(
          (sum, id) =>
            sum +
            product.batches.reduce((s, b) => s + (stockAt(id)[b.id] ?? 0), 0),
          0,
        );
        return {
          product: product.name,
          piecesPerPack: perPack,
          opening: closing - receipt - transfers - sales - writeOffs,
          receipt,
          transfers,
          sales,
          supplierReturns: 0,
          writeOffs,
          stockCount: 0,
          closing,
        };
      });
      return {
        columns: [
          col('product', 'text'),
          col('opening', 'pieces'),
          col('receipt', 'pieces'),
          col('transfers', 'pieces'),
          col('sales', 'pieces'),
          col('supplierReturns', 'pieces'),
          col('writeOffs', 'pieces'),
          col('stockCount', 'pieces'),
          col('closing', 'pieces'),
        ],
        rows,
        total: null,
      };
    }
    case 'supplier_debts': {
      const rows = stock.suppliers.map((supplier) => {
        const debt = debtOf(supplier.id);
        return {
          supplier: supplier.name,
          debt: debt.debtMinor,
          overdue: debt.overdueMinor,
          nextDueOn: debt.nextDueOn,
        };
      });
      return {
        columns: [
          col('supplier', 'text'),
          ...costCols(col('debt', 'money'), col('overdue', 'money')),
          col('nextDueOn', 'date'),
        ],
        rows,
        total: canSeeCost
          ? sumRows(rows, ['debt', 'overdue'], 'total', 'supplier')
          : null,
      };
    }
    case 'cashiers': {
      const rows = mockDb()
        .employees.filter(
          (e) =>
            e.storeIds !== null &&
            e.status === 'active' &&
            owner()
              .roles.find((r) => r.id === e.roleId)
              ?.permissions.includes('pos:create'),
        )
        .flatMap((e) => {
          const storeIdOf = e.storeIds?.find((id) =>
            scoped.some((s) => s.id === id),
          );
          if (!storeIdOf) return [];
          const day = storeDay[storeIdOf] ?? { receipts: 0, revenueMinor: 0 };
          const sales = Math.round(day.revenueMinor * days * 0.45);
          const cash = Math.round(sales * 0.5);
          const card = Math.round(sales * 0.3);
          const qr = Math.round(sales * 0.1);
          const nfc = sales - cash - card - qr;
          const returns = -Math.round(sales * 0.006);
          return [
            {
              cashier: e.shortName,
              store: scoped.find((s) => s.id === storeIdOf)?.name ?? '—',
              receipts: Math.round(day.receipts * days * 0.45),
              cash,
              card,
              qr,
              nfc,
              returns,
              revenue: sales + returns,
            },
          ];
        });
      return {
        columns: [
          col('cashier', 'text'),
          col('store', 'text'),
          col('receipts', 'count'),
          col('cash', 'money'),
          col('card', 'money'),
          col('qr', 'money'),
          col('nfc', 'money'),
          col('returns', 'money'),
          col('revenue', 'money'),
        ],
        rows,
        total: sumRows(
          rows,
          ['receipts', 'cash', 'card', 'qr', 'nfc', 'returns', 'revenue'],
          'total',
          'cashier',
        ),
      };
    }
    case 'losses': {
      const names = scoped.map((s) => s.name);
      const rows = stock.writeOffs
        .filter(
          (d) =>
            d.status === 'posted' &&
            names.includes(d.storeName) &&
            inPeriod(d.date, from, to),
        )
        .flatMap((d) =>
          d.lines.map((l) => {
            const perPack =
              products.find((p) => p.id === l.productId)?.piecesPerPack ?? 1;
            const qty = l.unit === 'pack' ? l.quantity * perPack : l.quantity;
            return {
              number: d.number,
              date: d.date,
              store: d.storeName,
              product: l.productName,
              reason: d.reason,
              quantity: qty,
              piecesPerPack: perPack,
              amount: Math.round(
                ((d.totalMinor ?? 0) * l.quantity) /
                  Math.max(
                    1,
                    d.lines.reduce((sum, x) => sum + x.quantity, 0),
                  ),
              ),
            };
          }),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        columns: [
          col('number', 'text'),
          col('date', 'date'),
          col('store', 'text'),
          col('product', 'text'),
          col('reason', 'reason'),
          col('quantity', 'pieces'),
          ...costCols(col('amount', 'money')),
        ],
        rows,
        total: canSeeCost ? sumRows(rows, ['amount'], 'total', 'number') : null,
      };
    }
    case 'controlled': {
      const ids = scoped.map((s) => s.id);
      // the prescription data past the retention term of the network is purged (spec 2026-10-21-pos-offline-limits, P3)
      const retention = mockDb().owner.settings.prescriptionRetentionDays;
      const purged = (soldAt: string) =>
        daysBetween(toAppDate(new Date(soldAt)), toAppDate()) > retention;
      const rows = mockDb()
        .pos.receipts.filter(
          (r) => ids.includes(r.storeId) && inPeriod(r.soldAt, from, to),
        )
        .flatMap((r) =>
          r.lines
            .filter((l) => l.controlled !== null)
            .map((l) => ({
              at: r.soldAt,
              receivedAt: r.receivedAt ?? r.soldAt,
              store: scoped.find((s) => s.id === r.storeId)?.name ?? '—',
              product: l.productName,
              batch: l.batchNumber,
              quantity:
                l.unit === 'pack' ? l.quantity * l.piecesPerPack : l.quantity,
              piecesPerPack: l.piecesPerPack,
              cashier: r.cashierName,
              receipt: r.number,
              ...(purged(r.soldAt) ? { prescriptionPurged: 1 } : {}),
              prescription: purged(r.soldAt)
                ? null
                : l.controlled
                ? [
                    l.controlled.prescriptionNumber,
                    l.controlled.prescriptionDate,
                    l.controlled.clinic,
                    l.controlled.doctor,
                  ]
                    .filter(Boolean)
                    .join(' · ') || null
                : null,
            })),
        )
        .sort((a, b) => b.at.localeCompare(a.at));
      return {
        columns: [
          col('at', 'datetime'),
          col('receivedAt', 'datetime'),
          col('store', 'text'),
          col('product', 'text'),
          col('batch', 'text'),
          col('quantity', 'pieces'),
          col('cashier', 'text'),
          col('receipt', 'text'),
          col('prescription', 'text'),
        ],
        rows,
        total: null,
      };
    }
    case 'controlled_summary': {
      // ПКУ by product × store: received and issued in pieces, the closing from the stock (O6)
      const rows = products
        .filter((product) => product.prescription === 'controlled')
        .flatMap((product) =>
          scoped.map((store) => {
            const perPack = product.piecesPerPack;
            const issued = mockDb()
              .pos.receipts.filter(
                (r) => r.storeId === store.id && inPeriod(r.soldAt, from, to),
              )
              .flatMap((r) => r.lines)
              .filter((l) => l.productId === product.id)
              .reduce(
                (sum, l) =>
                  sum + (l.unit === 'pack' ? l.quantity * perPack : l.quantity),
                0,
              );
            const closing = product.batches.reduce(
              (sum, b) => sum + (stockAt(store.id)[b.id] ?? 0),
              0,
            );
            return {
              product: product.name,
              store: store.name,
              piecesPerPack: perPack,
              opening: closing + issued,
              received: 0,
              issued,
              closing,
            };
          }),
        );
      return {
        columns: [
          col('product', 'text'),
          col('store', 'text'),
          col('opening', 'pieces'),
          col('received', 'pieces'),
          col('issued', 'pieces'),
          col('closing', 'pieces'),
        ],
        rows,
        total: null,
      };
    }
  }
}

/* ---------------- 1C ---------------- */

function unmappedProducts() {
  const articles = owner().articles1c;
  const used = new Map<string, string>();
  for (const [productId, article] of Object.entries(articles)) {
    if (used.has(article)) continue;
    used.set(article, productId);
  }
  return mockDb()
    .pos.products.filter(
      (p) => !articles[p.id] || used.get(articles[p.id]) !== p.id,
    )
    .map((p) => ({
      productId: p.id,
      productName: p.name,
      barcode: p.barcodes[0] ?? null,
      conflictArticle: articles[p.id] ?? null,
    }));
}

const xmlEscape = (value: string) =>
  value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ---------------- settings ---------------- */

function settingsInput(
  body: UpdateNetworkSettingsRequest,
  correlationId: string,
): NetworkSettings {
  const range = (
    field: keyof UpdateNetworkSettingsRequest,
    min: number,
    max: number,
  ) => {
    const value = body[field];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw validation(correlationId, field, 'invalid');
    }
    if (value < min || value > max) {
      throw validation(correlationId, field, 'range');
    }
  };
  // the API keeps an idle session at least 5 minutes (spec 2026-10-14-owner-cabinet, E14)
  range('posSessionTimeoutMinutes', 5, 240);
  range('minPinLength', 4, 8);
  range('expiryNoticeDays', 1, 365);
  // the POS without the connection and the prescription data (spec 2026-10-21-pos-offline-limits, P2, P6)
  range('prescriptionRetentionDays', ...prescriptionRetentionBounds);
  range('posBufferMaxHours', ...posBufferBounds.maxHours);
  range('posBufferMaxOperations', ...posBufferBounds.maxOperations);
  range('posControlledMaxHours', ...posBufferBounds.controlledMaxHours);
  range('posControlledMaxOperations', ...posBufferBounds.controlledMaxOperations);
  if (body.posControlledMaxHours > body.posBufferMaxHours) {
    throw validation(correlationId, 'posControlledMaxHours', 'max');
  }
  if (body.posControlledMaxOperations > body.posBufferMaxOperations) {
    throw validation(correlationId, 'posControlledMaxOperations', 'max');
  }
  const kinds = Object.keys(owner().settings.notifications);
  const given = Object.keys(body.notifications ?? {});
  if (
    given.length !== kinds.length ||
    kinds.some((kind) => typeof body.notifications[kind as never] !== 'boolean')
  ) {
    throw new ApiError(400, 'validation_failed', correlationId, [
      { field: 'notifications', code: 'invalid' },
    ]);
  }
  // the name of the network is the operator's (E14): the owner cannot change it here
  return {
    networkName: owner().settings.networkName,
    posSessionTimeoutMinutes: body.posSessionTimeoutMinutes,
    minPinLength: body.minPinLength,
    expiryNoticeDays: body.expiryNoticeDays,
    warnBelowCost: body.warnBelowCost,
    notifications: { ...body.notifications },
    prescriptionRetentionDays: body.prescriptionRetentionDays,
    posBufferMaxHours: body.posBufferMaxHours,
    posBufferMaxOperations: body.posBufferMaxOperations,
    posControlledMaxHours: body.posControlledMaxHours,
    posControlledMaxOperations: body.posControlledMaxOperations,
    receiptFooter: {
      ru: body.receiptFooter.ru.trim(),
      tj: body.receiptFooter.tj.trim(),
    },
  };
}

function requireOfflineStore(correlationId: string) {
  if (owner().deployment !== 'offline-store') {
    throw new ApiError(404, 'not_found', correlationId);
  }
}

export const ownerHandlers: Pick<MockHandlers, OwnerRoute> = {
  'stores.overview': ({ correlationId }) => {
    const { session } = context(correlationId, 'stores:view');
    const visible = session.stores
      .map((s) => ownerStore(s.id))
      .filter((s): s is OwnerStore => s !== null);
    return {
      stores:
        session.scope === 'network'
          ? [...visible, ...owner().extraStores]
          : visible,
    };
  },
  'stores.create': ({ body, correlationId, idempotencyKey }) => {
    const { session } = context(correlationId, 'stores:create', {
      write: true,
    });
    const repeated = idempotencyKey && owner().storeKeys[idempotencyKey];
    if (repeated) {
      const store = ownerStore(repeated);
      if (store) return store;
    }
    checkStore(body, correlationId);
    const code = body.code.trim().toUpperCase();
    if (storeCodes().includes(code)) {
      throw new ApiError(409, 'store_code_taken', correlationId, [
        { field: 'code', code: 'store_code_taken' },
      ]);
    }
    const legalEntityId = body.newLegalEntity
      ? createLegalEntity(
          legalEntityInput(
            body.newLegalEntity,
            correlationId,
            'newLegalEntity.',
          ) as LegalEntityInput,
          correlationId,
          'newLegalEntity.taxId',
        )
      : activeLegalEntity(body.legalEntityId ?? '', correlationId);
    // A new store is an active cloud store at once (spec 2026-10-06-owner-stores, section 3).
    const id = `store-${owner().counters.store++}`;
    stores.push({
      id,
      name: body.name.trim(),
      address: body.address.trim(),
      mode: 'cloud',
    });
    owner().storeDetails[id] = {
      code,
      kind: body.kind,
      legalEntityId,
      printReceiptDefault: body.printReceiptDefault,
      status: 'active',
      licenseValidUntil: null,
      closedOn: null,
      stockMovedTo: null,
    };
    if (idempotencyKey) owner().storeKeys[idempotencyKey] = id;
    appendAudit(session, {
      event: 'store.created',
      object: body.name.trim(),
      storeName: null,
    });
    const store = ownerStore(id);
    if (!store) throw new ApiError(404, 'not_found', correlationId);
    return store;
  },
  'stores.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'stores:update', {
      write: true,
    });
    if (!body.name.trim()) throw invalid(correlationId, 'name', 'required');
    if (!body.address.trim()) {
      throw invalid(correlationId, 'address', 'required');
    }
    const legalEntityId = activeLegalEntity(body.legalEntityId, correlationId);
    const extra = owner().extraStores.find((s) => s.id === params.id);
    if (extra) {
      if (extra.status === 'closed') {
        throw new ApiError(409, 'store_closed', correlationId);
      }
      Object.assign(extra, {
        name: body.name.trim(),
        address: body.address.trim(),
        legalEntityId,
        legalEntityName: legalEntityName(legalEntityId),
        printReceiptDefault: body.printReceiptDefault,
      });
      return extra;
    }
    const base = stores.find((s) => s.id === params.id);
    // a store outside the scope does not exist for the employee
    if (!base || !session.stores.some((s) => s.id === base.id)) {
      throw new ApiError(404, 'not_found', correlationId);
    }
    base.name = body.name.trim();
    base.address = body.address.trim();
    Object.assign(owner().storeDetails[base.id], {
      legalEntityId,
      printReceiptDefault: body.printReceiptDefault,
    });
    appendAudit(session, {
      event: 'store.updated',
      object: base.name,
      storeName: base.name,
    });
    mockDb().pos.catalogVersion += 1;
    const updated = ownerStore(base.id);
    if (!updated) throw new ApiError(404, 'not_found', correlationId);
    return updated;
  },
  'legalEntities.list': ({ correlationId }) => {
    context(correlationId, 'stores:view');
    return {
      items: owner()
        .legalEntities.map((e) => toLegalEntity(e.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
      defaults: {
        name: owner().settings.networkName,
        taxId: owner().legalEntities[0]?.taxId ?? null,
      },
    };
  },
  'legalEntities.create': ({ body, correlationId }) => {
    context(correlationId, 'stores:create', { write: true });
    const input = legalEntityInput(body, correlationId) as LegalEntityInput;
    return toLegalEntity(createLegalEntity(input, correlationId, 'taxId'));
  },
  'legalEntities.update': ({ params, body, correlationId }) => {
    context(correlationId, 'stores:update', { write: true });
    const entity = owner().legalEntities.find((e) => e.id === params.id);
    if (!entity) throw new ApiError(404, 'not_found', correlationId);
    const change = legalEntityInput(body, correlationId);
    if (change.taxId && taxIdTaken(change.taxId, entity.id)) {
      throw new ApiError(409, 'tax_id_taken', correlationId, [
        { field: 'taxId', code: 'tax_id_taken' },
      ]);
    }
    Object.assign(entity, change);
    return toLegalEntity(entity.id);
  },
  'stores.closingPreview': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'stores:delete');
    const store = closingGuard(params.id, session, correlationId);
    const lines = closingStock(store.id).map(({ product, batch, held }) => ({
      productName: product.name,
      batchNumber: batch.number,
      expiresOn: batch.expiresOn,
      quantityPieces: held,
      piecesPerPack: product.piecesPerPack,
      ...(canSeeCost && {
        costMinor: Math.round(
          (held * (batch.costMinor ?? 0)) / product.piecesPerPack,
        ),
      }),
    }));
    return {
      lines,
      positions: lines.length,
      ...(canSeeCost && {
        totalCostMinor: lines.reduce((sum, l) => sum + (l.costMinor ?? 0), 0),
      }),
      transfers: Math.ceil(lines.length / CLOSING_LINES),
      blockers: closingBlockers(store.id),
      warnings: closingWarnings(store.id),
    };
  },
  'stores.close': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'stores:delete', {
      write: true,
    });
    const store = closingGuard(params.id, session, correlationId);
    const blockers = closingBlockers(store.id);
    if (blockers.length > 0) {
      throw new ApiError(
        409,
        'store_not_closable',
        correlationId,
        blockers.map((b) => ({ field: b.code, code: 'blocked' })),
      );
    }
    const stock = closingStock(store.id);
    const details = owner().storeDetails[store.id];
    if (stock.length === 0) {
      // a store without stock closes at once (spec 2026-10-15-store-closing, Z4)
      closeStore(store.id);
      appendAudit(session, {
        event: 'store.closed',
        object: store.name,
        storeName: store.name,
      });
      return {
        transferNumbers: [],
        store: owner().extraStores.find((s) => s.id === store.id) as OwnerStore,
      };
    }
    const receiver = stores.find((s) => s.id === body.receiverStoreId);
    if (
      !receiver ||
      receiver.id === store.id ||
      receiver.mode !== 'cloud' ||
      owner().storeDetails[receiver.id]?.status !== 'active'
    ) {
      throw validation(correlationId, 'receiverStoreId', 'invalid');
    }
    // one line per batch: whole packs in packs, an opened pack in pieces (E5); 500 lines a transfer (E6)
    const lines = stock.map(({ product, batch, held }) => {
      const whole = held % product.piecesPerPack === 0;
      return {
        productId: product.id,
        batchId: batch.id,
        unit: whole ? ('pack' as const) : ('piece' as const),
        quantity: whole ? held / product.piecesPerPack : held,
      };
    });
    const transfers = [];
    for (let i = 0; i < lines.length; i += CLOSING_LINES) {
      transfers.push(
        stockHandlers['transfers.create']({
          params: undefined,
          query: undefined,
          body: {
            requestId: null,
            fromStoreId: store.id,
            toStoreId: receiver.id,
            send: true,
            lines: lines.slice(i, i + CLOSING_LINES),
          },
          correlationId,
        }),
      );
    }
    Object.assign(details, {
      status: 'closing',
      stockMovedTo: receiver.name,
      closingTransferIds: transfers.map((t) => t.id),
    });
    appendAudit(session, {
      event: 'store.closing-started',
      object: store.name,
      storeName: store.name,
    });
    const closing = ownerStore(store.id);
    if (!closing) throw new ApiError(404, 'not_found', correlationId);
    return { transferNumbers: transfers.map((t) => t.number), store: closing };
  },
  'stores.cancelClosing': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'stores:delete', {
      write: true,
    });
    const details = owner().storeDetails[params.id];
    if (!details) {
      if (owner().extraStores.some((s) => s.id === params.id)) {
        throw new ApiError(409, 'store_closed', correlationId);
      }
      throw new ApiError(404, 'not_found', correlationId);
    }
    const store = ownerStore(params.id);
    if (!store || store.status !== 'closing') {
      throw new ApiError(404, 'not_found', correlationId);
    }
    if (!store.closingCancellable) {
      throw new ApiError(409, 'closing_partly_received', correlationId);
    }
    for (const id of details.closingTransferIds ?? []) {
      const args = { params: { id }, query: undefined, body: undefined, correlationId };
      stockHandlers['transfers.recall'](args);
      stockHandlers['transfers.cancel'](args);
    }
    Object.assign(details, {
      status: 'active',
      stockMovedTo: null,
      closingTransferIds: [],
    });
    appendAudit(session, {
      event: 'store.closing-cancelled',
      object: store.name,
      storeName: store.name,
    });
    return ownerStore(params.id) as OwnerStore;
  },

  // As apps/api (spec 2026-10-15-billing-services, 6.2): the name in the language of the employee,
  // the Russian one without a Tajik text.
  'services.list': ({ correlationId }) => {
    const { session } = context(correlationId, 'services:view');
    const locale = session.locale;
    return {
      catalog: owner().services.map((service) => ({
        id: service.id,
        name: localized(service.nameRu, service.nameTj, locale),
        description: localized(
          service.descriptionRu,
          service.descriptionTj,
          locale,
        ),
        basePriceMinor: service.basePriceMinor,
      })),
      orders: owner().serviceOrders.map((order) => withName(order, locale)),
    };
  },
  'serviceRequests.create': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'services:create', {
      write: true,
    });
    const service = owner().services.find((s) => s.id === body.serviceId);
    if (!service) throw new ApiError(404, 'not_found', correlationId);
    if (
      owner().serviceOrders.some(
        (order) => order.serviceId === service.id && order.status === 'pending',
      )
    ) {
      throw new ApiError(409, 'service_requested', correlationId);
    }
    const order = {
      requestId: `req-${Date.now()}`,
      serviceId: service.id,
      status: 'pending' as const,
      comment: body.comment?.trim() || null,
      requestedAt: new Date().toISOString(),
      priceMinor: null,
      reason: null,
      providedOn: null,
      decidedAt: null,
    };
    owner().serviceOrders.unshift(order);
    appendAudit(session, {
      event: 'settings.service-requested',
      object: service.nameRu,
      storeName: null,
    });
    return withName(order, session.locale);
  },
  'serviceRequests.withdraw': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'services:create', {
      write: true,
    });
    const index = owner().serviceOrders.findIndex(
      (order) => order.requestId === params.id,
    );
    if (index < 0) throw new ApiError(404, 'not_found', correlationId);
    if (owner().serviceOrders[index].status !== 'pending') {
      throw new ApiError(409, 'service_decided', correlationId);
    }
    const [removed] = owner().serviceOrders.splice(index, 1);
    appendAudit(session, {
      event: 'settings.service-request-withdrawn',
      object:
        owner().services.find((s) => s.id === removed.serviceId)?.nameRu ??
        removed.serviceId,
      storeName: null,
    });
  },
  // the estimate of the month by the formulas of an invoice, as the API (spec
  // 2026-10-15-billing-services, A19): cloud pharmacies with sales this month, through today
  'billing.get': ({ correlationId }): TenantBilling => {
    const { session } = context(correlationId, 'billing:view');
    const day = today();
    const period = day.slice(0, 7);
    const db = owner();
    const discounts = db.discounts
      .filter((discount) => discount.toMonth >= period)
      .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
    const current = discounts.find((discount) => discount.fromMonth <= period);
    const active = [
      ...stores.map((store) => ownerStore(store.id)),
      ...db.extraStores,
    ].filter(
      (store): store is OwnerStore =>
        store !== null &&
        store.kind === 'pharmacy' &&
        store.mode === 'cloud' &&
        store.receiptsThisMonth > 0 &&
        (store.closedOn === null || store.closedOn >= `${period}-01`),
    );
    const invoiced = new Set(
      db.invoices.flatMap((invoice) =>
        invoice.lines.map((line) => line.tenantServiceId),
      ),
    );
    // an earlier service goes into the invoice of the previous month until that one is out (A11)
    const previousOut = db.invoices.some(
      (invoice) => invoice.period === shiftPeriod(period, -1),
    );
    const estimate = composeInvoice({
      period,
      pricePerStoreMinor: MOCK_PRICE_PER_STORE_MINOR,
      vatBp: MOCK_VAT_BP,
      discountBp: current?.percentBp ?? null,
      stores: active.map((store) => ({
        storeId: store.id,
        name: store.name,
        firstSaleEver: MOCK_FIRST_SALE,
        closedOn:
          store.closedOn !== null && store.closedOn < day
            ? store.closedOn
            : day,
      })),
      services: db.serviceOrders
        .filter(
          (order) =>
            order.status === 'provided' &&
            order.providedOn !== null &&
            order.providedOn <= day &&
            (order.providedOn >= `${period}-01` || previousOut) &&
            !invoiced.has(order.requestId),
        )
        .map((order) => ({
          tenantServiceId: order.requestId ?? order.serviceId,
          name: withName(order, session.locale).serviceName,
          priceMinor: order.priceMinor ?? 0,
          providedOn: order.providedOn ?? day,
        })),
    });
    const invoices: TenantInvoice[] = [...db.invoices]
      .sort((a, b) => b.period.localeCompare(a.period))
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        period: invoice.period,
        totalMinor: invoice.totalMinor,
        paidMinor: invoice.paidMinor,
        dueOn: invoice.dueOn,
        paidOn: invoice.paidOn,
        ...invoiceState(invoice, day),
      }));
    return {
      estimate: {
        period,
        through: day,
        pricePerStoreMinor: MOCK_PRICE_PER_STORE_MINOR,
        vatRatePercent: MOCK_VAT_BP / 100,
        discountBp: current?.percentBp ?? null,
        lines: estimate.lines,
        netMinor: estimate.subtotalMinor,
        vatMinor: estimate.vatMinor,
        totalMinor: estimate.totalMinor,
      },
      debtMinor: invoices.reduce((sum, i) => sum + i.remainingMinor, 0),
      overdueDebtMinor: invoices
        .filter((invoice) => invoice.overdue)
        .reduce((sum, i) => sum + i.remainingMinor, 0),
      advanceMinor: db.billingAdvanceMinor,
      discounts,
      invoices,
    };
  },
  'billing.invoice': ({ params, correlationId }) => {
    context(correlationId, 'billing:view');
    const invoice = owner().invoices.find((i) => i.id === params.id);
    if (!invoice) throw new ApiError(404, 'not_found', correlationId);
    return { ...invoice, ...invoiceState(invoice, today()) };
  },

  'reports.get': ({ params, query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'reports:view');
    if (query.storeId && !session.stores.some((s) => s.id === query.storeId)) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    if (query.from > query.to) {
      throw validation(correlationId, 'from', 'range');
    }
    const table = report(
      params.kind,
      session,
      canSeeCost,
      query.from,
      query.to,
      query.storeId,
    );
    // the cells of the columns left out are not sent either (ADR-0018, п. 6); the marks of a row stay, as the API
    // sends them (`piecesPerPack`, `prescriptionPurged`)
    const keys = new Set([
      ...table.columns.map((c) => c.key),
      'piecesPerPack',
      'prescriptionPurged',
    ]);
    const pick = (row: Record<string, ReportCell>) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => keys.has(key)));
    return {
      kind: params.kind,
      columns: table.columns,
      rows: table.rows.map(pick),
      total: table.total ? pick(table.total) : null,
    };
  },

  'expenses.list': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'expenses:view');
    if (!MONTH.test(query.month)) throw invalid(correlationId, 'month', 'matches');
    if (query.storeId && !session.stores.some((st) => st.id === query.storeId)) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    const items = owner()
      .expenses.filter((e) => e.month === query.month)
      .filter((e) =>
        query.storeId
          ? e.storeId === query.storeId
          : expenseVisible(session, e.storeId),
      )
      .sort(
        (a, b) =>
          Number(a.storeId !== null) - Number(b.storeId !== null) ||
          (a.storeName ?? '').localeCompare(b.storeName ?? '', 'ru') ||
          expenseKinds.indexOf(a.kind) - expenseKinds.indexOf(b.kind) ||
          b.amountMinor - a.amountMinor,
      );
    const stores = session.stores.filter(
      (st) => !query.storeId || st.id === query.storeId,
    );
    const last = `${query.month}-${String(daysInMonth(query.month)).padStart(2, '0')}`;
    const cash = cashExpensesOf(
      stores.map((st) => st.id),
      `${query.month}-01`,
      last,
    );
    const cashExpenses: CashExpensesOfStore[] = stores.flatMap((st) => {
      const figure = cash.find((c) => c.storeId === st.id);
      return figure
        ? [
            {
              storeId: st.id,
              storeName: st.name,
              amountMinor: figure.amountMinor,
              operations: figure.operations,
            },
          ]
        : [];
    });
    return {
      items: items.map((e) => ({ ...e })),
      totalMinor: items.reduce((sum, e) => sum + e.amountMinor, 0),
      cashExpenses,
    };
  },
  'expenses.create': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'expenses:create', {
      write: true,
    });
    const record = {
      ...expenseInput(body, session, correlationId),
      id: `exp-${++owner().counters.expense}`,
    };
    owner().expenses.push(record);
    appendAudit(session, {
      event: 'expense.created',
      object: null,
      params: expenseParams(record),
      storeName: record.storeName,
    });
    return { ...record };
  },
  'expenses.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'expenses:update', {
      write: true,
    });
    const record = findExpense(params.id, session, correlationId);
    const before = { ...record };
    Object.assign(record, expenseInput(body, session, correlationId), {
      id: record.id,
    });
    // the previous values of the changed fields, as the API writes them
    const previous: Record<string, string | number> = {};
    if (before.month !== record.month) previous.previousMonth = before.month;
    if (before.kind !== record.kind) previous.previousExpenseKind = before.kind;
    if (before.amountMinor !== record.amountMinor) {
      previous.previousAmountMinor = before.amountMinor;
    }
    if (before.storeId !== record.storeId) {
      previous.previousStore = before.storeName ?? 'network';
    }
    appendAudit(session, {
      event: 'expense.updated',
      object: null,
      params: { ...expenseParams(record), ...previous },
      storeName: record.storeName,
    });
    return { ...record };
  },
  'expenses.delete': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'expenses:delete', {
      write: true,
    });
    const record = findExpense(params.id, session, correlationId);
    owner().expenses = owner().expenses.filter((e) => e.id !== record.id);
    appendAudit(session, {
      event: 'expense.deleted',
      object: null,
      params: expenseParams(record),
      storeName: record.storeName,
    });
  },

  'export1c.preview': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'export-1c:view');
    const days = Math.max(1, daysBetween(query.from, query.to) + 1);
    const scoped = session.stores.filter(
      (s) => !query.storeId || s.id === query.storeId,
    );
    const stock = mockDb().stock;
    const documents = [
      ...stock.goodsReceipts,
      ...stock.writeOffs,
      ...stock.supplierReturns,
    ].filter(
      (d) =>
        d.status === 'posted' &&
        scoped.some((s) => s.id === d.storeId) &&
        inPeriod(d.date, query.from, query.to),
    ).length;
    return {
      receipts: scoped.reduce(
        (sum, s) => sum + (storeDay[s.id]?.receipts ?? 0) * days,
        0,
      ),
      documents,
      unmapped: unmappedProducts(),
    };
  },
  'export1c.setArticle': ({ params, body, correlationId }) => {
    context(correlationId, 'export-1c:export', { write: true });
    findDoc(mockDb().pos.products, params.productId, correlationId);
    const article = body.article.trim();
    if (!article) throw validation(correlationId, 'article', 'required');
    const taken = Object.entries(owner().articles1c).find(
      ([productId, value]) =>
        value === article && productId !== params.productId,
    );
    if (taken) throw new ApiError(409, 'article_taken', correlationId);
    owner().articles1c[params.productId] = article;
  },
  'export1c.run': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'export-1c:export', {
      write: true,
    });
    const preview = ownerHandlers['export1c.preview']({
      params: undefined,
      query: {
        from: body.from,
        to: body.to,
        storeId: body.storeId ?? undefined,
      },
      body: undefined,
      correlationId,
    });
    const excluded = new Set(preview.unmapped.map((u) => u.productId));
    const goods = mockDb()
      .pos.products.filter((p) => !excluded.has(p.id))
      .map(
        (p) =>
          `<Товар><Ид>${xmlEscape(owner().articles1c[p.id] ?? '')}</Ид><Наименование>${xmlEscape(p.name)}</Наименование></Товар>`,
      )
      .join('');
    // a skeleton of the CommerceML document — the real one is built by apps/api
    const xml = `<?xml version="1.0" encoding="UTF-8"?><КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="${today()}"><Каталог><Товары>${goods}</Товары></Каталог></КоммерческаяИнформация>`;
    appendAudit(session, {
      event: 'settings.export-1c',
      object: '1С',
      storeName: null,
    });
    return {
      fileName: `export-1c_${body.from}_${body.to}.xml`,
      downloadUrl: `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`,
      receipts: preview.receipts,
      documents: preview.documents,
      excluded: excluded.size,
    };
  },

  'settings.get': ({ correlationId }) => {
    context(correlationId, 'settings:view');
    return owner().settings;
  },
  'settings.update': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'settings:update', {
      write: true,
    });
    // a fresh sign-in, as the API asks for the security settings
    if (session.auth !== 'password') {
      throw new ApiError(403, 'fresh_auth_required', correlationId);
    }
    owner().settings = settingsInput(body, correlationId);
    appendAudit(session, {
      event: 'settings.updated',
      object: 'Настройки сети',
      storeName: null,
    });
    mockDb().pos.catalogVersion += 1;
    return owner().settings;
  },
  'settings.returns': ({ correlationId }) => {
    context(correlationId, 'settings:view');
    return owner().returnPolicy;
  },
  'settings.updateReturns': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'settings:update', {
      write: true,
    });
    const days = body.returnWindowDays;
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      throw validation(correlationId, 'returnWindowDays', 'range');
    }
    owner().returnPolicy = {
      returnWindowDays: days,
      customerReturns: {
        none: Boolean(body.customerReturns.none),
        rx: Boolean(body.customerReturns.rx),
        controlled: Boolean(body.customerReturns.controlled),
      },
    };
    appendAudit(session, {
      event: 'settings.returns-updated',
      object: 'Возвраты покупателей',
      storeName: null,
    });
    mockDb().pos.catalogVersion += 1;
    return owner().returnPolicy;
  },
  'settings.markups': ({ correlationId }) => {
    context(correlationId, 'settings:view');
    return activeCategories().map((c) => ({
      categoryId: c.id,
      categoryName: c.name,
      markupPercent: mockDb().stock.markup[c.id] ?? null,
      products: mockDb().pos.products.filter((p) => p.categoryId === c.id)
        .length,
    }));
  },
  'settings.updateMarkups': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'settings:update', {
      write: true,
    });
    for (const markup of body.markups) {
      if (!activeCategories().some((c) => c.id === markup.categoryId)) {
        throw validation(correlationId, 'categoryId', 'unknown');
      }
      if (
        !Number.isInteger(markup.markupPercent) ||
        markup.markupPercent < 0 ||
        markup.markupPercent > 1000
      ) {
        throw validation(correlationId, 'markupPercent', 'range');
      }
    }
    for (const markup of body.markups) {
      mockDb().stock.markup[markup.categoryId] = markup.markupPercent;
    }
    appendAudit(session, {
      event: 'markups.updated',
      object: 'Наценки категорий',
      storeName: null,
    });
    return ownerHandlers['settings.markups']({
      params: undefined,
      query: undefined,
      body: undefined,
      correlationId,
    });
  },

  'sync.stores': ({ correlationId }) => {
    const { session } = context(correlationId, 'sync:view');
    return session.stores
      .filter((s) => s.mode === 'offline')
      .map((s) => ({
        storeId: s.id,
        storeName: s.name,
        lastSyncAt: owner().lastSyncAt,
        appliedLastDay: 48,
        quarantined: 0,
        licenseValidUntil:
          owner().storeDetails[s.id]?.licenseValidUntil ?? null,
        priceConflicts: mockDb().catalog.priceConflicts.filter(
          (c) => c.storeId === s.id,
        ).length,
        pendingDuplicates: mockDb().catalog.duplicates.filter(
          (d) => d.storeId === s.id && d.status === 'pending',
        ).length,
      }));
  },
  'sync.queue': ({ query, correlationId }) => {
    context(correlationId, 'sync:view');
    requireOfflineStore(correlationId);
    const items = owner().offlineQueue;
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },
  'sync.run': ({ correlationId }) => {
    context(correlationId, 'sync:run', { write: true });
    requireOfflineStore(correlationId);
    const sent = owner().offlineQueue.length;
    owner().offlineQueue = [];
    owner().lastSyncAt = new Date().toISOString();
    return { sent, received: 12, finishedAt: owner().lastSyncAt };
  },
  'catalog.resolveDuplicate': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'catalog:update', {
      write: true,
    });
    requireOfflineStore(correlationId);
    const duplicate = findDoc(
      mockDb().catalog.duplicates,
      params.id,
      correlationId,
    );
    // the store that added the product decides (ADR-0014)
    if (duplicate.storeId !== session.currentStoreId) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    if (duplicate.status !== 'pending') {
      throw new ApiError(409, 'duplicate_resolved', correlationId);
    }
    duplicate.status = body.decision === 'merge' ? 'merged' : 'kept';
  },
};

/** PIN rule with the network minimum (ADR-0008), for the handlers that set a PIN. */
export const networkPinProblem = (pin: string) =>
  checkPin(pin, owner().settings.minPinLength);
