import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

type Money = bigint | string | number;

export interface OwnerInvoiceRow {
  id: string;
  number: string;
  tenantId: string;
  tenantName: string;
  tenantInn: string;
  /** YYYY-MM. */
  period: string;
  issuedAt: Date;
  dueOn: string;
  pricePerStoreDirams: Money;
  vatBp: number;
  subtotalDirams: Money;
  vatDirams: Money;
  totalDirams: Money;
  paidDirams: Money;
  paidOn: string | null;
  supplierName: string;
  supplierInn: string;
  supplierBankAccount: string;
  supplierBankName: string;
  supplierBankBik: string;
  supplierBankCorrAccount: string;
  paymentPurpose: string;
  recalculatedAt: Date | null;
  stores: Money;
  hasServices: boolean;
  overdue: boolean;
}

export interface OwnerInvoiceListRow {
  id: string;
  number: string;
  /** YYYY-MM. */
  period: string;
  dueOn: string;
  totalDirams: Money;
  paidDirams: Money;
  paidOn: string | null;
  overdue: boolean;
}

export interface OwnerLineRow {
  id: string;
  kind: 'store' | 'service';
  storeId: string | null;
  storeName: string | null;
  days: number | null;
  daysInMonth: number | null;
  baseDirams: Money | null;
  discountBp: number | null;
  tenantServiceId: string | null;
  description: string | null;
  providedOn: string | null;
  amountDirams: Money;
}

export interface PendingServiceRow {
  tenantServiceId: string;
  name: unknown;
  priceDirams: Money;
  providedOn: string;
}

// The billing of a network as its owner sees it (spec 2026-10-15-billing-services, A19, 6.2): its own
// invoices and their lines, discounts, the advance, the current tariff and the services provided and
// not invoiced yet. Every query names the network; RLS on these platform-class tables lets the
// network read its own rows only (ADR-0013). "Today" is the calendar day of Asia/Dushanbe, as for
// the invoices of the platform.
@Injectable()
export class OwnerBillingRepository {
  async today(trx: TenantTransaction): Promise<string> {
    const { rows } = await sql<{ today: string }>`
      select (now() at time zone 'Asia/Dushanbe')::date::text as today`.execute(
      trx,
    );
    return rows[0].today;
  }

