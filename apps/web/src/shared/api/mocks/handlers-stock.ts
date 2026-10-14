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
  StockCountLine,
  StockLine,
  StockLineInput,
  StockProductOption,
  StockRow,
  SupplierReturn,
  SupplierReturnInput,
  Transfer,
  TransferInput,
  TransferLine,
  TransferListItem,
  TransferRequest,
  TransferRequestInput,
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

/* ---------------- stock counts ---------------- */

/** Difference of a counted line: fact − (book − sold since the start). */
const countDiff = (line: StockCountLine) =>
  (line.factPieces ?? 0) - (line.bookPieces - line.soldBeforeCountPieces);

function recount(line: StockCountLine) {
  line.counted = line.entries.length > 0;
  line.factPieces = line.counted
    ? line.entries.reduce((sum, e) => sum + e.pieces, 0)
    : null;
}

function runningCount(id: string, correlationId: string): StockCount {
  const doc = findDoc(db().stockCounts, id, correlationId);
  if (doc.status === 'posted') {
    throw new ApiError(409, 'document_posted', correlationId);
  }
  if (doc.status === 'cancelled') {
    throw new ApiError(409, 'document_cancelled', correlationId);
  }
  return doc;
}

/** The batches a posted count moved: lines with a difference and batches of found products. */
const countBatches = (doc: StockCount) =>
  doc.lines
    .filter((l) => l.batchId !== null && (l.isFound || countDiff(l) !== 0))
    .map((l) => ({
      batchId: l.batchId as string,
      productName: l.productName,
      batchNumber: l.batchNumber,
    }));

/** The count as one employee sees it: their own entries, costs only with the right. */
function countView(
  doc: StockCount,
  canSeeCost: boolean,
  me: string,
): StockCount {
  return {
    ...doc,
    lines: doc.lines.map(
      ({ pieceCostMinor, costMinor, ...line }): StockCountLine => ({
        ...line,
        entries: line.entries.map((e) => ({ ...e, mine: e.byName === me })),
        ...(canSeeCost ? { pieceCostMinor, costMinor } : {}),
      }),
    ),
  };
}

function lineView(
  doc: StockCount,
  lineId: string,
  canSeeCost: boolean,
  me: string,
): StockCountLine {
  return countView(doc, canSeeCost, me).lines.find(
    (l) => l.lineId === lineId,
  ) as StockCountLine;
}

/** A running count of the store freezes the products of its scope for stock documents (5.3). */
function assertNotFrozen(
  storeId: string,
  productIds: readonly string[],
  correlationId: string,
) {
  const count = db().stockCounts.find(
    (c) => c.storeId === storeId && c.status === 'in_progress',
  );
  if (!count) return;
  const frozen = productIds.some(
    (id) =>
      count.scope === 'all' ||
      products().find((p) => p.id === id)?.categoryId === count.categoryId,
  );
  if (frozen) {
    throw new ApiError(409, 'stock_count_in_progress', correlationId);
  }
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
    fromStoreId: t.fromStoreId,
    fromStoreName: t.fromStoreName,
    toStoreId: t.toStoreId,
    toStoreName: t.toStoreName,
    requestNumber: t.requestNumber,
    positions: t.lines.length,
    status: t.status,
    sentByName: t.sentBy?.name ?? null,
    shortage: t.discrepancy !== null,
  };
}

const involves = (session: EmployeeSession, ...storeIds: string[]) =>
  storeIds.some((id) => session.stores.some((s) => s.id === id));

const fieldError = (correlationId: string, field: string, code: string) =>
  new ApiError(400, 'validation_failed', correlationId, [{ field, code }]);

/** The other store of a transfer or a request: another active cloud store of the network. */
function counterpart(storeId: string, ownId: string, correlationId: string) {
  const store = stores.find((s) => s.id === storeId);
  if (!store || storeId === ownId) {
    throw fieldError(correlationId, 'toStoreId', 'invalid');
  }
  if (store.mode === 'offline') {
    throw new ApiError(409, 'offline_store_read_only', correlationId);
  }
}

/** Pieces of a quantity of a transfer line in its unit. */
const linePieces = (
  line: Pick<TransferLine, 'productId' | 'unit'>,
  quantity: number,
  correlationId: string,
) =>
  line.unit === 'piece'
    ? quantity
    : quantity * productOf(line.productId, correlationId).piecesPerPack;

