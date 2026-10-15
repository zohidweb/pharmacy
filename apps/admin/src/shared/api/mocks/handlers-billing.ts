/*
 * Mock handlers of «Счета и платежи», «Услуги», «Лицензионные ключи», «Версии установок» and the
 * company billing tab. Same routes, problem codes and paging as apps/api will have.
 */
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
import { withVat } from './db-billing';
import { mockDb } from './db';
import { demoOperator } from './fixtures';
import { audit, findStore, findTenant, notFound } from './helpers';
import { logAction } from './log-action';
import type { MockHandlers } from './types';

const billing = () => mockDb().billing;
/** Platform settings: the tariff and VAT rate of the invoices issued next. */
const settings = () => mockDb().system.settings;
const today = () => toAppDate();
const currentPeriod = () => today().slice(0, 7);

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

function toListItem(invoice: InvoiceDetails): InvoiceListItem {
  const { lines: _lines, vatRatePercent: _rate, ...item } = invoice;
  return item;
}

function page<T>(items: T[], limit = 20, offset = 0) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

function matchesInvoice(
  invoice: InvoiceDetails,
  filter: InvoiceListFilter,
): boolean {
  if (filter === 'paid') return invoice.status === 'paid';
  if (filter === 'overdue') return invoice.status === 'overdue';
  return true;
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
  'tenants.invoices': ({ params }) =>
    billing()
      .invoices.filter((invoice) => invoice.tenantId === params.id)
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        period: invoice.period,
        stores: invoice.stores,
        hasServices: invoice.hasServices,
        totalMinor: invoice.totalMinor,
        status: invoice.status,
      })),
  'tenants.payments': ({ params }) =>
    billing()
      .payments.filter(
        (payment) => payment.tenantId === params.id && !payment.cancelled,
      )
      .map(({ id, paidOn, amountMinor, method, recordedBy }) => ({
        id,
        paidOn,
        amountMinor,
        method,
        recordedBy,
      })),

  'billing.summary': ({ query }) => {
    const period = query?.period ?? '2026-09';
    const invoices = billing().invoices.filter(
      (invoice) => invoice.period === period,
    );
    const paid = invoices.filter((invoice) => invoice.status === 'paid');
    const overdue = billing().invoices.filter(
      (invoice) => invoice.status === 'overdue',
    );
    return {
      period,
      issuedMinor: invoices.reduce(
        (sum, invoice) => sum + invoice.totalMinor,
        0,
      ),
      paidMinor: paid.reduce((sum, invoice) => sum + invoice.totalMinor, 0),
      invoices: invoices.length,
      paidInvoices: paid.length,
      overdueMinor: overdue.reduce(
        (sum, invoice) => sum + invoice.totalMinor,
        0,
      ),
      overdueTenants: new Set(overdue.map((invoice) => invoice.tenantId)).size,
      // the period's own rate once invoiced, otherwise the one new invoices will take
      pricePerStoreMinor: settings().pricePerStoreMinor,
      vatRatePercent: invoices[0]?.vatRatePercent ?? settings().vatRatePercent,
    };
  },
  'invoices.list': ({ query }) => {
    const all = [...billing().invoices].sort((a, b) =>
      b.period === a.period
        ? a.number.localeCompare(b.number)
        : b.period.localeCompare(a.period),
    );
    const filter = query?.filter ?? 'all';
    return {
      ...page(
        all
          .filter((invoice) => matchesInvoice(invoice, filter))
          .map(toListItem),
        query?.limit,
        query?.offset,
      ),
      counts: {
        all: all.length,
        paid: all.filter((invoice) => matchesInvoice(invoice, 'paid')).length,
        overdue: all.filter((invoice) => matchesInvoice(invoice, 'overdue'))
          .length,
      },
    };
  },
  'invoices.get': ({ params, correlationId }) => {
    const invoice = billing().invoices.find((item) => item.id === params.id);
    if (!invoice) throw notFound(correlationId);
    return invoice;
  },
  'invoices.generationPreview': ({ query }) => {
    const period = query.period;
    const state =
      period < currentPeriod()
        ? 'closed'
        : period === currentPeriod()
          ? 'current'
          : 'future';
    const rows = mockDb()
      .tenants.filter((tenant) => tenant.status === 'active')
      .map((tenant) => {
        const activeStores = mockDb().stores.filter(
          (store) =>
            store.tenantId === tenant.id &&
            store.mode === 'cloud' &&
            store.status === 'active',
        ).length;
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          activeStores,
          totalMinor:
            state === 'future'
              ? 0
              : withVat(
                  activeStores * settings().pricePerStoreMinor,
                  settings().vatRatePercent,
                ).totalMinor,
        };
      });
    return {
      period,
      state,
      rows,
      totalMinor: rows.reduce((sum, row) => sum + row.totalMinor, 0),
    };
  },
  'invoices.generate': ({ body, correlationId }) => {
    if (body.period >= currentPeriod()) {
      throw new ApiError(409, 'period_not_closed', correlationId);
    }
    if (billing().invoices.some((invoice) => invoice.period === body.period)) {
      throw new ApiError(409, 'invoices_already_generated', correlationId);
    }
    return { created: 0 };
  },
  'invoices.recalculationPreview': ({ params, correlationId }) => {
    const invoice = billing().invoices.find((item) => item.id === params.id);
    if (!invoice) throw notFound(correlationId);
    if (invoice.status === 'paid')
      throw new ApiError(409, 'invoice_paid', correlationId);
    return { beforeMinor: invoice.totalMinor, afterMinor: invoice.totalMinor };
  },
  'invoices.recalculate': ({ params, correlationId }) => {
    const invoice = billing().invoices.find((item) => item.id === params.id);
    if (!invoice) throw notFound(correlationId);
    if (invoice.status === 'paid')
      throw new ApiError(409, 'invoice_paid', correlationId);
    audit(invoice.tenantId, `Счёт ${invoice.number} пересчитан`);
    return invoice;
  },

  'payments.list': ({ query }) =>
    page(
      [...billing().payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn)),
      query?.limit,
      query?.offset,
    ),
  'payments.record': ({ body, correlationId }) => {
    const invoice = billing().invoices.find(
      (item) => item.id === body.invoiceId,
    );
    if (!invoice) throw notFound(correlationId);
    if (invoice.status === 'paid')
      throw new ApiError(409, 'invoice_paid', correlationId);
    const payment: PaymentListItem = {
      id: `pay-${Date.now()}`,
      paidOn: body.paidOn,
      tenantId: invoice.tenantId,
      tenantName: invoice.tenantName,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountMinor: body.amountMinor,
      method: body.method,
      recordedBy: demoOperator.fullName,
      comment: body.comment ?? '',
      cancelled: false,
    };
    billing().payments.push(payment);
    if (body.amountMinor >= invoice.totalMinor) invoice.status = 'paid';
    const tenant = findTenant(invoice.tenantId, correlationId);
    tenant.overdue = billing().invoices.some(
      (item) => item.tenantId === tenant.id && item.status === 'overdue',
    );
    if (body.paidUntil) {
      tenant.paidUntil = body.paidUntil;
      mockDb()
        .stores.filter(
          (store) => store.tenantId === tenant.id && store.mode === 'cloud',
        )
        .forEach((store) => {
          store.paidUntil = body.paidUntil ?? store.paidUntil;
        });
    }
    audit(invoice.tenantId, `Зафиксирован платёж по счёту ${invoice.number}`);
    return payment;
  },
  'payments.update': ({ params, body, correlationId }) => {
    const payment = billing().payments.find((item) => item.id === params.id);
    if (!payment) throw notFound(correlationId);
    if (payment.cancelled)
      throw new ApiError(409, 'payment_cancelled', correlationId);
    Object.assign(payment, body);
    audit(payment.tenantId, `Изменён платёж по счёту ${payment.invoiceNumber}`);
    return payment;
  },
  'payments.cancel': ({ params, body, correlationId }) => {
    const payment = billing().payments.find((item) => item.id === params.id);
    if (!payment) throw notFound(correlationId);
    payment.cancelled = true;
    const invoice = billing().invoices.find(
      (item) => item.id === payment.invoiceId,
    );
    if (invoice && invoice.status === 'paid') {
      invoice.status = invoice.dueOn < today() ? 'overdue' : 'issued';
    }
    audit(
      payment.tenantId,
      `Отменён платёж по счёту ${payment.invoiceNumber}. Причина: ${body.reason}`,
    );
    return payment;
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
    const tenant = findTenant(params.id, correlationId);
    const service = billing().services.find(
      (item) => item.id === body.serviceId && !item.archived,
    );
    if (!service) throw notFound(correlationId);
    const added: TenantServiceItem = {
      id: `ts-${Date.now()}`,
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
    if (item.status !== 'provided')
      throw new ApiError(409, 'service_not_approved', correlationId);
    Object.assign(item, { status: 'approved', providedOn: null });
    logAction('service.provision-undone', { tenant: tenantRef(item) });
    return item;
  },
  'tenantServices.update': ({ params, body, correlationId }) => {
    const item = tenantService(params.id, correlationId);
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
    Object.assign(item, {
      status: 'cancelled',
      reason: body.reason,
      providedOn: null,
    });
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
