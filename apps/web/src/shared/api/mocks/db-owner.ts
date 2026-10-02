/*
 * Owner cabinet part of the mock database (UI mockups «Точки, услуги, оплата», «Сотрудники и роли»,
 * «Журнал действий», «Настройки», «Офлайн-точка»): roles of the tenant, store details, services,
 * invoices, the audit log, network settings, terminals and the synchronisation of the offline
 * store. Synthetic data; amounts in dirams, TJS only.
 */
import {
  permissions,
  roleTemplates,
  type Permission,
  type RoleTemplateKey,
} from '@pharmacy/shared-domain';
import type {
  NetworkSettings,
  OfflineQueueItem,
  OwnerStore,
  TenantAuditEntry,
  TenantInvoice,
  TenantService,
  TenantTerminal,
} from '@pharmacy/shared-dto';
import { DAY_MS, dateIn } from './fixtures-pos';

export interface MockRole {
  id: string;
  name: string;
  system: boolean;
  templateKey: RoleTemplateKey | null;
  permissions: Permission[];
}

/** Store data the owner edits on top of the session store (name, address, mode). */
export type StoreDetails = Omit<
  OwnerStore,
  'id' | 'name' | 'address' | 'mode' | 'managerName' | 'receiptsThisMonth'
> & {
  /** Transfer of the stock of a closing store; its acceptance closes the store. */
  closingTransferId?: string;
};

export interface OwnerMockDb {
  roles: MockRole[];
  storeDetails: Record<string, StoreDetails>;
  /** Stores that are not in the session list: pending activation or closed. */
  extraStores: OwnerStore[];
  services: TenantService[];
  invoices: TenantInvoice[];
  audit: TenantAuditEntry[];
  settings: NetworkSettings;
  terminals: TenantTerminal[];
  /** Article of a product in 1C (mapping of the export, CommerceML). */
  articles1c: Record<string, string>;
  offlineQueue: OfflineQueueItem[];
  lastSyncAt: string;
  deployment: 'cloud' | 'offline-store';
  counters: { store: number; role: number; employee: number; audit: number };
}

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

const roleNames: Record<RoleTemplateKey, string> = {
  owner: 'Владелец',
  manager: 'Заведующий точкой',
  cashier: 'Фармацевт-кассир',
  accountant: 'Бухгалтер',
};

function templateRole(key: RoleTemplateKey): MockRole {
  return {
    id: `role-${key}`,
    name: roleNames[key],
    system: roleTemplates[key].system,
    templateKey: key,
    permissions:
      key === 'owner' ? [...permissions] : [...roleTemplates[key].permissions],
  };
}

const receipt = (taxId = '020012345') => ({
  taxId,
  header: 'Аптечная сеть «Шифо»',
  footer: 'Спасибо за покупку! Обмен и возврат — 14 дней при наличии чека.',
  autoPrint: true,
});

const details = (
  managerId: string | null,
  phone: string,
  paidUntil: string | null,
  licenseValidUntil: string | null = null,
): StoreDetails => ({
  phone,
  managerId,
  status: 'active',
  paidUntil,
  licenseValidUntil,
  minStockPacks: 10,
  receipt: receipt(),
  closedOn: null,
  stockMovedTo: null,
});

const audit = (
  id: number,
  minutes: number,
  entry: Omit<TenantAuditEntry, 'id' | 'at' | 'documentDate' | 'byOperator'> &
    Partial<Pick<TenantAuditEntry, 'documentDate' | 'byOperator'>>,
): TenantAuditEntry => ({
  id: `au-${id}`,
  at: ago(minutes),
  documentDate: null,
  byOperator: false,
  ...entry,
});

