import type {
  ReportCell,
  ReportColumn,
  ReportTable,
} from '@pharmacy/shared-dto';
import type {
  ControlledBalance,
  LossesOfStore,
  LossLine,
  MovementOfProduct,
  StockOfStore,
} from '../inventory/stock-figures';
import type {
  ControlledSale,
  SalesOfCashier,
  SalesOfCategory,
  SalesOfStore,
} from '../pos/sales-figures';
import type { SupplierDebtOfToday } from '../purchasing/supplier-dues';
import type {
  RefundsOfCashier,
  RefundsOfCategory,
  RefundsOfStore,
} from '../returns/return-figures';

// The tables of the reports (spec 2026-10-14-owner-cabinet, 5.3): pure functions of the figures of
// the domains and the names. Money in dirams, quantities in pieces with `piecesPerPack` in the row;
// the last row `total` starts with the text 'total'. Columns at cost are left out without
// `finance:view-cost` — from the columns, the rows and the total.

type Row = Record<string, ReportCell>;
type Body = Omit<ReportTable, 'kind'>;

export interface Named {
  id: string;
  name: string;
}

const col = (key: string, type: ReportColumn['type']): ReportColumn => ({
  key,
  type,
});

/** part / whole × 100 with one decimal; null for a zero whole. */
export const percentOf = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part * 1000) / whole) / 10;

const sum = (rows: readonly Row[], key: string) =>
  rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

function totalOf(
  rows: readonly Row[],
  first: string,
  keys: readonly string[],
): Row {
  const total: Row = { [first]: 'total' };
  for (const key of keys) total[key] = sum(rows, key);
  return total;
}

/** Leaves out the columns at cost without the right: columns, rows and total. */
function withCost(
  body: Body,
  costKeys: readonly string[],
  canSeeCost: boolean,
): Body {
  if (canSeeCost) return body;
  const strip = (row: Row): Row =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => !costKeys.includes(key)),
    );
  return {
    columns: body.columns.filter((column) => !costKeys.includes(column.key)),
    rows: body.rows.map(strip),
    total: body.total === null ? null : strip(body.total),
  };
}

const byName =
  <T>(name: (item: T) => string) =>
  (a: T, b: T) =>
    name(a).localeCompare(name(b), 'ru');

/**
 * The expenses of the period for «Продажи по точкам» (spec E16): the shares of the records of the
 * stores, the share of the network records (the total only) and the cash withdrawals «на расходы».
 * Positive dirams; `null` — the expense columns are absent.
 */
export interface StoreExpenses {
  byStore: ReadonlyMap<string, number>;
  networkMinor: number;
  cash: readonly { storeId: string; amountMinor: number }[];
}

export function salesByStore(
  stores: readonly Named[],
  sales: readonly SalesOfStore[],
  refunds: readonly RefundsOfStore[],
  losses: readonly LossesOfStore[],
  canSeeCost: boolean,
  expenses: StoreExpenses | null,
): Body {
  const rows: Row[] = stores.map((store) => {
    const sold = sales.find((row) => row.storeId === store.id);
    const back = refunds.find((row) => row.storeId === store.id);
    const lost = losses.find((row) => row.storeId === store.id);
    const revenue = sold?.salesMinor ?? 0;
    const returns = -(back?.refundMinor ?? 0);
    const cost = (sold?.costMinor ?? 0) - (back?.returnedCostMinor ?? 0);
    const lossMinor = -(
      (lost?.writeOffMinor ?? 0) + (lost?.stockCountMinor ?? 0)
    );
    const margin = revenue + returns - cost + lossMinor;
    return {
      store: store.name,
      receipts: sold?.receipts ?? 0,
      revenue,
      returns,
      cost,
      losses: lossMinor,
      margin,
      marginPercent: percentOf(margin, revenue + returns),
    };
  });
  const total = totalOf(rows, 'store', [
    'receipts',
    'revenue',
    'returns',
    'cost',
    'losses',
    'margin',
  ]);
  total.marginPercent = percentOf(
    Number(total.margin),
    Number(total.revenue) + Number(total.returns),
  );
  const columns = [
    col('store', 'text'),
    col('receipts', 'count'),
    col('revenue', 'money'),
    col('returns', 'money'),
    col('cost', 'money'),
    col('losses', 'money'),
    col('margin', 'money'),
    col('marginPercent', 'percent'),
  ];
  // net profit (E16): expenses are negative as the returns and the losses; the network records go
  // to the total only
  if (expenses !== null && canSeeCost) {
    stores.forEach((store, index) => {
      const row = rows[index];
      const own = -(expenses.byStore.get(store.id) ?? 0);
      const cash = -(
        expenses.cash.find((item) => item.storeId === store.id)?.amountMinor ?? 0
      );
      row.expenses = own;
      row.cashExpenses = cash;
      row.netProfit = Number(row.margin) + own + cash;
    });
    total.expenses = sum(rows, 'expenses') - expenses.networkMinor;
    total.cashExpenses = sum(rows, 'cashExpenses');
    total.netProfit =
      Number(total.margin) +
      Number(total.expenses) +
      Number(total.cashExpenses);
    columns.push(
      col('expenses', 'money'),
      col('cashExpenses', 'money'),
      col('netProfit', 'money'),
    );
  }
  return withCost(
    { columns, rows, total },
    ['cost', 'losses', 'margin', 'marginPercent'],
    canSeeCost,
  );
}

