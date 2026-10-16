import { Injectable } from '@nestjs/common';
import type {
  InvoiceDetails,
  InvoiceLine,
  TenantBilling,
  TenantInvoice,
} from '@pharmacy/shared-dto';
import { composeInvoice, invoiceStatus } from '@pharmacy/shared-domain';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { TenantDatabase } from '../../core/database';
import {
  OwnerBillingRepository,
  type OwnerInvoiceListRow,
  type OwnerLineRow,
} from './owner-billing.repository';
import { localized } from './owner-services.repository';
import { StoreUsageRepository } from './store-usage.repository';

const notFound = () => new ProblemException(404, 'not_found');

const num = (value: bigint | string | number | null): number | null =>
  value === null ? null : Number(value);

function toInvoice(row: OwnerInvoiceListRow): TenantInvoice {
  const totalMinor = Number(row.totalDirams);
  const paidMinor = Number(row.paidDirams);
  return {
    id: row.id,
    number: row.number,
    period: row.period,
    totalMinor,
    paidMinor,
    remainingMinor: totalMinor - paidMinor,
    status: invoiceStatus(totalMinor, paidMinor),
    overdue: row.overdue,
    dueOn: row.dueOn,
    paidOn: row.paidOn,
  };
}

function toLine(row: OwnerLineRow): InvoiceLine {
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
}

// The «Оплата» of the owner cabinet (spec 2026-10-15-billing-services, A19, 6.2): the estimate of the
// current month by the formulas of an invoice, the debt, the overdue debt and the advance of the
// network, its discounts and its invoices with their print snapshot. Read only.
@Injectable()
export class OwnerBillingService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: OwnerBillingRepository,
    private readonly usage: StoreUsageRepository,
  ) {}

  billing(): Promise<TenantBilling> {
    const { tenantId, locale } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const today = await this.repository.today(trx);
      const period = today.slice(0, 7);
      const month = `${period}-01`;
      const settings = await this.repository.settings(trx);
      const discounts = await this.repository.discounts(trx, tenantId, month);
      const current = discounts.find(
        (discount) =>
          discount.fromMonth <= period && discount.toMonth >= period,
      );
      const stores = await this.usage.activity(trx, tenantId, month, today);
      const services = await this.repository.pendingServices(
        trx,
        tenantId,
        month,
        today,
      );
      // A19: the days from the 1st to today — a store still open is billed through today
      const estimate = composeInvoice({
        period,
        pricePerStoreMinor: settings.pricePerStoreMinor,
        vatBp: settings.vatBp,
        discountBp: current?.percentBp ?? null,
        stores: stores.map((store) => ({
          ...store,
          closedOn:
            store.closedOn !== null && store.closedOn < today
              ? store.closedOn
              : today,
        })),
        services: services.map((service) => ({
          tenantServiceId: service.tenantServiceId,
          name: localized(service.name, locale),
          priceMinor: Number(service.priceDirams),
          providedOn: service.providedOn,
        })),
      });
      const invoices = (
        await this.repository.invoices(trx, tenantId, today)
      ).map(toInvoice);
      const balance = await this.repository.balance(trx, tenantId, today);
      return {
        estimate: {
          period,
          through: today,
          pricePerStoreMinor: settings.pricePerStoreMinor,
          vatRatePercent: settings.vatBp / 100,
          discountBp: current?.percentBp ?? null,
          lines: estimate.lines,
          netMinor: estimate.subtotalMinor,
          vatMinor: estimate.vatMinor,
          totalMinor: estimate.totalMinor,
        },
        ...balance,
        discounts: discounts.map(({ percentBp, fromMonth, toMonth }) => ({
          percentBp,
          fromMonth,
          toMonth,
        })),
        invoices,
      };
    });
  }

  /** 404 — no such invoice of the network. */
  invoice(invoiceId: string): Promise<InvoiceDetails> {
    const { tenantId } = requirePrincipal();
    const id = invoiceId.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const today = await this.repository.today(trx);
      const row = await this.repository.invoice(trx, tenantId, id, today);
      if (row === null) throw notFound();
      const lines = await this.repository.lines(trx, tenantId, id);
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
    });
  }
}