export function createOwnerDb(): OwnerMockDb {
  return {
    roles: [
      templateRole('owner'),
      templateRole('manager'),
      templateRole('cashier'),
      templateRole('accountant'),
      {
        id: 'role-senior-cashier',
        name: 'Старший кассир',
        system: false,
        templateKey: null,
        permissions: [
          ...roleTemplates.cashier.permissions,
          'pos:sell-controlled',
          'pos:choose-batch',
          'returns:without-receipt',
          'inventory:create',
          'inventory:update',
        ],
      },
    ],
    storeDetails: {
      'store-1': details('emp-manager', '+992 37 221-10-01', dateIn(30)),
      'store-2': details(null, '+992 37 221-10-02', dateIn(30)),
      'store-3': details('emp-manager', '+992 37 221-10-03', dateIn(30)),
      'store-4': details(null, '+992 3 226-20-04', null, dateIn(14)),
    },
    extraStores: [
      {
        id: 'store-5',
        name: 'Аптека №5 · Хуҷанд',
        address: 'г. Худжанд, ул. Ленина, 20',
        phone: '',
        managerId: null,
        managerName: null,
        mode: 'cloud',
        status: 'closed',
        paidUntil: null,
        licenseValidUntil: null,
        receiptsThisMonth: 0,
        minStockPacks: 10,
        receipt: receipt(),
        closedOn: dateIn(-90),
        stockMovedTo: 'Аптека №1 · Центр',
      },
    ],
    services: [
      { key: 'export-1c', state: 'included', requestedAt: null },
      { key: 'fiscal', state: 'included', requestedAt: null },
      { key: 'notifications', state: 'requested', requestedAt: daysAgo(3) },
      { key: 'print-agent', state: 'available', requestedAt: null },
      { key: 'labels', state: 'available', requestedAt: null },
    ],
    invoices: [
      {
        number: 'СЧ-2026-09-014',
        period: dateIn(-15).slice(0, 7),
        amountMinor: 120_000,
        dueOn: dateIn(4),
        paidOn: null,
        status: 'due',
      },
      {
        number: 'СЧ-2026-08-014',
        period: dateIn(-45).slice(0, 7),
        amountMinor: 120_000,
        dueOn: dateIn(-26),
        paidOn: dateIn(-28),
        status: 'paid',
      },
      {
        number: 'СЧ-2026-07-014',
        period: dateIn(-75).slice(0, 7),
        amountMinor: 160_000,
        dueOn: dateIn(-56),
        paidOn: dateIn(-57),
        status: 'paid',
      },
    ],
    audit: [
      audit(11, 20, {
        employeeName: 'Зарина Рахимова',
        storeName: 'Аптека №3 · Рудаки',
        action: 'sale',
        object: 'Чек №1041',
        details: '86,50 с · наличные + карта',
      }),
      audit(10, 24, {
        employeeName: 'Манижа Каримова',
        storeName: 'Аптека №1 · Центр',
        action: 'price_change',
        object: 'Витамин D3 2000 МЕ, капс. №60',
        details: '65,00 с → 70,00 с',
      }),
      audit(9, 41, {
        employeeName: 'Фируз Ахмедов',
        storeName: 'Аптека №2 · Сино',
        action: 'write_off',
        object: 'СП-000019',
        details: '4 уп. · истёк срок · 55,20 с',
      }),
      audit(8, 63, {
        employeeName: 'Зарина Рахимова',
        storeName: 'Аптека №3 · Рудаки',
        action: 'return',
        object: 'Чек №0988',
        details: '−38,00 с',
      }),
      audit(7, 140, {
        employeeName: 'Фируз Ахмедов',
        storeName: 'Аптека №1 · Центр',
        action: 'goods_receipt',
        object: 'ПР-000122',
        details: '760,00 с · Дори-Дармон',
        documentDate: dateIn(-2),
        byOperator: true,
      }),
      audit(6, 60 * 20, {
        employeeName: 'Далер Сафаров',
        storeName: 'Аптека №2 · Сино',
        action: 'unpost',
        object: 'СП-000017',
        details: 'Проведён → Черновик',
      }),
      audit(5, 60 * 23, {
        employeeName: 'Фируз Ахмедов',
        storeName: null,
        action: 'sign_in',
        object: '—',
        details: 'Сеанс оператора платформы',
        byOperator: true,
      }),
      audit(4, 60 * 27, {
        employeeName: 'Фируз Ахмедов',
        storeName: 'Аптека №4 · Вахдат',
        action: 'employee_block',
        object: 'Рустам Назаров',
        details: 'Активен → Заблокирован',
      }),
      audit(3, 60 * 46, {
        employeeName: 'Манижа Каримова',
        storeName: 'Аптека №1 · Центр',
        action: 'password_reset',
        object: 'Зарина Рахимова',
        details: '—',
      }),
      audit(2, 60 * 50, {
        employeeName: 'Зарина Рахимова',
        storeName: 'Аптека №3 · Рудаки',
        action: 'stock_count',
        object: 'ИН-000006',
        details: '−6 / +1 · −104,40 с',
      }),
      audit(1, 60 * 52, {
        employeeName: 'Зарина Рахимова',
        storeName: 'Аптека №3 · Рудаки',
        action: 'shift_open',
        object: 'Смена №218',
        details: '500,00 с',
      }),
    ],
    settings: {
      networkName: 'Аптечная сеть «Шифо»',
      returnWindowDays: 14,
      posSessionTimeoutMinutes: 15,
      minPinLength: 4,
      expiryNoticeDays: 30,
      warnBelowCost: true,
      notifications: {
        expiry: true,
        low_stock: true,
        supplier_debt: true,
        transfer: true,
        shift_discrepancy: true,
        sync_conflict: true,
        negative_stock: true,
        license_expiry: true,
      },
    },
    terminals: [
      {
        id: 'term-3-1',
        name: 'Касса 1 · Аптека №3',
        serial: 'SN 8841-2290',
        storeId: 'store-3',
        storeName: 'Аптека №3 · Рудаки',
        storeOffline: false,
        boundByName: 'Зарина Р.',
        boundAt: daysAgo(60),
        lastSeenAt: ago(5),
      },
      {
        id: 'term-1-1',
        name: 'ПК кассира · Windows 11',
        serial: 'SN WS-0041',
        storeId: 'store-1',
        storeName: 'Аптека №1 · Центр',
        storeOffline: false,
        boundByName: 'Манижа К.',
        boundAt: daysAgo(79),
        lastSeenAt: ago(30),
      },
      {
        id: 'term-4-1',
        name: 'POS-терминал 10″ · Android 12',
        serial: 'SN 8841-1177',
        storeId: 'store-4',
        storeName: 'Аптека №4 · Вахдат',
        storeOffline: true,
        boundByName: 'Нигина Р.',
        boundAt: daysAgo(102),
        lastSeenAt: ago(130),
      },
    ],
    articles1c: {
      'p-paracetamol': 'ЛС-00101',
      'p-amoxicillin': 'ЛС-00145',
      'p-ibuprofen-400': 'ЛС-00177',
      'p-ibuprofen-200': 'ЛС-00178',
      'p-nurofen': 'ЛС-00190',
      'p-tramadol': 'ЛС-00310',
      'p-nurofen-kids': 'ЛС-00191',
    },
    offlineQueue: [
      {
        id: 'q-5',
        at: ago(12),
        kind: 'sale',
        label: 'Чек №0312',
        amountMinor: 8_650,
      },
      {
        id: 'q-4',
        at: ago(33),
        kind: 'write_off',
        label: 'СП-000006',
        amountMinor: 5_520,
      },
      {
        id: 'q-3',
        at: ago(55),
        kind: 'return',
        label: 'ВЗ-000004',
        amountMinor: -3_800,
      },
      {
        id: 'q-2',
        at: ago(103),
        kind: 'price_change',
        label: 'Витамин D3 2000 МЕ, капс. №60',
        amountMinor: 6_200,
      },
      {
        id: 'q-1',
        at: ago(175),
        kind: 'new_product',
        label: 'Ибуфен сироп 100мл',
        amountMinor: null,
      },
    ],
    lastSyncAt: ago(130),
    deployment: 'cloud',
    counters: { store: 6, role: 1, employee: 1, audit: 12 },
  };
}
