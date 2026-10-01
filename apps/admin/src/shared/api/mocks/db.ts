/*
 * Synthetic in-memory data of the mock transport: fictional companies, people, phones and keys
 * (no real client data, CLAUDE.md). Resets on page reload.
 */
import type {
  AuditEntry,
  StoreDetails,
  TenantDetails,
  TenantServiceItem,
  TenantStats,
} from '@pharmacy/shared-dto';
import { seedBilling, type BillingDb } from './db-billing';
import { seedSystem, type SystemDb } from './db-system';

const LATEST_VERSION = '2.4.0';

function store(
  partial: Partial<StoreDetails> &
    Pick<
      StoreDetails,
      'id' | 'tenantId' | 'tenantName' | 'name' | 'address' | 'mode'
    >,
): StoreDetails {
  return {
    status: 'active',
    closedOn: null,
    paidUntil: partial.mode === 'cloud' ? '2026-10-31' : null,
    licenseValidUntil: null,
    lastSyncAt: null,
    monthSalesMinor: 0,
    managerName: 'Заведующая Демо',
    managerPhone: '+992 00 000 00 10',
    cashiers: 2,
    connectedOn: '2026-03-01',
    installedVersion: partial.mode === 'offline' ? LATEST_VERSION : null,
    latestVersion: LATEST_VERSION,
    monthReceipts: 0,
    license: null,
    syncHistory: [],
    syncQueue: [],
    ...partial,
  };
}

export interface MockDb {
  tenants: TenantDetails[];
  stores: StoreDetails[];
  billing: BillingDb;
  system: SystemDb;
  services: Record<string, TenantServiceItem[]>;
  audit: Record<string, AuditEntry[]>;
}

