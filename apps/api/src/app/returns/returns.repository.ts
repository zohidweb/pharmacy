import { Injectable } from '@nestjs/common';
import type {
  PrescriptionKind,
  ReceiptPaymentMethod,
  ReturnReason,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';
import type { ShiftReturnTotals } from '../pos/shift-returns';

/** The return window and policy of the network, with its business date (R3, E4). */
export interface ReturnSettings {
  /** Business date of the network, YYYY-MM-DD. */
  today: string;
  returnWindowDays: number;
  customerReturns: Record<PrescriptionKind, boolean>;
}

export interface CustomerReturnValues {
  id: string;
  storeId: string;
  shiftId: string;
  terminalId: string;
  cashierId: string;
  receiptId: string;
  number: string;
  businessDate: string;
  reason: ReturnReason;
  foundWithoutReceipt: boolean;
  discountReturnedDirams: number;
  refundDirams: number;
  correlationId: string;
}

export interface CustomerReturnLineValues {
  receiptLineId: string;
  qtyPieces: number;
  amountDirams: number;
  discountShareDirams: number;
}

export interface ReturnListRow {
  id: string;
  number: string;
  returnedAt: Date;
  storeName: string;
  receiptId: string;
  reason: ReturnReason;
  refundDirams: number;
  cashierName: string;
  foundWithoutReceipt: boolean;
}

// The customer returns of a network (spec 2026-10-13-customer-returns; data model 04): the return,
// its lines and the money back are append-only; the return window and policy live in
// tenant_settings (R3, E17). The receipts, their lines, the stock and the catalog are read through
// the exports of pos, inventory and catalog (E16).
@Injectable()
export class ReturnsRepository {
  async settings(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<ReturnSettings> {
    const result = await sql<{
      today: string;
      returnWindowDays: number;
      otc: boolean;
      rx: boolean;
      controlled: boolean;
    }>`
      select (now() at time zone coalesce(ts.timezone, 'Asia/Dushanbe'))::date::text as today,
             coalesce(ts.return_period_days, 14) as return_window_days,
             coalesce(ts.customer_return_otc, true) as otc,
             coalesce(ts.customer_return_rx, false) as rx,
             coalesce(ts.customer_return_controlled, false) as controlled
      from (select 1) one
      left join pharmacy.tenant_settings ts on ts.tenant_id = ${tenantId}`.execute(trx);
    const row = result.rows[0];
    return {
      today: row.today,
      returnWindowDays: row.returnWindowDays,
      customerReturns: {
        none: row.otc,
        rx: row.rx,
        controlled: row.controlled,
      },
    };
  }

  async updatePolicy(
    trx: TenantTransaction,
    tenantId: string,
    policy: {
      returnWindowDays: number;
      customerReturns: Record<PrescriptionKind, boolean>;
    },
    updatedBy: string,
  ): Promise<void> {
    await sql`
      insert into pharmacy.tenant_settings
        (tenant_id, return_period_days, customer_return_otc, customer_return_rx,
         customer_return_controlled, updated_by)
      values (${tenantId}, ${policy.returnWindowDays}, ${policy.customerReturns.none},
              ${policy.customerReturns.rx}, ${policy.customerReturns.controlled}, ${updatedBy})
      on conflict (tenant_id) do update set
        return_period_days = excluded.return_period_days,
        customer_return_otc = excluded.customer_return_otc,
        customer_return_rx = excluded.customer_return_rx,
        customer_return_controlled = excluded.customer_return_controlled,
        updated_by = excluded.updated_by,
        updated_at = now()`.execute(trx);
  }

  async storeName(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<string> {
    const result = await sql<{ name: string }>`
      select s.name from pharmacy.stores s
      where s.tenant_id = ${tenantId} and s.id = ${storeId}`.execute(trx);
    return result.rows[0]?.name ?? '—';
  }

  /** Pieces returned so far by receipt line. */
  async returnedPieces(
    trx: TenantTransaction,
    tenantId: string,
    receiptLineIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (receiptLineIds.length === 0) return new Map();
    const result = await sql<{ receiptLineId: string; pieces: number }>`
      select l.receipt_line_id, sum(l.qty_pieces)::integer as pieces
      from pharmacy.customer_return_lines l
      where l.tenant_id = ${tenantId}
        and l.receipt_line_id in (${sql.join([...receiptLineIds])})
      group by l.receipt_line_id`.execute(trx);
    return new Map(result.rows.map((r) => [r.receiptLineId, r.pieces]));
  }

  /** The money refunded so far by kind for the returns of a receipt. */
  async refundedByKind(
    trx: TenantTransaction,
    tenantId: string,
    receiptId: string,
  ): Promise<Map<ReceiptPaymentMethod, number>> {
    const result = await sql<{ kind: ReceiptPaymentMethod; amount: string }>`
      select f.kind, sum(f.amount_dirams)::text as amount
      from pharmacy.customer_return_refunds f
      join pharmacy.customer_returns r
        on r.tenant_id = f.tenant_id and r.id = f.customer_return_id
      where f.tenant_id = ${tenantId} and r.receipt_id = ${receiptId}
      group by f.kind`.execute(trx);
    return new Map(result.rows.map((r) => [r.kind, Number(r.amount)]));
  }

  async insertReturn(
    trx: TenantTransaction,
    tenantId: string,
    values: CustomerReturnValues,
  ): Promise<void> {
    await sql`
      insert into pharmacy.customer_returns
        (tenant_id, id, store_id, shift_id, terminal_id, cashier_id, receipt_id, number,
         returned_at, business_date, reason, found_without_receipt, discount_returned_dirams,
         refund_dirams, correlation_id)
      values (${tenantId}, ${values.id}, ${values.storeId}, ${values.shiftId},
              ${values.terminalId}, ${values.cashierId}, ${values.receiptId}, ${values.number},
              now(), ${values.businessDate}::date, ${values.reason},
              ${values.foundWithoutReceipt}, ${values.discountReturnedDirams},
              ${values.refundDirams}, ${values.correlationId})`.execute(trx);
  }

  /**
   * The lines of a return; their ids, in the order given. `receiptId` — the receipt of the return:
   * each line is a line of it (composite key, cr-M9).
   */
  async insertLines(
    trx: TenantTransaction,
    tenantId: string,
    customerReturnId: string,
    receiptId: string,
    lines: readonly CustomerReturnLineValues[],
  ): Promise<string[]> {
    const ids = lines.map(() => newId());
    await trx
      .insertInto('customerReturnLines')
      .values(
        lines.map((line, i) => ({
          tenantId,
          id: ids[i],
          customerReturnId,
          receiptId,
          receiptLineId: line.receiptLineId,
          qtyPieces: line.qtyPieces,
          amountDirams: BigInt(line.amountDirams),
          discountShareDirams: BigInt(line.discountShareDirams),
        })),
      )
      .execute();
    return ids;
  }

  async insertRefunds(
    trx: TenantTransaction,
    tenantId: string,
    customerReturnId: string,
    refunds: ReadonlyArray<{ kind: ReceiptPaymentMethod; amountDirams: number }>,
  ): Promise<void> {
    // a return of nothing to pay back (a price 0, a 100 % discount) has no refunds
    if (refunds.length === 0) return;
    await trx
      .insertInto('customerReturnRefunds')
      .values(
        refunds.map((refund) => ({
          tenantId,
          id: newId(),
          customerReturnId,
          kind: refund.kind,
          amountDirams: BigInt(refund.amountDirams),
        })),
      )
      .execute();
  }

  /** The journal: returns of the stores (null — every store), the newest first. */
  async list(
    trx: TenantTransaction,
    tenantId: string,
    filter: {
      storeIds: readonly string[] | null;
      reason?: ReturnReason;
      limit: number;
      offset: number;
    },
  ): Promise<{ rows: ReturnListRow[]; total: number }> {
    if (filter.storeIds !== null && filter.storeIds.length === 0) {
      return { rows: [], total: 0 };
    }
    const where = sql`r.tenant_id = ${tenantId}
      ${filter.storeIds === null ? sql`` : sql`and r.store_id in (${sql.join([...filter.storeIds])})`}
      ${filter.reason ? sql`and r.reason = ${filter.reason}` : sql``}`;
    const rows = await sql<ReturnListRow & { refund: string }>`
      select r.id, r.number, r.returned_at, s.name as store_name, r.receipt_id, r.reason,
             r.refund_dirams::text as refund, e.full_name as cashier_name,
             r.found_without_receipt
      from pharmacy.customer_returns r
      join pharmacy.stores s on s.tenant_id = r.tenant_id and s.id = r.store_id
      join pharmacy.employees e on e.tenant_id = r.tenant_id and e.id = r.cashier_id
      where ${where}
      order by r.returned_at desc, r.number desc
      limit ${filter.limit} offset ${filter.offset}`.execute(trx);
    const total = await sql<{ n: number }>`
      select count(*)::integer as n from pharmacy.customer_returns r where ${where}`.execute(
      trx,
    );
    return {
      rows: rows.rows.map(({ refund, ...row }) => ({
        ...row,
        refundDirams: Number(refund),
      })),
      total: total.rows[0].n,
    };
  }

  /** The first returned receipt line of each return, in the order of the receipt. */
  async firstLines(
    trx: TenantTransaction,
    tenantId: string,
    returnIds: readonly string[],
  ): Promise<Map<string, { receiptLineId: string; lines: number }>> {
    if (returnIds.length === 0) return new Map();
    const result = await sql<{
      customerReturnId: string;
      receiptLineId: string;
      lines: number;
    }>`
      select distinct on (l.customer_return_id) l.customer_return_id, l.receipt_line_id,
             (count(*) over (partition by l.customer_return_id))::integer as lines
      from pharmacy.customer_return_lines l
      where l.tenant_id = ${tenantId}
        and l.customer_return_id in (${sql.join([...returnIds])})
      order by l.customer_return_id, l.created_at, l.id`.execute(trx);
    return new Map(
      result.rows.map((r) => [
        r.customerReturnId,
        { receiptLineId: r.receiptLineId, lines: r.lines },
      ]),
    );
  }

  /** The ways the money went back, by return. */
  async refundKinds(
    trx: TenantTransaction,
    tenantId: string,
    returnIds: readonly string[],
  ): Promise<Map<string, ReceiptPaymentMethod[]>> {
    if (returnIds.length === 0) return new Map();
    const result = await sql<{
      customerReturnId: string;
      kind: ReceiptPaymentMethod;
    }>`
      select f.customer_return_id, f.kind from pharmacy.customer_return_refunds f
      where f.tenant_id = ${tenantId}
        and f.customer_return_id in (${sql.join([...returnIds])})
      order by array_position(array['cash', 'card', 'qr', 'nfc'], f.kind)`.execute(trx);
    const out = new Map<string, ReceiptPaymentMethod[]>();
    for (const row of result.rows) {
      out.set(row.customerReturnId, [
        ...(out.get(row.customerReturnId) ?? []),
        row.kind,
      ]);
    }
    return out;
  }

  /** The returns made in a shift (`ShiftReturns`, E13). */
  async shiftTotals(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
  ): Promise<ShiftReturnTotals> {
    const returns = await sql<{
      id: string;
      at: Date;
      reference: string;
      employeeName: string;
      refund: string;
    }>`
      select r.id, r.returned_at as at, r.number as reference, e.full_name as employee_name,
             r.refund_dirams::text as refund
      from pharmacy.customer_returns r
      join pharmacy.employees e on e.tenant_id = r.tenant_id and e.id = r.cashier_id
      where r.tenant_id = ${tenantId} and r.shift_id = ${shiftId}`.execute(trx);
    const kinds = await sql<{
      kind: ReceiptPaymentMethod;
      count: number;
      amount: string;
    }>`
      select f.kind, count(*)::integer as count, sum(f.amount_dirams)::text as amount
      from pharmacy.customer_return_refunds f
      join pharmacy.customer_returns r
        on r.tenant_id = f.tenant_id and r.id = f.customer_return_id
      where f.tenant_id = ${tenantId} and r.shift_id = ${shiftId}
      group by f.kind`.execute(trx);
    return {
      count: returns.rows.length,
      amountDirams: returns.rows.reduce((sum, r) => sum + Number(r.refund), 0),
      byKind: new Map(
        kinds.rows.map((k) => [
          k.kind,
          { count: k.count, amountDirams: Number(k.amount) },
        ]),
      ),
      events: returns.rows.map((r) => ({
        id: r.id,
        at: r.at,
        kind: 'return' as const,
        reference: r.reference,
        employeeName: r.employeeName,
        amountDirams: -Number(r.refund),
        flagged: false,
      })),
    };
  }

  /** Numbers of the returns (`CustomerReturnNumbers`, E9). */
  async numbers(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const result = await sql<{ id: string; number: string }>`
      select r.id, r.number from pharmacy.customer_returns r
      where r.tenant_id = ${tenantId} and r.id in (${sql.join([...ids])})`.execute(trx);
    return new Map(result.rows.map((r) => [r.id, r.number]));
  }
}
