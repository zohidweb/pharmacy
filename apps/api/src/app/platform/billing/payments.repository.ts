import { Injectable } from '@nestjs/common';
import type {
  PaymentListItem,
  PaymentMethod,
  TenantPaymentItem,
} from '@pharmacy/shared-dto';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

type Money = bigint | string | number;

export interface PaymentRow {
  id: string;
  tenantId: string;
  status: 'active' | 'cancelled';
  amountDirams: Money;
  paidOn: string;
  method: PaymentMethod;
  comment: string | null;
  requestHash: Buffer;
}

interface ItemRow {
  id: string;
  paidOn: string;
  tenantId: string;
  tenantName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountDirams: Money;
  method: PaymentMethod;
  recordedBy: string;
  comment: string | null;
  status: 'active' | 'cancelled';
  cancelReason: string | null;
}

const toItem = (row: ItemRow): PaymentListItem => ({
  id: row.id,
  paidOn: row.paidOn,
  tenantId: row.tenantId,
  tenantName: row.tenantName,
  invoiceId: row.invoiceId,
  invoiceNumber: row.invoiceNumber,
  amountMinor: Number(row.amountDirams),
  method: row.method,
  recordedBy: row.recordedBy,
  comment: row.comment,
  cancelled: row.status === 'cancelled',
  cancelReason: row.cancelReason,
});

const ITEM = sql`
  select p.id, p.paid_on::text as paid_on, p.tenant_id, t.name as tenant_name,
         p.preferred_invoice_id as invoice_id, i.number as invoice_number, p.amount_dirams,
         p.method, o.full_name as recorded_by, p.comment, p.status, p.cancel_reason
  from pharmacy.tenant_payments p
  join pharmacy.tenants t on t.id = p.tenant_id
  join pharmacy.operators o on o.id = p.recorded_by
  left join pharmacy.invoices i on i.id = p.preferred_invoice_id`;

// Payments of networks on the platform path (spec 2026-10-15-billing-services, B1, B2, A9): never
// deleted, a cancelled one keeps its reason; the allocation is written by TenantAllocation.
@Injectable()
export class PaymentsRepository {
  async find(
    trx: Transaction<DB>,
    id: string,
    forUpdate = false,
  ): Promise<PaymentRow | null> {
    const { rows } = await sql<PaymentRow>`
      select id, tenant_id, status, amount_dirams, paid_on::text as paid_on, method, comment,
             request_hash
      from pharmacy.tenant_payments where id = ${id}
      ${forUpdate ? sql`for no key update` : sql``}`.execute(trx);
    return rows[0] ?? null;
  }

  /** Locks the row of the network (the first lock of a money change); false for an unknown one. */
  async lockTenant(trx: Transaction<DB>, tenantId: string): Promise<boolean> {
    const { rows } = await sql`
      select id from pharmacy.tenants where id = ${tenantId} for no key update`.execute(
      trx,
    );
    return rows.length > 0;
  }

  async invoiceOf(
    trx: Transaction<DB>,
    invoiceId: string,
  ): Promise<{
    tenantId: string;
    totalDirams: Money;
    paidDirams: Money;
  } | null> {
    const row = await trx
      .selectFrom('invoices')
      .select(['tenantId', 'totalDirams', 'paidDirams'])
      .where('id', '=', invoiceId)
      .executeTakeFirst();
    return row ?? null;
  }

  /** False when a payment with this id exists already (a concurrent repeat committed first). */
  async insert(
    trx: Transaction<DB>,
    values: {
      id: string;
      tenantId: string;
      amountMinor: number;
      paidOn: string;
      method: PaymentMethod;
      comment: string | null;
      invoiceId: string | null;
      recordedBy: string;
      requestHash: Buffer;
    },
  ): Promise<boolean> {
    const result = await trx
      .insertInto('tenantPayments')
      .values({
        id: values.id,
        tenantId: values.tenantId,
        amountDirams: BigInt(values.amountMinor),
        paidOn: values.paidOn,
        method: values.method,
        comment: values.comment,
        preferredInvoiceId: values.invoiceId,
        recordedBy: values.recordedBy,
        requestHash: values.requestHash,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  async update(
    trx: Transaction<DB>,
    id: string,
    values: {
      amountMinor: number;
      paidOn: string;
      method: PaymentMethod;
      comment: string | null;
    },
  ): Promise<void> {
    await trx
      .updateTable('tenantPayments')
      .set({
        amountDirams: BigInt(values.amountMinor),
        paidOn: values.paidOn,
        method: values.method,
        comment: values.comment,
        updatedAt: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
  }

  async cancel(
    trx: Transaction<DB>,
    id: string,
    reason: string,
    operatorId: string,
  ): Promise<void> {
    await trx
      .updateTable('tenantPayments')
      .set({
        status: 'cancelled',
        cancelReason: reason,
        cancelledBy: operatorId,
        cancelledAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
  }

  async item(trx: Transaction<DB>, id: string): Promise<PaymentListItem> {
    const { rows } = await sql<ItemRow>`${ITEM} where p.id = ${id}`.execute(
      trx,
    );
    if (rows.length === 0) throw new Error('The payment is not readable');
    return toItem(rows[0]);
  }

  /** Newest first. */
  async list(
    trx: Transaction<DB>,
    tenantId: string | null,
    limit: number,
    offset: number,
  ): Promise<{ items: PaymentListItem[]; total: number }> {
    const scope = sql`(${tenantId}::uuid is null or p.tenant_id = ${tenantId}::uuid)`;
    const { rows: count } = await sql<{ total: Money }>`
      select count(*) as total from pharmacy.tenant_payments p where ${scope}`.execute(
      trx,
    );
    const { rows } = await sql<ItemRow>`
      ${ITEM} where ${scope}
      order by p.paid_on desc, p.created_at desc, p.id
      limit ${limit} offset ${offset}`.execute(trx);
    return { items: rows.map(toItem), total: Number(count[0].total) };
  }

  async ofTenant(
    trx: Transaction<DB>,
    tenantId: string,
  ): Promise<TenantPaymentItem[]> {
    const { rows } = await sql<ItemRow>`
      ${ITEM} where p.tenant_id = ${tenantId}
      order by p.paid_on desc, p.created_at desc, p.id`.execute(trx);
    return rows.map((row) => ({
      id: row.id,
      paidOn: row.paidOn,
      amountMinor: Number(row.amountDirams),
      method: row.method,
      recordedBy: row.recordedBy,
      invoiceNumber: row.invoiceNumber,
      comment: row.comment,
      cancelled: row.status === 'cancelled',
    }));
  }
}
