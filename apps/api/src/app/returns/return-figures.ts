import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface RefundsOfDay {
  storeId: string;
  /** YYYY-MM-DD — the business date of the returns. */
  businessDate: string;
  refundMinor: number;
}

export interface RefundsOfStore {
  storeId: string;
  refundMinor: number;
  /** The cost of the goods returned: pieces × the cost of a piece of the batch of the line. */
  returnedCostMinor: number;
}

export interface RefundsOfCategory {
  categoryId: string;
  refundMinor: number;
  returnedCostMinor: number;
}

export interface RefundsOfCashier {
  cashierId: string;
  storeId: string;
  refundMinor: number;
}

const stores = (storeIds: readonly string[]) => sql.val([...storeIds]);

// The money given back to the customers and the cost of the goods returned, by the business date
// and the store of the return, for the home and the reports (spec 2026-10-14-owner-cabinet, E2, E3).
@Injectable()
export class ReturnFigures {
  async byStoreDay(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<RefundsOfDay[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      storeId: string;
      businessDate: string;
      refundMinor: string;
    }>`
      select store_id, business_date::text as business_date, sum(refund_dirams) as refund_minor
      from pharmacy.customer_returns
      where tenant_id = ${tenantId}
        and store_id = any(${stores(storeIds)}::uuid[])
        and business_date between ${from}::date and ${to}::date
      group by store_id, business_date`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      refundMinor: Number(row.refundMinor),
    }));
  }

  async byStore(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<RefundsOfStore[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      storeId: string;
      refundMinor: string;
      returnedCostMinor: string;
    }>`
      select cr.store_id,
             sum(cr.refund_dirams) as refund_minor,
             sum((select coalesce(sum(rl.qty_pieces * b.cost_per_piece_dirams), 0)
                  from pharmacy.customer_return_lines rl
                  join pharmacy.receipt_lines l
                    on l.tenant_id = rl.tenant_id and l.id = rl.receipt_line_id
                  join pharmacy.batches b on b.tenant_id = l.tenant_id and b.id = l.batch_id
                  where rl.tenant_id = cr.tenant_id and rl.customer_return_id = cr.id))
               as returned_cost_minor
      from pharmacy.customer_returns cr
      where cr.tenant_id = ${tenantId}
        and cr.store_id = any(${stores(storeIds)}::uuid[])
        and cr.business_date between ${from}::date and ${to}::date
      group by cr.store_id`.execute(trx);
    return result.rows.map((row) => ({
      storeId: row.storeId,
      refundMinor: Number(row.refundMinor),
      returnedCostMinor: Number(row.returnedCostMinor),
    }));
  }

  async byCategory(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<RefundsOfCategory[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      categoryId: string;
      refundMinor: string;
      returnedCostMinor: string;
    }>`
      select p.category_id, sum(rl.amount_dirams) as refund_minor,
             sum(rl.qty_pieces * b.cost_per_piece_dirams) as returned_cost_minor
      from pharmacy.customer_return_lines rl
      join pharmacy.customer_returns cr
        on cr.tenant_id = rl.tenant_id and cr.id = rl.customer_return_id
      join pharmacy.receipt_lines l on l.tenant_id = rl.tenant_id and l.id = rl.receipt_line_id
      join pharmacy.batches b on b.tenant_id = l.tenant_id and b.id = l.batch_id
      join pharmacy.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
      where cr.tenant_id = ${tenantId}
        and cr.store_id = any(${stores(storeIds)}::uuid[])
        and cr.business_date between ${from}::date and ${to}::date
      group by p.category_id`.execute(trx);
    return result.rows.map((row) => ({
      categoryId: row.categoryId,
      refundMinor: Number(row.refundMinor),
      returnedCostMinor: Number(row.returnedCostMinor),
    }));
  }

  /** The returns made by each cashier (the employee of the return), by store. */
  async byCashier(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<RefundsOfCashier[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      cashierId: string;
      storeId: string;
      refundMinor: string;
    }>`
      select cashier_id, store_id, sum(refund_dirams) as refund_minor
      from pharmacy.customer_returns
      where tenant_id = ${tenantId}
        and store_id = any(${stores(storeIds)}::uuid[])
        and business_date between ${from}::date and ${to}::date
      group by cashier_id, store_id`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      refundMinor: Number(row.refundMinor),
    }));
  }
}
