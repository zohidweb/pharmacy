import { Injectable } from '@nestjs/common';
import type { ControlledSaleData } from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface SalesOfDay {
  storeId: string;
  /** YYYY-MM-DD — the business date of the sales. */
  businessDate: string;
  receipts: number;
  /** The sum of the receipts, discounts applied. */
  salesMinor: number;
}

export interface SalesOfStore {
  storeId: string;
  receipts: number;
  salesMinor: number;
  /** The cost of the goods sold — the snapshot of the receipt lines. */
  costMinor: number;
}

export interface SalesOfCategory {
  categoryId: string;
  /** The lines less their share of the receipt discount. */
  netMinor: number;
  costMinor: number;
}

export interface SalesOfCashier {
  cashierId: string;
  storeId: string;
  receipts: number;
  /** Cash less the change. */
  cashMinor: number;
  cardMinor: number;
  qrMinor: number;
  nfcMinor: number;
}

export interface ControlledSale {
  soldAt: Date;
  storeId: string;
  productId: string;
  lotNumber: string | null;
  qtyPieces: number;
  piecesPerPack: number;
  cashierId: string;
  receiptNumber: string;
  prescription: ControlledSaleData | null;
  /** The prescription data were purged by the retention term. */
  purged: boolean;
}

const stores = (storeIds: readonly string[]) => sql.val([...storeIds]);

// The sales of the stores for the home and the reports (spec 2026-10-14-owner-cabinet, E2, E3,
// 5.3): by business date of the receipts, the stores given, both dates included.
@Injectable()
export class SalesFigures {
  async byStoreDay(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<SalesOfDay[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      storeId: string;
      businessDate: string;
      receipts: number;
      salesMinor: string;
    }>`
      select store_id, business_date::text as business_date, count(*)::integer as receipts,
             sum(total_dirams) as sales_minor
      from pharmacy.receipts
      where tenant_id = ${tenantId}
        and store_id = any(${stores(storeIds)}::uuid[])
        and business_date between ${from}::date and ${to}::date
      group by store_id, business_date`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      salesMinor: Number(row.salesMinor),
    }));
  }

  async byStore(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<SalesOfStore[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      storeId: string;
      receipts: number;
      salesMinor: string;
      costMinor: string;
    }>`
      select r.store_id, count(*)::integer as receipts, sum(r.total_dirams) as sales_minor,
             sum((select coalesce(sum(l.cost_dirams), 0) from pharmacy.receipt_lines l
                  where l.tenant_id = r.tenant_id and l.receipt_id = r.id)) as cost_minor
      from pharmacy.receipts r
      where r.tenant_id = ${tenantId}
        and r.store_id = any(${stores(storeIds)}::uuid[])
        and r.business_date between ${from}::date and ${to}::date
      group by r.store_id`.execute(trx);
    return result.rows.map((row) => ({
      storeId: row.storeId,
      receipts: row.receipts,
      salesMinor: Number(row.salesMinor),
      costMinor: Number(row.costMinor),
    }));
  }

  async byCategory(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<SalesOfCategory[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      categoryId: string;
      netMinor: string;
      costMinor: string;
    }>`
      select p.category_id,
             sum(l.line_amount_dirams - l.discount_share_dirams) as net_minor,
             sum(l.cost_dirams) as cost_minor
      from pharmacy.receipt_lines l
      join pharmacy.receipts r on r.tenant_id = l.tenant_id and r.id = l.receipt_id
      join pharmacy.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
      where r.tenant_id = ${tenantId}
        and r.store_id = any(${stores(storeIds)}::uuid[])
        and r.business_date between ${from}::date and ${to}::date
      group by p.category_id`.execute(trx);
    return result.rows.map((row) => ({
      categoryId: row.categoryId,
      netMinor: Number(row.netMinor),
      costMinor: Number(row.costMinor),
    }));
  }

  async byCashier(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<SalesOfCashier[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      cashierId: string;
      storeId: string;
      receipts: number;
      cashMinor: string;
      cardMinor: string;
      qrMinor: string;
      nfcMinor: string;
    }>`
      with paid as (
        select r.id, r.cashier_id, r.store_id, r.change_dirams,
               coalesce(sum(p.amount_dirams) filter (where p.kind = 'cash'), 0) as cash,
               coalesce(sum(p.amount_dirams) filter (where p.kind = 'card'), 0) as card,
               coalesce(sum(p.amount_dirams) filter (where p.kind = 'qr'), 0) as qr,
               coalesce(sum(p.amount_dirams) filter (where p.kind = 'nfc'), 0) as nfc
        from pharmacy.receipts r
        left join pharmacy.payments p on p.tenant_id = r.tenant_id and p.receipt_id = r.id
        where r.tenant_id = ${tenantId}
          and r.store_id = any(${stores(storeIds)}::uuid[])
          and r.business_date between ${from}::date and ${to}::date
        group by r.id
      )
      select cashier_id, store_id, count(*)::integer as receipts,
             sum(cash - change_dirams) as cash_minor, sum(card) as card_minor,
             sum(qr) as qr_minor, sum(nfc) as nfc_minor
      from paid
      group by cashier_id, store_id`.execute(trx);
    return result.rows.map((row) => ({
      cashierId: row.cashierId,
      storeId: row.storeId,
      receipts: row.receipts,
      cashMinor: Number(row.cashMinor),
      cardMinor: Number(row.cardMinor),
      qrMinor: Number(row.qrMinor),
      nfcMinor: Number(row.nfcMinor),
    }));
  }

  /** The sales of the ПКУ journal: the lines with a ПКУ record. */
  async controlledSales(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<ControlledSale[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<
      Omit<ControlledSale, 'purged'> & { purgedAt: Date | null }
    >`
      select r.sold_at, r.store_id, l.product_id, b.lot_number, l.qty_pieces,
             l.pieces_per_pack, r.cashier_id, r.number as receipt_number,
             c.prescription_note as prescription, c.prescription_purged_at as purged_at
      from pharmacy.controlled_sale_records c
      join pharmacy.receipt_lines l on l.tenant_id = c.tenant_id and l.id = c.receipt_line_id
      join pharmacy.receipts r on r.tenant_id = l.tenant_id and r.id = l.receipt_id
      join pharmacy.batches b on b.tenant_id = l.tenant_id and b.id = l.batch_id
      where c.tenant_id = ${tenantId}
        and r.store_id = any(${stores(storeIds)}::uuid[])
        and r.business_date between ${from}::date and ${to}::date
      order by r.sold_at desc, l.line_no`.execute(trx);
    return result.rows.map(({ purgedAt, ...row }) => ({
      ...row,
      purged: purgedAt !== null,
    }));
  }
}
