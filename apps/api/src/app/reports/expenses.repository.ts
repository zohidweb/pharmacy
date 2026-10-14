import { Injectable } from '@nestjs/common';
import type { ExpenseKind } from '@pharmacy/shared-domain';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface ExpenseRow {
  id: string;
  /** YYYY-MM. */
  month: string;
  storeId: string | null;
  /** The name of the store at any status; null for the whole network. */
  storeName: string | null;
  kind: ExpenseKind;
  amountMinor: number;
  comment: string | null;
}

export interface ExpenseFields {
  /** YYYY-MM. */
  month: string;
  storeId: string | null;
  kind: ExpenseKind;
  amountMinor: number;
  comment: string | null;
}

const columns = sql`
  e.id, to_char(e.month, 'YYYY-MM') as month, e.store_id, s.name as store_name, e.kind,
  e.amount_dirams as amount_minor, e.comment`;

const toRow = (row: Omit<ExpenseRow, 'amountMinor'> & { amountMinor: bigint | string }) => ({
  ...row,
  amountMinor: Number(row.amountMinor),
});

// The other expenses of the network (spec 2026-10-14-owner-cabinet, E16, 5.6): one row per month,
// store (or the whole network) and kind of an entry; months are stored as their first day.
@Injectable()
export class ExpensesRepository {
  /** The records of the months [fromMonth, toMonth] (YYYY-MM, both included). */
  async ofMonths(
    trx: TenantTransaction,
    tenantId: string,
    fromMonth: string,
    toMonth: string,
  ): Promise<ExpenseRow[]> {
    const result = await sql<Parameters<typeof toRow>[0]>`
      select ${columns}
      from pharmacy.expenses e
      left join pharmacy.stores s on s.tenant_id = e.tenant_id and s.id = e.store_id
      where e.tenant_id = ${tenantId}
        and e.month between ${`${fromMonth}-01`}::date and ${`${toMonth}-01`}::date
      order by e.store_id nulls first, e.kind, e.amount_dirams desc, e.id`.execute(trx);
    return result.rows.map(toRow);
  }

  async find(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<ExpenseRow | null> {
    const result = await sql<Parameters<typeof toRow>[0]>`
      select ${columns}
      from pharmacy.expenses e
      left join pharmacy.stores s on s.tenant_id = e.tenant_id and s.id = e.store_id
      where e.tenant_id = ${tenantId} and e.id = ${id}`.execute(trx);
    return result.rows[0] ? toRow(result.rows[0]) : null;
  }

  async insert(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    fields: ExpenseFields,
    employeeId: string,
  ): Promise<void> {
    await trx
      .insertInto('expenses')
      .values({
        tenantId,
        id,
        month: `${fields.month}-01`,
        storeId: fields.storeId,
        kind: fields.kind,
        amountDirams: BigInt(fields.amountMinor),
        comment: fields.comment,
        createdBy: employeeId,
      })
      .execute();
  }

  async update(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    fields: ExpenseFields,
    employeeId: string,
  ): Promise<void> {
    await trx
      .updateTable('expenses')
      .set({
        month: `${fields.month}-01`,
        storeId: fields.storeId,
        kind: fields.kind,
        amountDirams: BigInt(fields.amountMinor),
        comment: fields.comment,
        updatedBy: employeeId,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async remove(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<void> {
    await trx
      .deleteFrom('expenses')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }
}
