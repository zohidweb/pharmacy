/*
 * Synthetic billing, services, license and installation data of the mock transport
 * (fictional companies, keys and people). Resets on page reload or resetMockDb().
 */
import type {
  InstallationItem,
  InvoiceDetails,
  LicenseListItem,
  PaymentListItem,
  PlatformService,
  Release,
  ServiceRequestItem,
} from '@pharmacy/shared-dto';

export const VAT_RATE_PERCENT = 15;
export const PRICE_PER_STORE_MINOR = 12_000;

/** Mock-only VAT split; the real calculation and rounding belong to apps/api. */
export function withVat(netMinor: number) {
  const vatMinor = Math.round((netMinor * VAT_RATE_PERCENT) / 100);
  return { netMinor, vatMinor, totalMinor: netMinor + vatMinor };
}

function invoice(
  partial: Omit<
    InvoiceDetails,
    'netMinor' | 'vatMinor' | 'totalMinor' | 'vatRatePercent'
  >,
): InvoiceDetails {
  const net = partial.lines.reduce((sum, line) => sum + line.amountMinor, 0);
  return { ...partial, ...withVat(net), vatRatePercent: VAT_RATE_PERCENT };
}

export interface BillingDb {
  invoices: InvoiceDetails[];
  payments: PaymentListItem[];
  services: PlatformService[];
  serviceRequests: ServiceRequestItem[];
  licenses: LicenseListItem[];
  installations: InstallationItem[];
  releases: Release[];
}

export function seedBilling(): BillingDb {
  return {
    invoices: [
      invoice({
        id: 'inv-1',
        number: 'СЧ-2026-09-001',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        period: '2026-09',
        stores: 2,
        hasServices: true,
        status: 'paid',
        dueOn: '2026-10-15',
        lines: [
          {
            kind: 'store',
            description: 'Демо Фарм №1 — полный месяц',
            days: 30,
            amountMinor: 12_000,
          },
          {
            kind: 'store',
            description: 'Демо Фарм №2 — полный месяц',
            days: 30,
            amountMinor: 12_000,
          },
          {
            kind: 'service',
            description: 'Перенос данных из прежней системы',
            days: null,
            amountMinor: 120_000,
          },
          {
            kind: 'service',
            description: 'Расширенная аналитика',
            days: 30,
            amountMinor: 26_200,
          },
        ],
      }),
      invoice({
        id: 'inv-3',
        number: 'СЧ-2026-09-003',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        period: '2026-09',
        stores: 2,
        hasServices: false,
        status: 'overdue',
        dueOn: '2026-09-15',
        lines: [
          {
            kind: 'store',
            description: 'Пример Мед — центральная — полный месяц',
            days: 30,
            amountMinor: 12_000,
          },
          {
            kind: 'store',
            description: 'Пример Мед — склад — 8 дней',
            days: 8,
            amountMinor: 3_200,
          },
        ],
      }),
      invoice({
        id: 'inv-4',
        number: 'СЧ-2026-09-002',
        tenantId: 't-3',
        tenantName: 'Тест Аптека',
        period: '2026-09',
        stores: 1,
        hasServices: false,
        status: 'issued',
        dueOn: '2026-10-15',
        lines: [
          {
            kind: 'store',
            description: 'Тест Аптека — 11 дней',
            days: 11,
            amountMinor: 4_400,
          },
        ],
      }),
      invoice({
        id: 'inv-2',
        number: 'СЧ-2026-08-001',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        period: '2026-08',
        stores: 2,
        hasServices: false,
        status: 'paid',
        dueOn: '2026-09-15',
        lines: [
          {
            kind: 'store',
            description: 'Демо Фарм №1 — полный месяц',
            days: 31,
            amountMinor: 12_000,
          },
          {
            kind: 'store',
            description: 'Демо Фарм №2 — полный месяц',
            days: 31,
            amountMinor: 12_000,
          },
        ],
      }),
      invoice({
        id: 'inv-5',
        number: 'СЧ-2026-08-002',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        period: '2026-08',
        stores: 1,
        hasServices: false,
        status: 'paid',
        dueOn: '2026-09-15',
        lines: [
          {
            kind: 'store',
            description: 'Пример Мед — центральная — полный месяц',
            days: 31,
            amountMinor: 12_000,
          },
        ],
      }),
      invoice({
        id: 'inv-6',
        number: 'СЧ-2026-07-001',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        period: '2026-07',
        stores: 2,
        hasServices: false,
        status: 'paid',
        dueOn: '2026-08-15',
        lines: [
          {
            kind: 'store',
            description: 'Демо Фарм №1 — полный месяц',
            days: 31,
            amountMinor: 12_000,
          },
          {
            kind: 'store',
            description: 'Демо Фарм №2 — 20 дней',
            days: 20,
            amountMinor: 7_740,
          },
        ],
      }),
    ],
    payments: [
      {
        id: 'pay-1',
        paidOn: '2026-09-05',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        invoiceId: 'inv-1',
        invoiceNumber: 'СЧ-2026-09-001',
        amountMinor: 195_730,
        method: 'bank_transfer',
        recordedBy: 'Демо Оператор',
        comment: 'Платёжное поручение № 0001 (тест)',
        cancelled: false,
      },
      {
        id: 'pay-2',
        paidOn: '2026-08-04',
        tenantId: 't-1',
        tenantName: 'Демо Фарм',
        invoiceId: 'inv-2',
        invoiceNumber: 'СЧ-2026-08-001',
        amountMinor: 27_600,
        method: 'cash',
        recordedBy: 'Демо Оператор',
        comment: '',
        cancelled: false,
      },
      {
        id: 'pay-3',
        paidOn: '2026-08-10',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        invoiceId: 'inv-5',
        invoiceNumber: 'СЧ-2026-08-002',
        amountMinor: 13_800,
        method: 'bank_transfer',
        recordedBy: 'Демо Оператор',
        comment: '',
        cancelled: false,
      },
    ],
    services: [
      {
        id: 'svc-a',
        name: 'Перенос данных из прежней системы',
        description:
          'Импорт справочника товаров, остатков и поставщиков из файла прежней программы.',
        billing: 'one_time',
        priceMinor: 120_000,
        visibleInCatalog: true,
        tenants: 1,
      },
      {
        id: 'svc-b',
        name: 'Расширенная аналитика',
        description:
          'Отчёты по оборачиваемости, ABC-анализ и прогноз закупок по всей сети.',
        billing: 'monthly',
        priceMinor: 35_000,
        visibleInCatalog: true,
        tenants: 1,
      },
      {
        id: 'svc-c',
        name: 'Выезд инженера на точку',
        description:
          'Установка офлайн-точки или обновление на месте в пределах города.',
        billing: 'one_time',
        priceMinor: 25_000,
        visibleInCatalog: false,
        tenants: 0,
      },
    ],
    serviceRequests: [
      {
        id: 'req-1',
        serviceId: 'svc-b',
        serviceName: 'Расширенная аналитика',
        tenantId: 't-2',
        tenantName: 'Пример Мед',
        requestedAt: '2026-09-29T07:15:00Z',
        billing: 'monthly',
        priceMinor: 35_000,
      },
      {
        id: 'req-2',
        serviceId: 'svc-a',
        serviceName: 'Перенос данных из прежней системы',
        tenantId: 't-3',
        tenantName: 'Тест Аптека',
        requestedAt: '2026-09-30T11:40:00Z',
        billing: 'one_time',
        priceMinor: 120_000,
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
}
