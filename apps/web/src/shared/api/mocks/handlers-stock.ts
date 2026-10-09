/*
 * Mock handlers of the stock module — the rules apps/api will enforce: stock only from movements by
 * batch (a posted document writes them, unposting reverts them and is blocked when the batch had
 * later movements), permissions `inventory:*` and the store scope (ADR-0018), purchase prices only
 * with `finance:view-cost`, stock of an offline store read-only from the cloud (ADR-0014), the
 * receiver's stock changes only when it accepts a transfer.
 */
import {
  hasPermissions,
  orderStatusAfterReceipt,
  pieceCost,
  receivedPercent,
  stockState,
  type Permission,
} from '@pharmacy/shared-domain';
import type {
  DocumentAuthor,
  EmployeeSession,
  GoodsReceipt,
  GoodsReceiptInput,
  PosBatch,
  PosProduct,
  PurchaseOrderOption,
  SaleUnit,
  StockCount,
  StockLine,
  StockLineInput,
  StockProductOption,
  StockRow,
  SupplierReturn,
  SupplierReturnInput,
  Transfer,
  TransferListItem,
  UnpostCheck,
  WriteOff,
  OpeningBalance,
  OpeningBalanceInput,
  ProductBatchRow,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb } from './db';
import { stores } from './fixtures';
import { categories } from './fixtures-pos';
import { completeStoreClosing } from './owner-stores';
import { setStorePrice, storePrice } from './pricing';
import { authorize } from './session';
import type { MockHandlers } from './types';

type StockRoute = Extract<
  ApiRouteKey,
  | `stock.${string}`
  | 'suppliers.options'
  | 'purchaseOrders.open'
  | 'documents.unpostCheck'
  | `goodsReceipts.${string}`
  | `openingBalances.${string}`
  | `writeOffs.${string}`
  | `supplierReturns.${string}`
  | `stockCounts.${string}`
  | `transfers.${string}`
  | `transferRequests.${string}`
>;

const db = () => mockDb().stock;
const products = () => mockDb().pos.products;
const today = () => toAppDate();
const now = () => new Date().toISOString();

const number = (prefix: string, key: keyof ReturnType<typeof db>['counters']) =>
  `${prefix}-${String(db().counters[key]++).padStart(6, '0')}`;

export const storeName = (id: string) =>
  stores.find((s) => s.id === id)?.name ?? '—';

export function context(
  correlationId: string,
  permission: Permission,
  { write = false } = {},
) {
  const { session } = authorize(correlationId, permission, { write });
  return {
    session,
    canSeeCost: hasPermissions(session.permissions, 'finance:view-cost'),
    author: (): DocumentAuthor => ({
      name:
        mockDb().employees.find((e) => e.id === session.employee.id)
          ?.shortName ?? session.employee.fullName,
      at: now(),
    }),
  };
}

export function inScope(
  session: EmployeeSession,
  storeId: string,
  correlationId: string,
) {
  if (!session.stores.some((s) => s.id === storeId)) {
    throw new ApiError(403, 'store_not_in_scope', correlationId);
  }
}

/** The cloud does not write the stock of an offline store (ADR-0014). */
export function writable(
  session: EmployeeSession,
  storeId: string,
  correlationId: string,
) {
  inScope(session, storeId, correlationId);
  if (stores.find((s) => s.id === storeId)?.mode === 'offline') {
    throw new ApiError(409, 'offline_store_read_only', correlationId);
  }
}

export function productOf(id: string, correlationId: string): PosProduct {
  const found = products().find((p) => p.id === id);
  if (!found) {
    throw new ApiError(422, 'validation_failed', correlationId, [
      { field: 'productId', code: 'unknown' },
    ]);
  }
  return found;
}

function batchOf(
  productId: string,
  batchId: string,
  correlationId: string,
): PosBatch {
  const batch = productOf(productId, correlationId).batches.find(
    (b) => b.id === batchId,
  );
  if (!batch) {
    throw new ApiError(422, 'validation_failed', correlationId, [
      { field: 'batchId', code: 'unknown' },
    ]);
  }
  return batch;
}

export const stockAt = (storeId: string) => (db().stock[storeId] ??= {});

function move(
  storeId: string,
  batchId: string,
  document: string,
  pieces: number,
) {
  stockAt(storeId)[batchId] = (stockAt(storeId)[batchId] ?? 0) + pieces;
  db().movements.push({ storeId, batchId, document, pieces, at: now() });
}

const piecesOf = (product: PosProduct, unit: SaleUnit, quantity: number) =>
  unit === 'pack' ? quantity * product.piecesPerPack : quantity;

function unitCost(product: PosProduct, batch: PosBatch, unit: SaleUnit) {
  const pack = batch.costMinor ?? 0;
  return unit === 'pack' ? pack : pieceCost(pack, product.piecesPerPack);
}

function hideCost<T extends { costMinor?: number; totalMinor?: number }>(
  value: T,
  canSeeCost: boolean,
): T {
  if (canSeeCost) return value;
  const { costMinor: _c, totalMinor: _t, ...rest } = value;
  return rest as T;
}

function stockLines(
  lines: StockLineInput[],
  correlationId: string,
): StockLine[] {
  return lines.map((line) => {
    const product = productOf(line.productId, correlationId);
    const batch = batchOf(line.productId, line.batchId, correlationId);
    if (line.quantity <= 0) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'quantity', code: 'positive' },
      ]);
    }
    return {
      ...line,
      productName: product.name,
      batchNumber: batch.number,
      expiresOn: batch.expiresOn,
      costMinor: unitCost(product, batch, line.unit),
    };
  });
}

const linesTotal = (lines: Array<{ quantity: number; costMinor?: number }>) =>
  lines.reduce((sum, l) => sum + l.quantity * (l.costMinor ?? 0), 0);