/** A sent request addressed by the receiver to this sender, with no transfer yet. */
function openRequest(
  id: string,
  body: Pick<TransferInput, 'fromStoreId' | 'toStoreId'>,
  correlationId: string,
): TransferRequest {
  const request = db().transferRequests.find((r) => r.id === id);
  if (
    !request ||
    request.status !== 'sent' ||
    request.fromStoreId !== body.fromStoreId ||
    request.requesterStoreId !== body.toStoreId
  ) {
    throw new ApiError(409, 'request_not_open', correlationId);
  }
  if (
    db().transfers.some(
      (t) => t.requestId === request.id && t.status !== 'cancelled',
    )
  ) {
    throw new ApiError(409, 'request_has_transfer', correlationId);
  }
  return request;
}

/** Lines of a transfer: batches of the sender; by a request — its products, not more than asked. */
function transferLines(
  body: Pick<TransferInput, 'fromStoreId' | 'lines'>,
  request: TransferRequest | null,
  correlationId: string,
): TransferLine[] {
  if (body.lines.length === 0)
    throw fieldError(correlationId, 'lines', 'required');
  const seen = new Set<string>();
  const sentByProduct = new Map<string, number>();
  return body.lines.map((line, i) => {
    const product = productOf(line.productId, correlationId);
    const batch = batchOf(line.productId, line.batchId, correlationId);
    if (seen.has(batch.id)) {
      throw fieldError(correlationId, `lines.${i}.batchId`, 'duplicate');
    }
    seen.add(batch.id);
    if (line.unit === 'piece' && !product.divisible) {
      throw fieldError(correlationId, `lines.${i}.unit`, 'not_divisible');
    }
    if (request) {
      const asked = request.lines.find((l) => l.productId === product.id);
      if (!asked) {
        throw fieldError(
          correlationId,
          `lines.${i}.productId`,
          'not_requested',
        );
      }
      const pieces =
        (sentByProduct.get(product.id) ?? 0) +
        linePieces(line, line.quantity, correlationId);
      sentByProduct.set(product.id, pieces);
      if (pieces > asked.quantity * product.piecesPerPack) {
        throw fieldError(
          correlationId,
          `lines.${i}.quantity`,
          'exceeds_request',
        );
      }
    }
    return {
      productId: product.id,
      productName: product.name,
      batchId: batch.id,
      batchNumber: batch.number,
      expiresOn: batch.expiresOn,
      unit: line.unit,
      sentQuantity: line.quantity,
      receivedQuantity: null,
    };
  });
}

function transferDraft(doc: Transfer, correlationId: string) {
  if (doc.status === 'cancelled') {
    throw new ApiError(409, 'document_cancelled', correlationId);
  }
  if (doc.status !== 'draft') {
    throw new ApiError(409, 'document_posted', correlationId);
  }
}

/** Sending: the sender's stock goes down now; the request closes — all asked or less. */
function dispatch(
  doc: Transfer,
  author: () => DocumentAuthor,
  correlationId: string,
) {
  const short = doc.lines.flatMap((line, i) =>
    (stockAt(doc.fromStoreId)[line.batchId] ?? 0) <
    linePieces(line, line.sentQuantity, correlationId)
      ? [{ field: `lines.${i}.quantity`, code: 'stock_insufficient' }]
      : [],
  );
  if (short.length > 0) {
    throw new ApiError(409, 'stock_insufficient', correlationId, short);
  }
  for (const line of doc.lines) {
    move(
      doc.fromStoreId,
      line.batchId,
      doc.number,
      -linePieces(line, line.sentQuantity, correlationId),
    );
  }
  doc.status = 'in_transit';
  doc.date = today();
  doc.sentBy = author();
  const request = db().transferRequests.find((r) => r.id === doc.requestId);
  if (request) {
    const full = request.lines.every((asked) => {
      const product = productOf(asked.productId, correlationId);
      const sent = doc.lines
        .filter((l) => l.productId === asked.productId)
        .reduce(
          (sum, l) => sum + linePieces(l, l.sentQuantity, correlationId),
          0,
        );
      return sent >= asked.quantity * product.piecesPerPack;
    });
    request.status = full ? 'done' : 'partial';
  }
  mockDb().pos.catalogVersion += 1;
}

