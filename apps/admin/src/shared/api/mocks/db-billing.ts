/*
 * Synthetic billing, services, license and installation data of the mock transport
 * (fictional companies, keys and people). Resets on page reload or resetMockDb().
 */
import {
  allocatePayments,
  type ComposeInput,
  composeInvoice,
  invoiceDueOn,
  invoiceNumber,
  invoiceStatus,
} from '@pharmacy/shared-domain';
import type {
  InstallationItem,
  InvoiceDetails,
  LicenseListItem,
  PaymentListItem,
  PlatformService,
  Release,
  ServiceRequestItem,
  TenantDiscount,
  TenantServiceItem,
} from '@pharmacy/shared-dto';

/**
 * The rate of the seeded invoices and the default of the platform settings (Tajikistan, 14 %).
 * New invoices take the rate from the settings (`settings.vatRatePercent`), issued ones keep theirs.
 */
export const DEFAULT_VAT_RATE_PERCENT = 14;
export const PRICE_PER_STORE_MINOR = 12_000;

/** Stores the mock bills as a warehouse: never on an invoice (B4); apps/api reads `stores.kind`. */
export const WAREHOUSES = new Set(['s-202']);

const SUPPLIER = {
  name: 'ООО «Платформа» (демо)',
  inn: '000000000',
  bankAccount: '00000000000000000000',
  bankName: 'Демо-банк',
  bankBik: '000000000',
  bankCorrAccount: '00000000000000000000',
};
const PURPOSE = 'Оплата по счёту № {number} за обслуживание точек';

/** A payment of the mock with what apps/api keeps beside it: the order of the day and the request. */
export interface MockPayment extends PaymentListItem {
  createdAt: string;
  /** The body of the first request (A9): a repeat with another one is a conflict. */
  request: string;
}

export interface MockDiscount extends TenantDiscount {
  tenantId: string;
}

/** A service of a network with the body of the request that added it without an order (B17). */
export type MockTenantService = TenantServiceItem & { request?: string };

/** An invoice as apps/api would compose it (spec 2026-10-15-billing-services, A2–A5). */
export function composedInvoice(spec: {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantInn: string;
  period: string;
  sequence: number;
  issuedOn: string;
  pricePerStoreMinor: number;
  vatRatePercent: number;
  discountBp: number | null;
  stores: ComposeInput['stores'];
  services: ComposeInput['services'];
  supplier?: typeof SUPPLIER;
  purposeTemplate?: string;
}): InvoiceDetails {
  const composed = composeInvoice({
    period: spec.period,
    pricePerStoreMinor: spec.pricePerStoreMinor,
    vatBp: spec.vatRatePercent * 100,
    discountBp: spec.discountBp,
    stores: spec.stores,
    services: spec.services,
  });
  const number = invoiceNumber(spec.period, spec.sequence);
  return {
    id: spec.id,
    number,
    tenantId: spec.tenantId,
    tenantName: spec.tenantName,
    period: spec.period,
    stores: composed.lines.filter((line) => line.kind === 'store').length,
    hasServices: composed.lines.some((line) => line.kind === 'service'),
    netMinor: composed.subtotalMinor,
    vatMinor: composed.vatMinor,
    totalMinor: composed.totalMinor,
    paidMinor: 0,
    remainingMinor: composed.totalMinor,
    status: 'issued',
    overdue: false,
    issuedAt: `${spec.issuedOn}T04:00:00.000Z`,
    dueOn: invoiceDueOn(spec.period, spec.issuedOn),
    paidOn: null,
    pricePerStoreMinor: spec.pricePerStoreMinor,
    vatRatePercent: spec.vatRatePercent,
    supplier: spec.supplier ?? SUPPLIER,
    payer: { name: spec.tenantName, inn: spec.tenantInn },
    paymentPurpose: (spec.purposeTemplate ?? PURPOSE)
      .split('{number}')
      .join(number),
    recalculatedAt: null,
    lines: composed.lines.map((line, index) => ({
      id: `${spec.id}-l${index + 1}`,
      ...line,
    })),
  };
}

const seeded = (
  spec: Omit<
    Parameters<typeof composedInvoice>[0],
    'pricePerStoreMinor' | 'vatRatePercent' | 'services' | 'discountBp'
  > & { services?: ComposeInput['services'] },
) =>
  composedInvoice({
    ...spec,
    pricePerStoreMinor: PRICE_PER_STORE_MINOR,
    vatRatePercent: DEFAULT_VAT_RATE_PERCENT,
    discountBp: null,
    services: spec.services ?? [],
  });

