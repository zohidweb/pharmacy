import { Injectable } from '@nestjs/common';
import type { ReceiptPaymentMethod } from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** A line of a paid receipt as a return sees it. */
export interface SoldLine {
  id: string;
  lineNo: number;
  productId: string;
  batchId: string;
  saleUnit: 'pack' | 'piece';
  piecesPerPack: number;
  qtyPieces: number;
  /** Price of the sale unit. */
  unitPriceDirams: number;
  lineAmountDirams: number;
  discountShareDirams: number;
  /** Sold as ПКУ: a `controlled_sale_records` row exists (spec 2026-10-13-customer-returns, E8). */
  controlled: boolean;
}

export interface SoldReceipt {
  id: string;
  storeId: string;
  number: string;
  soldAt: Date;
  businessDate: string;
  cashierName: string;
  subtotalDirams: number;
  discountDirams: number;
  /** Paid by kind; cash — net of the change (the payment row holds the cash handed over). */
  paidByKind: Map<ReceiptPaymentMethod, number>;
  lines: SoldLine[];
}

/** A line of a sale found by its product (a return without the receipt, R8). */
export interface SoldProductLine {
  receiptId: string;
  receiptNumber: string;
  soldAt: Date;
  productId: string;
  saleUnit: 'pack' | 'piece';
  /** In the sale unit. */
  quantity: number;
  amountDirams: number;
}

// The paid receipts of a store for the customer returns (spec 2026-10-13-customer-returns, E16):
// the returns module reads them through this interface, not the tables of the POS. Runs in the
// caller's transaction.
@Injectable()
export class SoldReceipts {
  /** A receipt of the store by its id (the QR of the receipt) or its number; null — none. */
  async find(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    by: { id: string } | { number: string },
  ): Promise<SoldReceipt | null> {
    const match =
      'id' in by ? sql`r.id = ${by.id}` : sql`r.number = ${by.number}`;
    const head = await sql<{
      id: string;
      storeId: string;
      number: string;
      soldAt: Date;
      businessDate: string;
      cashierName: string;
      subtotal: string;
      discount: string;
      change: string;
    }>`
      select r.id, r.store_id, r.number, r.sold_at, r.business_date::text as business_date,
             e.full_name as cashier_name, r.subtotal_dirams::text as subtotal,
             r.discount_dirams::text as discount, r.change_dirams::text as change
      from pharmacy.receipts r
      join pharmacy.employees e on e.tenant_id = r.tenant_id and e.id = r.cashier_id
      where r.tenant_id = ${tenantId} and r.store_id = ${storeId} and ${match}`.execute(
      trx,
    );
    const receipt = head.rows[0];
    if (!receipt) return null;
    const lines = await sql<{
      id: string;
      lineNo: number;
      productId: string;
      batchId: string;
      saleUnit: 'pack' | 'piece';
      piecesPerPack: number;
      qtyPieces: number;
      unitPrice: string;
      amount: string;
      share: string;
      controlled: boolean;
    }>`
      select l.id, l.line_no, l.product_id, l.batch_id, l.sale_unit, l.pieces_per_pack,
             l.qty_pieces, l.unit_price_dirams::text as unit_price,
             l.line_amount_dirams::text as amount, l.discount_share_dirams::text as share,
             exists (
               select 1 from pharmacy.controlled_sale_records c
               where c.tenant_id = l.tenant_id and c.receipt_line_id = l.id
             ) as controlled
      from pharmacy.receipt_lines l
      where l.tenant_id = ${tenantId} and l.receipt_id = ${receipt.id}
      order by l.line_no`.execute(trx);
    const payments = await sql<{ kind: ReceiptPaymentMethod; amount: string }>`
      select p.kind, p.amount_dirams::text as amount from pharmacy.payments p
      where p.tenant_id = ${tenantId} and p.receipt_id = ${receipt.id}`.execute(trx);
    const change = Number(receipt.change);
    return {
      id: receipt.id,
      storeId: receipt.storeId,
      number: receipt.number,
      soldAt: receipt.soldAt,
      businessDate: receipt.businessDate,
      cashierName: receipt.cashierName,
      subtotalDirams: Number(receipt.subtotal),
      discountDirams: Number(receipt.discount),
      paidByKind: new Map(
        payments.rows.map((p) => [
          p.kind,
          Number(p.amount) - (p.kind === 'cash' ? change : 0),
        ]),
      ),
      lines: lines.rows.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        productId: l.productId,
        batchId: l.batchId,
        saleUnit: l.saleUnit,
        piecesPerPack: l.piecesPerPack,
        qtyPieces: l.qtyPieces,
        unitPriceDirams: Number(l.unitPrice),
        lineAmountDirams: Number(l.amount),
        discountShareDirams: Number(l.share),
        controlled: l.controlled,
      })),
    };
  }

  /** Receipt lines by id with their receipt and product (the journal of returns). */
  async linesByIds(
    trx: TenantTransaction,
    tenantId: string,
    lineIds: readonly string[],
  ): Promise<
    Map<string, { receiptId: string; receiptNumber: string; productId: string }>
  > {
    const ids = [...new Set(lineIds)];
    if (ids.length === 0) return new Map();
    const result = await sql<{
      id: string;
      receiptId: string;
      receiptNumber: string;
      productId: string;
    }>`
      select l.id, l.receipt_id, r.number as receipt_number, l.product_id
      from pharmacy.receipt_lines l
      join pharmacy.receipts r on r.tenant_id = l.tenant_id and r.id = l.receipt_id
      where l.tenant_id = ${tenantId} and l.id in (${sql.join(ids)})`.execute(trx);
    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          receiptId: row.receiptId,
          receiptNumber: row.receiptNumber,
          productId: row.productId,
        },
      ]),
    );
  }

  /**
   * Sales of the products at the store on a business date, the newest first: one row per receipt,
   * product and sale unit — a product sold from two batches (FEFO) is one sale, not two.
   */
  async salesOfProducts(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    businessDate: string,
    productIds: readonly string[],
    limit: number,
  ): Promise<SoldProductLine[]> {
    if (productIds.length === 0) return [];
    const result = await sql<{
      receiptId: string;
      receiptNumber: string;
      soldAt: Date;
      productId: string;
      saleUnit: 'pack' | 'piece';
      quantity: number;
      amount: string;
    }>`
      select r.id as receipt_id, r.number as receipt_number, r.sold_at, l.product_id,
             l.sale_unit,
             -- each line in its own unit: the pieces per pack of a snapshot may differ by line
             sum(case when l.sale_unit = 'pack' then l.qty_pieces / l.pieces_per_pack
                      else l.qty_pieces end)::int as quantity,
             sum(l.line_amount_dirams)::text as amount
      from pharmacy.receipt_lines l
      join pharmacy.receipts r on r.tenant_id = l.tenant_id and r.id = l.receipt_id
      where l.tenant_id = ${tenantId} and r.store_id = ${storeId}
        and r.business_date = ${businessDate}::date
        and l.product_id in (${sql.join([...productIds])})
      group by r.id, r.number, r.sold_at, l.product_id, l.sale_unit
      order by r.sold_at desc, min(l.line_no)
      limit ${limit}`.execute(trx);
    return result.rows.map((row) => ({
      receiptId: row.receiptId,
      receiptNumber: row.receiptNumber,
      soldAt: row.soldAt,
      productId: row.productId,
      saleUnit: row.saleUnit,
      quantity: row.quantity,
      amountDirams: Number(row.amount),
    }));
  }
}