/** Lines of a request: active products, once each, packs. */
function requestLines(
  body: Pick<TransferRequestInput, 'lines'>,
  correlationId: string,
): TransferRequest['lines'] {
  if (body.lines.length === 0)
    throw fieldError(correlationId, 'lines', 'required');
  const seen = new Set<string>();
  return body.lines.map((line, i) => {
    if (seen.has(line.productId)) {
      throw fieldError(correlationId, `lines.${i}.productId`, 'duplicate');
    }
    seen.add(line.productId);
    return {
      productId: line.productId,
      productName: productOf(line.productId, correlationId).name,
      quantity: line.quantity,
    };
  });
}

/** The system reasons of a write-off of a customer return are not chosen by hand (E9). */
function manualReason(reason: WriteOff['reason'], correlationId: string) {
  if (reason === 'customer_return_defect' || reason === 'customer_return_expired') {
    throw new ApiError(422, 'validation_failed', correlationId, [
      { field: 'reason', code: 'invalid' },
    ]);
  }
}

/**
 * The write-off of a customer return (spec 2026-10-13-customer-returns, E9): a defect or an expired
 * batch goes back to the batch and leaves it again by a posted write-off linked to the return.
 */
export function writeOffReturned(input: {
  storeId: string;
  reason: 'customer_return_defect' | 'customer_return_expired';
  customerReturnId: string;
  customerReturnNumber: string;
  authorName: string;
  lines: ReadonlyArray<{
    productId: string;
    productName: string;
    batchId: string;
    unit: SaleUnit;
    quantity: number;
  }>;
  correlationId: string;
}): WriteOff {
  const by: DocumentAuthor = { name: input.authorName, at: now() };
  const writeOff: WriteOff = {
    id: `wo-${input.customerReturnId}`,
    number: number('СП', 'sp'),
    status: 'posted',
    date: today(),
    storeId: input.storeId,
    storeName: storeName(input.storeId),
    reason: input.reason,
    comment: input.customerReturnNumber,
    lines: input.lines.map((line) => {
      const product = productOf(line.productId, input.correlationId);
      const batch = batchOf(line.productId, line.batchId, input.correlationId);
      return {
        productId: line.productId,
        productName: line.productName,
        batchId: line.batchId,
        batchNumber: batch.number,
        expiresOn: batch.expiresOn,
        unit: line.unit,
        quantity: line.quantity,
        costMinor: unitCost(product, batch, line.unit),
      };
    }),
    createdBy: by,
    postedBy: by,
    transferId: null,
    transferNumber: null,
    customerReturnId: input.customerReturnId,
    customerReturnNumber: input.customerReturnNumber,
  };
  writeOff.totalMinor = linesTotal(writeOff.lines);
  for (const line of input.lines) {
    const product = productOf(line.productId, input.correlationId);
    move(
      input.storeId,
      line.batchId,
      writeOff.number,
      -piecesOf(product, line.unit, line.quantity),
    );
  }
  db().writeOffs.unshift(writeOff);
  return writeOff;
}

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
    // expired: only the batches with stock that expired, of every product (spec 2026-10-12, B4)
    const expired = (b: { id: string; expiresOn: string }) =>
      (stockAt(params.storeId)[b.id] ?? 0) > 0 && b.expiresOn < today();
    const ids = query?.ids ? query.ids.split(',') : null;
    // supplierId: only the batches of the supplier — the one of the mock receipt with the batch
    // number; a batch outside the mock receipts counts as any supplier's
    const supplierOf = new Map(
      db().goodsReceipts.flatMap((r) =>
        r.lines.map((l) => [`${l.productId}/${l.batchNumber}`, r.supplierId]),
      ),
    );
    const receipt = query?.receiptId
      ? db().goodsReceipts.find((r) => r.id === query.receiptId)
      : null;
    const ofReceipt = (productId: string, b: { number: string }) =>
      !receipt ||
      receipt.lines.some(
        (l) => l.productId === productId && l.batchNumber === b.number,
      );
    const ofSupplier = (productId: string, b: { number: string }) =>
      !query?.supplierId ||
      (supplierOf.get(`${productId}/${b.number}`) ?? query.supplierId) ===
        query.supplierId;
    return products()
      .filter((p) =>
        ids
          ? ids.includes(p.id)
          : query?.expired
            ? p.batches.some(expired)
            : (!needle ||
                [p.name, p.inn ?? '', ...p.barcodes].some((v) =>
                  v.toLocaleLowerCase('ru').includes(needle),
                )) &&
              // a supplier return searches among the products with the supplier's batches
              (!query?.supplierId ||
                p.batches.some(
                  (b) =>
                    ofSupplier(p.id, b) &&
                    (stockAt(params.storeId)[b.id] ?? 0) > 0,
                )),
      )
      .slice(
        0,
        query?.expired || ids || query?.receiptId
          ? undefined
          : (query?.limit ?? 20),
      )
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
        batches: p.batches
          .filter(
            (b) =>
              (!query?.expired || expired(b)) &&
              ofSupplier(p.id, b) &&
              ofReceipt(p.id, b),
          )
          .map((b) => {
            const batch = {
              ...b,
              quantityPieces: stockAt(params.storeId)[b.id] ?? 0,
            };
            return canSeeCost ? batch : hideCost(batch, false);
          }),
      }))
      .filter((p) => !receipt || p.batches.some((b) => b.quantityPieces > 0));
  },

  'stock.productBatches': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'inventory:view');
    const product = productOf(params.productId, correlationId);
    return session.stores.flatMap((store) =>
      product.batches
        .map((b): ProductBatchRow => ({
          storeId: store.id,
          storeName: store.name,
          batchId: b.id,
          batchNumber: b.number,
          expiresOn: b.expiresOn,
          quantityPieces: stockAt(store.id)[b.id] ?? 0,
          ...(canSeeCost && b.costMinor !== undefined
            ? { costMinor: b.costMinor }
            : {}),
        }))
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
        return unpostCheck(
          doc.number,
          doc.storeId,
          countBatches(doc),
          doc.postedBy,
        );
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
    assertNotFrozen(
      doc.storeId,
      doc.lines.map((l) => l.productId),
      correlationId,
    );
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
    assertNotFrozen(
      doc.storeId,
      doc.lines.map((l) => l.productId),
      correlationId,
    );
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
    assertNotFrozen(
      doc.storeId,
      doc.lines.map((l) => l.productId),
      correlationId,
    );
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
    assertNotFrozen(
      doc.storeId,
      doc.lines.map((l) => l.productId),
      correlationId,
    );
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
    manualReason(body.reason, correlationId);
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
      transferId: null,
      transferNumber: null,
      customerReturnId: null,
      customerReturnNumber: null,
    };
    db().writeOffs.unshift(doc);
    return doc;
  },
  'writeOffs.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().writeOffs, params.id, correlationId);
    if (doc.transferId) {
      throw new ApiError(409, 'write_off_from_transfer', correlationId);
    }
    if (doc.customerReturnId) {
      throw new ApiError(409, 'write_off_from_return', correlationId);
    }
    requireDraft(doc.status, correlationId);
    manualReason(body.reason, correlationId);
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
    if (doc.transferId) {
      throw new ApiError(409, 'write_off_from_transfer', correlationId);
    }
    if (doc.customerReturnId) {
      throw new ApiError(409, 'write_off_from_return', correlationId);
    }
    requireDraft(doc.status, correlationId);
    writable(session, doc.storeId, correlationId);
    assertNotFrozen(
      doc.storeId,
      doc.lines.map((l) => l.productId),
      correlationId,
    );
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
    if (doc.transferId) {
      throw new ApiError(409, 'write_off_from_transfer', correlationId);
    }
    if (doc.customerReturnId) {
      throw new ApiError(409, 'write_off_from_return', correlationId);
    }
    writable(session, doc.storeId, correlationId);
    assertNotFrozen(
      doc.storeId,
      doc.lines.map((l) => l.productId),
      correlationId,
    );
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
      .filter((d) => !query?.status || d.status === query.status)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return page(
      all.map((d) => {
        const diffs = d.lines
          .filter((l) => l.factPieces !== null)
          .map((l) => ({ diff: countDiff(l), cost: l.pieceCostMinor ?? 0 }));
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
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:view',
    );
    const doc = findDoc(db().stockCounts, params.id, correlationId);
    inScope(session, doc.storeId, correlationId);
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.start': ({ body, correlationId }) => {
    // the start freezes the stock of the scope: a manager's step (spec 2026-10-12, R1)
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:post',
      { write: true },
    );
    writable(session, body.storeId, correlationId);
    if (
      db().stockCounts.some(
        (c) => c.storeId === body.storeId && c.status === 'in_progress',
      )
    ) {
      throw new ApiError(409, 'stock_count_in_progress', correlationId);
    }
    const category = categories.find((c) => c.id === body.categoryId) ?? null;
    const lines = products()
      .filter((p) =>
        body.scope === 'category' ? p.categoryId === body.categoryId : true,
      )
      .flatMap((p) =>
        p.batches
          .filter((b) => (stockAt(body.storeId)[b.id] ?? 0) > 0)
          .map((b): StockCountLine => ({
            lineId: `scl-${Date.now()}-${b.id}`,
            productId: p.id,
            productName: p.name,
            barcodes: p.barcodes,
            isFound: false,
            batchId: b.id,
            batchNumber: b.number,
            expiresOn: b.expiresOn,
            piecesPerPack: p.piecesPerPack,
            bookPieces: stockAt(body.storeId)[b.id] ?? 0,
            soldBeforeCountPieces: 0,
            soldAfterCountPieces: 0,
            counted: false,
            factPieces: null,
            entries: [],
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
      cancelledBy: null,
    };
    db().stockCounts.unshift(doc);
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.save': ({ params, body, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:update',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    doc.comment = body.comment;
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.addEntry': ({ params, body, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:update',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const line = doc.lines.find((l) => l.lineId === body.lineId);
    if (!line)
      throw new ApiError(400, 'validation_failed', correlationId, [
        { field: 'lineId', code: 'unknown' },
      ]);
    const seen = doc.lines
      .flatMap((l) => l.entries.map((entry) => ({ line: l, entry })))
      .find((x) => x.entry.id === body.id);
    if (seen) {
      // a repeat of the tablet: the same answer; another body with the key — a conflict
      if (
        seen.line.lineId !== body.lineId ||
        seen.entry.pieces !== body.pieces
      ) {
        throw new ApiError(409, 'idempotency_conflict', correlationId);
      }
    } else {
      line.entries.push({
        id: body.id,
        pieces: body.pieces,
        byName: author().name,
        mine: true,
        at: now(),
      });
      recount(line);
    }
    return lineView(doc, line.lineId, canSeeCost, author().name);
  },
  'stockCounts.deleteEntry': ({ params, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:update',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const line = doc.lines.find((l) =>
      l.entries.some((e) => e.id === params.entryId),
    );
    if (!line) throw new ApiError(404, 'not_found', correlationId);
    const entry = line.entries.find((e) => e.id === params.entryId);
    if (entry && entry.byName !== author().name) {
      authorize(correlationId, 'inventory:post');
    }
    line.entries = line.entries.filter((e) => e.id !== params.entryId);
    recount(line);
    return lineView(doc, line.lineId, canSeeCost, author().name);
  },
  'stockCounts.addFoundLine': ({ params, body, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:update',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const product = productOf(body.productId, correlationId);
    const cost = canSeeCost ? body.costMinor : null;
    doc.lines.push({
      lineId: `scl-found-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      barcodes: product.barcodes,
      isFound: true,
      batchId: null,
      batchNumber: body.batchNumber.trim(),
      expiresOn: body.expiresOn,
      piecesPerPack: product.piecesPerPack,
      bookPieces: 0,
      soldBeforeCountPieces: 0,
      soldAfterCountPieces: 0,
      counted: false,
      factPieces: null,
      entries: [],
      pieceCostMinor:
        cost === null ? 0 : pieceCost(cost, product.piecesPerPack),
      costMinor: cost,
    });
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.updateFoundLine': ({ params, body, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:update',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const line = doc.lines.find((l) => l.lineId === params.lineId && l.isFound);
    if (!line) throw new ApiError(404, 'not_found', correlationId);
    line.batchNumber = body.batchNumber.trim();
    line.expiresOn = body.expiresOn;
    if (canSeeCost) {
      line.costMinor = body.costMinor;
      line.pieceCostMinor =
        body.costMinor === null
          ? 0
          : pieceCost(body.costMinor, line.piecesPerPack);
    }
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.deleteFoundLine': ({ params, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:update',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const line = doc.lines.find((l) => l.lineId === params.lineId && l.isFound);
    if (!line) throw new ApiError(404, 'not_found', correlationId);
    if (line.entries.length > 0) {
      throw new ApiError(400, 'validation_failed', correlationId, [
        { field: 'lineId', code: 'has_entries' },
      ]);
    }
    doc.lines = doc.lines.filter((l) => l.lineId !== params.lineId);
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.post': ({ params, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:post',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const problems = doc.lines.flatMap((l, i) => [
      // as apps/api: no entry — required, a negative total — negative
      ...(!l.counted
        ? [{ field: `lines.${i}.counted`, code: 'required' }]
        : (l.factPieces ?? 0) < 0
          ? [{ field: `lines.${i}.counted`, code: 'negative' }]
          : []),
      ...(l.isFound && !l.expiresOn
        ? [{ field: `lines.${i}.expiresOn`, code: 'required' }]
        : []),
      ...(l.isFound && (l.costMinor ?? null) === null
        ? [{ field: `lines.${i}.costMinor`, code: 'required' }]
        : []),
    ]);
    if (problems.length > 0) {
      throw new ApiError(422, 'validation_failed', correlationId, problems);
    }
    // surplus is taken in, shortage written off (ТЗ); a found product gets a batch of its own
    for (const line of doc.lines) {
      if (line.isFound) {
        const batchId = line.batchId ?? `b-found-${line.lineId}`;
        if (line.batchId === null) {
          line.batchId = batchId;
          productOf(line.productId, correlationId).batches.push({
            id: batchId,
            number: line.batchNumber,
            expiresOn: line.expiresOn ?? today(),
            costMinor: line.costMinor ?? 0,
          } as PosBatch);
        }
        move(doc.storeId, batchId, doc.number, line.factPieces ?? 0);
        continue;
      }
      const diff = countDiff(line);
      if (diff !== 0 && line.batchId) {
        move(doc.storeId, line.batchId, doc.number, diff);
      }
    }
    doc.status = 'posted';
    doc.postedBy = author();
    mockDb().pos.catalogVersion += 1;
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.unpost': ({ params, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:unpost',
      { write: true },
    );
    const doc = findDoc(db().stockCounts, params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    const check = unpostCheck(
      doc.number,
      doc.storeId,
      countBatches(doc),
      doc.postedBy,
    );
    if (!check.allowed)
      throw new ApiError(409, 'unpost_blocked', correlationId);
    if (
      db().stockCounts.some(
        (c) =>
          c.id !== doc.id &&
          c.storeId === doc.storeId &&
          c.status === 'in_progress',
      )
    ) {
      throw new ApiError(409, 'stock_count_in_progress', correlationId);
    }
    for (const line of doc.lines) {
      const diff = line.isFound ? (line.factPieces ?? 0) : countDiff(line);
      if (diff !== 0 && line.batchId) {
        move(doc.storeId, line.batchId, `${doc.number} отмена`, -diff);
      }
    }
    doc.status = 'in_progress';
    doc.postedBy = null;
    mockDb().pos.catalogVersion += 1;
    return countView(doc, canSeeCost, author().name);
  },
  'stockCounts.cancel': ({ params, correlationId }) => {
    const { session, author, canSeeCost } = context(
      correlationId,
      'inventory:delete',
      { write: true },
    );
    const doc = runningCount(params.id, correlationId);
    writable(session, doc.storeId, correlationId);
    doc.status = 'cancelled';
    doc.cancelledBy = author();
    return countView(doc, canSeeCost, author().name);
  },

  /* transfers (spec 2026-10-12-supplier-returns-transfers, section 5) */
  'transfers.overview': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'inventory:view');
    if (query?.storeId) inScope(session, query.storeId, correlationId);
    const mine = (...ids: string[]) =>
      query?.storeId ? ids.includes(query.storeId) : involves(session, ...ids);
    const requests = db()
      .transferRequests.filter((r) => mine(r.requesterStoreId, r.fromStoreId))
      .sort((a, b) => b.number.localeCompare(a.number));
    const transfers = db()
      .transfers.filter((t) => mine(t.fromStoreId, t.toStoreId))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
      );
    return {
      requests,
      transfers: transfers.map(transferItem),
      kpi: {
        newRequests: requests.filter(
          (r) => r.status === 'sent' && mine(r.fromStoreId),
        ).length,
        requestsInProgress: requests.filter((r) => r.status === 'in_progress')
          .length,
        inTransit: transfers.filter((t) => t.status === 'in_transit').length,
      },
      stores: stores.map((s) => ({ id: s.id, name: s.name, mode: s.mode })),
    };
  },
  'transfers.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:view');
    const doc = findDoc(db().transfers, params.id, correlationId);
    if (!involves(session, doc.fromStoreId, doc.toStoreId)) {
      throw new ApiError(404, 'not_found', correlationId);
    }
    return doc;
  },
  'transfers.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:create', {
      write: true,
    });
    if (body.send) context(correlationId, 'inventory:post', { write: true });
    writable(session, body.fromStoreId, correlationId);
    counterpart(body.toStoreId, body.fromStoreId, correlationId);
    const request = body.requestId
      ? openRequest(body.requestId, body, correlationId)
      : null;
    const lines = transferLines(body, request, correlationId);
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
      status: 'draft',
      lines,
      sentBy: null,
      receivedBy: null,
      discrepancy: null,
    };
    if (body.send) dispatch(doc, author, correlationId);
    db().transfers.unshift(doc);
    if (request) {
      request.transferId = doc.id;
      request.transferNumber = doc.number;
      if (!body.send) request.status = 'in_progress';
    }
    return doc;
  },
  'transfers.update': ({ params, body, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:update', {
      write: true,
    });
    if (body.send) context(correlationId, 'inventory:post', { write: true });
    const doc = findDoc(db().transfers, params.id, correlationId);
    transferDraft(doc, correlationId);
    writable(session, doc.fromStoreId, correlationId);
    const request = doc.requestId
      ? (db().transferRequests.find((r) => r.id === doc.requestId) ?? null)
      : null;
    if (!request) counterpart(body.toStoreId, doc.fromStoreId, correlationId);
    doc.lines = transferLines(
      { ...body, fromStoreId: doc.fromStoreId },
      request,
      correlationId,
    );
    if (!request) {
      doc.toStoreId = body.toStoreId;
      doc.toStoreName = storeName(body.toStoreId);
    }
    if (body.send) dispatch(doc, author, correlationId);
    return doc;
  },
  'transfers.send': ({ params, correlationId }) => {
    const { session, author } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().transfers, params.id, correlationId);
    transferDraft(doc, correlationId);
    writable(session, doc.fromStoreId, correlationId);
    dispatch(doc, author, correlationId);
    return doc;
  },
  'transfers.recall': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:unpost', {
      write: true,
    });
    const doc = findDoc(db().transfers, params.id, correlationId);
    if (doc.status !== 'in_transit') {
      throw new ApiError(409, 'transfer_not_in_transit', correlationId);
    }
    writable(session, doc.fromStoreId, correlationId);
    for (const line of doc.lines) {
      move(
        doc.fromStoreId,
        line.batchId,
        `${doc.number} отзыв`,
        linePieces(line, line.sentQuantity, correlationId),
      );
    }
    doc.status = 'draft';
    doc.sentBy = null;
    const request = db().transferRequests.find((r) => r.id === doc.requestId);
    if (request) request.status = 'in_progress';
    mockDb().pos.catalogVersion += 1;
    return doc;
  },
  'transfers.cancel': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:delete', {
      write: true,
    });
    const doc = findDoc(db().transfers, params.id, correlationId);
    transferDraft(doc, correlationId);
    writable(session, doc.fromStoreId, correlationId);
    doc.status = 'cancelled';
    const request = db().transferRequests.find((r) => r.id === doc.requestId);
    if (request) {
      request.status = 'sent';
      request.transferId = null;
      request.transferNumber = null;
    }
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
    const received = doc.lines.map((line, i) => {
      const given = body.lines.filter((l) => l.batchId === line.batchId);
      const value = given[0]?.receivedQuantity;
      if (
        given.length !== 1 ||
        value === undefined ||
        value < 0 ||
        value > line.sentQuantity
      ) {
        throw new ApiError(400, 'validation_failed', correlationId, [
          { field: `lines.${i}.receivedQuantity`, code: 'range' },
        ]);
      }
      return value;
    });
    const short: TransferLine[] = [];
    doc.lines.forEach((line, i) => {
      line.receivedQuantity = received[i];
      // the receiver's stock changes only now (ТЗ)
      if (received[i] > 0) {
        move(
          doc.toStoreId,
          line.batchId,
          doc.number,
          linePieces(line, received[i], correlationId),
        );
      }
      if (received[i] < line.sentQuantity) short.push(line);
    });
    doc.status = 'accepted';
    doc.receivedBy = author();
    doc.discrepancy = null;
    if (short.length > 0) {
      // the shortage is written off at the sender by the system (spec T6); its stock already left
      const writeOff: WriteOff = {
        id: `wo-${Date.now()}`,
        number: number('СП', 'sp'),
        status: 'posted',
        date: today(),
        storeId: doc.fromStoreId,
        storeName: doc.fromStoreName,
        reason: 'transfer_discrepancy',
        comment: `${doc.number}: ${body.comment}`.trim(),
        lines: short.map((line) => {
          const product = productOf(line.productId, correlationId);
          const batch = batchOf(line.productId, line.batchId, correlationId);
          return {
            productId: line.productId,
            productName: line.productName,
            batchId: line.batchId,
            batchNumber: line.batchNumber,
            expiresOn: line.expiresOn,
            unit: line.unit,
            quantity: line.sentQuantity - (line.receivedQuantity ?? 0),
            costMinor: unitCost(product, batch, line.unit),
          };
        }),
        createdBy: author(),
        postedBy: author(),
        transferId: doc.id,
        transferNumber: doc.number,
        customerReturnId: null,
        customerReturnNumber: null,
      };
      writeOff.totalMinor = linesTotal(writeOff.lines);
      db().writeOffs.unshift(writeOff);
      doc.discrepancy = {
        comment: body.comment,
        writeOffId: writeOff.id,
        writeOffNumber: writeOff.number,
      };
    }
    completeStoreClosing(doc.id);
    mockDb().pos.catalogVersion += 1;
    return doc;
  },
  'transferRequests.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:view');
    const doc = findDoc(db().transferRequests, params.id, correlationId);
    if (!involves(session, doc.requesterStoreId, doc.fromStoreId)) {
      throw new ApiError(404, 'not_found', correlationId);
    }
    return doc;
  },
  'transferRequests.create': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:create', {
      write: true,
    });
    writable(session, body.toStoreId, correlationId);
    counterpart(body.fromStoreId, body.toStoreId, correlationId);
    const doc: TransferRequest = {
      id: `rq-${Date.now()}`,
      number: number('ЗП', 'zp'),
      date: today(),
      requesterStoreId: body.toStoreId,
      requesterStoreName: storeName(body.toStoreId),
      fromStoreId: body.fromStoreId,
      fromStoreName: storeName(body.fromStoreId),
      status: body.send ? 'sent' : 'draft',
      comment: body.comment,
      rejection: null,
      lines: requestLines(body, correlationId),
      transferId: null,
      transferNumber: null,
    };
    db().transferRequests.unshift(doc);
    return doc;
  },
  'transferRequests.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().transferRequests, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.requesterStoreId, correlationId);
    counterpart(body.fromStoreId, doc.requesterStoreId, correlationId);
    Object.assign(doc, {
      fromStoreId: body.fromStoreId,
      fromStoreName: storeName(body.fromStoreId),
      comment: body.comment,
      lines: requestLines(body, correlationId),
      status: body.send ? 'sent' : 'draft',
    });
    return doc;
  },
  'transferRequests.delete': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:update', {
      write: true,
    });
    const doc = findDoc(db().transferRequests, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.requesterStoreId, correlationId);
    db().transferRequests = db().transferRequests.filter(
      (r) => r.id !== doc.id,
    );
    return undefined;
  },
  'transferRequests.send': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'inventory:create', {
      write: true,
    });
    const doc = findDoc(db().transferRequests, params.id, correlationId);
    requireDraft(doc.status, correlationId);
    writable(session, doc.requesterStoreId, correlationId);
    doc.status = 'sent';
    return doc;
  },
  'transferRequests.reject': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'inventory:post', {
      write: true,
    });
    const doc = findDoc(db().transferRequests, params.id, correlationId);
    writable(session, doc.fromStoreId, correlationId);
    const transfer = db().transfers.find(
      (t) => t.id === doc.transferId && t.status !== 'cancelled',
    );
    if (
      !(doc.status === 'sent' || doc.status === 'in_progress') ||
      (transfer && transfer.status !== 'draft')
    ) {
      throw new ApiError(409, 'request_not_open', correlationId);
    }
    if (body.reason === 'other' && !body.comment.trim()) {
      throw new ApiError(400, 'validation_failed', correlationId, [
        { field: 'comment', code: 'required' },
      ]);
    }
    if (transfer) transfer.status = 'cancelled';
    doc.status = 'rejected';
    doc.rejection = { reason: body.reason, comment: body.comment };
    doc.transferId = null;
    doc.transferNumber = null;
    return doc;
  },
};

function buildSupplierReturn(
  input: SupplierReturnInput,
  base: Pick<
    SupplierReturn,
    'id' | 'number' | 'status' | 'createdBy' | 'postedBy'
  >,
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
    comment: input.comment,
    lines,
    totalMinor: linesTotal(lines),
  };
}