/**
 * The allocation of the active payments of a network to its invoices, as TenantAllocation of
 * apps/api (spec 2026-10-15-billing-services, A7, A8): paid amounts, statuses and the advance.
 */
export function settleBilling(db: BillingDb, tenantId: string): void {
  const invoices = db.invoices.filter(
    (invoice) => invoice.tenantId === tenantId,
  );
  const result = allocatePayments(
    invoices.map((invoice) => ({
      id: invoice.id,
      period: invoice.period,
      number: invoice.number,
      totalMinor: invoice.totalMinor,
      issuedOn: invoice.issuedAt.slice(0, 10),
    })),
    db.payments
      .filter((payment) => payment.tenantId === tenantId && !payment.cancelled)
      .map((payment) => ({
        id: payment.id,
        amountMinor: payment.amountMinor,
        paidOn: payment.paidOn,
        createdAt: payment.createdAt,
        preferredInvoiceId: payment.invoiceId,
      })),
  );
  for (const invoice of invoices) {
    const paid = result.invoices[invoice.id];
    invoice.paidMinor = paid.paidMinor;
    invoice.paidOn = paid.paidOn;
    invoice.remainingMinor = invoice.totalMinor - paid.paidMinor;
    invoice.status = invoiceStatus(invoice.totalMinor, paid.paidMinor);
  }
  db.advances[tenantId] = result.advanceMinor;
}

export interface BillingDb {
  /** Paid amounts, statuses and advances are set by the allocation (mocks/billing-ledger.ts). */
  invoices: InvoiceDetails[];
  payments: MockPayment[];
  discounts: MockDiscount[];
  /** The advance of each network: payments not allocated to invoices. */
  advances: Record<string, number>;
  services: Omit<PlatformService, 'tenants'>[];
  /** Pending requests: a decision moves a request to `tenantServices`. */
  serviceRequests: ServiceRequestItem[];
  tenantServices: MockTenantService[];
  licenses: LicenseListItem[];
  installations: InstallationItem[];
  releases: Release[];
}

const DEMO = {
  tenantId: 't-1',
  tenantName: 'Демо Фарм',
  tenantInn: '000000001',
};
const EXAMPLE = {
  tenantId: 't-2',
  tenantName: 'Пример Мед',
  tenantInn: '000000002',
};
const TEST = {
  tenantId: 't-3',
  tenantName: 'Тест Аптека',
  tenantInn: '000000003',
};
const DEMO_1 = {
  storeId: 's-101',
  name: 'Демо Фарм №1',
  firstSaleEver: '2026-03-02',
  closedOn: null,
};
const DEMO_2 = {
  storeId: 's-102',
  name: 'Демо Фарм №2',
  firstSaleEver: '2026-07-12',
  closedOn: null,
};
const DEMO_5 = {
  storeId: 's-105',
  name: 'Демо Фарм №5',
  firstSaleEver: '2026-03-02',
  closedOn: '2026-09-08',
};

