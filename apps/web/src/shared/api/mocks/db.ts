/* Mutable in-memory database of the mocks; resetMockDb() restores the initial data set. */
import type { MyTerminal, TenantNotification } from '@pharmacy/shared-dto';

/**
 * A notification of the mocks: `read` — read by everybody at the start, `readBy` — the employees
 * who marked it read later (the API keeps a mark per employee, spec 2026-10-14-owner-cabinet, E12).
 */
export interface MockNotification extends TenantNotification {
  readBy: string[];
}
import { createCatalogDb, type CatalogMockDb } from './db-catalog';
import { createOwnerDb, type OwnerMockDb } from './db-owner';
import { createPosDb, type PosMockDb } from './db-pos';
import { createStockDb, type StockMockDb } from './db-stock';
import {
  MOCK_PASSWORD,
  boundTerminal,
  employees,
  initialStores,
  stores,
  type MockEmployee,
} from './fixtures';

export interface MockEmployeeState extends MockEmployee {
  password: string;
  pinFailures: number;
  pinLocked: boolean;
  lastLoginAt: string | null;
  roleId: string;
  status: 'active' | 'blocked';
}

export interface MockDb {
  employees: MockEmployeeState[];
  /** Device-cookie of this browser: a bound terminal or none. */
  terminal: typeof boundTerminal | null;
  notifications: MockNotification[];
  terminals: Record<string, MyTerminal[]>;
  pos: PosMockDb;
  stock: StockMockDb;
  catalog: CatalogMockDb;
  owner: OwnerMockDb;
}

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

function initialNotifications(): MockNotification[] {
  return [
    {
      id: 'n-1',
      kind: 'batch_expiring',
      storeId: 'store-2',
      readBy: [],
      params: {
        productName: 'Нурофен 200 мг',
        batchNumber: 'N-4471',
        days: 12,
        expiresOn: daysAgo(-12).slice(0, 10),
        quantity: 18,
        storeName: 'Аптека №2 · Сино',
      },
      createdAt: minutesAgo(40),
      read: false,
    },
    {
      id: 'n-2',
      kind: 'supplier_payment_due',
      storeId: 'store-1',
      readBy: [],
      params: {
        supplierName: 'Фарм-Импорт',
        dueDate: daysAgo(-4).slice(0, 10),
        amountMinor: 1_240_000,
      },
      createdAt: minutesAgo(75),
      read: false,
    },
    {
      id: 'n-3',
      kind: 'transfer_in_transit',
      storeId: 'store-3',
      readBy: [],
      params: {
        documentNumber: 'ПМ-000045',
        fromStore: 'Центральный склад',
        toStore: 'Аптека №3 · Рудаки',
        positions: 14,
      },
      createdAt: daysAgo(1),
      read: false,
    },
    {
      id: 'n-4',
      kind: 'low_stock',
      storeId: 'store-1',
      readBy: [],
      params: { positions: 27, storeName: 'Аптека №1 · Центр' },
      createdAt: daysAgo(1),
      read: true,
    },
    {
      id: 'n-5',
      kind: 'license_expiring',
      storeId: 'store-4',
      readBy: [],
      params: { storeName: 'Аптека №4 · Вахдат', days: 9 },
      createdAt: daysAgo(2),
      read: true,
    },
  ];
}

function initialTerminals(): Record<string, MyTerminal[]> {
  const own = (employeeId: string): MyTerminal[] => [
    {
      id: boundTerminal.id,
      name: boundTerminal.name,
      storeName: 'Аптека №3 · Рудаки',
      boundAt: daysAgo(108),
      lastSeenAt: minutesAgo(5),
      current: true,
    },
    ...(employeeId === 'emp-owner'
      ? [
          {
            id: 'term-office',
            name: 'ПК владельца · Windows 11',
            storeName: null,
            boundAt: daysAgo(76),
            lastSeenAt: daysAgo(1),
            current: false,
          },
        ]
      : []),
  ];
  return Object.fromEntries(employees.map((e) => [e.id, own(e.id)]));
}

function createDb(): MockDb {
  // the store list is shared by reference with the handlers: reset it in place
  stores.splice(0, stores.length, ...initialStores());
  const pos = createPosDb();
  return {
    employees: employees.map((employee) => ({
      ...employee,
      password: MOCK_PASSWORD,
      pinFailures: 0,
      pinLocked: false,
      lastLoginAt: daysAgo(1),
      roleId: `role-${employee.role}`,
      status: employee.blocked ? 'blocked' : 'active',
    })),
    terminal: { ...boundTerminal },
    notifications: initialNotifications(),
    terminals: initialTerminals(),
    pos,
    stock: createStockDb(pos.products),
    catalog: createCatalogDb(),
    owner: createOwnerDb(),
  };
}

let db: MockDb = createDb();

export function mockDb(): MockDb {
  return db;
}

export function resetMockDb(): void {
  db = createDb();
}