export function visible<T extends { storeId: string }>(
  session: EmployeeSession,
  items: T[],
) {
  return items.filter((item) =>
    session.stores.some((s) => s.id === item.storeId),
  );
}

export function page<T>(
  items: T[],
  query?: { limit?: number; offset?: number },
) {
  const limit = query?.limit ?? 10;
  const offset = query?.offset ?? 0;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

const thisMonth = (date: string) => date.slice(0, 7) === today().slice(0, 7);

/** Unposting is blocked when a batch of the document moved after the posting (ТЗ). */
function unpostCheck(
  docNumber: string,
  storeId: string,
  batches: Array<{ batchId: string; productName: string; batchNumber: string }>,
  postedBy: DocumentAuthor | null,
): UnpostCheck {
  const since = postedBy?.at ?? '';
  const blockers = batches
    .map((b) => {
      const later = db().movements.filter(
        (m) =>
          m.storeId === storeId &&
          m.batchId === b.batchId &&
          m.document !== docNumber &&
          m.at > since,
      );
      return {
        productName: b.productName,
        batchNumber: b.batchNumber,
        soldPieces: -later
          .filter((m) => m.document === 'sale')
          .reduce((sum, m) => sum + m.pieces, 0),
        documents: [
          ...new Set(later.map((m) => m.document).filter((d) => d !== 'sale')),
        ],
        count: later.length,
      };
    })
    .filter((b) => b.count > 0)
    .map(({ count: _count, ...rest }) => rest);
  return { allowed: blockers.length === 0, postedBy, blockers };
}

function requireDraft(status: string, correlationId: string) {
  if (status !== 'draft' && status !== 'in_progress') {
    throw new ApiError(409, 'document_posted', correlationId);
  }
}

/* ---------------- opening balances ---------------- */

function openingBatchId(line: OpeningBalance['lines'][number]) {
  return `b-${line.productId}-${line.batchNumber || 'start'}`;
}

function buildOpeningBalance(
  input: OpeningBalanceInput,
  base: Pick<
    OpeningBalance,
    'id' | 'number' | 'status' | 'createdBy' | 'postedBy'
  >,
  correlationId: string,
): OpeningBalance {
  const lines = input.lines.map((line) => ({
    ...line,
    productName: productOf(line.productId, correlationId).name,
  }));
  return {
    ...base,
    ...input,
    comment: input.comment.trim(),
    storeName: storeName(input.storeId),
    lines,
    totalMinor: lines.reduce((sum, l) => sum + l.quantity * l.costMinor, 0),
  };
}

/* ---------------- goods receipts ---------------- */

function receiptBatchId(line: GoodsReceipt['lines'][number]) {
  return `b-${line.productId}-${line.batchNumber}`;
}

function buildReceipt(
  input: GoodsReceiptInput,
  base: Pick<
    GoodsReceipt,
    'id' | 'number' | 'status' | 'createdBy' | 'postedBy'
  >,
  correlationId: string,
): GoodsReceipt {
  const supplier = db().suppliers.find((s) => s.id === input.supplierId);
  if (!supplier) {
    throw new ApiError(422, 'validation_failed', correlationId, [
      { field: 'supplierId', code: 'required' },
    ]);
  }
  const order = db().orders.find((o) => o.id === input.orderId) ?? null;
  const lines = input.lines.map((line) => ({
    ...line,
    productName: productOf(line.productId, correlationId).name,
  }));
  return {
    ...base,
    ...input,
    supplierName: supplier.name,
    storeName: storeName(input.storeId),
    orderNumber: order?.number ?? null,
    lines,
    totalMinor: lines.reduce((sum, l) => sum + l.quantity * l.costMinor, 0),
  };
}

/** Received packs of the order of a goods receipt: +1 on posting, −1 on unposting. */
function receiveOnOrder(doc: GoodsReceipt, sign: 1 | -1) {
  const order = db().orders.find((o) => o.id === doc.orderId);
  if (!order) return;
  for (const line of doc.lines) {
    const orderLine = order.lines.find((l) => l.productId === line.productId);
    if (orderLine) {
      orderLine.receivedQuantity = Math.max(
        0,
        orderLine.receivedQuantity + sign * line.quantity,
      );
    }
  }
  order.status = orderStatusAfterReceipt(order.lines);
  order.receivedPercent = receivedPercent(order.lines);
}

export function findDoc<T extends { id: string }>(
  list: T[],
  id: string,
  correlationId: string,
): T {
  const doc = list.find((d) => d.id === id);
  if (!doc) throw new ApiError(404, 'not_found', correlationId);
  return doc;
}

/* ---------------- transfers ---------------- */

function transferItem(t: Transfer): TransferListItem {
  return {
    id: t.id,
    number: t.number,
    date: t.date,
    fromStoreName: t.fromStoreName,
    toStoreName: t.toStoreName,
    requestNumber: t.requestNumber,
    positions: t.lines.length,
    status: t.status,
    sentByName: t.sentBy?.name ?? null,
    openDiscrepancy: Boolean(t.discrepancy && !t.discrepancy.resolution),
  };
}

const involves = (session: EmployeeSession, ...storeIds: string[]) =>
  storeIds.some((id) => session.stores.some((s) => s.id === id));

export const stockHandlers: Pick<MockHandlers, StockRoute> = {
  'stock.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const storeIds = query?.storeId
      ? [query.storeId]
      : session.stores.map((s) => s.id);
    for (const id of storeIds) inScope(session, id, correlationId);
    const needle = (query?.q ?? '').trim().toLocaleLowerCase('ru');
    const rows: StockRow[] = [];
    for (const storeId of storeIds) {
      const store = stores.find((s) => s.id === storeId);
      for (const product of products()) {
        if (
          needle &&
          ![product.name, ...product.barcodes].some((v) =>
            v.toLocaleLowerCase('ru').includes(needle),
          )
        ) {
          continue;
        }
        const minPieces =
          (db().minPacks[product.id] ?? 0) * product.piecesPerPack;
        const base = {
          productId: product.id,
          productName: product.name,
          barcode: product.barcodes[0] ?? null,
          prescription: product.prescription,
          storeId,
          storeName: store?.name ?? '—',
          storeMode: store?.mode ?? 'cloud',
          piecesPerPack: product.piecesPerPack,
          minPieces,
          retailPriceMinor: storePrice(storeId, product),
        } as const;
        const held = product.batches.filter(
          (b) => (stockAt(storeId)[b.id] ?? 0) !== 0,
        );
        if (held.length === 0) {
          rows.push({
            ...base,
            id: `${storeId}:${product.id}`,
            batchId: null,
            batchNumber: null,
            expiresOn: null,
            quantityPieces: 0,
            state: 'out',
          });
          continue;
        }
        for (const batch of held) {
          const quantityPieces = stockAt(storeId)[batch.id] ?? 0;
          const row: StockRow = {
            ...base,
            id: `${storeId}:${batch.id}`,
            batchId: batch.id,
            batchNumber: batch.number,
            expiresOn: batch.expiresOn,
            quantityPieces,
            costMinor: batch.costMinor,
            state: stockState({
              quantityPieces,
              minPieces,
              daysToExpiry: daysBetween(today(), batch.expiresOn),
            }),
          };
          rows.push(canSeeCost ? row : hideCost(row, false));
        }
      }
    }
    const counts = {
      low: rows.filter((r) => r.state === 'low').length,
      expiring: rows.filter((r) => r.state === 'expiring').length,
      negative: rows.filter((r) => r.state === 'negative').length,
    };
    const state = query?.state ?? 'all';
    const filtered =
      state === 'all' ? rows : rows.filter((r) => r.state === state);
    const direction = query?.direction === 'desc' ? -1 : 1;
    const key = query?.sort ?? 'product';
    const value = (r: StockRow): string | number =>
      key === 'expiresOn'
        ? (r.expiresOn ?? '9999')
        : key === 'quantity'
          ? r.quantityPieces
          : key === 'price'
            ? (r.retailPriceMinor ?? 0)
            : r.productName;
    filtered.sort((a, b) => {
      const l = value(a);
      const r = value(b);
      const order =
        typeof l === 'number' && typeof r === 'number'
          ? l - r
          : String(l).localeCompare(String(r), 'ru');
      return order * direction;
    });
    return {
      ...page(filtered, { limit: query?.limit ?? 20, offset: query?.offset }),
      counts,
    };
  },

  'stock.products': ({ params, query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    inScope(session, params.storeId, correlationId);
    const needle = (query?.query ?? '').trim().toLocaleLowerCase('ru');
    return products()
      .filter(
        (p) =>
          !needle ||
          [p.name, p.inn ?? '', ...p.barcodes].some((v) =>
            v.toLocaleLowerCase('ru').includes(needle),
          ),
      )
      .slice(0, query?.limit ?? 20)
      .map((p): StockProductOption => ({
        id: p.id,
        name: p.name,
        barcodes: p.barcodes,
        categoryId: p.categoryId,
        piecesPerPack: p.piecesPerPack,
        divisible: p.divisible,
        prescription: p.prescription,
        retailPriceMinor: storePrice(params.storeId, p),
        markupPercent:
          mockDb().catalog.extras[p.id]?.markupPercent ??
          db().markup[p.categoryId] ??
          40,
        maxPriceMinor: mockDb().catalog.extras[p.id]?.maxPriceMinor ?? null,
        minStockPacks: db().minPacks[p.id] ?? 0,
        batches: p.batches.map((b) => {
          const batch = {
            ...b,
            quantityPieces: stockAt(params.storeId)[b.id] ?? 0,
          };
          return canSeeCost ? batch : hideCost(batch, false);
        }),
      }));
  },

  'stock.productBatches': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const product = productOf(params.productId, correlationId);
    return session.stores.flatMap((store) =>
      product.batches
        .map(
          (b): ProductBatchRow => ({
            storeId: store.id,
            storeName: store.name,
            batchId: b.id,
            batchNumber: b.number,
            expiresOn: b.expiresOn,
            quantityPieces: stockAt(store.id)[b.id] ?? 0,
            ...(canSeeCost && b.costMinor !== undefined
              ? { costMinor: b.costMinor }
              : {}),
          }),
        )
        .filter((b) => b.quantityPieces !== 0),
    );
  },

  'suppliers.options': ({ correlationId }) => {
    context(correlationId, 'inventory:view');
    return db().suppliers.map(({ id, name }) => ({ id, name }));
  },
  'purchaseOrders.open': ({ query, correlationId }) => {
    context(correlationId, 'inventory:view');
    return db()
      .orders.filter((o) => o.supplierId === query.supplierId)
      .flatMap((o): PurchaseOrderOption[] =>
        o.status === 'confirmed' || o.status === 'partially_received'
          ? [
              {
                id: o.id,
                number: o.number,
                supplierId: o.supplierId,
                status: o.status,
                lines: o.lines,
              },
            ]
          : [],
      );
  },

  'documents.unpostCheck': ({ params, correlationId }) => {
    context(correlationId, 'inventory:unpost');
    switch (params.kind) {
      case 'goods-receipts': {
        const doc = findDoc(db().goodsReceipts, params.id, correlationId);
        return unpostCheck(
          doc.number,
          doc.storeId,
          doc.lines.map((l) => ({
            batchId:
              products()
                .find((p) => p.id === l.productId)
                ?.batches.find((b) => b.number === l.batchNumber)?.id ??
              receiptBatchId(l),
            productName: l.productName,
            batchNumber: l.batchNumber,
          })),
          doc.postedBy,
        );
      }
      case 'opening-balances': {
        const doc = findDoc(db().openingBalances, params.id, correlationId);
        return unpostCheck(
          doc.number,
          doc.storeId,
          doc.lines.map((l) => ({
            batchId: openingBatchId(l),
            productName: l.productName,
            batchNumber: l.batchNumber,
          })),
          doc.postedBy,
        );
      }
      case 'write-offs': {
        const doc = findDoc(db().writeOffs, params.id, correlationId);
        return unpostCheck(doc.number, doc.storeId, doc.lines, doc.postedBy);
      }
      case 'supplier-returns': {
        const doc = findDoc(db().supplierReturns, params.id, correlationId);
        return unpostCheck(doc.number, doc.storeId, doc.lines, doc.postedBy);
      }
      case 'stock-counts': {
        const doc = findDoc(db().stockCounts, params.id, correlationId);
        return unpostCheck(doc.number, doc.storeId, doc.lines, doc.postedBy);
      }
    }
  },

  /* goods receipts */
  'goodsReceipts.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const all = visible(session, db().goodsReceipts)
      .filter((d) => !query?.storeId || d.storeId === query.storeId)
      .filter((d) => !query?.status || d.status === query.status)
      .filter((d) => !query?.supplierId || d.supplierId === query.supplierId)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
      );
    const posted = all.filter(
      (d) => d.status === 'posted' && thisMonth(d.date),
    );
    return {
      ...page(
        all.map((d) =>
          hideCost(
            {
              id: d.id,
              number: d.number,
              date: d.date,
              supplierName: d.supplierName,
              orderNumber: d.orderNumber,
              storeName: d.storeName,
              positions: d.lines.length,
              totalMinor: d.totalMinor,
              status: d.status,
            },
            canSeeCost,
          ),
        ),
        query,
      ),
      kpi: {
        postedThisMonth: posted.length,
        ...(canSeeCost && {
          postedThisMonthMinor: posted.reduce((s, d) => s + d.totalMinor, 0),
        }),
        drafts: all.filter((d) => d.status === 'draft').length,
      },
    };
  },
  'goodsReceipts.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:view');
    // a goods receipt without its purchase prices makes no sense: cost is required to open it
    authorize(correlationId, 'finance:view-cost');
    const doc = findDoc(db().goodsReceipts, params.id, correlationId);
    inScope(session, doc.storeId, correlationId);
    return doc;
  },
  'goodsReceipts.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.storeId, correlationId);
    const doc = buildReceipt(
      body,
      {
        id: `gr-${Date.now()}`,
        number: number('ПР', 'pr'),
        status: 'draft',
        createdBy: author(),
        postedBy: null,
      },
      correlationId,
    );
    db().goodsReceipts.unshift(doc);
    return doc;
  },
  'goodsReceipts.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().goodsReceipts, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, body.storeId, correlationId);
    const next = buildReceipt(body, doc, correlationId);
    Object.assign(doc, next);
    return doc;
  },
  'goodsReceipts.post': ({ params, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().goodsReceipts, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.storeId, correlationId);
    if (doc.lines.length === 0 || !doc.invoiceNumber.trim()) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        {
          field: doc.lines.length === 0 ? 'lines' : 'invoiceNumber',
          code: 'required',
        },
      ]);
    }
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      let batch = product.batches.find((b) => b.number === line.batchNumber);
      if (!batch) {
        batch = {
          id: receiptBatchId(line),
          number: line.batchNumber,
          expiresOn: line.expiresOn,
          quantityPieces: 0,
          costMinor: line.costMinor,
        };
        product.batches.push(batch);
      }
      move(
        doc.storeId,
        batch.id,
        doc.number,
        line.quantity * product.piecesPerPack,
      );
      // the retail price of the draft becomes the price of the store (ТЗ)
      setStorePrice(doc.storeId, product.id, line.retailPriceMinor);
    }
    // the debt to the supplier is derived from posted receipts («Поставщики и долги»)
    receiveOnOrder(doc, 1);
    doc.status = 'posted';
    doc.postedBy = author();
    mockDb().pos.catalogVersion += 1;
    return doc;
  },
  'goodsReceipts.unpost': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:unpost', {
      write: true,
    });
    const doc = findDoc(db().goodsReceipts, params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const check = stockHandlers['documents.unpostCheck']({
      params: { kind: 'goods-receipts', id: doc.id },
      query: undefined,
      body: undefined,
      correlationId,
    });
    if (!check.allowed)
      throw new ApiError(409, 'unpost_blocked', correlationId);
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      const batch = product.batches.find((b) => b.number === line.batchNumber);
      if (batch)
        move(
          doc.storeId,
          batch.id,
          `${doc.number} отмена`,
          -line.quantity * product.piecesPerPack,
        );
    }
    receiveOnOrder(doc, -1);
    doc.status = 'draft';
    doc.postedBy = null;
    mockDb().pos.catalogVersion += 1;
    return doc;
  },

  /* opening balances */
  'openingBalances.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const all = visible(session, db().openingBalances)
      .filter((d) => !query?.storeId || d.storeId === query.storeId)
      .filter((d) => !query?.status || d.status === query.status)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
      );
    return page(
      all.map((d) =>
        hideCost(
          {
            id: d.id,
            number: d.number,
            date: d.date,
            storeName: d.storeName,
            positions: d.lines.length,
            totalMinor: d.totalMinor,
            status: d.status,
          },
          canSeeCost,
        ),
      ),
      query,
    );
  },
  'openingBalances.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:view');
    authorize(correlationId, 'finance:view-cost');
    const doc = findDoc(db().openingBalances, params.id, correlationId);
    inScope(session, doc.storeId, correlationId);
    return doc;
  },
  'openingBalances.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.storeId, correlationId);
    const doc = buildOpeningBalance(
      body,
      {
        id: `no-${Date.now()}`,
        number: number('НО', 'no'),
        status: 'draft',
        createdBy: author(),
        postedBy: null,
      },
      correlationId,
    );
    db().openingBalances.unshift(doc);
    return doc;
  },
  'openingBalances.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().openingBalances, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, body.storeId, correlationId);
    Object.assign(doc, buildOpeningBalance(body, doc, correlationId));
    return doc;
  },
  'openingBalances.post': ({ params, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().openingBalances, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.storeId, correlationId);
    if (doc.lines.length === 0) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'lines', code: 'required' },
      ]);
    }
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      const id = openingBatchId(line);
      if (!product.batches.some((b) => b.id === id)) {
        product.batches.push({
          id,
          number: line.batchNumber,
          expiresOn: line.expiresOn,
          quantityPieces: 0,
          costMinor: line.costMinor,
        });
      }
      move(doc.storeId, id, doc.number, line.quantity * product.piecesPerPack);
      if (line.retailPriceMinor !== null) {
        setStorePrice(doc.storeId, product.id, line.retailPriceMinor);
      }
    }
    doc.status = 'posted';
    doc.postedBy = author();
    mockDb().pos.catalogVersion += 1;
    return doc;
  },
  'openingBalances.unpost': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:unpost', {
      write: true,
    });
    const doc = findDoc(db().openingBalances, params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const check = stockHandlers['documents.unpostCheck']({
      params: { kind: 'opening-balances', id: doc.id },
      query: undefined,
      body: undefined,
      correlationId,
    });
    if (!check.allowed)
      throw new ApiError(409, 'unpost_blocked', correlationId);
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      move(
        doc.storeId,
        openingBatchId(line),
        `${doc.number} отмена`,
        -line.quantity * product.piecesPerPack,
      );
    }
    doc.status = 'draft';
    doc.postedBy = null;
    mockDb().pos.catalogVersion += 1;
    return doc;
  },

  /* write-offs */
  'writeOffs.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const all = visible(session, db().writeOffs)
      .filter((d) => !query?.storeId || d.storeId === query.storeId)
      .filter((d) => !query?.reason || d.reason === query.reason)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
      );
    const month = all.filter((d) => d.status === 'posted' && thisMonth(d.date));
    let expired = 0;
    let expiring = 0;
    for (const store of session.stores) {
      for (const product of products()) {
        for (const batch of product.batches) {
          if ((stockAt(store.id)[batch.id] ?? 0) <= 0) continue;
          const days = daysBetween(today(), batch.expiresOn);
          if (days < 0) expired += 1;
          else if (days <= 30) expiring += 1;
        }
      }
    }
    return {
      ...page(
        all.map((d) =>
          hideCost(
            {
              id: d.id,
              number: d.number,
              date: d.date,
              storeName: d.storeName,
              reason: d.reason,
              positions: d.lines.length,
              totalMinor: d.totalMinor,
              postedByName: d.postedBy?.name ?? null,
              status: d.status,
            },
            canSeeCost,
          ),
        ),
        query,
      ),
      kpi: {
        documentsThisMonth: month.length,
        ...(canSeeCost && {
          writtenOffThisMonthMinor: month.reduce(
            (s, d) => s + (d.totalMinor ?? 0),
            0,
          ),
        }),
        expiredBatches: expired,
        expiringBatches: expiring,
      },
    };
  },
  'writeOffs.get': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const doc = findDoc(db().writeOffs, params.id, correlationId);
    inScope(session, doc.storeId, correlationId);
    return canSeeCost
      ? doc
      : {
          ...hideCost(doc, false),
          lines: doc.lines.map((l) => hideCost(l, false)),
        };
  },
  'writeOffs.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.storeId, correlationId);
    const lines = stockLines(body.lines, correlationId);
    const doc: WriteOff = {
      id: `wo-${Date.now()}`,
      number: number('СП', 'sp'),
      status: 'draft',
      ...body,
      storeName: storeName(body.storeId),
      lines,
      totalMinor: linesTotal(lines),
      createdBy: author(),
      postedBy: null,
    };
    db().writeOffs.unshift(doc);
    return doc;
  },
  'writeOffs.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().writeOffs, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, body.storeId, correlationId);
    const lines = stockLines(body.lines, correlationId);
    Object.assign(doc, body, {
      storeName: storeName(body.storeId),
      lines,
      totalMinor: linesTotal(lines),
    });
    return doc;
  },
  'writeOffs.post': ({ params, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().writeOffs, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.storeId, correlationId);
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      const pieces = piecesOf(product, line.unit, line.quantity);
      if ((stockAt(doc.storeId)[line.batchId] ?? 0) < pieces) {
        throw new ApiError(409, 'stock_insufficient', correlationId);
      }
    }
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      move(
        doc.storeId,
        line.batchId,
        doc.number,
        -piecesOf(product, line.unit, line.quantity),
      );
    }
    doc.status = 'posted';
    doc.postedBy = author();
    mockDb().pos.catalogVersion += 1;
    return doc;
  },
  'writeOffs.unpost': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:unpost', {
      write: true,
    });
    const doc = findDoc(db().writeOffs, params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const check = unpostCheck(doc.number, doc.storeId, doc.lines, doc.postedBy);
    if (!check.allowed)
      throw new ApiError(409, 'unpost_blocked', correlationId);
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      move(
        doc.storeId,
        line.batchId,
        `${doc.number} отмена`,
        piecesOf(product, line.unit, line.quantity),
      );
    }
    doc.status = 'draft';
    doc.postedBy = null;
    mockDb().pos.catalogVersion += 1;
    return doc;
  },

  /* supplier returns */
  'supplierReturns.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const all = visible(session, db().supplierReturns)
      .filter((d) => !query?.supplierId || d.supplierId === query.supplierId)
      .filter((d) => !query?.reason || d.reason === query.reason)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
      );
    const month = all.filter((d) => d.status === 'posted' && thisMonth(d.date));
    return {
      ...page(
        all.map((d) =>
          hideCost(
            {
              id: d.id,
              number: d.number,
              date: d.date,
              supplierName: d.supplierName,
              receiptNumber: d.receiptNumber,
              storeName: d.storeName,
              reason: d.reason,
              totalMinor: d.totalMinor,
              claim: d.claim,
              status: d.status,
            },
            canSeeCost,
          ),
        ),
        query,
      ),
      kpi: {
        documentsThisMonth: month.length,
        ...(canSeeCost && {
          returnedThisMonthMinor: month.reduce(
            (s, d) => s + (d.totalMinor ?? 0),
            0,
          ),
        }),
        openClaims: all.filter((d) => d.claim === 'sent').length,
      },
    };
  },
  'supplierReturns.get': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const doc = findDoc(db().supplierReturns, params.id, correlationId);
    inScope(session, doc.storeId, correlationId);
    return canSeeCost
      ? doc
      : {
          ...hideCost(doc, false),
          lines: doc.lines.map((l) => hideCost(l, false)),
        };
  },
  'supplierReturns.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.storeId, correlationId);
    const doc = buildSupplierReturn(
      body,
      {
        id: `vr-${Date.now()}`,
        number: number('ВП', 'vp'),
        status: 'draft',
        createdBy: author(),
        postedBy: null,
      },
      correlationId,
    );
    db().supplierReturns.unshift(doc);
    return doc;
  },
  'supplierReturns.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().supplierReturns, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, body.storeId, correlationId);
    Object.assign(doc, buildSupplierReturn(body, doc, correlationId));
    return doc;
  },
  'supplierReturns.post': ({ params, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().supplierReturns, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.storeId, correlationId);
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      const pieces = piecesOf(product, line.unit, line.quantity);
      if ((stockAt(doc.storeId)[line.batchId] ?? 0) < pieces) {
        throw new ApiError(409, 'stock_insufficient', correlationId);
      }
    }
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      move(
        doc.storeId,
        line.batchId,
        doc.number,
        -piecesOf(product, line.unit, line.quantity),
      );
    }
    // the debt to the supplier goes down by the posted return (derived, «Поставщики и долги»)
    if (doc.claim === 'draft') doc.claim = 'sent';
    doc.status = 'posted';
    doc.postedBy = author();
    mockDb().pos.catalogVersion += 1;
    return doc;
  },
  'supplierReturns.unpost': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:unpost', {
      write: true,
    });
    const doc = findDoc(db().supplierReturns, params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const check = unpostCheck(doc.number, doc.storeId, doc.lines, doc.postedBy);
    if (!check.allowed)
      throw new ApiError(409, 'unpost_blocked', correlationId);
    for (const line of doc.lines) {
      const product = productOf(line.productId, correlationId);
      move(
        doc.storeId,
        line.batchId,
        `${doc.number} отмена`,
        piecesOf(product, line.unit, line.quantity),
      );
    }
    doc.status = 'draft';
    doc.postedBy = null;
    mockDb().pos.catalogVersion += 1;
    return doc;
  },

  /* stock counts */
  'stockCounts.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const all = visible(session, db().stockCounts)
      .filter((d) => !query?.storeId || d.storeId === query.storeId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return page(
      all.map((d) => {
        const diffs = d.lines
          .filter((l) => l.factPieces !== null)
          .map((l) => ({
            diff: (l.factPieces ?? 0) - (l.bookPieces - l.soldSincePieces),
            cost: l.pieceCostMinor ?? 0,
          }));
        return {
          id: d.id,
          number: d.number,
          startedAt: d.startedAt,
          storeName: d.storeName,
          scope: d.scope,
          categoryName: d.categoryName,
          positions: d.lines.length,
          surplusLines: diffs.filter((x) => x.diff > 0).length,
          shortageLines: diffs.filter((x) => x.diff < 0).length,
          ...(canSeeCost && {
            diffMinor: diffs.reduce((s, x) => s + x.diff * x.cost, 0),
          }),
          status: d.status,
        };
      }),
      query,
    );
  },
  'stockCounts.get': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const doc = findDoc(db().stockCounts, params.id, correlationId);
    inScope(session, doc.storeId, correlationId);
    if (canSeeCost) return doc;
    return {
      ...doc,
      lines: doc.lines.map(({ pieceCostMinor: _c, ...rest }) => rest),
    };
  },
  'stockCounts.start': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.storeId, correlationId);
    const category = categories.find((c) => c.id === body.categoryId) ?? null;
    const lines = products()
      .filter((p) =>
        body.scope === 'category'
          ? p.categoryId === body.categoryId
          : body.scope === 'selected'
            ? body.productIds.includes(p.id)
            : true,
      )
      .flatMap((p) =>
        p.batches
          .filter((b) => (stockAt(body.storeId)[b.id] ?? 0) > 0)
          .map((b) => ({
            productId: p.id,
            productName: p.name,
            batchId: b.id,
            batchNumber: b.number,
            expiresOn: b.expiresOn,
            piecesPerPack: p.piecesPerPack,
            bookPieces: stockAt(body.storeId)[b.id] ?? 0,
            soldSincePieces: 0,
            factPieces: null,
            pieceCostMinor: pieceCost(b.costMinor ?? 0, p.piecesPerPack),
          })),
      );
    const doc: StockCount = {
      id: `sc-${Date.now()}`,
      number: number('ИН', 'in'),
      status: 'in_progress',
      startedAt: now(),
      storeId: body.storeId,
      storeName: storeName(body.storeId),
      scope: body.scope,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      comment: '',
      lines,
      createdBy: author(),
      postedBy: null,
    };
    db().stockCounts.unshift(doc);
    return doc;
  },
  'stockCounts.save': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().stockCounts, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.storeId, correlationId);
    doc.comment = body.comment;
    for (const fact of body.facts) {
      const line = doc.lines.find((l) => l.batchId === fact.batchId);
      if (line) line.factPieces = fact.factPieces;
    }
    return doc;
  },
  'stockCounts.post': ({ params, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().stockCounts, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.storeId, correlationId);
    if (doc.lines.some((l) => l.factPieces === null)) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'factPieces', code: 'required' },
      ]);
    }
    // surplus is taken in, shortage written off (ТЗ)
    for (const line of doc.lines) {
      const diff =
        (line.factPieces ?? 0) - (line.bookPieces - line.soldSincePieces);
      if (diff !== 0) move(doc.storeId, line.batchId, doc.number, diff);
    }
    doc.status = 'posted';
    doc.postedBy = author();
    mockDb().pos.catalogVersion += 1;
    return doc;
  },
  'stockCounts.unpost': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:unpost', {
      write: true,
    });
    const doc = findDoc(db().stockCounts, params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const check = unpostCheck(doc.number, doc.storeId, doc.lines, doc.postedBy);
    if (!check.allowed)
      throw new ApiError(409, 'unpost_blocked', correlationId);
    for (const line of doc.lines) {
      const diff =
        (line.factPieces ?? 0) - (line.bookPieces - line.soldSincePieces);
      if (diff !== 0)
        move(doc.storeId, line.batchId, `${doc.number} отмена`, -diff);
    }
    doc.status = 'in_progress';
    doc.postedBy = null;
    mockDb().pos.catalogVersion += 1;
    return doc;
  },

  /* transfers */
  'transfers.overview': ({ correlationId }) => {
    const { session } = context(correlationId, 'inventory:view');
    const requests = db().transferRequests.filter((r) =>
      involves(session, r.requesterStoreId, r.fromStoreId),
    );
    const transfers = db()
      .transfers.filter((t) => involves(session, t.fromStoreId, t.toStoreId))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
      );
    return {
      requests: [...requests].sort((a, b) => b.number.localeCompare(a.number)),
      transfers: transfers.map(transferItem),
      kpi: {
        newRequests: requests.filter((r) => r.status === 'sent').length,
        requestsInProgress: requests.filter((r) => r.status === 'in_progress')
          .length,
        inTransit: transfers.filter((t) => t.status === 'in_transit').length,
        awaiting: transfers.filter((t) => t.status === 'awaiting').length,
        openDiscrepancies: transfers.filter(
          (t) => t.discrepancy && !t.discrepancy.resolution,
        ).length,
      },
    };
  },
  'transfers.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:view');
    const doc = findDoc(db().transfers, params.id, correlationId);
    if (!involves(session, doc.fromStoreId, doc.toStoreId)) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    return doc;
  },
  'transfers.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.fromStoreId, correlationId);
    if (body.fromStoreId === body.toStoreId || body.lines.length === 0) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        {
          field: body.lines.length === 0 ? 'lines' : 'toStoreId',
          code: 'invalid',
        },
      ]);
    }
    const lines = body.lines.map((line) => {
      const product = productOf(line.productId, correlationId);
      const batch = batchOf(line.productId, line.batchId, correlationId);
      const pieces = line.quantity * product.piecesPerPack;
      if (body.send && (stockAt(body.fromStoreId)[batch.id] ?? 0) < pieces) {
        throw new ApiError(409, 'stock_insufficient', correlationId);
      }
      return {
        productId: product.id,
        productName: product.name,
        batchId: batch.id,
        batchNumber: batch.number,
        expiresOn: batch.expiresOn,
        sentQuantity: line.quantity,
        receivedQuantity: null,
      };
    });
    const request =
      db().transferRequests.find((r) => r.id === body.requestId) ?? null;
    const toOffline =
      stores.find((s) => s.id === body.toStoreId)?.mode === 'offline';
    const doc: Transfer = {
      id: `mv-${Date.now()}`,
      number: number('ПМ', 'pm'),
      date: today(),
      requestId: request?.id ?? null,
      requestNumber: request?.number ?? null,
      fromStoreId: body.fromStoreId,
      fromStoreName: storeName(body.fromStoreId),
      toStoreId: body.toStoreId,
      toStoreName: storeName(body.toStoreId),
      status: body.send ? (toOffline ? 'awaiting' : 'in_transit') : 'draft',
      lines,
      sentBy: body.send ? author() : null,
      receivedBy: null,
      discrepancy: null,
    };
    if (body.send) {
      for (const line of lines) {
        const product = productOf(line.productId, correlationId);
        move(
          body.fromStoreId,
          line.batchId,
          doc.number,
          -line.sentQuantity * product.piecesPerPack,
        );
      }
      if (request) request.status = 'in_progress';
    }
    db().transfers.unshift(doc);
    return doc;
  },
  'transfers.accept': ({ params, body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:receive', {
      write: true,
    });
    const doc = findDoc(db().transfers, params.id, correlationId);
    if (doc.status !== 'in_transit') {
      throw new ApiError(409, 'transfer_not_in_transit', correlationId);
    }
    writable(session, doc.toStoreId, correlationId);
    let short = false;
    for (const line of doc.lines) {
      const received =
        body.lines.find((l) => l.batchId === line.batchId)?.receivedQuantity ??
        0;
      if (received < 0 || received > line.sentQuantity) {
        throw new ApiError(422, 'validation_failed', correlationId, [
          { field: 'receivedQuantity', code: 'range' },
        ]);
      }
      line.receivedQuantity = received;
      if (received < line.sentQuantity) short = true;
      const product = productOf(line.productId, correlationId);
      // the receiver's stock changes only now (ТЗ)
      if (received > 0)
        move(
          doc.toStoreId,
          line.batchId,
          doc.number,
          received * product.piecesPerPack,
        );
    }
    doc.status = 'accepted';
    doc.receivedBy = author();
    doc.discrepancy = short
      ? { comment: body.comment, resolution: null, documentNumber: null }
      : null;
    const request = db().transferRequests.find((r) => r.id === doc.requestId);
    if (request) request.status = short ? 'partial' : 'done';
    completeStoreClosing(doc.id);
    return doc;
  },
  'transfers.resolve': ({ params, body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().transfers, params.id, correlationId);
    if (!doc.discrepancy || doc.discrepancy.resolution) {
      throw new ApiError(409, 'document_posted', correlationId);
    }
    writable(session, doc.fromStoreId, correlationId);
    const missing = doc.lines
      .map((l) => ({
        ...l,
        missing: l.sentQuantity - (l.receivedQuantity ?? 0),
      }))
      .filter((l) => l.missing > 0);
    if (body.resolution === 'write_off') {
      // the packs already left the sender: the write-off records the loss, no stock movement
      const writeOff: WriteOff = {
        id: `wo-${Date.now()}`,
        number: number('СП', 'sp'),
        status: 'posted',
        date: today(),
        storeId: doc.fromStoreId,
        storeName: doc.fromStoreName,
        reason: 'transfer_discrepancy',
        comment: `${doc.number}: ${doc.discrepancy.comment}`,
        lines: missing.map((l) => {
          const product = productOf(l.productId, correlationId);
          const batch = batchOf(l.productId, l.batchId, correlationId);
          return {
            productId: l.productId,
            productName: l.productName,
            batchId: l.batchId,
            batchNumber: l.batchNumber,
            expiresOn: l.expiresOn,
            unit: 'pack' as const,
            quantity: l.missing,
            costMinor: unitCost(product, batch, 'pack'),
          };
        }),
        createdBy: author(),
        postedBy: author(),
      };
      writeOff.totalMinor = linesTotal(writeOff.lines);
      db().writeOffs.unshift(writeOff);
      doc.discrepancy = {
        ...doc.discrepancy,
        resolution: 'write_off',
        documentNumber: writeOff.number,
      };
    } else {
      const resend = stockHandlers['transfers.create']({
        params: undefined,
        query: undefined,
        correlationId,
        body: {
          requestId: doc.requestId,
          fromStoreId: doc.fromStoreId,
          toStoreId: doc.toStoreId,
          send: true,
          lines: missing.map((l) => ({
            productId: l.productId,
            batchId: l.batchId,
            quantity: l.missing,
          })),
        },
      });
      doc.discrepancy = {
        ...doc.discrepancy,
        resolution: 'resend',
        documentNumber: resend.number,
      };
    }
    return doc;
  },
  'transferRequests.get': ({ params, correlationId }) => {
    context(correlationId, 'inventory:view');
    return findDoc(db().transferRequests, params.id, correlationId);
  },
  'transferRequests.create': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.toStoreId, correlationId);
    if (body.lines.length === 0) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'lines', code: 'required' },
      ]);
    }
    const doc = {
      id: `rq-${Date.now()}`,
      number: number('ЗП', 'zp'),
      date: today(),
      requesterStoreId: body.toStoreId,
      requesterStoreName: storeName(body.toStoreId),
      fromStoreId: body.fromStoreId,
      fromStoreName: storeName(body.fromStoreId),
      status: body.send ? ('sent' as const) : ('draft' as const),
      comment: body.comment,
      rejection: null,
      lines: body.lines.map((l) => ({
        ...l,
        productName: productOf(l.productId, correlationId).name,
      })),
    };
    db().transferRequests.unshift(doc);
    return doc;
  },
  'transferRequests.reject': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().transferRequests, params.id, correlationId);
    inScope(session, doc.fromStoreId, correlationId);
    if (doc.status !== 'sent')
      throw new ApiError(409, 'document_posted', correlationId);
    doc.status = 'rejected';
    doc.rejection = body;
    return doc;
  },
};

