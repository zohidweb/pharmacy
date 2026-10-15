/*
 * Invoices, payments and discounts of networks in the mock transport, by the rules of apps/api
 * (spec 2026-10-15-billing-services, A1–A11): the same formulas and allocation of
 * `@pharmacy/shared-domain`, the overdue flag by the calendar day, the debt and advance of a network.
 */
import { type ComposeInput, generationOpensOn } from '@pharmacy/shared-domain';
import type {
  InvoiceDetails,
  InvoiceListItem,
  PeriodState,
  TenantDiscount,
  TenantInvoiceItem,
  TenantListItem,
} from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { mockDb } from './db';
import {
  composedInvoice,
  type MockDiscount,
  settleBilling,
  WAREHOUSES,
} from './db-billing';

const billing = () => mockDb().billing;
export const today = () => toAppDate();

/** The allocation of a network after a change of its payments or invoices (A7). */
export const settle = (tenantId: string) => settleBilling(billing(), tenantId);

export function invoiceView(invoice: InvoiceDetails): InvoiceDetails {
  return {
    ...invoice,
    overdue: invoice.remainingMinor > 0 && invoice.dueOn < today(),
  };
}

export function listItem(invoice: InvoiceDetails): InvoiceListItem {
  const {
    lines: _lines,
    vatRatePercent: _rate,
    pricePerStoreMinor: _price,
    supplier: _supplier,
    payer: _payer,
    paymentPurpose: _purpose,
    recalculatedAt: _recalculated,
    ...item
  } = invoiceView(invoice);
  return item;
}

export function tenantInvoiceItem(invoice: InvoiceDetails): TenantInvoiceItem {
  const item = listItem(invoice);
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
}

/** The last month of a discount with an invoice of its network (A10). */
export function discountView(discount: MockDiscount): TenantDiscount {
  const periods = billing()
    .invoices.filter(
      (invoice) =>
        invoice.tenantId === discount.tenantId &&
        invoice.period >= discount.fromMonth &&
        invoice.period <= discount.toMonth,
    )
    .map((invoice) => invoice.period)
    .sort();
  return {
    id: discount.id,
    percentBp: discount.percentBp,
    fromMonth: discount.fromMonth,
    toMonth: discount.toMonth,
    invoicedThrough: periods.at(-1) ?? null,
  };
}

export function discountFor(
  tenantId: string,
  period: string,
): MockDiscount | null {
  return (
    billing().discounts.find(
      (discount) =>
        discount.tenantId === tenantId &&
        discount.fromMonth <= period &&
        discount.toMonth >= period,
    ) ?? null
  );
}

/** Debt, overdue debt, advance and the discount of the current month (6.1, B12). */
export function tenantBilling(
  tenantId: string,
): Pick<
  TenantListItem,
  'debtMinor' | 'overdueDebtMinor' | 'advanceMinor' | 'discount' | 'overdue'
> {
  const invoices = billing().invoices.filter(
    (invoice) => invoice.tenantId === tenantId,
  );
  const debtMinor = invoices.reduce((sum, i) => sum + i.remainingMinor, 0);
  const overdueDebtMinor = invoices
    .filter((invoice) => invoice.dueOn < today())
    .reduce((sum, i) => sum + i.remainingMinor, 0);
  const discount = discountFor(tenantId, today().slice(0, 7));
  return {
    debtMinor,
    overdueDebtMinor,
    advanceMinor: billing().advances[tenantId] ?? 0,
    discount:
      discount === null
        ? null
        : { percentBp: discount.percentBp, toMonth: discount.toMonth },
    overdue: overdueDebtMinor > 0,
  };
}

/** `future` — after the current month; `closed` — from the 3rd of the next month (A1). */
export function periodState(period: string): PeriodState {
  if (period > today().slice(0, 7)) return 'future';
  return today() >= generationOpensOn(period) ? 'closed' : 'current';
}

/** Cloud pharmacies of a network as store_usage_monthly would list them; a warehouse never. */
export function usageStores(tenantId: string): ComposeInput['stores'] {
  return mockDb()
    .stores.filter(
      (store) =>
        store.tenantId === tenantId &&
        store.mode === 'cloud' &&
        !WAREHOUSES.has(store.id),
    )
    .map((store) => ({
      storeId: store.id,
      name: store.name,
      firstSaleEver: store.connectedOn,
      closedOn: store.closedOn,
    }));
}

const onInvoice = (tenantServiceId: string) =>
  billing().invoices.find((invoice) =>
    invoice.lines.some((line) => line.tenantServiceId === tenantServiceId),
  ) ?? null;

export { onInvoice };

/** Provided services up to the end of the period not yet on an invoice (A11). */
export function pendingServices(
  tenantId: string,
  period: string,
): ComposeInput['services'] {
  return billing()
    .tenantServices.filter(
      (item) =>
        item.tenantId === tenantId &&
        item.status === 'provided' &&
        item.providedOn !== null &&
        item.providedOn.slice(0, 7) <= period &&
        onInvoice(item.id) === null,
    )
    .map((item) => ({
      tenantServiceId: item.id,
      name: item.serviceName,
      priceMinor: item.priceMinor ?? 0,
      providedOn: item.providedOn ?? '',
    }));
}

/** The invoice a network would get for the period now, at the current tariff, rate and discount. */
export function draftInvoice(
  tenant: { id: string; name: string; inn: string },
  period: string,
  sequence: number,
): InvoiceDetails {
  const settings = mockDb().system.settings;
  const { paymentPurposeTemplate, ...supplier } = settings.supplier;
  return composedInvoice({
    id: `inv-${Date.now()}-${tenant.id}`,
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantInn: tenant.inn,
    period,
    sequence,
    issuedOn: today(),
    pricePerStoreMinor: settings.pricePerStoreMinor,
    vatRatePercent: settings.vatRatePercent,
    discountBp: discountFor(tenant.id, period)?.percentBp ?? null,
    stores: usageStores(tenant.id),
    services: pendingServices(tenant.id, period),
    supplier,
    purposeTemplate: paymentPurposeTemplate,
  });
}