export function salesByCategory(
  categories: readonly Named[],
  sales: readonly SalesOfCategory[],
  refunds: readonly RefundsOfCategory[],
  canSeeCost: boolean,
): Body {
  const ids = new Set([
    ...sales.map((row) => row.categoryId),
    ...refunds.map((row) => row.categoryId),
  ]);
  const rows: Row[] = [...ids]
    .map((id) => {
      const sold = sales.find((row) => row.categoryId === id);
      const back = refunds.find((row) => row.categoryId === id);
      const revenue = (sold?.netMinor ?? 0) - (back?.refundMinor ?? 0);
      const cost = (sold?.costMinor ?? 0) - (back?.returnedCostMinor ?? 0);
      return {
        category: categories.find((c) => c.id === id)?.name ?? '—',
        revenue,
        cost,
        margin: revenue - cost,
        marginPercent: percentOf(revenue - cost, revenue),
      };
    })
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));
  const total = totalOf(rows, 'category', ['revenue', 'cost', 'margin']);
  total.marginPercent = percentOf(Number(total.margin), Number(total.revenue));
  return withCost(
    {
      columns: [
        col('category', 'text'),
        col('revenue', 'money'),
        col('cost', 'money'),
        col('margin', 'money'),
        col('marginPercent', 'percent'),
      ],
      rows,
      total,
    },
    ['cost', 'margin', 'marginPercent'],
    canSeeCost,
  );
}

export function stock(
  stores: readonly Named[],
  figures: readonly StockOfStore[],
  canSeeCost: boolean,
): Body {
  const rows: Row[] = stores.map((store) => {
    const row = figures.find((figure) => figure.storeId === store.id);
    return {
      store: store.name,
      positions: row?.positions ?? 0,
      cost: row?.costMinor ?? 0,
      retail: row?.retailMinor ?? 0,
      low: row?.low ?? 0,
      expiring: row?.expiring ?? 0,
    };
  });
  return withCost(
    {
      columns: [
        col('store', 'text'),
        col('positions', 'count'),
        col('cost', 'money'),
        col('retail', 'money'),
        col('low', 'count'),
        col('expiring', 'count'),
      ],
      rows,
      total: totalOf(rows, 'store', [
        'positions',
        'cost',
        'retail',
        'low',
        'expiring',
      ]),
    },
    ['cost'],
    canSeeCost,
  );
}

