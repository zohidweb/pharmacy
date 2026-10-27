import { Injectable } from '@nestjs/common';
import type {
  HeldReceipt,
  ReceiptPaymentMethod,
  ShiftAfterClosing,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import {
  type TenantTransaction,
  tenantTimeZone,
  tenantToday,
  uniqueConstraint,
} from '../../core/database';

export interface ShiftRow {
  id: string;
  storeId: string;
  terminalId: string;
  number: string;
  status: 'open' | 'closed';
  openedBy: string;
  openedByName: string;
  openedAt: Date;
  openingCashDirams: bigint;
  openedAuthorFlagged: boolean;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: Date | null;
  countedCashDirams: bigint | null;
  closedAuthorFlagged: boolean;
  zReport: unknown;
  /** Closed from another computer, and why (plan 2026-10-27-shift-history, S3). */
  forced: boolean;
  forcedReason: string | null;
}

/**
 * A shift of the history with its store, its till and the receipts accepted after a forced closing (S1). A closed
 * shift brings the five figures of its Z-report the list shows, not the whole report (it holds every sale).
 */
export interface ShiftListRow extends Omit<ShiftRow, 'zReport'> {
  storeName: string;
  terminalName: string;
  afterClosingReceipts: number;
  zTotals: {
    receipts: number;
    revenueMinor: number;
    discrepancyReceipts: number;
    discrepancyMinor: number;
    discrepancyReasonMissing: boolean;
  } | null;
}

/** The figures of the late operations of a shift; their list is `events(…, 'after-closing')`. */
export type ShiftAfterClosingFigures = Omit<ShiftAfterClosing, 'events'>;

export interface ShiftListFilter {
  storeId?: string;
  /** YYYY-MM-DD business dates of the opening, inclusive; by default `to` is today, `from` six days before `to`. */
  from?: string;
  to?: string;
  status?: 'open' | 'closed';
  limit: number;
  offset: number;
}

export interface ShiftTotals {
  receipts: number;
  revenueDirams: number;
  changeDirams: number;
  discrepancyReceipts: number;
  /** The largest local number of the receipts (P12); null without one. */
  lastLocalNumber: number | null;
  byKind: Map<ReceiptPaymentMethod, { count: number; amountDirams: number }>;
  depositsDirams: number;
  withdrawalsDirams: number;
}

export interface ShiftEventRow {
  id: string;
  at: Date;
  kind: 'sale' | 'cash_in' | 'cash_out' | 'return';
  reference: string;
  employeeName: string;
  amountDirams: number;
  flagged: boolean;
}

export interface HeldReceiptRow {
  id: string;
  storeId: string;
  shiftId: string;
  heldAt: Date;
  heldByName: string;
  subtotalDirams: bigint;
  payload: HeldReceipt['lines'];
}

const SHIFT = sql`
  select s.id, s.store_id, s.terminal_id, s.number, s.status, s.opened_by,
         eo.full_name as opened_by_name, s.opened_at, s.opening_cash_dirams,
         s.opened_author_flagged, s.closed_by, ec.full_name as closed_by_name, s.closed_at,
         s.counted_cash_dirams, s.closed_author_flagged, s.z_report, s.forced, s.forced_reason
  from pharmacy.shifts s
  join pharmacy.employees eo on eo.tenant_id = s.tenant_id and eo.id = s.opened_by
  left join pharmacy.employees ec on ec.tenant_id = s.tenant_id and ec.id = s.closed_by`;

/** A unique violation of the one open shift per terminal (two openings at once). */
export function isOpenShiftConflict(error: unknown): boolean {
  return uniqueConstraint(error) === 'shifts_open_terminal_uq';
}

// Shifts of the terminals, their cash operations and the held receipts of a store (data model 04,
// spec 2026-10-13-pos-shift-sale, 4.4 and 4.6).
@Injectable()
export class ShiftsRepository {
  /** The open shifts of a store (spec 2026-10-15-store-closing, E7). */
  async openShiftsOfStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<number> {
    const result = await sql<{ open: number }>`
      select count(*)::integer as open from pharmacy.shifts
      where tenant_id = ${tenantId} and store_id = ${storeId} and status = 'open'`.execute(trx);
    return result.rows[0].open;
  }

  async openShiftOfTerminal(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<ShiftRow | null> {
    const result = await sql<ShiftRow>`${SHIFT}
      where s.tenant_id = ${tenantId} and s.terminal_id = ${terminalId}
        and s.status = 'open'`.execute(trx);
    return result.rows[0] ?? null;
  }

  /** When the last shift of the terminal closed: the opening of the next one is not dated before it (E4). */
  async lastClosedAt(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<Date | null> {
    const result = await sql<{ closedAt: Date | null }>`
      select max(closed_at) as closed_at from pharmacy.shifts
      where tenant_id = ${tenantId} and terminal_id = ${terminalId}
        and status = 'closed'`.execute(trx);
    return result.rows[0]?.closedAt ?? null;
  }

  /** The shift locked for the transaction: `share` — an operation in it, `update` — its closing. */
  async lockShift(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
    mode: 'share' | 'update',
  ): Promise<ShiftRow | null> {
    const result = await sql<ShiftRow>`${SHIFT}
      where s.tenant_id = ${tenantId} and s.id = ${shiftId}
      ${mode === 'share' ? sql`for share of s` : sql`for update of s`}`.execute(trx);
    return result.rows[0] ?? null;
  }

  /**
   * The shift history of the scope (S1): opened within the business dates, newest first. `scope` — the stores the
   * employee may see; `'all'` — the whole network.
   */
  async list(
    trx: TenantTransaction,
    tenantId: string,
    scope: 'all' | readonly string[],
    filter: ShiftListFilter,
  ): Promise<{ rows: ShiftListRow[]; total: number }> {
    const zone = tenantTimeZone(tenantId);
    const to = sql`coalesce(${filter.to ?? null}::date, ${tenantToday(tenantId)})`;
    const from = sql`coalesce(${filter.from ?? null}::date, ${to} - 6)`;
    // the business days as a range of moments, so that shifts_store_opened_idx serves it
    const where = sql`s.tenant_id = ${tenantId}
      ${scope === 'all' ? sql`` : sql`and s.store_id = any(${sql.val([...scope])}::uuid[])`}
      ${filter.storeId ? sql`and s.store_id = ${filter.storeId}` : sql``}
      ${filter.status ? sql`and s.status = ${filter.status}` : sql``}
      and s.opened_at >= ((${from})::timestamp at time zone ${zone})
      and s.opened_at < (((${to}) + 1)::timestamp at time zone ${zone})`;
    const count = await sql<{ total: number }>`
      select count(*)::integer as total from pharmacy.shifts s where ${where}`.execute(trx);
    const result = await sql<ShiftListRow>`
      select s.id, s.store_id, s.terminal_id, s.number, s.status, s.opened_by,
             eo.full_name as opened_by_name, s.opened_at, s.opening_cash_dirams,
             s.opened_author_flagged, s.closed_by, ec.full_name as closed_by_name, s.closed_at,
             s.counted_cash_dirams, s.closed_author_flagged, s.forced, s.forced_reason,
             case when s.z_report is not null then jsonb_build_object(
               'receipts', s.z_report->'shift'->'receipts',
               'revenueMinor', s.z_report->'shift'->'revenueMinor',
               'discrepancyReceipts', s.z_report->'shift'->'discrepancyReceipts',
               'discrepancyMinor', s.z_report->'discrepancyMinor',
               'discrepancyReasonMissing', s.z_report->'discrepancyReasonMissing') end as z_totals,
             st.name as store_name, t.name as terminal_name,
             (select count(*)::integer from pharmacy.receipts r
              where r.tenant_id = ${tenantId} and r.shift_id = s.id
                and 'after_closing' = any(r.discrepancy_kinds)) as after_closing_receipts
      from pharmacy.shifts s
      join pharmacy.employees eo on eo.tenant_id = s.tenant_id and eo.id = s.opened_by
      left join pharmacy.employees ec on ec.tenant_id = s.tenant_id and ec.id = s.closed_by
      join pharmacy.stores st on st.tenant_id = s.tenant_id and st.id = s.store_id
      join pharmacy.terminals t on t.tenant_id = s.tenant_id and t.id = s.terminal_id
      where ${where}
      order by s.opened_at desc, s.id desc
      limit ${filter.limit} offset ${filter.offset}`.execute(trx);
    return { rows: result.rows, total: count.rows[0].total };
  }

  /**
   * The receipts and cash operations of a till accepted after its shift was closed from another computer (S4). The
   * cash part of the receipts is the cash handed over less the change, as in the totals of a shift.
   */
  async afterClosing(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
  ): Promise<ShiftAfterClosingFigures> {
    const result = await sql<{
      receipts: number;
      revenue: string;
      cash: string;
      cashIn: string;
      cashOut: string;
    }>`
      select
        (select count(*)::integer from pharmacy.receipts r
         where r.tenant_id = ${tenantId} and r.shift_id = ${shiftId}
           and 'after_closing' = any(r.discrepancy_kinds)) as receipts,
        (select coalesce(sum(r.total_dirams), 0)::text from pharmacy.receipts r
         where r.tenant_id = ${tenantId} and r.shift_id = ${shiftId}
           and 'after_closing' = any(r.discrepancy_kinds)) as revenue,
        ((select coalesce(sum(p.amount_dirams), 0) from pharmacy.payments p
          join pharmacy.receipts r on r.tenant_id = p.tenant_id and r.id = p.receipt_id
          where p.tenant_id = ${tenantId} and r.shift_id = ${shiftId} and p.kind = 'cash'
            and 'after_closing' = any(r.discrepancy_kinds))
         - (select coalesce(sum(r.change_dirams), 0) from pharmacy.receipts r
            where r.tenant_id = ${tenantId} and r.shift_id = ${shiftId}
              and 'after_closing' = any(r.discrepancy_kinds)))::text as cash,
        (select coalesce(sum(o.amount_dirams), 0)::text from pharmacy.shift_cash_operations o
         where o.tenant_id = ${tenantId} and o.shift_id = ${shiftId}
           and o.after_closing and o.kind = 'deposit') as cash_in,
        (select coalesce(sum(o.amount_dirams), 0)::text from pharmacy.shift_cash_operations o
         where o.tenant_id = ${tenantId} and o.shift_id = ${shiftId}
           and o.after_closing and o.kind = 'withdrawal') as cash_out`.execute(trx);
    const row = result.rows[0];
    return {
      receipts: row.receipts,
      revenueMinor: Number(row.revenue),
      cashMinor: Number(row.cash),
      cashInMinor: Number(row.cashIn),
      cashOutMinor: Number(row.cashOut),
    };
  }

  /** The name of a till of the network (the card of a shift, S2). */
  async terminalName(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<string> {
    const row = await trx
      .selectFrom('terminals')
      .select('name')
      .where('tenantId', '=', tenantId)
      .where('id', '=', terminalId)
      .executeTakeFirst();
    return row?.name ?? '';
  }

  /** When the till of the shift was last heard from: the opening, its last receipt or cash operation received (S2). */
  async lastActivityAt(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
  ): Promise<Date | null> {
    const result = await sql<{ at: Date | null }>`
      select greatest(
        (select s.received_at from pharmacy.shifts s
         where s.tenant_id = ${tenantId} and s.id = ${shiftId}),
        (select max(r.received_at) from pharmacy.receipts r
         where r.tenant_id = ${tenantId} and r.shift_id = ${shiftId}),
        (select max(o.received_at) from pharmacy.shift_cash_operations o
         where o.tenant_id = ${tenantId} and o.shift_id = ${shiftId})) as at`.execute(trx);
    return result.rows[0]?.at ?? null;
  }

  async findShift(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
  ): Promise<ShiftRow | null> {
    const result = await sql<ShiftRow>`${SHIFT}
      where s.tenant_id = ${tenantId} and s.id = ${shiftId}`.execute(trx);
    return result.rows[0] ?? null;
  }

  async insertShift(
    trx: TenantTransaction,
    tenantId: string,
    values: {
      id: string;
      storeId: string;
      terminalId: string;
      number: string;
      openedBy: string;
      openedAt: Date;
      receivedAt: Date;
      openingCashDirams: number;
      openedAuthorFlagged: boolean;
    },
  ): Promise<void> {
    await trx
      .insertInto('shifts')
      .values({
        tenantId,
        ...values,
        openingCashDirams: BigInt(values.openingCashDirams),
      })
      .execute();
  }

  async closeShift(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
    values: {
      closedBy: string;
      closedAt: Date;
      closedAuthorFlagged: boolean;
      expectedCashDirams: number;
      countedCashDirams: number;
      discrepancyDirams: number;
      discrepancyReason: string | null;
      terminalTotals: Record<'card' | 'qr' | 'nfc', number>;
      /** Closed from another computer (S3). */
      forced: boolean;
      forcedReason: string | null;
      zReport: unknown;
    },
  ): Promise<void> {
    await trx
      .updateTable('shifts')
      .set({
        status: 'closed',
        closedBy: values.closedBy,
        closedAt: values.closedAt,
        closedAuthorFlagged: values.closedAuthorFlagged,
        expectedCashDirams: BigInt(values.expectedCashDirams),
        countedCashDirams: BigInt(values.countedCashDirams),
        discrepancyDirams: BigInt(values.discrepancyDirams),
        discrepancyReason: values.discrepancyReason,
        terminalTotals: JSON.stringify(values.terminalTotals),
        forced: values.forced,
        forcedReason: values.forcedReason,
        zReport: JSON.stringify(values.zReport),
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', shiftId)
      .execute();
  }

  async insertCashOperation(
    trx: TenantTransaction,
    tenantId: string,
    values: {
      id: string;
      shiftId: string;
      kind: 'deposit' | 'withdrawal';
      amountDirams: number;
      reason: string;
      comment: string | null;
      employeeId: string;
      occurredAt: Date;
      receivedAt: Date;
      authorFlagged: boolean;
      /** Received after its shift was closed from another computer (S4): not in the Z-report. */
      afterClosing: boolean;
    },
  ): Promise<void> {
    await trx
      .insertInto('shiftCashOperations')
      .values({
        tenantId,
        ...values,
        amountDirams: BigInt(values.amountDirams),
      })
      .execute();
  }

  /**
   * Totals of the receipts, payments and cash operations of a shift; those accepted after a closing from another
   * computer are not in them — they are counted apart (`afterClosing`, S4).
   */
  async totals(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
  ): Promise<ShiftTotals> {
    const receipts = await sql<{
      receipts: number;
      revenue: string;
      change: string;
      flagged: number;
      lastLocalNumber: number | null;
    }>`
      select count(*)::integer as receipts, coalesce(sum(r.total_dirams), 0)::text as revenue,
             coalesce(sum(r.change_dirams), 0)::text as change,
             (count(*) filter (where r.discrepancy_kinds <> '{}'))::integer as flagged,
             max(r.local_number) as last_local_number
      from pharmacy.receipts r
      where r.tenant_id = ${tenantId} and r.shift_id = ${shiftId}
        and not ('after_closing' = any(r.discrepancy_kinds))`.execute(trx);
    const payments = await sql<{
      kind: ReceiptPaymentMethod;
      count: number;
      amount: string;
    }>`
      select p.kind, count(*)::integer as count, sum(p.amount_dirams)::text as amount
      from pharmacy.payments p
      join pharmacy.receipts r on r.tenant_id = p.tenant_id and r.id = p.receipt_id
      where p.tenant_id = ${tenantId} and r.shift_id = ${shiftId}
        and not ('after_closing' = any(r.discrepancy_kinds))
      group by p.kind`.execute(trx);
    const cash = await sql<{ deposits: string; withdrawals: string }>`
      select coalesce(sum(o.amount_dirams) filter (where o.kind = 'deposit'), 0)::text as deposits,
             coalesce(sum(o.amount_dirams) filter (where o.kind = 'withdrawal'), 0)::text
               as withdrawals
      from pharmacy.shift_cash_operations o
      where o.tenant_id = ${tenantId} and o.shift_id = ${shiftId} and not o.after_closing`.execute(trx);
    const r = receipts.rows[0];
    return {
      receipts: r.receipts,
      revenueDirams: Number(r.revenue),
      changeDirams: Number(r.change),
      discrepancyReceipts: r.flagged,
      lastLocalNumber: r.lastLocalNumber,
      byKind: new Map(
        payments.rows.map((p) => [
          p.kind,
          { count: p.count, amountDirams: Number(p.amount) },
        ]),
      ),
      depositsDirams: Number(cash.rows[0].deposits),
      withdrawalsDirams: Number(cash.rows[0].withdrawals),
    };
  }

  /**
   * Sales and cash operations of a shift for its log; `after-closing` — only those accepted after its closing from
   * another computer (S4), which the log of the shift leaves out.
   */
  async events(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
    part: 'shift' | 'after-closing' = 'shift',
  ): Promise<ShiftEventRow[]> {
    const late = part === 'after-closing';
    const result = await sql<ShiftEventRow & { amountDirams: string }>`
      select r.id, r.sold_at as at, 'sale' as kind, r.number as reference,
             e.full_name as employee_name, r.total_dirams::text as amount_dirams,
             r.discrepancy_kinds <> '{}' as flagged
      from pharmacy.receipts r
      join pharmacy.employees e on e.tenant_id = r.tenant_id and e.id = r.cashier_id
      where r.tenant_id = ${tenantId} and r.shift_id = ${shiftId}
        and ('after_closing' = any(r.discrepancy_kinds)) = ${late}
      union all
      select o.id, o.occurred_at, case o.kind when 'deposit' then 'cash_in' else 'cash_out' end,
             o.reason, e.full_name,
             (case o.kind when 'deposit' then o.amount_dirams else -o.amount_dirams end)::text,
             o.author_flagged
      from pharmacy.shift_cash_operations o
      join pharmacy.employees e on e.tenant_id = o.tenant_id and e.id = o.employee_id
      where o.tenant_id = ${tenantId} and o.shift_id = ${shiftId} and o.after_closing = ${late}`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      amountDirams: Number(row.amountDirams),
    }));
  }

  async insertHeld(
    trx: TenantTransaction,
    tenantId: string,
    values: {
      id: string;
      storeId: string;
      shiftId: string;
      heldBy: string;
      subtotalDirams: number;
      payload: HeldReceipt['lines'];
    },
  ): Promise<void> {
    await trx
      .insertInto('heldReceipts')
      .values({
        tenantId,
        id: values.id,
        storeId: values.storeId,
        shiftId: values.shiftId,
        heldBy: values.heldBy,
        heldAt: sql<Date>`now()`,
        subtotalDirams: BigInt(values.subtotalDirams),
        payload: JSON.stringify(values.payload),
      })
      .execute();
  }

  async heldReceipts(
    trx: TenantTransaction,
    tenantId: string,
    filter: { storeId?: string; id?: string },
  ): Promise<HeldReceiptRow[]> {
    const result = await sql<HeldReceiptRow>`
      select h.id, h.store_id, h.shift_id, h.held_at, e.full_name as held_by_name,
             h.subtotal_dirams, h.payload
      from pharmacy.held_receipts h
      join pharmacy.employees e on e.tenant_id = h.tenant_id and e.id = h.held_by
      where h.tenant_id = ${tenantId}
        ${filter.storeId === undefined ? sql`` : sql`and h.store_id = ${filter.storeId}`}
        ${filter.id === undefined ? sql`` : sql`and h.id = ${filter.id}`}
      order by h.held_at desc, h.id`.execute(trx);
    return result.rows;
  }

  async deleteHeld(
    trx: TenantTransaction,
    tenantId: string,
    filter: { id?: string; shiftId?: string },
  ): Promise<void> {
    let query = trx.deleteFrom('heldReceipts').where('tenantId', '=', tenantId);
    if (filter.id !== undefined) query = query.where('id', '=', filter.id);
    if (filter.shiftId !== undefined)
      query = query.where('shiftId', '=', filter.shiftId);
    await query.execute();
  }
}
