import { Injectable } from '@nestjs/common';
import type { PurchaseOrderStatus } from '@pharmacy/shared-domain';
import { sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';

export interface OrderRow {
  id: string;
  storeId: string;
  storeName: string;
  supplierId: string;
  supplierName: string;
  number: string;
  orderDate: string;
  expectedDate: string | null;
  status: PurchaseOrderStatus;
  createdBy: string;
  createdAt: Date;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  comment: string | null;
}

export interface OrderLineRow {
  id: string;
  orderId: string;
  lineNo: number;
  productId: string;
  qtyOrderedPieces: number;
  pricePerPackDirams: bigint;
}

export interface OrderLineValues {
  productId: string;
  qtyOrderedPieces: number;
  pricePerPackDirams: number;
}

export interface OrderHeaderValues {
  supplierId: string;
  expectedDate: string | null;
  comment: string | null;
}

export interface OrderStore {
  id: string;
  code: string;
  status: string;
}

const HEADER = sql`o.id, o.store_id, s.name as store_name, o.supplier_id, sp.name as supplier_name,
  o.number, o.order_date::text as order_date, o.expected_date::text as expected_date, o.status,
  o.created_by, o.created_at, o.confirmed_by, o.confirmed_at, o.comment`;
const FROM = sql`pharmacy.purchase_orders o
  join pharmacy.stores s on s.tenant_id = o.tenant_id and s.id = o.store_id
  join pharmacy.suppliers sp on sp.tenant_id = o.tenant_id and sp.id = o.supplier_id`;

// Purchase orders and their lines (data model 05). What the posted goods receipts received by an
// order line is read from their lines, as the supplier ledger reads posted receipts.
@Injectable()
export class PurchaseOrdersRepository {
  /** `lock` — FOR NO KEY UPDATE: a goods receipt saved by the order meanwhile only checks its key. */
  async find(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<OrderRow | null> {
    const result = await sql<OrderRow>`
      select ${HEADER} from ${FROM}
      where o.tenant_id = ${tenantId} and o.id = ${id}
      ${lock ? sql`for no key update of o` : sql``}`.execute(trx);
    return result.rows[0] ?? null;
  }

  async list(
    trx: TenantTransaction,
    tenantId: string,
    filter: {
      storeIds: readonly string[] | null;
      status?: PurchaseOrderStatus | 'open';
      supplierId?: string;
    },
    page: { limit: number; offset: number },
  ): Promise<{ rows: OrderRow[]; total: number }> {
    if (filter.storeIds !== null && filter.storeIds.length === 0) {
      return { rows: [], total: 0 };
    }
    const result = await sql<OrderRow & { total: bigint }>`
      select ${HEADER}, count(*) over () as total
      from ${FROM}
      where o.tenant_id = ${tenantId}
        ${filter.storeIds === null ? sql`` : sql`and o.store_id in (${sql.join([...filter.storeIds])})`}
        ${
          filter.status === 'open'
            ? sql`and o.status <> 'closed'`
            : filter.status
              ? sql`and o.status = ${filter.status}`
              : sql``
        }
        ${filter.supplierId ? sql`and o.supplier_id = ${filter.supplierId}` : sql``}
      order by o.order_date desc, o.number desc
      limit ${page.limit} offset ${page.offset}`.execute(trx);
    return {
      rows: result.rows,
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  /** Orders by status in the stores. */
  async kpi(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[] | null,
  ): Promise<Map<string, number>> {
    if (storeIds !== null && storeIds.length === 0) return new Map();
    const result = await sql<{ status: string; n: number }>`
      select status, count(*)::integer as n
      from pharmacy.purchase_orders
      where tenant_id = ${tenantId}
        ${storeIds === null ? sql`` : sql`and store_id in (${sql.join([...storeIds])})`}
      group by status`.execute(trx);
    return new Map(result.rows.map((r) => [r.status, r.n]));
  }

  /** Confirmed and partially received orders of the supplier in the stores. */
  async open(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    storeIds: readonly string[] | null,
  ): Promise<OrderRow[]> {
    if (storeIds !== null && storeIds.length === 0) return [];
    const result = await sql<OrderRow>`
      select ${HEADER} from ${FROM}
      where o.tenant_id = ${tenantId} and o.supplier_id = ${supplierId}
        and o.status in ('confirmed', 'partially_received')
        ${storeIds === null ? sql`` : sql`and o.store_id in (${sql.join([...storeIds])})`}
      order by o.order_date desc, o.number desc`.execute(trx);
    return result.rows;
  }

  async lines(
    trx: TenantTransaction,
    tenantId: string,
    orderIds: readonly string[],
  ): Promise<OrderLineRow[]> {
    if (orderIds.length === 0) return [];
    return trx
      .selectFrom('purchaseOrderLines')
      .select([
        'id',
        'orderId',
        'lineNo',
        'productId',
        'qtyOrderedPieces',
        'pricePerPackDirams',
      ])
      .where('tenantId', '=', tenantId)
      .where('orderId', 'in', [...orderIds])
      .orderBy('orderId')
      .orderBy('lineNo')
      .execute() as Promise<OrderLineRow[]>;
  }

  /** Pieces received by the order lines through posted goods receipts. */
  async receivedPieces(
    trx: TenantTransaction,
    tenantId: string,
    orderIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const result = await sql<{ lineId: string; pieces: number }>`
      select l.purchase_order_line_id as line_id, sum(l.qty_pieces)::integer as pieces
      from pharmacy.goods_receipt_lines l
      join pharmacy.documents d on d.tenant_id = l.tenant_id and d.id = l.document_id
      where l.tenant_id = ${tenantId} and d.status = 'posted'
        and d.purchase_order_id in (${sql.join([...orderIds])})
        and l.purchase_order_line_id is not null
      group by l.purchase_order_line_id`.execute(trx);
    return new Map(result.rows.map((r) => [r.lineId, r.pieces]));
  }

  async numbers(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await trx
      .selectFrom('purchaseOrders')
      .select(['id', 'number'])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', unique)
      .execute();
    return new Map(rows.map((r) => [r.id, r.number]));
  }

  async store(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<OrderStore | null> {
    const row = await trx
      .selectFrom('stores')
      .select(['id', 'code', 'status'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', storeId)
      .executeTakeFirst();
    return row ?? null;
  }

  /** `ЗК-<store code>-<year>-<6 digits>`: a counter per store and year (data model 05). */
  async nextNumber(
    trx: TenantTransaction,
    tenantId: string,
    store: OrderStore,
    date: string,
  ): Promise<string> {
    const year = Number(date.slice(0, 4));
    const result = await sql<{ lastNumber: bigint }>`
      insert into pharmacy.document_counters (tenant_id, store_id, kind, year, last_number)
      values (${tenantId}, ${store.id}, 'purchase_order', ${year}, 1)
      on conflict (tenant_id, store_id, kind, year)
        do update set last_number = pharmacy.document_counters.last_number + 1
      returning last_number`.execute(trx);
    const n = String(result.rows[0].lastNumber).padStart(6, '0');
    return `ЗК-${store.code}-${year}-${n}`;
  }

  async insert(
    trx: TenantTransaction,
    tenantId: string,
    order: OrderHeaderValues & {
      id: string;
      storeId: string;
      number: string;
      orderDate: string;
      createdBy: string;
    },
  ): Promise<void> {
    await trx
      .insertInto('purchaseOrders')
      .values({ tenantId, ...order })
      .execute();
  }

  async updateHeader(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    header: OrderHeaderValues,
  ): Promise<void> {
    await trx
      .updateTable('purchaseOrders')
      .set({ ...header, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  /** The lines of the order become exactly `lines`, numbered in order. */
  async replaceLines(
    trx: TenantTransaction,
    tenantId: string,
    orderId: string,
    lines: readonly OrderLineValues[],
  ): Promise<void> {
    await trx
      .deleteFrom('purchaseOrderLines')
      .where('tenantId', '=', tenantId)
      .where('orderId', '=', orderId)
      .execute();
    if (lines.length === 0) return;
    await trx
      .insertInto('purchaseOrderLines')
      .values(
        lines.map((line, index) => ({
          tenantId,
          id: newId(),
          orderId,
          lineNo: index + 1,
          productId: line.productId,
          qtyOrderedPieces: line.qtyOrderedPieces,
          pricePerPackDirams: BigInt(line.pricePerPackDirams),
        })),
      )
      .execute();
  }

  async confirm(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    employeeId: string,
  ): Promise<void> {
    await trx
      .updateTable('purchaseOrders')
      .set({
        status: 'confirmed',
        confirmedBy: employeeId,
        confirmedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async setStatus(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    status: PurchaseOrderStatus,
  ): Promise<void> {
    await trx
      .updateTable('purchaseOrders')
      .set({ status, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async employeeNames(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await trx
      .selectFrom('employees')
      .select(['id', 'fullName'])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', unique)
      .execute();
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}
