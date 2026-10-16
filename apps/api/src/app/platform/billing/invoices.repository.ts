import { Injectable } from '@nestjs/common';
import type {
  InvoiceLine,
  InvoiceListFilter,
  PlatformRequisites,
} from '@pharmacy/shared-dto';
import type { ComposedLine } from '@pharmacy/shared-domain';
import { type RawBuilder, type SqlBool, sql, type Transaction } from 'kysely';
import { type DB, newId } from '../../../core/database';
import { textOf } from './billing.repository';

type Money = bigint | string | number;

export interface InvoiceRow {
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

/** A store of a network active in a month: what the invoice needs of store_usage_monthly. */
export interface UsageRow {
  tenantId: string;
  storeId: string;
  name: string;
  firstSaleEver: string;
  closedOn: string | null;
}

/** A provided service not yet in an invoice (A11). */
export interface PendingServiceRow {
  tenantId: string;
  tenantServiceId: string;
  name: unknown;
  priceDirams: Money;
  providedOn: string;
}

interface LineRow {
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

const num = (value: Money | null): number | null =>
  value === null ? null : Number(value);

export const toLine = (row: LineRow): InvoiceLine => {
  const base = num(row.baseDirams);
  const amount = Number(row.amountDirams);
  return {
    id: row.id,
    kind: row.kind,
    description: (row.kind === 'store' ? row.storeName : row.description) ?? '',
    storeId: row.storeId,
    days: row.days,
    daysInMonth: row.daysInMonth,
    baseMinor: base,
    discountBp: row.discountBp,
    discountMinor: base === null ? null : base - amount,
    tenantServiceId: row.tenantServiceId,
    providedOn: row.providedOn,
    amountMinor: amount,
  };
};

/** The first day of a period YYYY-MM. */
export const monthOf = (period: string) => `${period}-01`;

// Invoices of networks on the platform path (spec 2026-10-15-billing-services, 4, 5, 6.1): reads the
// activity of stores (store_usage_monthly, platform_read), the registry columns of stores and the
// platform tables; writes invoices and their lines. Lines are never deleted (B18): a removed line
// carries removed_at. "Today" is the calendar day of Asia/Dushanbe.
@Injectable()
export class InvoicesRepository {
  async today(trx: Transaction<DB>): Promise<string> {
    const { rows } = await sql<{ today: string }>`
      select (now() at time zone 'Asia/Dushanbe')::date::text as today`.execute(
      trx,
    );
    return rows[0].today;
  }

