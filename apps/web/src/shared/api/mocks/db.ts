/* Mutable in-memory database of the mocks; resetMockDb() restores the initial data set. */
import type {
  ActivityEntry,
  MyTerminal,
  TenantNotification,
} from '@pharmacy/shared-dto';
import { createCatalogDb, type CatalogMockDb } from './db-catalog';
import { createPosDb, type PosMockDb } from './db-pos';
import { createStockDb, type StockMockDb } from './db-stock';
import {
  MOCK_PASSWORD,
  boundTerminal,
  employees,
  type MockEmployee,
} from './fixtures';

export interface MockEmployeeState extends MockEmployee {
  password: string;
  pinFailures: number;
  pinLocked: boolean;
  lastLoginAt: string | null;
}

export interface MockDb {
  employees: MockEmployeeState[];
  /** Device-cookie of this browser: a bound terminal or none. */
  terminal: typeof boundTerminal | null;
  notifications: TenantNotification[];
  terminals: Record<string, MyTerminal[]>;
  activity: ActivityEntry[];
  pos: PosMockDb;
  stock: StockMockDb;
  catalog: CatalogMockDb;
}

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

function initialNotifications(): TenantNotification[] {
  return [
    {
      id: 'n-1',
      kind: 'batch_expiring',
      params: {
        productName: 'Нурофен 200 мг',
        batchNumber: 'N-4471',
        days: 12,
        quantity: 18,
        storeName: 'Аптека №2 · Сино',
      },
      createdAt: minutesAgo(40),
      read: false,
    },
    {
      id: 'n-2',
      kind: 'supplier_payment_due',
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
      params: { positions: 27 },
      createdAt: daysAgo(1),
      read: true,
    },
    {
      id: 'n-5',
      kind: 'license_expiring',
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

function initialActivity(): ActivityEntry[] {
  return [
    {
      id: 'a-1',
      at: minutesAgo(3),
      actorName: 'Зарина Р.',
      storeName: 'Аптека №3 · Рудаки',
      description: 'Продажа № 1041 · 86,50 с',
    },
    {
      id: 'a-2',
      at: minutesAgo(7),
      actorName: 'Манижа К.',
      storeName: 'Аптека №1 · Центр',
      description: 'Изменение цены · Витамин D3 → 65,00 с',
    },
    {
      id: 'a-3',
      at: minutesAgo(24),
      actorName: 'Фируз А.',
      storeName: null,
      description: 'Списание СП-000019 · истёк срок годности',
    },
    {
      id: 'a-4',
      at: minutesAgo(46),
      actorName: 'Далер С.',
      storeName: 'Аптека №2 · Сино',
      description: 'Возврат · чек № 0988',
    },
  ];
}

function createDb(): MockDb {
  const pos = createPosDb();
  return {
    employees: employees.map((employee) => ({
      ...employee,
      password: MOCK_PASSWORD,
      pinFailures: 0,
      pinLocked: false,
      lastLoginAt: daysAgo(1),
    })),
    terminal: { ...boundTerminal },
    notifications: initialNotifications(),
    terminals: initialTerminals(),
    activity: initialActivity(),
    pos,
    stock: createStockDb(pos.products),
    catalog: createCatalogDb(),
  };
}

let db: MockDb = createDb();

export function mockDb(): MockDb {
  return db;
}

export function resetMockDb(): void {
  db = createDb();
}