export function movement(
  figures: readonly MovementOfProduct[],
  productName: (id: string) => string,
): Body {
  const rows: Row[] = figures
    .map((row) => ({
      product: productName(row.productId),
      piecesPerPack: row.piecesPerPack,
      opening: row.opening,
      receipt: row.receipt,
      transfers: row.transfers,
      sales: row.sales,
      supplierReturns: row.supplierReturns,
      writeOffs: row.writeOffs,
      stockCount: row.stockCount,
      closing: row.closing,
    }))
    .sort(byName((row) => String(row.product)));
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

export function supplierDebts(
  debts: readonly SupplierDebtOfToday[],
  canSeeCost: boolean,
): Body {
  const rows: Row[] = debts
    .filter((debt) => debt.debtMinor > 0)
    .map((debt) => ({
      supplier: debt.supplierName,
      debt: debt.debtMinor,
      overdue: debt.overdueMinor,
      nextDueOn: debt.nextDueOn,
    }))
    .sort(byName((row) => String(row.supplier)));
  const total = totalOf(rows, 'supplier', ['debt', 'overdue']);
  total.nextDueOn = null;
  const body = withCost(
    {
      columns: [
        col('supplier', 'text'),
        col('debt', 'money'),
        col('overdue', 'money'),
        col('nextDueOn', 'date'),
      ],
      rows,
      total,
    },
    ['debt', 'overdue'],
    canSeeCost,
  );
  // the total is of the amounts only (spec 5.3: «с правом»)
  return canSeeCost ? body : { ...body, total: null };
}

export function cashiers(
  sales: readonly SalesOfCashier[],
  refunds: readonly RefundsOfCashier[],
  cashierName: (id: string) => string,
  storeName: (id: string) => string,
): Body {
  const keys = new Set([
    ...sales.map((row) => `${row.cashierId}/${row.storeId}`),
    ...refunds.map((row) => `${row.cashierId}/${row.storeId}`),
  ]);
  const rows: Row[] = [...keys]
    .map((key) => {
      const [cashierId, storeId] = key.split('/');
      const sold = sales.find(
        (row) => row.cashierId === cashierId && row.storeId === storeId,
      );
      const back = refunds.find(
        (row) => row.cashierId === cashierId && row.storeId === storeId,
      );
      const cash = sold?.cashMinor ?? 0;
      const card = sold?.cardMinor ?? 0;
      const qr = sold?.qrMinor ?? 0;
      const nfc = sold?.nfcMinor ?? 0;
      const returns = -(back?.refundMinor ?? 0);
      return {
        cashier: cashierName(cashierId),
        store: storeName(storeId),
        receipts: sold?.receipts ?? 0,
        cash,
        card,
        qr,
        nfc,
        returns,
        revenue: cash + card + qr + nfc + returns,
      };
    })
    .sort(byName((row) => `${String(row.cashier)} ${String(row.store)}`));
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
    total: totalOf(rows, 'cashier', [
      'receipts',
      'cash',
      'card',
      'qr',
      'nfc',
      'returns',
      'revenue',
    ]),
  };
}

export function losses(
  lines: readonly LossLine[],
  storeName: (id: string) => string,
  productName: (id: string) => string,
  canSeeCost: boolean,
): Body {
  const rows: Row[] = lines.map((line) => ({
    number: line.number,
    date: line.date,
    store: storeName(line.storeId),
    product: productName(line.productId),
    reason: line.reason,
    quantity: line.qtyPieces,
    piecesPerPack: line.piecesPerPack,
    amount: line.amountMinor,
  }));
  const body = withCost(
    {
      columns: [
        col('number', 'text'),
        col('date', 'date'),
        col('store', 'text'),
        col('product', 'text'),
        col('reason', 'reason'),
        col('quantity', 'pieces'),
        col('amount', 'money'),
      ],
      rows,
      total: totalOf(rows, 'number', ['amount']),
    },
    ['amount'],
    canSeeCost,
  );
  return canSeeCost ? body : { ...body, total: null };
}

export function controlled(
  sales: readonly ControlledSale[],
  storeName: (id: string) => string,
  productName: (id: string) => string,
  cashierName: (id: string) => string,
): Body {
  const rows: Row[] = sales.map((sale) => {
    // the prescription only — never the name and the document of the buyer
    const prescription = sale.prescription
      ? [
          sale.prescription.prescriptionNumber,
          sale.prescription.prescriptionDate,
          sale.prescription.clinic,
          sale.prescription.doctor,
        ]
          .filter((part): part is string => Boolean(part))
          .join(' · ') || null
      : null;
    return {
      at: new Date(sale.soldAt).toISOString(),
      received: new Date(sale.receivedAt).toISOString(),
      store: storeName(sale.storeId),
      product: productName(sale.productId),
      batch: sale.lotNumber ?? '',
      quantity: sale.qtyPieces,
      piecesPerPack: sale.piecesPerPack,
      cashier: cashierName(sale.cashierId),
      receipt: sale.receiptNumber,
      prescription: sale.purged ? null : prescription,
      ...(sale.purged ? { prescriptionPurged: 1 } : {}),
    };
  });
  return {
    columns: [
      col('at', 'datetime'),
      // sold and received: the ПКУ journal by ADR-0015 (spec 2026-10-21-pos-offline-limits, P1)
      col('received', 'datetime'),
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

export function controlledSummary(
  balances: readonly ControlledBalance[],
  productName: (id: string) => string,
  storeName: (id: string) => string,
): Body {
  const rows: Row[] = balances
    .map((row) => ({
      product: productName(row.productId),
      store: storeName(row.storeId),
      piecesPerPack: row.piecesPerPack,
      opening: row.opening,
      received: row.received,
      issued: row.issued,
      closing: row.closing,
    }))
    .sort(byName((row) => `${String(row.product)} ${String(row.store)}`));
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