function seed(): MockDb {
  const stores: StoreDetails[] = [
    store({
      id: 's-101',
      tenantId: 't-1',
      tenantName: 'Демо Фарм',
      name: 'Демо Фарм №1',
      address: 'Душанбе, ул. Примерная, 1',
      mode: 'cloud',
      monthSalesMinor: 9_640_000,
      monthReceipts: 2_310,
    }),
    store({
      id: 's-102',
      tenantId: 't-1',
      tenantName: 'Демо Фарм',
      name: 'Демо Фарм №2',
      address: 'Душанбе, ул. Тестовая, 15',
      mode: 'cloud',
      monthSalesMinor: 7_215_050,
      monthReceipts: 1_904,
    }),
    store({
      id: 's-103',
      tenantId: 't-1',
      tenantName: 'Демо Фарм',
      name: 'Демо Фарм №3',
      address: 'Вахдат, ул. Образцовая, 5',
      mode: 'offline',
      licenseValidUntil: '2026-10-08',
      lastSyncAt: '2026-09-30T22:00:00Z',
      monthSalesMinor: 7_890_000,
      monthReceipts: 1_870,
      installedVersion: '2.3.1',
      cashiers: 3,
      license: {
        code: 'DMO-0001-TEST-2026',
        validUntil: '2026-10-08',
        notifyDaysBefore: 7,
        syncSchedule: 'daily',
      },
      syncHistory: [
        {
          at: '2026-09-30T22:00:00Z',
          operations: 312,
          version: '2.3.1',
          result: 'ok',
          conflicts: 0,
        },
        {
          at: '2026-09-29T22:00:00Z',
          operations: 287,
          version: '2.3.1',
          result: 'ok_with_conflicts',
          conflicts: 1,
        },
        {
          at: '2026-09-28T22:00:00Z',
          operations: 0,
          version: '2.3.1',
          result: 'no_connection',
          conflicts: 0,
        },
      ],
      syncQueue: [
        { kind: 'sales', operations: 112 },
        { kind: 'returns', operations: 4 },
        { kind: 'stock_movements', operations: 9 },
        { kind: 'price_changes', operations: 23 },
      ],
    }),
    store({
      id: 's-104',
      tenantId: 't-1',
      tenantName: 'Демо Фарм',
      name: 'Демо Фарм №4',
      address: 'Гиссар, ул. Условная, 2',
      mode: 'offline',
      licenseValidUntil: '2027-03-01',
      lastSyncAt: '2026-09-27T22:00:00Z',
      monthSalesMinor: 4_120_000,
      monthReceipts: 1_002,
      license: {
        code: 'DMO-0002-TEST-2027',
        validUntil: '2027-03-01',
        notifyDaysBefore: 14,
        syncSchedule: 'twice_daily',
      },
    }),
    store({
      id: 's-105',
      tenantId: 't-1',
      tenantName: 'Демо Фарм',
      name: 'Демо Фарм №5',
      address: 'Душанбе, ул. Закрытая, 9',
      mode: 'cloud',
      status: 'closed',
      closedOn: '2026-09-08',
      paidUntil: '2026-09-08',
    }),
    store({
      id: 's-201',
      tenantId: 't-2',
      tenantName: 'Пример Мед',
      name: 'Пример Мед — центральная',
      address: 'Худжанд, пр. Примерный, 10',
      mode: 'cloud',
      monthSalesMinor: 12_480_000,
      monthReceipts: 3_120,
    }),
    store({
      id: 's-202',
      tenantId: 't-2',
      tenantName: 'Пример Мед',
      name: 'Пример Мед — склад',
      address: 'Худжанд, ул. Складская, 3',
      mode: 'cloud',
      paidUntil: '2026-09-15',
    }),
    store({
      id: 's-203',
      tenantId: 't-2',
      tenantName: 'Пример Мед',
      name: 'Пример Мед №2',
      address: 'Исфара, ул. Тестовая, 4',
      mode: 'offline',
      licenseValidUntil: '2026-12-15',
      lastSyncAt: '2026-09-30T10:00:00Z',
      monthSalesMinor: 3_300_000,
      monthReceipts: 840,
      license: {
        code: 'PRM-0001-TEST-2026',
        validUntil: '2026-12-15',
        notifyDaysBefore: 7,
        syncSchedule: 'hourly',
      },
    }),
    store({
      id: 's-301',
      tenantId: 't-3',
      tenantName: 'Тест Аптека',
      name: 'Тест Аптека',
      address: 'Бохтар, ул. Пробная, 7',
      mode: 'cloud',
      monthSalesMinor: 2_150_000,
      monthReceipts: 610,
    }),
  ];

  const tenants: TenantDetails[] = [
    {
      id: 't-1',
      name: 'Демо Фарм',
      city: 'Душанбе',
      inn: '000000001',
      joinedOn: '2026-03-01',
      status: 'active',
      overdue: false,
      block: null,
      owner: {
        fullName: 'Владелец Демо',
        phone: '+992 00 000 00 01',
        login: 'owner1@example.test',
      },
      cloudStores: 2,
      offlineStores: 2,
      paidUntil: '2026-10-31',
      monthlyChargeMinor: 24_000,
    },
    {
      id: 't-2',
      name: 'Пример Мед',
      city: 'Худжанд',
      inn: '000000002',
      joinedOn: '2026-05-12',
      status: 'active',
      overdue: true,
      block: null,
      owner: {
        fullName: 'Владелица Пример',
        phone: '+992 00 000 00 02',
        login: 'owner2@example.test',
      },
      cloudStores: 2,
      offlineStores: 1,
      paidUntil: '2026-09-15',
      monthlyChargeMinor: 24_000,
    },
    {
      id: 't-3',
      name: 'Тест Аптека',
      city: 'Бохтар',
      inn: '000000003',
      joinedOn: '2026-08-20',
      status: 'active',
      overdue: false,
      block: null,
      owner: {
        fullName: 'Владелец Тест',
        phone: '+992 00 000 00 03',
        login: 'owner3@example.test',
      },
      cloudStores: 1,
      offlineStores: 0,
      paidUntil: '2026-10-31',
      monthlyChargeMinor: 12_000,
    },
  ];

  return {
    tenants,
    stores,
    billing: seedBilling(),
    system: seedSystem(),
    services: {
      't-1': [
        {
          id: 'svc-1',
          name: 'Перенос данных из прежней системы',
          billing: 'one_time',
          connectedOn: '2026-03-02',
          status: 'active',
          priceMinor: 120_000,
        },
        {
          id: 'svc-2',
          name: 'Расширенная аналитика',
          billing: 'monthly',
          connectedOn: '2026-09-20',
          status: 'pending',
          priceMinor: 35_000,
        },
      ],
    },
    audit: {
      't-1': [
        {
          id: 'a-1',
          at: '2026-09-30T06:42:00Z',
          actorName: 'Владелец Демо',
          actorIsPlatformOperator: false,
          storeName: 'Демо Фарм №1',
          action: 'Изменена цена позиции в прайс-листе',
        },
        {
          id: 'a-2',
          at: '2026-09-29T09:10:00Z',
          actorName: 'Демо Оператор',
          actorIsPlatformOperator: true,
          storeName: null,
          action: 'Зафиксирован платёж по счёту СЧ-2026-09-001',
        },
        {
          id: 'a-3',
          at: '2026-09-28T12:05:00Z',
          actorName: 'Заведующая Демо',
          actorIsPlatformOperator: false,
          storeName: 'Демо Фарм №3',
          action: 'Принята накладная поставщика',
        },
      ],
    },
  };
}

let db: MockDb = seed();

export function mockDb(): MockDb {
  return db;
}

/** Test hook: restores the initial data set. */
export function resetMockDb(): void {
  db = seed();
}

export function mockStats(tenantId: string): TenantStats {
  const stores = db.stores.filter(
    (s) => s.tenantId === tenantId && s.status === 'active',
  );
  const salesMinor = stores.reduce((sum, s) => sum + s.monthSalesMinor, 0);
  const receipts = stores.reduce((sum, s) => sum + s.monthReceipts, 0);
  const pattern = [82, 91, 76, 103, 99, 64, 58, 87, 96, 111, 104, 72, 69, 118];
  return {
    receipts,
    salesMinor,
    averageReceiptMinor: receipts > 0 ? Math.round(salesMinor / receipts) : 0,
    activeCashiers: stores.reduce((sum, s) => sum + s.cashiers, 0),
    daily: pattern.map((value, i) => ({
      date: `2026-09-${String(17 + i - 3).padStart(2, '0')}`,
      salesMinor: Math.round((salesMinor / 30) * (value / 90)),
    })),
  };
}
