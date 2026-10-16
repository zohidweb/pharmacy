import { Injectable } from '@nestjs/common';
import { allocatePayments } from '@pharmacy/shared-domain';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

type Money = bigint | string | number;

// The allocation of the payments of a network to its invoices (spec 2026-10-15-billing-services, A7,
// B2, B18): computed again as a whole after every change of its payments or invoices, in the
// caller's transaction, under the lock of the network's row (the first lock of every money change;
// FOR NO KEY UPDATE, so the foreign-key checks of the network's own inserts are not blocked).
// Allocation rows are never deleted: a pair that no longer covers an invoice keeps 0. Writes what is
// paid on the invoices and the advance of the network.
@Injectable()
export class TenantAllocation {
  async recompute(trx: Transaction<DB>, tenantId: string): Promise<void> {
    await sql`select id from pharmacy.tenants where id = ${tenantId} for no key update`.execute(
      trx,
    );
    const { rows: invoices } = await sql<{
      id: string;
      period: string;
      number: string;
      totalDirams: Money;
      paidDirams: Money;
      paidOn: string | null;
      issuedOn: string;
    }>`
      select id, to_char(period_month, 'YYYY-MM') as period, number, total_dirams, paid_dirams,
             paid_on::text as paid_on,
             (issued_at at time zone 'Asia/Dushanbe')::date::text as issued_on
      from pharmacy.invoices where tenant_id = ${tenantId}`.execute(trx);
    const { rows: payments } = await sql<{
      id: string;
      amountDirams: Money;
      paidOn: string;
      createdAt: Date;
      preferredInvoiceId: string | null;
    }>`
      select id, amount_dirams, paid_on::text as paid_on, created_at, preferred_invoice_id
      from pharmacy.tenant_payments
      where tenant_id = ${tenantId} and status = 'active'`.execute(trx);

    const result = allocatePayments(
      invoices.map((invoice) => ({
        id: invoice.id,
        period: invoice.period,
        number: invoice.number,
        totalMinor: Number(invoice.totalDirams),
        issuedOn: invoice.issuedOn,
      })),
      payments.map((payment) => ({
        id: payment.id,
        amountMinor: Number(payment.amountDirams),
        paidOn: payment.paidOn,
        createdAt: new Date(payment.createdAt).toISOString(),
        preferredInvoiceId: payment.preferredInvoiceId,
      })),
    );

    if (result.allocations.length > 0) {
      await sql`
        insert into pharmacy.tenant_payment_allocations (payment_id, invoice_id, tenant_id, amount_dirams)
        values ${sql.join(
          result.allocations.map(
            (a) =>
              sql`(${a.paymentId}::uuid, ${a.invoiceId}::uuid, ${tenantId}::uuid, ${a.amountMinor})`,
          ),
        )}
        on conflict (payment_id, invoice_id) do update set amount_dirams = excluded.amount_dirams
        where tenant_payment_allocations.amount_dirams <> excluded.amount_dirams`.execute(
        trx,
      );
    }
    const kept =
      result.allocations.length === 0
        ? sql`false`
        : sql`(payment_id, invoice_id) in (${sql.join(
            result.allocations.map(
              (a) => sql`(${a.paymentId}::uuid, ${a.invoiceId}::uuid)`,
            ),
          )})`;
    await sql`
      update pharmacy.tenant_payment_allocations set amount_dirams = 0
      where tenant_id = ${tenantId} and amount_dirams > 0 and not ${kept}`.execute(
      trx,
    );

    for (const invoice of invoices) {
      const next = result.invoices[invoice.id];
      if (
        Number(invoice.paidDirams) === next.paidMinor &&
        invoice.paidOn === next.paidOn
      ) {
        continue;
      }
      await sql`
        update pharmacy.invoices
        set paid_dirams = ${next.paidMinor}, paid_on = ${next.paidOn}::date
        where id = ${invoice.id}`.execute(trx);
    }
    await sql`
      update pharmacy.tenants set billing_advance_dirams = ${result.advanceMinor}
      where id = ${tenantId} and billing_advance_dirams <> ${result.advanceMinor}`.execute(
      trx,
    );
  }
}