function buildSupplierReturn(
  input: SupplierReturnInput,
  base: Pick<
    SupplierReturn,
    'id' | 'number' | 'status' | 'createdBy' | 'postedBy'
  > & {
    claim?: SupplierReturn['claim'];
  },
  correlationId: string,
): SupplierReturn {
  const supplier = db().suppliers.find((s) => s.id === input.supplierId);
  if (!supplier) {
    throw new ApiError(422, 'validation_failed', correlationId, [
      { field: 'supplierId', code: 'required' },
    ]);
  }
  const receiptDoc =
    db().goodsReceipts.find((r) => r.id === input.receiptId) ?? null;
  const lines = stockLines(input.lines, correlationId).map((line, index) => ({
    ...line,
    note: input.lines[index].note,
  }));
  return {
    id: base.id,
    number: base.number,
    status: base.status,
    createdBy: base.createdBy,
    postedBy: base.postedBy,
    date: input.date,
    supplierId: supplier.id,
    supplierName: supplier.name,
    storeId: input.storeId,
    storeName: storeName(input.storeId),
    receiptId: receiptDoc?.id ?? null,
    receiptNumber: receiptDoc?.number ?? null,
    reason: input.reason,
    claim: input.createClaim ? 'draft' : 'none',
    lines,
    totalMinor: linesTotal(lines),
  };
}