export function seedBilling(): BillingDb {
  const db: BillingDb = {
    // July and August are invoiced; September closes on 2026-10-03 (A1).
    invoices: [
      seeded({
        ...DEMO,
        id: 'inv-6',
        period: '2026-07',
        sequence: 1,
        issuedOn: '2026-08-03',
        stores: [DEMO_1, DEMO_2, DEMO_5],
      }),
      seeded({
        ...DEMO,
        id: 'inv-2',
        period: '2026-08',
        sequence: 1,
        issuedOn: '2026-09-03',
        stores: [DEMO_1, DEMO_2, DEMO_5],
        services: [
          {
            tenantServiceId: 'ts-1',
            name: 'Перенос данных из прежней системы',
            priceMinor: 120_000,
            providedOn: '2026-08-12',
          },
        ],
      }),
      seeded({
        ...EXAMPLE,
        id: 'inv-5',
        period: '2026-08',
        sequence: 2,
        issuedOn: '2026-09-03',
        stores: [
          {
            storeId: 's-201',
            name: 'Пример Мед — центральная',
            firstSaleEver: '2026-05-15',
            closedOn: null,
          },
        ],
      }),
      seeded({
        ...TEST,
        id: 'inv-7',
        period: '2026-08',
        sequence: 3,
        issuedOn: '2026-09-03',
        stores: [
          {
            storeId: 's-301',
            name: 'Тест Аптека',
            firstSaleEver: '2026-08-20',
            closedOn: null,
          },
        ],
      }),
    ],
    payments: [
      {
        id: 'pay-2',
        paidOn: '2026-08-04',
        createdAt: '2026-08-04T06:00:00.000Z',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        invoiceId: null,
        invoiceNumber: null,
        amountMinor: 50_000,
        method: 'cash',
        recordedBy: 'Демо Оператор',
        comment: null,
        cancelled: false,
        cancelReason: null,
        request: '',
      },
      {
        id: 'pay-1',
        paidOn: '2026-09-10',
        createdAt: '2026-09-10T06:00:00.000Z',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        invoiceId: 'inv-2',
        invoiceNumber: 'СЧ-2026-08-001',
        amountMinor: 170_000,
        method: 'bank_transfer',
        recordedBy: 'Демо Оператор',
        comment: 'Платёжное поручение № 0001 (тест)',
        cancelled: false,
        cancelReason: null,
        request: '',
      },
      {
        id: 'pay-3',
        paidOn: '2026-09-20',
        createdAt: '2026-09-20T06:00:00.000Z',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        invoiceId: null,
        invoiceNumber: null,
        amountMinor: 5_000,
        method: 'cash',
        recordedBy: 'Демо Оператор',
        comment: null,
        cancelled: false,
        cancelReason: null,
        request: '',
      },
      {
        id: 'pay-4',
        paidOn: '2026-09-12',
        createdAt: '2026-09-12T06:00:00.000Z',
        tenantId: 't-3',
        tenantName: 'Тест Аптека',
        invoiceId: null,
        invoiceNumber: null,
        amountMinor: 5_295,
        method: 'bank_transfer',
        recordedBy: 'Демо Оператор',
        comment: null,
        cancelled: false,
        cancelReason: null,
        request: '',
      },
    ],
    discounts: [
      {
        id: 'disc-1',
        tenantId: 't-1',
        percentBp: 1_000,
        fromMonth: '2026-09',
        toMonth: '2026-12',
        invoicedThrough: null,
      },
    ],
    advances: {},
    // One-time services of the catalog (spec 2026-10-15-billing-services, B7); the count of
    // networks is computed by the handler, as apps/api does.
    services: [
      {
        id: 'svc-a',
        nameRu: 'Перенос данных из прежней системы',
        nameTj: 'Интиқоли маълумот аз системаи пешина',
        descriptionRu:
          'Импорт справочника товаров, остатков и поставщиков из файла прежней программы.',
        descriptionTj: null,
        basePriceMinor: 120_000,
        visible: true,
        archived: false,
      },
      {
        id: 'svc-b',
        nameRu: 'Обучение персонала',
        nameTj: null,
        descriptionRu: 'Занятие для кассиров и заведующих на точке или онлайн.',
        descriptionTj: null,
        basePriceMinor: 30_000,
        visible: true,
        archived: false,
      },
      {
        id: 'svc-c',
        nameRu: 'Выезд инженера на точку',
        nameTj: null,
        descriptionRu:
          'Настройка кассы и оборудования на месте в пределах города.',
        descriptionTj: null,
        basePriceMinor: 25_000,
        visible: false,
        archived: false,
      },
    ],
    serviceRequests: [
      {
        id: 'req-1',
        serviceId: 'svc-b',
        serviceName: 'Обучение персонала',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        requestedAt: '2026-09-29T07:15:00Z',
        basePriceMinor: 30_000,
        comment: 'Пять кассиров, вечером после смены',
      },
      {
        id: 'req-2',
        serviceId: 'svc-a',
        serviceName: 'Перенос данных из прежней системы',
        tenantId: 't-3',
        tenantName: 'Тест Аптека',
        requestedAt: '2026-09-30T11:40:00Z',
        basePriceMinor: 120_000,
        comment: null,
      },
    ],
    tenantServices: [
      {
        id: 'ts-1',
        serviceId: 'svc-a',
        serviceName: 'Перенос данных из прежней системы',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        status: 'provided',
        priceMinor: 120_000,
        reason: null,
        requestId: 'req-0',
        requestedAt: '2026-08-01T06:00:00Z',
        comment: null,
        decidedAt: '2026-08-01T09:30:00Z',
        decidedBy: 'Демо Оператор',
        providedOn: '2026-08-12',
      },
      {
        id: 'ts-2',
        serviceId: 'svc-b',
        serviceName: 'Обучение персонала',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        status: 'approved',
        priceMinor: 45_000,
        reason: null,
        requestId: null,
        requestedAt: null,
        comment: null,
        decidedAt: '2026-09-20T08:00:00Z',
        decidedBy: 'Демо Оператор',
        providedOn: null,
      },
    ],
    licenses: [
      {
        id: 'lic-1',
        storeId: 's-103',
        storeName: 'Демо Фарм №3',
        city: 'Вахдат',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        code: 'DMO-0001-TEST-2026',
        validUntil: '2026-10-08',
        notifyDaysBefore: 7,
        syncSchedule: 'daily',
        lastSyncAt: '2026-09-30T22:00:00Z',
        state: 'active',
        revokeReason: null,
      },
      {
        id: 'lic-2',
        storeId: 's-104',
        storeName: 'Демо Фарм №4',
        city: 'Гиссар',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        code: 'DMO-0002-TEST-2027',
        validUntil: '2027-03-01',
        notifyDaysBefore: 14,
        syncSchedule: 'twice_daily',
        lastSyncAt: '2026-09-27T22:00:00Z',
        state: 'active',
        revokeReason: null,
      },
      {
        id: 'lic-3',
        storeId: 's-203',
        storeName: 'Пример Мед №2',
        city: 'Исфара',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        code: 'PRM-0001-TEST-2026',
        validUntil: '2026-12-15',
        notifyDaysBefore: 7,
        syncSchedule: 'hourly',
        lastSyncAt: '2026-09-30T10:00:00Z',
        state: 'active',
        revokeReason: null,
      },
      {
        id: 'lic-4',
        storeId: 's-203',
        storeName: 'Пример Мед №2',
        city: 'Исфара',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        code: 'PRM-0000-TEST-2026',
        validUntil: '2026-09-01',
        notifyDaysBefore: 7,
        syncSchedule: 'hourly',
        lastSyncAt: '2026-08-20T10:00:00Z',
        state: 'revoked',
        revokeReason: 'Ключ заменён при переустановке',
      },
    ],
    installations: [
      {
        storeId: 's-103',
        storeName: 'Демо Фарм №3',
        city: 'Вахдат',
        tenantName: 'Демо Фарм',
        version: '2.3.1',
        updatedOn: '2026-08-12',
        os: 'Windows 11',
        ramGb: 16,
        state: 'behind',
        behindBy: 1,
        supportedUntil: null,
        plannedUpdateAt: null,
      },
      {
        storeId: 's-104',
        storeName: 'Демо Фарм №4',
        city: 'Гиссар',
        tenantName: 'Демо Фарм',
        version: '2.4.0',
        updatedOn: '2026-09-22',
        os: 'Ubuntu 22.04',
        ramGb: 16,
        state: 'current',
        behindBy: 0,
        supportedUntil: null,
        plannedUpdateAt: null,
      },
      {
        storeId: 's-203',
        storeName: 'Пример Мед №2',
        city: 'Исфара',
        tenantName: 'Пример Мед',
        version: '2.2.0',
        updatedOn: '2026-06-03',
        os: 'Windows 10',
        ramGb: 8,
        state: 'unsupported',
        behindBy: 2,
        supportedUntil: '2026-12-01',
        plannedUpdateAt: null,
      },
    ],
    releases: [
      {
        version: '2.4.0',
        releasedOn: '2026-09-18',
        notes:
          'Перевод точки в облако, ускорена синхронизация больших очередей.',
        supportedUntil: null,
      },
      {
        version: '2.3.1',
        releasedOn: '2026-08-05',
        notes: 'Исправлена печать чека 58 мм при длинных названиях.',
        supportedUntil: null,
      },
      {
        version: '2.2.0',
        releasedOn: '2026-06-01',
        notes: 'Журнал ПКУ на офлайн-точке.',
        supportedUntil: '2026-12-01',
      },
    ],
  };
  for (const tenantId of ['t-1', 't-2', 't-3']) settleBilling(db, tenantId);
  return db;
}