  async settings(
    trx: TenantTransaction,
  ): Promise<{ pricePerStoreMinor: number; vatBp: number }> {
    const row = await trx
      .selectFrom('platformSettings')
      .select(['storeMonthlyPriceDirams', 'vatBp'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return {
      pricePerStoreMinor: Number(row.storeMonthlyPriceDirams),
      vatBp: row.vatBp,
    };
  }

  /** The discounts ending in `month` (YYYY-MM-01) or later, by their first month (A10). */
  async discounts(
    trx: TenantTransaction,
    tenantId: string,
    month: string,
  ): Promise<Array<{ percentBp: number; fromMonth: string; toMonth: string }>> {
    const { rows } = await sql<{
      percentBp: number;
      fromMonth: string;
      toMonth: string;
    }>`
      select percent_bp, to_char(from_month, 'YYYY-MM') as from_month,
             to_char(to_month, 'YYYY-MM') as to_month
      from pharmacy.tenant_discounts
      where tenant_id = ${tenantId} and removed_at is null and to_month >= ${month}::date
      order by from_month, id`.execute(trx);
    return rows;
  }

  /**
   * The provided services the invoice of `month` (YYYY-MM-01) would take by `through`, without a line
   * in an invoice (A11): those of the month, and the earlier ones only once the network has the
   * invoice of the previous month — until then they go into that invoice.
   */
  async pendingServices(
    trx: TenantTransaction,
    tenantId: string,
    month: string,
    through: string,
  ): Promise<PendingServiceRow[]> {
    const { rows } = await sql<PendingServiceRow>`
      select ts.id as tenant_service_id, s.name, ts.price_dirams,
             ts.provided_on::text as provided_on
      from pharmacy.tenant_services ts
      join pharmacy.services s on s.id = ts.service_id
      where ts.tenant_id = ${tenantId} and ts.status = 'provided'
        and ts.provided_on <= ${through}::date
        and (ts.provided_on >= ${month}::date
             or exists (select 1 from pharmacy.invoices i
                        where i.tenant_id = ts.tenant_id
                          and i.period_month = (${month}::date - interval '1 month')::date))
        and not exists (select 1 from pharmacy.invoice_lines l
                        where l.tenant_id = ts.tenant_id and l.tenant_service_id = ts.id
                          and l.removed_at is null)`.execute(trx);
    return rows;
  }

  /**
   * The debt, the overdue debt and the advance of the network in one statement — one snapshot, so a
   * payment allocated meanwhile shows either before or after, never half of it.
   */
  async balance(
    trx: TenantTransaction,
    tenantId: string,
    today: string,
  ): Promise<{
    debtMinor: number;
    overdueDebtMinor: number;
    advanceMinor: number;
  }> {
    const { rows } = await sql<{
      debt: Money;
      overdueDebt: Money;
      advance: Money;
    }>`
      select coalesce(sum(i.total_dirams - i.paid_dirams), 0) as debt,
             coalesce(sum(i.total_dirams - i.paid_dirams) filter (where i.due_on < ${today}::date), 0)
               as overdue_debt,
             (select t.billing_advance_dirams from pharmacy.tenants t where t.id = ${tenantId})
               as advance
      from pharmacy.invoices i
      where i.tenant_id = ${tenantId}`.execute(trx);
    return {
      debtMinor: Number(rows[0].debt),
      overdueDebtMinor: Number(rows[0].overdueDebt),
      advanceMinor: Number(rows[0].advance),
    };
  }

  /** The invoices of the network with a remainder after their due date, oldest first. */
  async overdue(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<
    Array<{ id: string; number: string; remainingDirams: Money; dueOn: string }>
  > {
    const { rows } = await sql<{
      id: string;
      number: string;
      remainingDirams: Money;
      dueOn: string;
    }>`
      select id, number, total_dirams - paid_dirams as remaining_dirams, due_on::text as due_on
      from pharmacy.invoices
      where tenant_id = ${tenantId} and paid_dirams < total_dirams
        and due_on < (now() at time zone 'Asia/Dushanbe')::date
      order by due_on, id`.execute(trx);
    return rows;
  }

  private select(today: string) {
    return sql`
      select i.id, i.number, i.tenant_id, i.tenant_name, i.tenant_inn,
             to_char(i.period_month, 'YYYY-MM') as period, i.issued_at, i.due_on::text as due_on,
             i.price_per_store_dirams, i.vat_bp, i.subtotal_dirams, i.vat_dirams, i.total_dirams,
             i.paid_dirams, i.paid_on::text as paid_on, i.supplier_name, i.supplier_inn,
             i.supplier_bank_account, i.supplier_bank_name, i.supplier_bank_bik,
             i.supplier_bank_corr_account, i.payment_purpose, i.recalculated_at,
             (select count(*) from pharmacy.invoice_lines l
              where l.tenant_id = i.tenant_id and l.invoice_id = i.id and l.kind = 'store'
                and l.removed_at is null) as stores,
             exists (select 1 from pharmacy.invoice_lines l
                     where l.tenant_id = i.tenant_id and l.invoice_id = i.id
                       and l.kind = 'service' and l.removed_at is null) as has_services,
             (i.paid_dirams < i.total_dirams and i.due_on < ${today}::date) as overdue
      from pharmacy.invoices i`;
  }

  /** The invoices of the network, newest first: what the list shows, without the snapshot. */
  async invoices(
    trx: TenantTransaction,
    tenantId: string,
    today: string,
  ): Promise<OwnerInvoiceListRow[]> {
    const { rows } = await sql<OwnerInvoiceListRow>`
      select i.id, i.number, to_char(i.period_month, 'YYYY-MM') as period,
             i.due_on::text as due_on, i.total_dirams, i.paid_dirams, i.paid_on::text as paid_on,
             (i.paid_dirams < i.total_dirams and i.due_on < ${today}::date) as overdue
      from pharmacy.invoices i
      where i.tenant_id = ${tenantId}
      order by i.period_month desc, i.id`.execute(trx);
    return rows;
  }

  async invoice(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    today: string,
  ): Promise<OwnerInvoiceRow | null> {
    const { rows } = await sql<OwnerInvoiceRow>`
      ${this.select(today)} where i.tenant_id = ${tenantId} and i.id = ${id}`.execute(
      trx,
    );
    return rows[0] ?? null;
  }

  /** The lines still on an invoice: stores first, then services, in their order. */
  async lines(
    trx: TenantTransaction,
    tenantId: string,
    invoiceId: string,
  ): Promise<OwnerLineRow[]> {
    const { rows } = await sql<OwnerLineRow>`
      select id, kind, store_id, store_name, days, days_in_month, base_dirams, discount_bp,
             tenant_service_id, description, provided_on::text as provided_on, amount_dirams
      from pharmacy.invoice_lines
      where tenant_id = ${tenantId} and invoice_id = ${invoiceId} and removed_at is null
      order by case kind when 'store' then 0 else 1 end, position, id`.execute(
      trx,
    );
    return rows;
  }
}
