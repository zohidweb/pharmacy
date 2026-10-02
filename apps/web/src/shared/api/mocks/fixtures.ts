/*
 * Synthetic data set of the mocks (UI mockups «Клиентский продукт»): network «Шифо», four stores,
 * employees with the base roles. No real people or clients; logins, passwords and PINs below
 * exist only in the mocks (apps/web/README.md).
 */
import type { RoleTemplateKey } from '@pharmacy/shared-domain';
import type { SessionStore, UiLocale } from '@pharmacy/shared-dto';

export const MOCK_PASSWORD = 'Demo1234';

export const tenant = { id: 'tenant-shifo', name: 'Шифо' };

/** Stores of the network; the mutable `stores` list is reset with the mock database. */
export const initialStores = (): SessionStore[] => [
  {
    id: 'store-1',
    name: 'Аптека №1 · Центр',
    address: 'пр. Рудаки, 44',
    mode: 'cloud',
  },
  {
    id: 'store-2',
    name: 'Аптека №2 · Сино',
    address: 'ул. Бухоро, 7',
    mode: 'cloud',
  },
  {
    id: 'store-3',
    name: 'Аптека №3 · Рудаки',
    address: 'ул. Рудаки, 12',
    mode: 'cloud',
  },
  {
    id: 'store-4',
    name: 'Аптека №4 · Вахдат',
    address: 'г. Вахдат, ул. Сомони, 3',
    mode: 'offline',
  },
];

export const stores: SessionStore[] = initialStores();

export interface MockEmployee {
  id: string;
  fullName: string;
  shortName: string;
  login: string;
  phone: string;
  role: RoleTemplateKey;
  /** null — the whole network. */
  storeIds: string[] | null;
  pin: string | null;
  locale: UiLocale;
  blocked?: boolean;
}

export const roleNames: Record<RoleTemplateKey, string> = {
  owner: 'Владелец',
  manager: 'Заведующий точкой',
  cashier: 'Фармацевт-кассир',
  accountant: 'Бухгалтер',
};

export const employees: MockEmployee[] = [
  {
    id: 'emp-owner',
    fullName: 'Фируз Ахмедов',
    shortName: 'Фируз А.',
    login: 'firuz',
    phone: '+992 90 111-22-33',
    role: 'owner',
    storeIds: null,
    pin: null,
    locale: 'ru',
  },
  {
    id: 'emp-manager',
    fullName: 'Манижа Каримова',
    shortName: 'Манижа К.',
    login: 'manizha',
    phone: '+992 92 400-55-10',
    role: 'manager',
    storeIds: ['store-1', 'store-3'],
    pin: '3690',
    locale: 'ru',
  },
  {
    id: 'emp-cashier',
    fullName: 'Зарина Рахимова',
    shortName: 'Зарина Р.',
    login: 'zarina',
    phone: '+992 93 220-77-04',
    role: 'cashier',
    storeIds: ['store-3'],
    pin: '2580',
    locale: 'tg',
  },
  {
    id: 'emp-cashier-2',
    fullName: 'Далер Сафаров',
    shortName: 'Далер С.',
    login: 'daler',
    phone: '+992 91 330-12-45',
    role: 'cashier',
    storeIds: ['store-2', 'store-3'],
    pin: '1470',
    locale: 'ru',
  },
  {
    id: 'emp-accountant',
    fullName: 'Наргис Исматова',
    shortName: 'Наргис И.',
    login: 'nargis',
    phone: '+992 90 808-31-22',
    role: 'accountant',
    storeIds: null,
    pin: null,
    locale: 'ru',
  },
  {
    id: 'emp-cashier-4',
    fullName: 'Нигина Расулова',
    shortName: 'Нигина Р.',
    login: 'nigina',
    phone: '+992 98 600-41-07',
    role: 'cashier',
    storeIds: ['store-4'],
    pin: '4815',
    locale: 'tg',
  },
  {
    id: 'emp-cashier-5',
    fullName: 'Рустам Назаров',
    shortName: 'Рустам Н.',
    login: 'rustam',
    phone: '+992 98 600-77-19',
    role: 'cashier',
    storeIds: ['store-4'],
    pin: null,
    locale: 'tg',
    blocked: true,
  },
];

/** Terminal of this browser in the mocks: bound to «Аптека №3». */
export const boundTerminal = {
  id: 'term-3-1',
  name: 'Касса 1 · Аптека №3',
  storeId: 'store-3',
};

/** Per-store figures of one day; periods scale them (mock only). */
export const storeDay: Record<
  string,
  { receipts: number; revenueMinor: number }
> = {
  'store-1': { receipts: 128, revenueMinor: 794_000 },
  'store-2': { receipts: 84, revenueMinor: 461_050 },
  'store-3': { receipts: 71, revenueMinor: 412_000 },
  'store-4': { receipts: 29, revenueMinor: 175_000 },
};
