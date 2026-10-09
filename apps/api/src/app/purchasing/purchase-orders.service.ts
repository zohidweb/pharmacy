import { Injectable } from '@nestjs/common';
import { hasPermissions, receivedPercent } from '@pharmacy/shared-domain';
import type {
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderListQuery,
  PurchaseOrderListResponse,
  PurchaseOrderOption,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  type PricingProduct,
  ProductsReader,
} from '../catalog/products-reader';
import {
  type OrderLineRow,
  type OrderLineValues,
  type OrderRow,
  PurchaseOrdersRepository,
} from './purchase-orders.repository';
import { PurchasingRepository } from './purchasing.repository';

const notFound = () => new ProblemException(404, 'not_found');
const badField = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);
const notEditable = () => new ProblemException(409, 'order_not_editable');

interface OrderLineView {
  productId: string;
  productName: string;
  quantity: number;
  receivedQuantity: number;
  priceMinor: number;
}

// Purchase orders to suppliers (spec 2026-10-09-inventory-purchasing, section 5.3): a draft is
// edited, a confirmed order is received by goods receipts (OrderReceiving) and closes when every
// line is received. An order is seen and written only in the stores of the employee scope.
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: PurchaseOrdersRepository,
    private readonly purchasing: PurchasingRepository,
    private readonly products: ProductsReader,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: PurchaseOrderListQuery,
  ): Promise<PurchaseOrderListResponse> {
    const { tenantId, permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    const scope = this.scope();
    const storeId = query.storeId?.toLowerCase();
    if (storeId) this.inScope(storeId);
    const storeIds = storeId ? [storeId] : scope;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total } = await this.repository.list(
        trx,
        tenantId,
        {
          storeIds,
          status: query.status,
          supplierId: query.supplierId?.toLowerCase(),
        },
        { limit, offset },
      );
      const views = await this.lineViews(trx, tenantId, rows);
      const kpi = await this.repository.kpi(trx, tenantId, scope);
      const count = (status: string) => kpi.get(status) ?? 0;
      return {
        items: rows.map((row) => {
          const lines = views.get(row.id) ?? [];
          return {
            id: row.id,
            number: row.number,
            status: row.status,
            date: row.orderDate,
            supplierName: row.supplierName,
            storeName: row.storeName,
            positions: lines.length,
            ...(canSeeCost ? { totalMinor: totalOf(lines) } : {}),
            receivedPercent: receivedPercent(lines),
          };
        }),
        total,
        limit,
        offset,
        kpi: {
          open:
            count('draft') + count('confirmed') + count('partially_received'),
          draft: count('draft'),
          confirmed: count('confirmed'),
          partiallyReceived: count('partially_received'),
        },
      };
    });
  }

  async get(id: string): Promise<PurchaseOrder> {
    this.requireCost();
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.toOrder(trx, tenantId, await this.visible(trx, tenantId, id)),
    );
  }

  /** Confirmed and partially received orders of the supplier for a goods receipt. */
  async open(supplierId: string): Promise<PurchaseOrderOption[]> {
    // the lines carry the purchase prices (ADR-0018, п. 6)
    this.requireCost();
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const rows = await this.repository.open(
        trx,
        tenantId,
        supplierId.toLowerCase(),
        this.scope(),
      );
      const views = await this.lineViews(trx, tenantId, rows);
      return rows.map((row) => ({
        id: row.id,
        number: row.number,
        supplierId: row.supplierId,
        status: row.status as PurchaseOrderOption['status'],
        lines: views.get(row.id) ?? [],
      }));
    });
  }

  async create(input: PurchaseOrderInput): Promise<PurchaseOrder> {
    this.requireCost();
    const { tenantId, employeeId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      const storeId = input.storeId.toLowerCase();
      this.inScope(storeId);
      const store = await this.repository.store(trx, tenantId, storeId);
      if (store === null || store.status !== 'active') {
        throw badField('storeId', 'unknown_store');
      }
      const { header, lines } = await this.values(trx, tenantId, input);
      const today = await this.purchasing.businessDate(trx, tenantId);
      const number = await this.repository.nextNumber(
        trx,
        tenantId,
        store,
        today,
      );
      await this.repository.insert(trx, tenantId, {
        id,
        storeId,
        number,
        orderDate: today,
        createdBy: employeeId,
        ...header,
      });
      await this.repository.replaceLines(trx, tenantId, id, lines);
      await this.audit.append(trx, {
        action: 'purchase_order.created',
        entityType: 'purchase_order',
        entityId: id,
        storeId,
        details: { number, lines: lines.length },
      });
      return this.toOrder(trx, tenantId, await this.read(trx, tenantId, id));
    });
  }

  /** Only a draft; the store of an order does not change (its number carries the store code). */
  async update(id: string, input: PurchaseOrderInput): Promise<PurchaseOrder> {
    this.requireCost();
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const order = await this.visible(trx, tenantId, id, true);
      if (order.status !== 'draft') throw notEditable();
      if (input.storeId.toLowerCase() !== order.storeId) {
        throw badField('storeId', 'immutable');
      }
      const { header, lines } = await this.values(trx, tenantId, input);
      await this.repository.updateHeader(trx, tenantId, order.id, header);
      await this.repository.replaceLines(trx, tenantId, order.id, lines);
      await this.audit.append(trx, {
        action: 'purchase_order.updated',
        entityType: 'purchase_order',
        entityId: order.id,
        storeId: order.storeId,
        details: { number: order.number, lines: lines.length },
      });
      return this.toOrder(
        trx,
        tenantId,
        await this.read(trx, tenantId, order.id),
      );
    });
  }

  /** 409 `order_not_editable` unless a draft; 422 for a line without a price. */
  async confirm(id: string): Promise<PurchaseOrder> {
    this.requireCost();
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const order = await this.visible(trx, tenantId, id, true);
      if (order.status !== 'draft') throw notEditable();
      const lines = await this.repository.lines(trx, tenantId, [order.id]);
      const free = lines.findIndex((l) => Number(l.pricePerPackDirams) <= 0);
      if (free >= 0) {
        throw new FieldProblemException(422, 'validation_failed', [
          { field: `lines.${free}.priceMinor`, code: 'required' },
        ]);
      }
      await this.repository.confirm(trx, tenantId, order.id, employeeId);
      await this.audit.append(trx, {
        action: 'purchase_order.confirmed',
        entityType: 'purchase_order',
        entityId: order.id,
        storeId: order.storeId,
        details: { number: order.number, lines: lines.length },
      });
      return this.toOrder(
        trx,
        tenantId,
        await this.read(trx, tenantId, order.id),
      );
    });
  }

  /* ---------------- helpers ---------------- */

  private requireCost(): void {
    const { permissions } = requirePrincipal();
    // an order is its purchase prices (ADR-0018, п. 6)
    if (!hasPermissions(permissions, 'finance:view-cost')) {
      throw new ProblemException(403, 'forbidden');
    }
  }

  private scope(): readonly string[] | null {
    const { storeScope } = requirePrincipal();
    return storeScope === 'all' ? null : storeScope;
  }

  private inScope(storeId: string): void {
    const scope = this.scope();
    if (scope !== null && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
  }

  private async visible(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<OrderRow> {
    const order = await this.repository.find(
      trx,
      tenantId,
      id.toLowerCase(),
      lock,
    );
    if (order === null) throw notFound();
    this.inScope(order.storeId);
    return order;
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<OrderRow> {
    const order = await this.repository.find(trx, tenantId, id);
    if (order === null)
      throw new Error('The order just written is not readable');
    return order;
  }

  /** The supplier (active), active products without repeats, packs into pieces. */
  private async values(
    trx: TenantTransaction,
    tenantId: string,
    input: PurchaseOrderInput,
  ) {
    const supplier = await this.purchasing.findSupplier(
      trx,
      tenantId,
      input.supplierId.toLowerCase(),
    );
    if (supplier === null || supplier.status !== 'active') {
      throw badField('supplierId', 'unknown_supplier');
    }
    const ids = input.lines.map((l) => l.productId.toLowerCase());
    const products = new Map(
      (
        await this.products.findForPricing(trx, tenantId, [...new Set(ids)])
      ).map((p) => [p.id, p]),
    );
    const seen = new Set<string>();
    const lines: OrderLineValues[] = input.lines.map((line, i) => {
      const product = products.get(ids[i]);
      if (!product) throw badField(`lines.${i}.productId`, 'unknown_product');
      if (product.status !== 'active') {
        throw new FieldProblemException(409, 'product_archived', [
          { field: `lines.${i}.productId`, code: 'product_archived' },
        ]);
      }
      if (seen.has(product.id))
        throw badField(`lines.${i}.productId`, 'duplicate');
      seen.add(product.id);
      return {
        productId: product.id,
        qtyOrderedPieces: line.quantity * product.piecesPerPack,
        pricePerPackDirams: line.priceMinor,
      };
    });
    return {
      header: {
        supplierId: supplier.id,
        expectedDate: input.expectedOn,
        comment: input.comment.trim() || null,
      },
      lines,
    };
  }

  /** Lines of the orders in packs, with what the posted receipts received. */
  private async lineViews(
    trx: TenantTransaction,
    tenantId: string,
    orders: readonly OrderRow[],
  ): Promise<Map<string, OrderLineView[]>> {
    const ids = orders.map((o) => o.id);
    const lines = await this.repository.lines(trx, tenantId, ids);
    const received = await this.repository.receivedPieces(trx, tenantId, ids);
    const products = new Map(
      (
        await this.products.findForPricing(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const views = new Map<string, OrderLineView[]>();
    for (const line of lines) {
      const list = views.get(line.orderId) ?? [];
      list.push(lineView(line, products.get(line.productId), received));
      views.set(line.orderId, list);
    }
    return views;
  }

  private async toOrder(
    trx: TenantTransaction,
    tenantId: string,
    order: OrderRow,
  ): Promise<PurchaseOrder> {
    const lines =
      (await this.lineViews(trx, tenantId, [order])).get(order.id) ?? [];
    const names = await this.repository.employeeNames(trx, tenantId, [
      order.createdBy,
      ...(order.confirmedBy ? [order.confirmedBy] : []),
    ]);
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      date: order.orderDate,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      storeId: order.storeId,
      storeName: order.storeName,
      expectedOn: order.expectedDate,
      comment: order.comment ?? '',
      lines,
      totalMinor: totalOf(lines),
      receivedPercent: receivedPercent(lines),
      createdBy: {
        name: names.get(order.createdBy) ?? '—',
        at: order.createdAt.toISOString(),
      },
      confirmedBy:
        order.confirmedBy && order.confirmedAt
          ? {
              name: names.get(order.confirmedBy) ?? '—',
              at: order.confirmedAt.toISOString(),
            }
          : null,
    };
  }
}

function lineView(
  line: OrderLineRow,
  product: PricingProduct | undefined,
  received: ReadonlyMap<string, number>,
): OrderLineView {
  const ppp = product?.piecesPerPack ?? 1;
  return {
    productId: line.productId,
    productName: product?.name ?? '',
    quantity: Math.round(line.qtyOrderedPieces / ppp),
    receivedQuantity: Math.floor((received.get(line.id) ?? 0) / ppp),
    priceMinor: Number(line.pricePerPackDirams),
  };
}

const totalOf = (lines: readonly OrderLineView[]) =>
  lines.reduce((sum, l) => sum + l.quantity * l.priceMinor, 0);
