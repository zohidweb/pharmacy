/*
 * Mock handlers of «Счета и платежи», «Услуги», «Лицензионные ключи», «Версии установок» and the
 * company billing tab. Same routes, problem codes and paging as apps/api will have.
 */
import {
  generationOpensOn,
  invoiceSequence,
  vatOf,
} from '@pharmacy/shared-domain';
import type {
  InvoiceDetails,
  InvoiceListFilter,
  InvoiceListItem,
  LicenseListFilter,
  LicenseListItem,
  PaymentListItem,
  PlatformService,
  TenantServiceItem,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import {
  discountFor,
  discountView,
  draftInvoice,
  invoiceView,
  listItem,
  onInvoice,
  periodState,
  settle,
  tenantInvoiceItem,
  usageStores,
} from './billing-ledger';
import {
  composedInvoice,
  type MockDiscount,
  type MockPayment,
  type MockTenantService,
} from './db-billing';
import { mockDb } from './db';
import { demoOperator } from './fixtures';
import { audit, findStore, findTenant, notFound } from './helpers';
import { logAction } from './log-action';
import type { MockHandlers } from './types';

const billing = () => mockDb().billing;
/** Platform settings: the tariff and VAT rate of the invoices issued next. */
const settings = () => mockDb().system.settings;
const today = () => toAppDate();

/** The catalog entry with the number of networks that have it approved or provided. */
function withTenants(
  service: Omit<PlatformService, 'tenants'>,
): PlatformService {
  const tenants = new Set(
    billing()
      .tenantServices.filter(
        (item) =>
          item.serviceId === service.id &&
          (item.status === 'approved' || item.status === 'provided'),
      )
      .map((item) => item.tenantId),
  );
  return { ...service, tenants: tenants.size };
}

function tenantService(id: string, correlationId: string): TenantServiceItem {
  const item = billing().tenantServices.find((entry) => entry.id === id);
  if (!item) throw notFound(correlationId);
  return item;
}

const tenantRef = (item: TenantServiceItem) => ({
  id: item.tenantId,
  name: item.tenantName,
});

const badDate = (code: 'future' | 'before_decision', correlationId: string) =>
  new ApiError(400, 'validation_failed', correlationId, [
    { field: 'providedOn', code },
  ]);

/** One decision per request: a decided one has left the pending list (409), an unknown one is 404. */
function decide(
  requestId: string,
  correlationId: string,
  decision: {
    status: 'approved' | 'rejected';
    priceMinor: number | null;
    reason: string | null;
  },
): TenantServiceItem {
  if (billing().tenantServices.some((item) => item.requestId === requestId)) {
    throw new ApiError(409, 'service_decided', correlationId);
  }
  const index = billing().serviceRequests.findIndex(
    (item) => item.id === requestId,
  );
  if (index < 0) throw notFound(correlationId);
  const [request] = billing().serviceRequests.splice(index, 1);
  const decided: TenantServiceItem = {
    id: `ts-${Date.now()}`,
    serviceId: request.serviceId,
    serviceName: request.serviceName,
    tenantId: request.tenantId,
    tenantName: request.tenantName,
    status: decision.status,
    priceMinor: decision.priceMinor,
    reason: decision.reason,
    requestId: request.id,
    requestedAt: request.requestedAt,
    comment: request.comment,
    decidedAt: new Date().toISOString(),
    decidedBy: demoOperator.fullName,
    providedOn: null,
  };
  billing().tenantServices.unshift(decided);
  logAction(`service.${decision.status}`, {
    tenant: { id: request.tenantId, name: request.tenantName },
  });
  return decided;
}

function previousPeriod(): string {
  const [year, month] = today().split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Newest period first, then the number of the period (as apps/api). */
const byPeriod = (list: InvoiceDetails[]) =>
  [...list].sort(
    (a, b) =>
      b.period.localeCompare(a.period) ||
      invoiceSequence(a.number) - invoiceSequence(b.number),
  );

const byName = <T extends { name: string }>(list: T[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

const newestFirst = (list: MockPayment[]) =>
  [...list].sort(
    (a, b) =>
      b.paidOn.localeCompare(a.paidOn) ||
      b.createdAt.localeCompare(a.createdAt),
  );

function matches(item: InvoiceListItem, filter: InvoiceListFilter): boolean {
  if (filter === 'unpaid') return item.remainingMinor > 0;
  if (filter === 'overdue') return item.overdue;
  if (filter === 'paid') return item.remainingMinor === 0;
  return true;
}

function invoiceOf(id: string, correlationId: string): InvoiceDetails {
  const invoice = billing().invoices.find((item) => item.id === id);
  if (!invoice) throw notFound(correlationId);
  return invoice;
}

/** Only an invoice without payments is recalculated (A6). */
function unpaidInvoice(id: string, correlationId: string): InvoiceDetails {
  const invoice = invoiceOf(id, correlationId);
  if (invoice.paidMinor > 0)
    throw new ApiError(409, 'invoice_paid', correlationId);
  return invoice;
}

/** The stores now, at the tariff and rate of the invoice and the current discount; services stay. */
function recomposed(invoice: InvoiceDetails): InvoiceDetails {
  return composedInvoice({
    id: invoice.id,
    tenantId: invoice.tenantId,
    tenantName: invoice.tenantName,
    tenantInn: invoice.payer.inn,
    period: invoice.period,
    sequence: invoiceSequence(invoice.number),
    issuedOn: invoice.issuedAt.slice(0, 10),
    pricePerStoreMinor: invoice.pricePerStoreMinor,
    vatRatePercent: invoice.vatRatePercent,
    discountBp:
      discountFor(invoice.tenantId, invoice.period)?.percentBp ?? null,
    stores: usageStores(invoice.tenantId),
    services: invoice.lines
      .filter((line) => line.kind === 'service')
      .map((line) => ({
        tenantServiceId: line.tenantServiceId ?? '',
        name: line.description,
        priceMinor: line.amountMinor,
        providedOn: line.providedOn ?? '',
      })),
    supplier: invoice.supplier,
  });
}

const paymentItem = (payment: MockPayment): PaymentListItem => {
  const { createdAt: _createdAt, request: _request, ...item } = payment;
  return item;
};

function activePayment(id: string, correlationId: string): MockPayment {
  const payment = billing().payments.find((item) => item.id === id);
  if (!payment) throw notFound(correlationId);
  if (payment.cancelled)
    throw new ApiError(409, 'payment_cancelled', correlationId);
  return payment;
}

const futurePayment = (correlationId: string) =>
  new ApiError(400, 'validation_failed', correlationId, [
    { field: 'paidOn', code: 'future' },
  ]);

const discountField = (code: 'order' | 'not_shorter', correlationId: string) =>
  new ApiError(400, 'validation_failed', correlationId, [
    { field: 'toMonth', code },
  ]);

function discountOf(id: string, correlationId: string): MockDiscount {
  const discount = billing().discounts.find((item) => item.id === id);
  if (!discount) throw notFound(correlationId);
  return discount;
}

function tenantOfDiscount(discount: MockDiscount, correlationId: string) {
  const tenant = findTenant(discount.tenantId, correlationId);
  return { id: tenant.id, name: tenant.name };
}

/** 409 `service_invoiced` for a service on an invoice (A13). */
function notInvoiced(item: TenantServiceItem, correlationId: string): void {
  if (onInvoice(item.id) !== null)
    throw new ApiError(409, 'service_invoiced', correlationId);
}

function page<T>(items: T[], limit = 20, offset = 0) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

function licenseBucket(
  license: LicenseListItem,
): 'active' | 'expiring' | 'inactive' {
  if (license.state === 'revoked') return 'inactive';
  const left = daysBetween(today(), license.validUntil);
  if (left < 0) return 'inactive';
  return left <= license.notifyDaysBefore ? 'expiring' : 'active';
}

function matchesLicense(
  license: LicenseListItem,
  filter: LicenseListFilter,
): boolean {
  if (filter === 'all') return true;
  return licenseBucket(license) === filter;
}

function termEnd(
  term: string,
  custom: string | undefined,
  correlationId: string,
): string {
  if (term === 'custom') {
    if (!custom || custom < today()) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'validUntil', code: 'date_from_today' },
      ]);
    }
    return custom;
  }
  const date = new Date(`${today()}T00:00:00Z`);
  if (term === 'week') date.setUTCDate(date.getUTCDate() + 7);
  if (term === 'quarter') date.setUTCMonth(date.getUTCMonth() + 3);
  if (term === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

let keySequence = 100;
function newKeyCode(tenantName: string, validUntil: string): string {
  const prefix =
    tenantName
      .replace(/[^A-Za-zА-Яа-я]/g, '')
      .slice(0, 3)
      .toUpperCase() || 'KEY';
  keySequence += 1;
  return `${prefix}-${String(keySequence).padStart(4, '0')}-TEST-${validUntil.slice(0, 4)}`;
}

export const billingHandlers: Pick<
  MockHandlers,
  | 'tenants.invoices'
  | 'tenants.payments'
  | 'billing.summary'
  | 'invoices.list'
  | 'invoices.get'
  | 'invoices.generationPreview'
  | 'invoices.generate'
  | 'invoices.recalculationPreview'
  | 'invoices.recalculate'
  | 'payments.list'
  | 'payments.record'
  | 'payments.update'
  | 'payments.cancel'
  | 'tenants.discounts'
  | 'tenants.addDiscount'
  | 'discounts.shorten'
  | 'discounts.remove'
  | 'services.list'
  | 'services.create'
  | 'services.update'
  | 'serviceRequests.list'
  | 'serviceRequests.approve'
  | 'serviceRequests.reject'
  | 'tenants.addService'
  | 'tenantServices.list'
  | 'tenantServices.provide'
  | 'tenantServices.unprovide'
  | 'tenantServices.update'
  | 'tenantServices.cancel'
  | 'licenses.list'
  | 'licenses.issue'
  | 'licenses.renew'
  | 'licenses.revoke'
  | 'stores.offlineOptions'
  | 'installations.list'
  | 'installations.scheduleUpdate'
  | 'releases.list'
> = {
  // Invoices, payments and discounts as apps/api answers them (spec 2026-10-15-billing-services,
  // A1–A11, 6.1): the formulas and the allocation of `@pharmacy/shared-domain`.
  'tenants.invoices': ({ params, correlationId }) => {
    findTenant(params.id, correlationId);
    return byPeriod(
      billing().invoices.filter((invoice) => invoice.tenantId === params.id),
    ).map(tenantInvoiceItem);
  },
  'tenants.payments': ({ params, correlationId }) => {
    findTenant(params.id, correlationId);
    return newestFirst(
      billing().payments.filter((payment) => payment.tenantId === params.id),
    ).map((payment) => ({
      id: payment.id,
      paidOn: payment.paidOn,
      amountMinor: payment.amountMinor,
      method: payment.method,
      recordedBy: payment.recordedBy,
      invoiceNumber: payment.invoiceNumber,
      comment: payment.comment,
      cancelled: payment.cancelled,
    }));
  },

  'billing.summary': ({ query }) => {
    const period = query?.period ?? previousPeriod();
    const invoices = billing().invoices.filter(
      (invoice) => invoice.period === period,
    );
    const overdue = billing()
      .invoices.map(invoiceView)
      .filter((invoice) => invoice.overdue);
    return {
      period,
      issuedMinor: invoices.reduce((sum, i) => sum + i.totalMinor, 0),
      paidMinor: invoices.reduce((sum, i) => sum + i.paidMinor, 0),
      invoices: invoices.length,
      paidInvoices: invoices.filter((invoice) => invoice.status === 'paid')
        .length,
      overdueMinor: overdue.reduce((sum, i) => sum + i.remainingMinor, 0),
      overdueTenants: new Set(overdue.map((invoice) => invoice.tenantId)).size,
      // the period's own tariff and rate once invoiced, otherwise the ones new invoices take
      pricePerStoreMinor:
        invoices[0]?.pricePerStoreMinor ?? settings().pricePerStoreMinor,
      vatRatePercent: invoices[0]?.vatRatePercent ?? settings().vatRatePercent,
    };
  },
  'invoices.list': ({ query }) => {
    const scoped = byPeriod(
      billing().invoices.filter(
        (invoice) =>
          (!query?.tenantId || invoice.tenantId === query.tenantId) &&
          (!query?.period || invoice.period === query.period),
      ),
    ).map(listItem);
    const filter = query?.filter ?? 'all';
    const counts = {
      all: scoped.length,
      unpaid: scoped.filter((i) => matches(i, 'unpaid')).length,
      overdue: scoped.filter((i) => matches(i, 'overdue')).length,
      paid: scoped.filter((i) => matches(i, 'paid')).length,
    };
    return {
      ...page(
        scoped.filter((invoice) => matches(invoice, filter)),
        query?.limit,
        query?.offset,
      ),
      counts,
    };
  },
  'invoices.get': ({ params, correlationId }) =>
    invoiceView(invoiceOf(params.id, correlationId)),
  'invoices.generationPreview': ({ query }) => {
    const period = query.period;
    const state = periodState(period);
    const opensOn = generationOpensOn(period);
    if (state === 'future')
      return { period, state, opensOn, rows: [], totalMinor: 0 };
    const rows = byName(mockDb().tenants).flatMap((tenant) => {
      const issued = billing().invoices.find(
        (invoice) =>
          invoice.tenantId === tenant.id && invoice.period === period,
      );
      const invoice = issued ?? draftInvoice(tenant, period, 0);
      if (invoice.lines.length === 0) return [];
      return [
        {
          tenantId: tenant.id,
          tenantName: tenant.name,
          stores: invoice.stores,
          services: invoice.lines.filter((line) => line.kind === 'service')
            .length,
          totalMinor: invoice.totalMinor,
          invoiced: issued !== undefined,
        },
      ];
    });
    return {
      period,
      state,
      opensOn,
      rows,
      totalMinor: rows
        .filter((row) => !row.invoiced)
        .reduce((sum, row) => sum + row.totalMinor, 0),
    };
  },
  'invoices.generate': ({ body, correlationId }) => {
    if (
      Object.values(settings().supplier).some((value) => value.trim() === '')
    ) {
      throw new ApiError(409, 'requisites_missing', correlationId);
    }
    if (periodState(body.period) !== 'closed') {
      throw new ApiError(409, 'period_not_closed', correlationId);
    }
    let sequence = Math.max(
      0,
      ...billing()
        .invoices.filter((invoice) => invoice.period === body.period)
        .map((invoice) => invoiceSequence(invoice.number)),
    );
    let created = 0;
    for (const tenant of byName(mockDb().tenants)) {
      if (
        billing().invoices.some(
          (invoice) =>
            invoice.tenantId === tenant.id && invoice.period === body.period,
        )
      ) {
        continue;
      }
      const draft = draftInvoice(tenant, body.period, sequence + 1);
      if (draft.lines.length === 0) continue;
      sequence += 1;
      billing().invoices.push(draft);
      settle(tenant.id);
      logAction('invoice.generated', {
        tenant: { id: tenant.id, name: tenant.name },
      });
      created += 1;
    }
    return { created };
  },
  'invoices.recalculationPreview': ({ params, correlationId }) => {
    const invoice = unpaidInvoice(params.id, correlationId);
    return {
      beforeMinor: invoice.totalMinor,
      afterMinor: recomposed(invoice).totalMinor,
    };
  },
  'invoices.recalculate': ({ params, correlationId }) => {
    const invoice = unpaidInvoice(params.id, correlationId);
    const next = recomposed(invoice);
    Object.assign(invoice, {
      stores: next.stores,
      netMinor: next.netMinor,
      vatMinor: next.vatMinor,
      totalMinor: next.totalMinor,
      lines: next.lines,
      recalculatedAt: new Date().toISOString(),
    });
    settle(invoice.tenantId);
    logAction('invoice.recalculated', {
      tenant: { id: invoice.tenantId, name: invoice.tenantName },
    });
    return invoiceView(invoice);
  },

  'payments.list': ({ query }) =>
    page(
      newestFirst(
        billing().payments.filter(
          (payment) => !query?.tenantId || payment.tenantId === query.tenantId,
        ),
      ).map(paymentItem),
      query?.limit,
      query?.offset,
    ),
  'payments.record': ({ body, correlationId }) => {
    const request = JSON.stringify({
      tenantId: body.tenantId,
      amountMinor: body.amountMinor,
      paidOn: body.paidOn,
      method: body.method,
      invoiceId: body.invoiceId ?? null,
      comment: body.comment?.trim() || null,
    });
    const existing = billing().payments.find((item) => item.id === body.id);
    if (existing) {
      if (existing.request !== request) {
        throw new ApiError(409, 'idempotency_conflict', correlationId);
      }
      return paymentItem(existing);
    }
    const tenant = findTenant(body.tenantId, correlationId);
    if (body.paidOn > today()) throw futurePayment(correlationId);
    let invoice: InvoiceDetails | null = null;
    if (body.invoiceId) {
      invoice = invoiceOf(body.invoiceId, correlationId);
      if (invoice.tenantId !== tenant.id) throw notFound(correlationId);
      if (invoice.remainingMinor === 0) {
        throw new ApiError(409, 'invoice_paid', correlationId);
      }
    }
    const payment: MockPayment = {
      id: body.id,
      paidOn: body.paidOn,
      createdAt: new Date().toISOString(),
      tenantId: tenant.id,
      tenantName: tenant.name,
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.number ?? null,
      amountMinor: body.amountMinor,
      method: body.method,
      recordedBy: demoOperator.fullName,
      comment: body.comment?.trim() || null,
      cancelled: false,
      cancelReason: null,
      request,
    };
    billing().payments.push(payment);
    settle(tenant.id);
    logAction('payment.recorded', {
      tenant: { id: tenant.id, name: tenant.name },
    });
    return paymentItem(payment);
  },
  'payments.update': ({ params, body, correlationId }) => {
    const payment = activePayment(params.id, correlationId);
    if (body.paidOn > today()) throw futurePayment(correlationId);
    Object.assign(payment, {
      amountMinor: body.amountMinor,
      paidOn: body.paidOn,
      method: body.method,
      comment: body.comment?.trim() || null,
    });
    settle(payment.tenantId);
    logAction('payment.updated', {
      tenant: { id: payment.tenantId, name: payment.tenantName },
    });
    return paymentItem(payment);
  },
  'payments.cancel': ({ params, body, correlationId }) => {
    const payment = activePayment(params.id, correlationId);
    Object.assign(payment, { cancelled: true, cancelReason: body.reason });
    settle(payment.tenantId);
    logAction('payment.cancelled', {
      tenant: { id: payment.tenantId, name: payment.tenantName },
    });
    return paymentItem(payment);
  },

  'tenants.discounts': ({ params, correlationId }) => {
    findTenant(params.id, correlationId);
    return billing()
      .discounts.filter((discount) => discount.tenantId === params.id)
      .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth))
      .map(discountView);
  },
  'tenants.addDiscount': ({ params, body, correlationId }) => {
    const tenant = findTenant(params.id, correlationId);
    if (body.toMonth < body.fromMonth)
      throw discountField('order', correlationId);
    if (
      billing().discounts.some(
        (discount) =>
          discount.tenantId === tenant.id &&
          discount.fromMonth <= body.toMonth &&
          discount.toMonth >= body.fromMonth,
      )
    ) {
      throw new ApiError(409, 'discount_overlap', correlationId);
    }
    const discount: MockDiscount = {
      id: `disc-${Date.now()}`,
      tenantId: tenant.id,
      percentBp: body.percentBp,
      fromMonth: body.fromMonth,
      toMonth: body.toMonth,
      invoicedThrough: null,
    };
    billing().discounts.push(discount);
    logAction('tenant.discount-added', {
      tenant: { id: tenant.id, name: tenant.name },
    });
    return discountView(discount);
  },
  'discounts.shorten': ({ params, body, correlationId }) => {
    const discount = discountOf(params.id, correlationId);
    const view = discountView(discount);
    if (body.toMonth < discount.fromMonth)
      throw discountField('order', correlationId);
    if (body.toMonth > discount.toMonth) {
      throw discountField('not_shorter', correlationId);
    }
    if (view.invoicedThrough !== null && body.toMonth < view.invoicedThrough) {
      throw new ApiError(409, 'discount_invoiced', correlationId);
    }
    if (body.toMonth !== discount.toMonth) {
      discount.toMonth = body.toMonth;
      logAction('tenant.discount-shortened', {
        tenant: tenantOfDiscount(discount, correlationId),
      });
    }
    return discountView(discount);
  },
  'discounts.remove': ({ params, correlationId }) => {
    const discount = discountOf(params.id, correlationId);
    if (discountView(discount).invoicedThrough !== null) {
      throw new ApiError(409, 'discount_invoiced', correlationId);
    }
    billing().discounts.splice(billing().discounts.indexOf(discount), 1);
    logAction('tenant.discount-removed', {
      tenant: tenantOfDiscount(discount, correlationId),
    });
  },

  // Services as apps/api answers them (spec 2026-10-15-billing-services, A12, A13, 6.1).
  'services.list': () =>
    [...billing().services]
      .sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.nameRu.localeCompare(b.nameRu, 'ru'),
      )
      .map(withTenants),
  'services.create': ({ body }) => {
    const service = { ...body, id: `svc-${Date.now()}` };
    billing().services.push(service);
    logAction('service.created');
    return withTenants(service);
  },
  'services.update': ({ params, body, correlationId }) => {
    const service = billing().services.find((item) => item.id === params.id);
    if (!service) throw notFound(correlationId);
    Object.assign(service, body);
    logAction('service.updated');
    return withTenants(service);
  },
  'serviceRequests.list': () => billing().serviceRequests,
  'serviceRequests.approve': ({ params, body, correlationId }) =>
    decide(params.id, correlationId, {
      status: 'approved',
      priceMinor: body.priceMinor,
      reason: null,
    }),
  'serviceRequests.reject': ({ params, body, correlationId }) =>
    decide(params.id, correlationId, {
      status: 'rejected',
      priceMinor: null,
      reason: body.reason,
    }),
  'tenants.addService': ({ params, body, correlationId }) => {
    const request = JSON.stringify({
      tenantId: params.id,
      serviceId: body.serviceId,
      priceMinor: body.priceMinor,
    });
    const existing = billing().tenantServices.find(
      (item) => item.id === body.id,
    );
    if (existing) {
      if (existing.request !== request) {
        throw new ApiError(409, 'idempotency_conflict', correlationId);
      }
      return existing;
    }
    const tenant = findTenant(params.id, correlationId);
    const service = billing().services.find(
      (item) => item.id === body.serviceId && !item.archived,
    );
    if (!service) throw notFound(correlationId);
    const added: MockTenantService = {
      id: body.id,
      request,
      serviceId: service.id,
      serviceName: service.nameRu,
      tenantId: tenant.id,
      tenantName: tenant.name,
      status: 'approved',
      priceMinor: body.priceMinor,
      reason: null,
      requestId: null,
      requestedAt: null,
      comment: null,
      decidedAt: new Date().toISOString(),
      decidedBy: demoOperator.fullName,
      providedOn: null,
    };
    billing().tenantServices.unshift(added);
    logAction('service.added', {
      tenant: { id: tenant.id, name: tenant.name },
    });
    return added;
  },
  'tenantServices.list': ({ query }) =>
    billing().tenantServices.filter(
      (item) =>
        (!query?.status || item.status === query.status) &&
        (!query?.tenantId || item.tenantId === query.tenantId),
    ),
  'tenantServices.provide': ({ params, body, correlationId }) => {
    const item = tenantService(params.id, correlationId);
    if (item.status !== 'approved')
      throw new ApiError(409, 'service_not_approved', correlationId);
    if (body.providedOn > today()) throw badDate('future', correlationId);
    if (body.providedOn < toAppDate(new Date(item.decidedAt)))
      throw badDate('before_decision', correlationId);
    Object.assign(item, { status: 'provided', providedOn: body.providedOn });
    logAction('service.provided', { tenant: tenantRef(item) });
    return item;
  },
  'tenantServices.unprovide': ({ params, correlationId }) => {
    const item = tenantService(params.id, correlationId);
    notInvoiced(item, correlationId);
    if (item.status !== 'provided')
      throw new ApiError(409, 'service_not_approved', correlationId);
    Object.assign(item, { status: 'approved', providedOn: null });
    logAction('service.provision-undone', { tenant: tenantRef(item) });
    return item;
  },
  'tenantServices.update': ({ params, body, correlationId }) => {
    const item = tenantService(params.id, correlationId);
    notInvoiced(item, correlationId);
    if (item.status !== 'approved' && item.status !== 'provided')
      throw new ApiError(409, 'service_not_approved', correlationId);
    item.priceMinor = body.priceMinor;
    logAction('service.price-changed', { tenant: tenantRef(item) });
    return item;
  },
  'tenantServices.cancel': ({ params, body, correlationId }) => {
    const item = tenantService(params.id, correlationId);
    if (item.status !== 'approved' && item.status !== 'provided')
      throw new ApiError(409, 'service_not_approved', correlationId);
    // a service on an invoice without payments leaves it; with a payment it stays (A13)
    const invoice = onInvoice(item.id);
    if (invoice && invoice.paidMinor > 0)
      throw new ApiError(409, 'service_invoiced', correlationId);
    Object.assign(item, {
      status: 'cancelled',
      reason: body.reason,
      providedOn: null,
    });
    if (invoice) {
      invoice.lines = invoice.lines.filter(
        (line) => line.tenantServiceId !== item.id,
      );
      const netMinor = invoice.lines.reduce((sum, l) => sum + l.amountMinor, 0);
      const vatMinor = vatOf(netMinor, invoice.vatRatePercent * 100);
      Object.assign(invoice, {
        netMinor,
        vatMinor,
        totalMinor: netMinor + vatMinor,
        hasServices: invoice.lines.some((line) => line.kind === 'service'),
      });
      settle(invoice.tenantId);
    }
    logAction('service.cancelled', { tenant: tenantRef(item) });
    return item;
  },

  'licenses.list': ({ query }) => {
    const all = billing().licenses;
    const filter = query?.filter ?? 'all';
    const sort = query?.sort ?? 'validUntil';
    const direction = query?.direction === 'desc' ? -1 : 1;
    const value = (license: LicenseListItem) =>
      sort === 'store'
        ? license.storeName
        : sort === 'tenant'
          ? license.tenantName
          : license.validUntil;
    return {
      items: all
        .filter((license) => matchesLicense(license, filter))
        .sort((a, b) => value(a).localeCompare(value(b), 'ru') * direction),
      counts: {
        all: all.length,
        expiring: all.filter((license) => matchesLicense(license, 'expiring'))
          .length,
        inactive: all.filter((license) => matchesLicense(license, 'inactive'))
          .length,
      },
    };
  },
  'licenses.issue': ({ body, correlationId }) => {
    const store = findStore(body.storeId, correlationId);
    if (store.mode !== 'offline')
      throw new ApiError(409, 'not_offline', correlationId);
    if (
      billing().licenses.some(
        (license) =>
          license.storeId === store.id && licenseBucket(license) !== 'inactive',
      )
    ) {
      throw new ApiError(409, 'license_exists', correlationId);
    }
    const validUntil = termEnd(body.term, body.validUntil, correlationId);
    const license: LicenseListItem = {
      id: `lic-${Date.now()}`,
      storeId: store.id,
      storeName: store.name,
      city: store.address.split(',')[0] ?? '',
      tenantId: store.tenantId,
      tenantName: store.tenantName,
      code: newKeyCode(store.tenantName, validUntil),
      validUntil,
      notifyDaysBefore: body.notifyDaysBefore,
      syncSchedule: body.syncSchedule,
      lastSyncAt: store.lastSyncAt,
      state: 'active',
      revokeReason: null,
    };
    billing().licenses.push(license);
    store.license = {
      code: license.code,
      validUntil,
      notifyDaysBefore: body.notifyDaysBefore,
      syncSchedule: body.syncSchedule,
    };
    store.licenseValidUntil = validUntil;
    audit(store.tenantId, 'Выдан лицензионный ключ', store.name);
    return license;
  },
  'licenses.renew': ({ params, body, correlationId }) => {
    const license = billing().licenses.find((item) => item.id === params.id);
    if (!license) throw notFound(correlationId);
    if (license.state === 'revoked')
      throw new ApiError(409, 'license_revoked', correlationId);
    license.validUntil = termEnd(body.term, body.validUntil, correlationId);
    license.notifyDaysBefore = body.notifyDaysBefore;
    license.syncSchedule = body.syncSchedule;
    const store = findStore(license.storeId, correlationId);
    store.licenseValidUntil = license.validUntil;
    if (store.license)
      Object.assign(store.license, { validUntil: license.validUntil });
    audit(
      license.tenantId,
      `Ключ продлён до ${license.validUntil}`,
      license.storeName,
    );
    return license;
  },
  'licenses.revoke': ({ params, body, correlationId }) => {
    const license = billing().licenses.find((item) => item.id === params.id);
    if (!license) throw notFound(correlationId);
    license.state = 'revoked';
    license.revokeReason = body.reason;
    audit(
      license.tenantId,
      `Ключ отозван. Причина: ${body.reason}`,
      license.storeName,
    );
    return license;
  },
  'stores.offlineOptions': () =>
    mockDb()
      .stores.filter(
        (store) => store.mode === 'offline' && store.status === 'active',
      )
      .map((store) => ({
        id: store.id,
        name: store.name,
        tenantName: store.tenantName,
        hasActiveLicense: billing().licenses.some(
          (license) =>
            license.storeId === store.id &&
            licenseBucket(license) !== 'inactive',
        ),
      })),

  'installations.list': ({ query }) => {
    const all = billing().installations;
    const filter = query?.filter ?? 'all';
    const items = all.filter((item) =>
      filter === 'outdated'
        ? item.state !== 'current'
        : filter === 'critical'
          ? item.state === 'unsupported'
          : true,
    );
    return {
      latest: billing().releases[0],
      items,
      counts: {
        all: all.length,
        outdated: all.filter((item) => item.state !== 'current').length,
        critical: all.filter((item) => item.state === 'unsupported').length,
      },
      updated: all.filter((item) => item.state === 'current').length,
    };
  },
  'installations.scheduleUpdate': ({ params, body, correlationId }) => {
    const installation = billing().installations.find(
      (item) => item.storeId === params.storeId,
    );
    if (!installation) throw notFound(correlationId);
    if (body.scheduledAt < new Date().toISOString()) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'scheduledAt', code: 'in_past' },
      ]);
    }
    installation.plannedUpdateAt = body.scheduledAt;
    const store = findStore(params.storeId, correlationId);
    audit(
      store.tenantId,
      `Запланировано обновление до ${body.targetVersion}`,
      store.name,
    );
    return installation;
  },
  'releases.list': () => billing().releases,
};
