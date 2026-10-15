import { Injectable } from '@nestjs/common';
import type {
  BillingSummary,
  GenerateInvoicesResponse,
  InvoiceDetails,
  InvoiceGenerationPreview,
  InvoiceListItem,
  InvoiceListResponse,
  PeriodState,
  PlatformRequisites,
  RecalculationPreview,
  TenantInvoiceItem,
} from '@pharmacy/shared-dto';
import {
  type ComposedInvoice,
  composeInvoice,
  generationOpensOn,
  invoiceDueOn,
  invoiceNumber,
  invoiceStatus,
} from '@pharmacy/shared-domain';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { type DB, newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { StoreUsage } from '../../billing/store-usage';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { TenantAllocation } from './allocation';
import { BillingRepository } from './billing.repository';
import type { InvoiceListQueryDto } from './dto/invoices.dto';
import {
  type InvoiceRow,
  InvoicesRepository,
  monthOf,
  serviceName,
  toLine,
} from './invoices.repository';

const notFound = () => new ProblemException(404, 'not_found');
const invoicePaid = () => new ProblemException(409, 'invoice_paid');

/** `future` — after the current month; `closed` — from the 3rd of the next month (A1). */
export function periodState(period: string, today: string): PeriodState {
  if (period > today.slice(0, 7)) return 'future';
  return today >= generationOpensOn(period) ? 'closed' : 'current';
}

function previousPeriod(today: string): string {
  const [year, month] = today.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export function toInvoiceItem(row: InvoiceRow): InvoiceListItem {
  const totalMinor = Number(row.totalDirams);
  const paidMinor = Number(row.paidDirams);
  return {
    id: row.id,
    number: row.number,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    period: row.period,
    stores: Number(row.stores),
    hasServices: row.hasServices,
    netMinor: Number(row.subtotalDirams),
    vatMinor: Number(row.vatDirams),
    totalMinor,
    paidMinor,
    remainingMinor: totalMinor - paidMinor,
    status: invoiceStatus(totalMinor, paidMinor),
    overdue: row.overdue,
    issuedAt: new Date(row.issuedAt).toISOString(),
    dueOn: row.dueOn,
    paidOn: row.paidOn,
  };
}

// Invoices of networks for the operator (spec 2026-10-15-billing-services, A1–A8, A11, 5, 6.1).
// The activity of stores is refreshed network by network in their own context before a platform
// transaction reads it (B13); generation runs under the advisory lock of the period and the locks
// of the networks, and every change of an invoice computes the allocation of the network again.
@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly invoices: InvoicesRepository,
    private readonly billing: BillingRepository,
    private readonly allocation: TenantAllocation,
    private readonly usage: StoreUsage,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  private async refresh(
    tenants: ReadonlyArray<{ id: string }>,
    period: string,
  ): Promise<void> {
    for (const tenant of tenants) {
      await this.usage.refresh(tenant.id, monthOf(period));
    }
  }

  /** The invoices the networks would get for the period now; a network with no lines gets none. */
  private async drafts(
    trx: Transaction<DB>,
    period: string,
    tenants: ReadonlyArray<{ id: string }>,
  ): Promise<Map<string, ComposedInvoice>> {
    const month = monthOf(period);
    const ids = tenants.map((tenant) => tenant.id);
    const settings = await this.billing.settings(trx);
    const usage = await this.invoices.usage(trx, month, ids);
    const discounts = await this.invoices.discounts(trx, month, ids);
    const services = await this.invoices.pendingServices(trx, month, ids);
    const drafts = new Map<string, ComposedInvoice>();
    for (const id of ids) {
      const draft = composeInvoice({
        period,
        pricePerStoreMinor: settings.pricePerStoreMinor,
        vatBp: settings.vatRatePercent * 100,
        discountBp: discounts.get(id) ?? null,
        stores: usage
          .filter((row) => row.tenantId === id)
          .map((row) => ({
            storeId: row.storeId,
            name: row.name,
            firstSaleEver: row.firstSaleEver,
            closedOn: row.closedOn,
          })),
        services: services
          .filter((row) => row.tenantId === id)
          .map((row) => ({
            tenantServiceId: row.tenantServiceId,
            name: serviceName(row.name),
            priceMinor: Number(row.priceDirams),
            providedOn: row.providedOn,
          })),
      });
      if (draft.lines.length > 0) drafts.set(id, draft);
    }
    return drafts;
  }

  async summary(period: string | undefined): Promise<BillingSummary> {
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const today = await this.invoices.today(trx);
      const shown = period ?? previousPeriod(today);
      const sums = await this.invoices.summary(trx, monthOf(shown), today);
      const settings = await this.billing.settings(trx);
      return {
        period: shown,
        issuedMinor: sums.issued,
        paidMinor: sums.paid,
        invoices: sums.invoices,
        paidInvoices: sums.paidInvoices,
        overdueMinor: sums.overdue,
        overdueTenants: sums.overdueTenants,
        pricePerStoreMinor: sums.price ?? settings.pricePerStoreMinor,
        vatRatePercent:
          sums.vatBp === null ? settings.vatRatePercent : sums.vatBp / 100,
      };
    });
  }

  async list(query: InvoiceListQueryDto): Promise<InvoiceListResponse> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const today = await this.invoices.today(trx);
      const page = await this.invoices.list(
        trx,
        {
          filter: query.filter ?? 'all',
          tenantId: query.tenantId?.toLowerCase() ?? null,
          month: query.period ? monthOf(query.period) : null,
          limit,
          offset,
        },
        today,
      );
      return {
        items: page.rows.map(toInvoiceItem),
        total: page.total,
        limit,
        offset,
        counts: page.counts,
      };
    });
  }

  private async detailsIn(
    trx: Transaction<DB>,
    id: string,
    today: string,
  ): Promise<InvoiceDetails> {
    const row = await this.invoices.invoice(trx, id, today);
    if (row === null) throw notFound();
    const lines = await this.invoices.activeLines(trx, id);
    return {
      ...toInvoiceItem(row),
      pricePerStoreMinor: Number(row.pricePerStoreDirams),
      vatRatePercent: row.vatBp / 100,
      supplier: {
        name: row.supplierName,
        inn: row.supplierInn,
        bankAccount: row.supplierBankAccount,
        bankName: row.supplierBankName,
        bankBik: row.supplierBankBik,
        bankCorrAccount: row.supplierBankCorrAccount,
      },
      payer: { name: row.tenantName, inn: row.tenantInn },
      paymentPurpose: row.paymentPurpose,
      recalculatedAt:
        row.recalculatedAt === null
          ? null
          : new Date(row.recalculatedAt).toISOString(),
      lines: lines.map(toLine),
    };
  }

  details(invoiceId: string): Promise<InvoiceDetails> {
    const id = invoiceId.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) =>
      this.detailsIn(trx, id, await this.invoices.today(trx)),
    );
  }

  /** 404 for an unknown network. */
  tenantInvoices(tenantIdParam: string): Promise<TenantInvoiceItem[]> {
    const tenantId = tenantIdParam.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      if (!(await this.invoices.tenantExists(trx, tenantId))) throw notFound();
      const rows = await this.invoices.ofTenant(
        trx,
        tenantId,
        await this.invoices.today(trx),
      );
      return rows.map((row) => {
        const item = toInvoiceItem(row);
        return {
          id: item.id,
          number: item.number,
          period: item.period,
          stores: item.stores,
          hasServices: item.hasServices,
          totalMinor: item.totalMinor,
          paidMinor: item.paidMinor,
          remainingMinor: item.remainingMinor,
          status: item.status,
          overdue: item.overdue,
          dueOn: item.dueOn,
        };
      });
    });
  }

  /** What generation would create now; the activity of the stores is refreshed first (B13). */
  async generationPreview(period: string): Promise<InvoiceGenerationPreview> {
    const actor = this.actor();
    const { today, tenants } = await this.db.platformTransaction(
      actor,
      async (trx) => ({
        today: await this.invoices.today(trx),
        tenants: await this.invoices.tenants(trx),
      }),
    );
    const state = periodState(period, today);
    const opensOn = generationOpensOn(period);
    if (state === 'future') {
      return { period, state, opensOn, rows: [], totalMinor: 0 };
    }
    await this.refresh(tenants, period);
    return this.db.platformTransaction(actor, async (trx) => {
      const existing = await this.invoices.ofMonth(trx, monthOf(period));
      const drafts = await this.drafts(
        trx,
        period,
        tenants.filter((tenant) => !existing.has(tenant.id)),
      );
      const rows: InvoiceGenerationPreview['rows'] = [];
      let totalMinor = 0;
      for (const tenant of tenants) {
        const invoice = existing.get(tenant.id);
        if (invoice !== undefined) {
          rows.push({
            tenantId: tenant.id,
            tenantName: tenant.name,
            stores: invoice.stores,
            services: invoice.services,
            totalMinor: invoice.totalMinor,
            invoiced: true,
          });
          continue;
        }
        const draft = drafts.get(tenant.id);
        if (draft === undefined) continue;
        rows.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          stores: draft.lines.filter((line) => line.kind === 'store').length,
          services: draft.lines.filter((line) => line.kind === 'service')
            .length,
          totalMinor: draft.totalMinor,
          invoiced: false,
        });
        totalMinor += draft.totalMinor;
      }
      return { period, state, opensOn, rows, totalMinor };
    });
  }

  /**
   * 201 `{ created }`; 409 `period_not_closed`, `requisites_missing`. A repeat creates 0: one invoice
   * per network and period (unique key and the advisory lock of the period).
   */
  async generate(period: string): Promise<GenerateInvoicesResponse> {
    const actor = this.actor();
    const { today, tenants } = await this.db.platformTransaction(
      actor,
      async (trx) => {
        const settings = await this.billing.settings(trx);
        if (requisitesMissing(settings.supplier)) {
          throw new ProblemException(409, 'requisites_missing');
        }
        return {
          today: await this.invoices.today(trx),
          tenants: await this.invoices.tenants(trx),
        };
      },
    );
    if (periodState(period, today) !== 'closed') {
      throw new ProblemException(409, 'period_not_closed');
    }
    await this.refresh(tenants, period);
    return this.db.platformTransaction(actor, async (trx) => {
      await this.invoices.lockPeriod(trx, period);
      const month = monthOf(period);
      const existing = await this.invoices.ofMonth(trx, month);
      const open = (await this.invoices.tenants(trx)).filter(
        (tenant) => !existing.has(tenant.id),
      );
      await this.invoices.lockTenants(
        trx,
        open.map((tenant) => tenant.id).sort(),
      );
      const settings = await this.billing.settings(trx);
      if (requisitesMissing(settings.supplier)) {
        throw new ProblemException(409, 'requisites_missing');
      }
      const drafts = await this.drafts(trx, period, open);
      const issuedOn = await this.invoices.today(trx);
      let sequence = await this.invoices.lastSequence(trx, month);
      let created = 0;
      for (const tenant of open) {
        const draft = drafts.get(tenant.id);
        if (draft === undefined) continue;
        sequence += 1;
        const number = invoiceNumber(period, sequence);
        const id = newId();
        await this.invoices.insertInvoice(trx, {
          id,
          tenantId: tenant.id,
          month,
          number,
          dueOn: invoiceDueOn(period, issuedOn),
          pricePerStoreMinor: settings.pricePerStoreMinor,
          vatBp: settings.vatRatePercent * 100,
          subtotalMinor: draft.subtotalMinor,
          vatMinor: draft.vatMinor,
          totalMinor: draft.totalMinor,
          tenantName: tenant.name,
          tenantInn: tenant.inn,
          supplier: settings.supplier,
          paymentPurpose: settings.supplier.paymentPurposeTemplate
            .split('{number}')
            .join(number),
          createdBy: actor.operatorId,
        });
        await this.invoices.insertLines(trx, tenant.id, id, draft.lines);
        await this.allocation.recompute(trx, tenant.id);
        await this.audit.append(trx, {
          action: 'invoice.generated',
          tenantId: tenant.id,
          entityType: 'invoice',
          entityId: id,
          details: { number, period, totalMinor: draft.totalMinor },
        });
        created += 1;
      }
      return { created };
    });
  }

  /** The stores of the invoice now, at its own tariff and rate and the current discount (A6). */
  private async recomposed(
    trx: Transaction<DB>,
    row: InvoiceRow,
  ): Promise<ComposedInvoice> {
    const month = monthOf(row.period);
    const usage = await this.invoices.usage(trx, month, [row.tenantId]);
    const discounts = await this.invoices.discounts(trx, month, [row.tenantId]);
    const services = (await this.invoices.activeLines(trx, row.id)).filter(
      (line) => line.kind === 'service',
    );
    return composeInvoice({
      period: row.period,
      pricePerStoreMinor: Number(row.pricePerStoreDirams),
      vatBp: row.vatBp,
      discountBp: discounts.get(row.tenantId) ?? null,
      stores: usage.map((store) => ({
        storeId: store.storeId,
        name: store.name,
        firstSaleEver: store.firstSaleEver,
        closedOn: store.closedOn,
      })),
      services: services.map((line) => ({
        tenantServiceId: line.tenantServiceId ?? '',
        name: line.description ?? '',
        priceMinor: Number(line.amountDirams),
        providedOn: line.providedOn ?? '',
      })),
    });
  }

  /** An invoice without payments, before the refresh of its month; 404, 409 `invoice_paid`. */
  private async unpaid(invoiceId: string): Promise<InvoiceRow> {
    const row = await this.db.platformTransaction(this.actor(), async (trx) =>
      this.invoices.invoice(trx, invoiceId, await this.invoices.today(trx)),
    );
    if (row === null) throw notFound();
    if (Number(row.paidDirams) > 0) throw invoicePaid();
    return row;
  }

  async recalculationPreview(invoiceId: string): Promise<RecalculationPreview> {
    const row = await this.unpaid(invoiceId.toLowerCase());
    await this.usage.refresh(row.tenantId, monthOf(row.period));
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const next = await this.recomposed(trx, row);
      return {
        beforeMinor: Number(row.totalDirams),
        afterMinor: next.totalMinor,
      };
    });
  }

  /** 404, 409 `invoice_paid`. The store lines are removed and written again (B18). */
  async recalculate(invoiceId: string): Promise<InvoiceDetails> {
    const actor = this.actor();
    const id = invoiceId.toLowerCase();
    const first = await this.unpaid(id);
    await this.usage.refresh(first.tenantId, monthOf(first.period));
    return this.db.platformTransaction(actor, async (trx) => {
      const today = await this.invoices.today(trx);
      await this.invoices.lockTenants(trx, [first.tenantId]);
      const row = await this.invoices.invoice(trx, id, today, true);
      if (row === null) throw notFound();
      if (Number(row.paidDirams) > 0) throw invoicePaid();
      const next = await this.recomposed(trx, row);
      await this.invoices.removeLines(
        trx,
        id,
        { kind: 'store' },
        'recalculated',
      );
      await this.invoices.insertLines(
        trx,
        row.tenantId,
        id,
        next.lines.filter((line) => line.kind === 'store'),
      );
      await this.invoices.updateSums(trx, id, next, true);
      await this.allocation.recompute(trx, row.tenantId);
      await this.audit.append(trx, {
        action: 'invoice.recalculated',
        tenantId: row.tenantId,
        entityType: 'invoice',
        entityId: id,
        details: {
          beforeMinor: Number(row.totalDirams),
          afterMinor: next.totalMinor,
        },
      });
      return this.detailsIn(trx, id, today);
    });
  }
}

/** Any requisite of the platform left empty (409 `requisites_missing`, section 4). */
export function requisitesMissing(supplier: PlatformRequisites): boolean {
  return Object.values(supplier).some((value) => value.trim() === '');
}
