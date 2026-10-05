import type { EmployeeProfile, ProfileStore } from './employee-auth.repository';
import {
  buildEmployeeSession,
  dbLanguage,
  idleTtlSeconds,
  roleDisplayName,
  sessionStoreMode,
  toRoleTemplateKey,
  uiLocale,
} from './session-profile';

// Mapping of database rows and the session record onto the EmployeeSession contract
// (libs/shared/dto tenant-auth.ts; auth design 2026-10-02, section 6).

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const EMPLOYEE = '0197a1b2-0000-7000-8000-000000000002';
const ROLE = '0197a1b2-0000-7000-8000-000000000003';
const STORE = '0197a1b2-0000-7000-8000-000000000004';

function profile(overrides: Partial<EmployeeProfile> = {}): EmployeeProfile {
  return {
    employee: {
      id: EMPLOYEE,
      fullName: 'Test employee',
      login: 'test.employee',
      phone: null,
      language: null,
    },
    role: {
      id: ROLE,
      name: { ru: 'Кассир', tj: 'Хазинадор' },
      isOwner: false,
      templateKey: 'cashier',
    },
    tenant: { id: TENANT, name: 'Test network' },
    settings: { defaultLanguage: 'ru', cashierSessionIdleMin: 15 },
    ...overrides,
  };
}

const store: ProfileStore = {
  id: STORE,
  name: 'Test store',
  address: 'Test address',
  mode: 'online',
};

describe('dbLanguage', () => {
  it('stores the Tajik UI locale as tj and Russian as ru', () => {
    expect(dbLanguage('tg')).toBe('tj');
    expect(dbLanguage('ru')).toBe('ru');
  });
});

describe('uiLocale', () => {
  it.each([
    ['ru', 'tj', 'ru'],
    ['tj', 'ru', 'tg'],
    [null, 'tj', 'tg'],
    [null, 'ru', 'ru'],
  ] as const)(
    'employee %s, network %s -> %s',
    (language, fallback, expected) => {
      expect(uiLocale(language, fallback)).toBe(expected);
    },
  );
});

describe('roleDisplayName', () => {
  it('takes the name in the session language', () => {
    expect(roleDisplayName({ ru: 'Кассир', tj: 'Хазинадор' }, 'tg')).toBe(
      'Хазинадор',
    );
    expect(roleDisplayName({ ru: 'Кассир', tj: 'Хазинадор' }, 'ru')).toBe(
      'Кассир',
    );
  });

  it('falls back to Russian, then to an empty string', () => {
    expect(roleDisplayName({ ru: 'Кассир' }, 'tg')).toBe('Кассир');
    expect(roleDisplayName({ en: 'Cashier' }, 'ru')).toBe('');
    expect(roleDisplayName(null, 'ru')).toBe('');
    expect(roleDisplayName({ ru: 42 }, 'ru')).toBe('');
  });
});

describe('sessionStoreMode', () => {
  it.each([
    ['online', 'cloud'],
    ['offline_pending', 'offline'],
    ['offline', 'offline'],
  ])('%s -> %s', (mode, expected) => {
    expect(sessionStoreMode(mode)).toBe(expected);
  });
});

describe('idleTtlSeconds', () => {
  it('converts minutes and clamps into [min, max]', () => {
    expect(idleTtlSeconds(15, 300, 43200)).toBe(900);
    expect(idleTtlSeconds(1, 300, 43200)).toBe(300);
    expect(idleTtlSeconds(10_000, 300, 43200)).toBe(43200);
  });
});

describe('toRoleTemplateKey', () => {
  it('keeps catalog template keys and drops anything else', () => {
    expect(toRoleTemplateKey('owner')).toBe('owner');
    expect(toRoleTemplateKey('accountant')).toBe('accountant');
    expect(toRoleTemplateKey(null)).toBeNull();
    expect(toRoleTemplateKey('legacy')).toBeNull();
  });
});

describe('buildEmployeeSession', () => {
  const view = {
    permissions: ['pos:view', 'catalog:view'] as const,
    storeScope: [STORE] as const,
    currentStoreId: STORE,
    auth: 'password' as const,
    authenticatedAt: '2026-10-02T09:00:00.000Z',
    terminalId: null,
    locale: 'tg' as const,
  };

  it('maps the profile, the stores and the session onto the contract', () => {
    expect(buildEmployeeSession(profile(), [store], view)).toEqual({
      employee: {
        id: EMPLOYEE,
        fullName: 'Test employee',
        login: 'test.employee',
        phone: '',
      },
      tenant: { id: TENANT, name: 'Test network' },
      role: {
        id: ROLE,
        name: 'Хазинадор',
        system: false,
        templateKey: 'cashier',
      },
      permissions: ['pos:view', 'catalog:view'],
      scope: 'stores',
      stores: [
        {
          id: STORE,
          name: 'Test store',
          address: 'Test address',
          mode: 'cloud',
        },
      ],
      currentStoreId: STORE,
      auth: 'password',
      authenticatedAt: '2026-10-02T09:00:00.000Z',
      terminalId: null,
      impersonation: null,
      locale: 'tg',
    });
  });

  it('marks the owner role as system and a whole-network scope as network', () => {
    const session = buildEmployeeSession(
      profile({
        role: {
          id: ROLE,
          name: { ru: 'Владелец' },
          isOwner: true,
          templateKey: 'owner',
        },
        employee: {
          id: EMPLOYEE,
          fullName: 'Owner',
          login: 'owner',
          phone: '+992900000001',
          language: 'ru',
        },
      }),
      [],
      { ...view, storeScope: 'all', currentStoreId: null, locale: 'ru' },
    );
    expect(session.role).toEqual({
      id: ROLE,
      name: 'Владелец',
      system: true,
      templateKey: 'owner',
    });
    expect(session.scope).toBe('network');
    expect(session.employee.phone).toBe('+992900000001');
    expect(session.stores).toEqual([]);
    expect(session.currentStoreId).toBeNull();
  });

  it('returns arrays the caller can not use to change the session view', () => {
    const permissions = ['pos:view'] as 'pos:view'[];
    const session = buildEmployeeSession(profile(), [store], {
      ...view,
      permissions,
    });
    expect(session.permissions).not.toBe(permissions);
  });
});
