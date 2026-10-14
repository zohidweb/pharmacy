import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  PrescriptionKind,
  ReceiptPayment,
  ReceiptPaymentMethod,
  ReturnableLine,
  ReturnableReceipt,
  SaleSearchItem,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { ProductsReader } from '../catalog/products-reader';
import { ReturnStock } from '../inventory/return-stock';
import { PosContext } from '../pos/pos-context';
import { type SoldLine, type SoldReceipt, SoldReceipts } from '../pos/sold-receipts';
import type { ReturnableQueryDto, SalesSearchQueryDto } from './dto/returns.dto';
import { type ReturnSettings, ReturnsRepository } from './returns.repository';

const DAY_MS = 86_400_000;
const METHODS: ReceiptPaymentMethod[] = ['cash', 'card', 'qr', 'nfc'];
const SALES_LIMIT = 50;

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** Days left in the return window of a sale; below zero — the window is over (E4). */
export function daysLeft(receipt: SoldReceipt, settings: ReturnSettings): number {
  return (
    settings.returnWindowDays - daysBetween(receipt.businessDate, settings.today)
  );
}

/** The sale unit of a line: packs of the snapshot of the sale, or pieces (E5). */
export function unitPieces(line: SoldLine): number {
  return line.saleUnit === 'pack' ? line.piecesPerPack : 1;
}

/**
 * The kind of the product of a line, for the view and the return alike: ПКУ when it was sold as ПКУ,
 * else the kind in the catalog now (E8).
 */
export function kindOf(
  line: SoldLine,
  prescription: PrescriptionKind | undefined,
): PrescriptionKind {
  return line.controlled ? 'controlled' : (prescription ?? 'none');
}

/** What is left to refund by kind: paid (cash net of change) − refunded (E7). */
export function refundable(
  receipt: SoldReceipt,
  refunded: ReadonlyMap<ReceiptPaymentMethod, number>,
): ReceiptPayment[] {
  return METHODS.flatMap((method) => {
    const left =
      (receipt.paidByKind.get(method) ?? 0) - (refunded.get(method) ?? 0);
    return left > 0 ? [{ method, amountMinor: left }] : [];
  });
}

// A receipt for a return and the sales of a product without the receipt (spec
// 2026-10-13-customer-returns, 4.2, E12, R8): only the store of the session, within the return
// window of the network.
@Injectable()
export class ReturnableService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly context: PosContext,
    private readonly repository: ReturnsRepository,
    private readonly sold: SoldReceipts,
    private readonly products: ProductsReader,
    private readonly stock: ReturnStock,
  ) {}

  find(query: ReturnableQueryDto): Promise<ReturnableReceipt> {
    const principal = requirePrincipal();
    const storeId = this.sessionStore();
    if (!query.id && !query.number?.trim()) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'number', code: 'required' },
      ]);
    }
    if (
      query.productId &&
      !hasPermissions(principal.permissions, 'returns:without-receipt')
    ) {
      throw new ProblemException(403, 'forbidden');
    }
    const by = query.id
      ? { id: query.id.toLowerCase() }
      : { number: (query.number ?? '').replace(/^№\s*/, '').trim() };
    const productId = query.productId?.toLowerCase() ?? null;
    return this.db.tenantTransaction(async (trx) => {
      const { tenantId } = principal;
      const settings = await this.repository.settings(trx, tenantId);
      const receipt = await this.sold.find(trx, tenantId, storeId, by);
      if (!receipt) throw new ProblemException(404, 'not_found');
      const left = daysLeft(receipt, settings);
      if (left < 0) throw new ProblemException(422, 'return_window_expired');
      const lines = receipt.lines.filter(
        (line) => productId === null || line.productId === productId,
      );
      // A product the receipt did not sell: no such sale, not a receipt without lines.
      if (productId !== null && lines.length === 0) {
        throw new ProblemException(404, 'not_found');
      }
      return {
        id: receipt.id,
        number: receipt.number,
        soldAt: receipt.soldAt.toISOString(),
        storeName: await this.repository.storeName(trx, tenantId, storeId),
        cashierName: receipt.cashierName,
        daysLeft: left,
        subtotalMinor: receipt.subtotalDirams,
        discountMinor: receipt.discountDirams,
        payments: refundable(
          receipt,
          await this.repository.refundedByKind(trx, tenantId, receipt.id),
        ),
        lines: await this.lines(trx, tenantId, storeId, lines, settings),
      };
    });
  }

  salesSearch(query: SalesSearchQueryDto): Promise<SaleSearchItem[]> {
    const { tenantId } = requirePrincipal();
    const storeId = this.sessionStore();
    return this.db.tenantTransaction(async (trx) => {
      const settings = await this.repository.settings(trx, tenantId);
      if (
        query.date > settings.today ||
        daysBetween(query.date, settings.today) > settings.returnWindowDays
      ) {
        return [];
      }
      const ids = await this.products.searchIds(trx, tenantId, query.query);
      if (!ids || ids.length === 0) return [];
      const sales = await this.sold.salesOfProducts(
        trx,
        tenantId,
        storeId,
        query.date,
        ids,
        SALES_LIMIT,
      );
      const names = new Map(
        (
          await this.products.listForPos(
            trx,
            tenantId,
            sales.map((s) => s.productId),
          )
        ).map((p) => [p.id, p.name]),
      );
      return sales.map((sale) => ({
        receiptId: sale.receiptId,
        receiptNumber: sale.receiptNumber,
        soldAt: sale.soldAt.toISOString(),
        productId: sale.productId,
        productName: names.get(sale.productId) ?? '—',
        quantity: sale.quantity,
        unit: sale.saleUnit,
        amountMinor: sale.amountDirams,
      }));
    });
  }

  /** The store of the session in its scope: a PIN session — its own store (4.1). */
  private sessionStore(): string {
    const { currentStoreId } = requirePrincipal();
    if (currentStoreId === null) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    this.context.inScope(currentStoreId);
    return currentStoreId;
  }

  private async lines(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    lines: readonly SoldLine[],
    settings: ReturnSettings,
  ): Promise<ReturnableLine[]> {
    const returned = await this.repository.returnedPieces(
      trx,
      tenantId,
      lines.map((l) => l.id),
    );
    const products = new Map(
      (
        await this.products.listForPos(
          trx,
          tenantId,
          lines.map((l) => l.productId),
        )
      ).map((p) => [p.id, p]),
    );
    const batches = await this.stock.batches(
      trx,
      tenantId,
      storeId,
      lines.map((l) => l.batchId),
    );
    return lines.map((line) => {
      const per = unitPieces(line);
      const product = products.get(line.productId);
      const batch = batches.get(line.batchId);
      const kind = kindOf(line, product?.prescription);
      return {
        lineId: line.id,
        productId: line.productId,
        productName: product?.name ?? '—',
        batchId: line.batchId,
        batchNumber: batch?.lotNumber ?? '—',
        unit: line.saleUnit,
        quantity: line.qtyPieces / per,
        returnedQuantity: (returned.get(line.id) ?? 0) / per,
        unitPriceMinor: line.unitPriceDirams,
        discountShareMinor: line.discountShareDirams,
        kind,
        customerReturnAllowed: settings.customerReturns[kind],
        batchExpired: batch !== undefined && batch.expiryDate < settings.today,
      };
    });
  }
}