  /** Every network, active or blocked, by name (A4: numbers go in this order). */
  async tenants(
    trx: Transaction<DB>,
  ): Promise<Array<{ id: string; name: string; inn: string }>> {
    const rows = await trx
      .selectFrom('tenants')
      .select(['id', 'name', 'billingTaxId'])
      .orderBy('name')
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      inn: row.billingTaxId ?? '',
    }));
  }

  async tenantExists(trx: Transaction<DB>, tenantId: string): Promise<boolean> {
    const row = await trx
      .selectFrom('tenants')
      .select('id')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Serialises the generation of one period (A9). */
  async lockPeriod(trx: Transaction<DB>, period: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`invoices:${period}`}, 0))`.execute(
      trx,
    );
  }

  /**
   * The rows of the networks, in the order of their ids (the lock order of the plan). FOR NO KEY
   * UPDATE: every tenant table references `tenants`, and the KEY SHARE of their foreign-key checks
   * (a sale of the network) must not wait for billing.
   */
  async lockTenants(
    trx: Transaction<DB>,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await sql`
      select id from pharmacy.tenants where id = any(${sql.val([...ids])}::uuid[])
      order by id for no key update`.execute(trx);
  }

  async usage(
    trx: Transaction<DB>,
    month: string,
    tenantIds: readonly string[],
  ): Promise<UsageRow[]> {
    if (tenantIds.length === 0) return [];
    const { rows } = await sql<UsageRow>`
      select u.tenant_id, u.store_id, s.name, u.first_sale_ever_date::text as first_sale_ever,
             u.closed_on::text as closed_on
      from pharmacy.store_usage_monthly u
      join pharmacy.stores s on s.tenant_id = u.tenant_id and s.id = u.store_id
      where u.month = ${month}::date and u.tenant_id = any(${sql.val([...tenantIds])}::uuid[])`.execute(
      trx,
    );
    return rows;
  }

  /** The discount of each network covering `month` (A10); periods do not overlap. */
  async discounts(
    trx: Transaction<DB>,
    month: string,
    tenantIds: readonly string[],
  ): Promise<Map<string, { id: string; percentBp: number }>> {
    if (tenantIds.length === 0) return new Map();
    const { rows } = await sql<{
      tenantId: string;
      id: string;
      percentBp: number;
    }>`
      select tenant_id, id, percent_bp from pharmacy.tenant_discounts
      where removed_at is null and from_month <= ${month}::date and to_month >= ${month}::date
        and tenant_id = any(${sql.val([...tenantIds])}::uuid[])`.execute(trx);
    return new Map(
      rows.map((row) => [
        row.tenantId,
        { id: row.id, percentBp: row.percentBp },
      ]),
    );
  }

  /** Provided services up to the end of `month` without a line in an invoice (A11). */
  async pendingServices(
    trx: Transaction<DB>,
    month: string,
    tenantIds: readonly string[],
  ): Promise<PendingServiceRow[]> {
    if (tenantIds.length === 0) return [];
    const { rows } = await sql<PendingServiceRow>`
      select ts.tenant_id, ts.id as tenant_service_id, s.name, ts.price_dirams,
             ts.provided_on::text as provided_on
      from pharmacy.tenant_services ts
      join pharmacy.services s on s.id = ts.service_id
      where ts.status = 'provided'
        and ts.provided_on < (${month}::date + interval '1 month')::date
        and ts.tenant_id = any(${sql.val([...tenantIds])}::uuid[])
        and not exists (select 1 from pharmacy.invoice_lines l
                        where l.tenant_service_id = ts.id and l.removed_at is null)`.execute(
      trx,
    );
    return rows;
  }

  /** The invoices of a month by network: id, total and the lines still on it. */
  async ofMonth(
    trx: Transaction<DB>,
    month: string,
  ): Promise<
    Map<
      string,
      { id: string; totalMinor: number; stores: number; services: number }
    >
  > {
    const { rows } = await sql<{
      tenantId: string;
      id: string;
      totalDirams: Money;
      stores: Money;
      services: Money;
    }>`
      select i.tenant_id, i.id, i.total_dirams,
             count(*) filter (where l.kind = 'store') as stores,
             count(*) filter (where l.kind = 'service') as services
      from pharmacy.invoices i
      left join pharmacy.invoice_lines l
        on l.tenant_id = i.tenant_id and l.invoice_id = i.id and l.removed_at is null
      where i.period_month = ${month}::date
      group by i.id`.execute(trx);
    return new Map(
      rows.map((row) => [
        row.tenantId,
        {
          id: row.id,
          totalMinor: Number(row.totalDirams),
          stores: Number(row.stores),
          services: Number(row.services),
        },
      ]),
    );
  }

  /** The order of the last invoice of a month (A4). */
  async lastSequence(trx: Transaction<DB>, month: string): Promise<number> {
    const { rows } = await sql<{ last: number }>`
      select coalesce(max(split_part(number, '-', 4)::int), 0) as last
      from pharmacy.invoices where period_month = ${month}::date`.execute(trx);
    return Number(rows[0].last);
  }

  async insertInvoice(
    trx: Transaction<DB>,
    values: {
      id: string;
      tenantId: string;
      month: string;
      number: string;
      dueOn: string;
      pricePerStoreMinor: number;
      vatBp: number;
      subtotalMinor: number;
      vatMinor: number;
      totalMinor: number;
      tenantName: string;
      tenantInn: string;
      supplier: PlatformRequisites;
      paymentPurpose: string;
      createdBy: string;
    },
  ): Promise<void> {
    await trx
      .insertInto('invoices')
      .values({
        id: values.id,
        tenantId: values.tenantId,
        periodMonth: values.month,
        number: values.number,
        dueOn: values.dueOn,
        pricePerStoreDirams: BigInt(values.pricePerStoreMinor),
        vatBp: values.vatBp,
        subtotalDirams: BigInt(values.subtotalMinor),
        vatDirams: BigInt(values.vatMinor),
        totalDirams: BigInt(values.totalMinor),
        // an invoice of 0 is paid at once; the allocation sets the day
        paidDirams: 0n,
        paidOn:
          values.totalMinor === 0
            ? sql<string>`(now() at time zone 'Asia/Dushanbe')::date`
            : null,
        tenantName: values.tenantName,
        tenantInn: values.tenantInn,
        supplierName: values.supplier.name,
        supplierInn: values.supplier.inn,
        supplierBankAccount: values.supplier.bankAccount,
        supplierBankName: values.supplier.bankName,
        supplierBankBik: values.supplier.bankBik,
        supplierBankCorrAccount: values.supplier.bankCorrAccount,
        paymentPurpose: values.paymentPurpose,
        createdBy: values.createdBy,
      })
      .execute();
  }

  /** `discountId` — the discount the store lines took, written on those that have one. */
  async insertLines(
    trx: Transaction<DB>,
    tenantId: string,
    invoiceId: string,
    lines: readonly ComposedLine[],
    discountId: string | null,
  ): Promise<void> {
    if (lines.length === 0) return;
    await trx
      .insertInto('invoiceLines')
      .values(
        lines.map((line, index) => ({
          id: newId(),
          tenantId,
          invoiceId,
          position: index + 1,
          kind: line.kind,
          storeId: line.storeId,
          storeName: line.kind === 'store' ? line.description : null,
          days: line.days,
          daysInMonth: line.daysInMonth,
          baseDirams: line.baseMinor === null ? null : BigInt(line.baseMinor),
          discountBp: line.discountBp,
          tenantServiceId: line.tenantServiceId,
          description: line.kind === 'service' ? line.description : null,
          providedOn: line.providedOn,
          amountDirams: BigInt(line.amountMinor),
          discountId:
            line.kind === 'store' && (line.discountBp ?? 0) > 0
              ? discountId
              : null,
        })),
      )
      .execute();
  }

  /** Removes lines of an invoice (B18): a recalculation removes its stores. */
  async removeLines(
    trx: Transaction<DB>,
    invoiceId: string,
    where: { kind: 'store' } | { tenantServiceId: string },
    reason: 'recalculated' | 'service_cancelled',
  ): Promise<number> {
    let query = trx
      .updateTable('invoiceLines')
      .set({ removedAt: sql`now()`, removedReason: reason })
      .where('tenantId', '=', (eb) =>
        eb
          .selectFrom('invoices')
          .select('invoices.tenantId')
          .where('invoices.id', '=', invoiceId),
      )
      .where('invoiceId', '=', invoiceId)
      .where('removedAt', 'is', null);
    query =
      'kind' in where
        ? query.where('kind', '=', where.kind)
        : query.where('tenantServiceId', '=', where.tenantServiceId);
    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async updateSums(
    trx: Transaction<DB>,
    invoiceId: string,
    sums: { subtotalMinor: number; vatMinor: number; totalMinor: number },
    recalculated: boolean,
  ): Promise<void> {
    await trx
      .updateTable('invoices')
      .set({
        subtotalDirams: BigInt(sums.subtotalMinor),
        vatDirams: BigInt(sums.vatMinor),
        totalDirams: BigInt(sums.totalMinor),
        // the allocation that follows sets what is paid; a lower total must not stay overpaid
        paidDirams: 0n,
        paidOn:
          sums.totalMinor === 0
            ? sql<string>`(now() at time zone 'Asia/Dushanbe')::date`
            : null,
        ...(recalculated && { recalculatedAt: sql`now()` }),
      })
      .where('id', '=', invoiceId)
      .execute();
  }

  /** The lines still on an invoice: stores first, then services, in their order. */
  async activeLines(
    trx: Transaction<DB>,
    invoiceId: string,
  ): Promise<LineRow[]> {
    const { rows } = await sql<LineRow>`
      select id, kind, store_id, store_name, days, days_in_month, base_dirams, discount_bp,
             tenant_service_id, description, provided_on::text as provided_on, amount_dirams
      from pharmacy.invoice_lines
      where tenant_id = (select i.tenant_id from pharmacy.invoices i where i.id = ${invoiceId})
        and invoice_id = ${invoiceId} and removed_at is null
      order by case kind when 'store' then 0 else 1 end, position, id`.execute(
      trx,
    );
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

  async invoice(
    trx: Transaction<DB>,
    id: string,
    today: string,
    forUpdate = false,
  ): Promise<InvoiceRow | null> {
    const { rows } = await sql<InvoiceRow>`
      ${this.select(today)} where i.id = ${id} ${forUpdate ? sql`for no key update of i` : sql``}`.execute(
      trx,
    );
    return rows[0] ?? null;
  }

  private filterSql(
    filter: InvoiceListFilter,
    today: string,
  ): RawBuilder<SqlBool> {
    switch (filter) {
      case 'unpaid':
        return sql<SqlBool>`i.paid_dirams < i.total_dirams`;
      case 'overdue':
        return sql<SqlBool>`i.paid_dirams < i.total_dirams and i.due_on < ${today}::date`;
      case 'paid':
        return sql<SqlBool>`i.paid_dirams = i.total_dirams`;
      default:
        return sql<SqlBool>`true`;
    }
  }

  async list(
    trx: Transaction<DB>,
    query: {
      filter: InvoiceListFilter;
      tenantId: string | null;
      month: string | null;
      limit: number;
      offset: number;
    },
    today: string,
  ): Promise<{
    rows: InvoiceRow[];
    total: number;
    counts: Record<InvoiceListFilter, number>;
  }> {
    const scope = sql<SqlBool>`(${query.tenantId}::uuid is null or i.tenant_id = ${query.tenantId}::uuid)
      and (${query.month}::date is null or i.period_month = ${query.month}::date)`;
    const { rows: countRows } = await sql<{
      all: Money;
      unpaid: Money;
      overdue: Money;
      paid: Money;
    }>`
      select count(*) as all,
             count(*) filter (where ${this.filterSql('unpaid', today)}) as unpaid,
             count(*) filter (where ${this.filterSql('overdue', today)}) as overdue,
             count(*) filter (where ${this.filterSql('paid', today)}) as paid
      from pharmacy.invoices i where ${scope}`.execute(trx);
    const counts = {
      all: Number(countRows[0].all),
      unpaid: Number(countRows[0].unpaid),
      overdue: Number(countRows[0].overdue),
      paid: Number(countRows[0].paid),
    };
    const { rows } = await sql<InvoiceRow>`
      ${this.select(today)}
      where ${scope} and ${this.filterSql(query.filter, today)}
      order by i.period_month desc, split_part(i.number, '-', 4)::int, i.id
      limit ${query.limit} offset ${query.offset}`.execute(trx);
    return { rows, total: counts[query.filter], counts };
  }

  async ofTenant(
    trx: Transaction<DB>,
    tenantId: string,
    today: string,
  ): Promise<InvoiceRow[]> {
    const { rows } = await sql<InvoiceRow>`
      ${this.select(today)} where i.tenant_id = ${tenantId}
      order by i.period_month desc, i.id`.execute(trx);
    return rows;
  }

  async summary(
    trx: Transaction<DB>,
    month: string,
    today: string,
  ): Promise<{
    issued: number;
    paid: number;
    invoices: number;
    paidInvoices: number;
    overdue: number;
    overdueTenants: number;
    price: number | null;
    vatBp: number | null;
  }> {
    const { rows } = await sql<{
      issued: Money | null;
      paid: Money | null;
      invoices: Money;
      paidInvoices: Money;
      price: Money | null;
      vatBp: number | null;
    }>`
      select sum(total_dirams) as issued, sum(paid_dirams) as paid, count(*) as invoices,
             count(*) filter (where paid_dirams = total_dirams) as paid_invoices,
             max(price_per_store_dirams) as price, max(vat_bp) as vat_bp
      from pharmacy.invoices where period_month = ${month}::date`.execute(trx);
    const { rows: overdueRows } = await sql<{
      overdue: Money | null;
      tenants: Money;
    }>`
      select sum(total_dirams - paid_dirams) as overdue, count(distinct tenant_id) as tenants
      from pharmacy.invoices
      where paid_dirams < total_dirams and due_on < ${today}::date`.execute(
      trx,
    );
    const period = rows[0];
    return {
      issued: Number(period.issued ?? 0),
      paid: Number(period.paid ?? 0),
      invoices: Number(period.invoices),
      paidInvoices: Number(period.paidInvoices),
      overdue: Number(overdueRows[0].overdue ?? 0),
      overdueTenants: Number(overdueRows[0].tenants),
      price: period.price === null ? null : Number(period.price),
      vatBp: period.vatBp,
    };
  }
}

/** The Russian name of a service for a line of an invoice (A11). */
export const serviceName = (name: unknown): string => textOf(name, 'ru') ?? '';
