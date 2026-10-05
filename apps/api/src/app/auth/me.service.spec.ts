import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type EmployeePrincipal,
  getRequestContext,
  requireTenantId,
  runWithContext,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import type { PasswordHasher, SessionTokenService } from '../../core/crypto';
import type { TenantDatabase, TenantTransaction } from '../../core/database';
import {
  SessionStore,
  type SessionPatch,
  type SessionRecord,
} from '../../core/sessions';
import type { AuditEvent, AuditService } from '../audit/audit.service';
import type {
  EmployeeAuthRepository,
  EmployeeProfile,
  LoginCredentials,
  ProfileStore,
} from './employee-auth.repository';
import { MeService } from './me.service';

// MeService (auth design 2026-10-02, section 6): the own profile, the interface language and the
// password change, with fakes of the database, the repository, the hasher, the token service, the
// session store and the audit.

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const EMPLOYEE = '0197a1b2-0000-7000-8000-000000000002';
const ROLE = '0197a1b2-0000-7000-8000-000000000003';
const STORE_1 = '0197a1b2-0000-7000-8000-000000000011';
const STORE_2 = '0197a1b2-0000-7000-8000-000000000012';
const OLD_SESSION = '0197a1b2-0000-7000-8000-000000000021';
const CURRENT = 'current correct horse';
const NEXT = 'Correct1horse';
const T0 = Date.parse('2026-10-05T09:00:00.000Z');
const LAST_LOGIN = new Date('2026-10-04T18:30:00.000Z');

const config = new ConfigService({ SESSION_ABSOLUTE_TTL_SECONDS: 43200 });

function principal(
  overrides: Partial<EmployeePrincipal> = {},
): EmployeePrincipal {
  return {
    kind: 'employee',
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    sessionId: OLD_SESSION,
    auth: 'password',
    authenticatedAt: '2026-10-05T08:50:00.000Z',
    permissions: ['pos:view'],
    storeScope: [STORE_1, STORE_2],
    currentStoreId: STORE_1,
    terminalId: null,
    locale: 'ru',
    ...overrides,
  };
}

function profile(overrides: Partial<EmployeeProfile> = {}): EmployeeProfile {
  return {
    employee: {
      id: EMPLOYEE,
      fullName: 'Farida R.',
      login: 'farida.r',
      phone: '+992900000101',
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

const oldRecord: SessionRecord = {
  sessionId: OLD_SESSION,
  tenantId: TENANT,
  employeeId: EMPLOYEE,
  auth: 'password',
  authenticatedAt: '2026-10-05T08:50:00.000Z',
  permissions: ['pos:view'],
  permissionsVersion: 4,
  storeScope: [STORE_1, STORE_2],
  currentStoreId: STORE_1,
  terminalId: null,
  terminalCredentialHash: null,
  locale: 'ru',
  idleTtlSeconds: 900,
  absoluteExpiresAt: '2026-10-05T20:50:00.000Z',
};

function store(id: string, name: string): ProfileStore {
  return { id, name, address: `${name} address`, mode: 'online' };
}

// Every transaction gets its own trx object; `open` tells whether work runs inside one.
class FakeTenantDatabase {
  readonly tenants: string[] = [];
  readonly trxs: TenantTransaction[] = [];
  open = 0;

  async tenantTransaction<T>(
    work: (trx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    this.tenants.push(requireTenantId());
    const trx = { trxId: this.trxs.length + 1 } as unknown as TenantTransaction;
    this.trxs.push(trx);
    this.open++;
    try {
      return await work(trx);
    } finally {
      this.open--;
    }
  }
}

class FakeSessionStore extends SessionStore {
  readonly events: string[] = [];
  readonly created: SessionRecord[] = [];
  readonly createdInTransaction: boolean[] = [];
  readonly updates: [string, SessionPatch][] = [];
  readonly destroyed: string[] = [];
  readonly destroyedAll: [string, string, string | undefined][] = [];
  readonly openAtDestroy: number[] = [];
  failCreate = false;
  failDestroy = false;
  failDestroyAll = false;
  found: SessionRecord | null = oldRecord;

  constructor(private readonly db: FakeTenantDatabase) {
    super();
  }

  async create(record: SessionRecord): Promise<void> {
    if (this.failCreate) throw new Error('redis down');
    this.events.push('create');
    this.createdInTransaction.push(this.db.open > 0);
    this.created.push(record);
  }
  async lookup(sessionId: string) {
    this.events.push(`lookup:${sessionId}`);
    return { session: this.found, permissionsVersion: 4 };
  }
  async update(sessionId: string, patch: SessionPatch): Promise<void> {
    this.updates.push([sessionId, patch]);
  }
  async touch(): Promise<void> {
    throw new Error('not used');
  }
  async destroy(sessionId: string): Promise<void> {
    this.openAtDestroy.push(this.db.open);
    if (this.failDestroy) throw new Error('redis down');
    this.events.push(`destroy:${sessionId}`);
    this.destroyed.push(sessionId);
  }
  async destroyAllFor(
    tenantId: string,
    employeeId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    this.openAtDestroy.push(this.db.open);
    if (this.failDestroyAll) throw new Error('redis down');
    this.events.push('destroyAll');
    this.destroyedAll.push([tenantId, employeeId, exceptSessionId]);
  }
}

interface RecordedAudit {
  trx: TenantTransaction;
  event: AuditEvent;
  tenantId: string | undefined;
}

function setup() {
  const db = new FakeTenantDatabase();
  const credentials: LoginCredentials = {
    status: 'active',
    passwordHash: '$scrypt$stored',
    passwordPepperVersion: 1,
  };
  let stores: ProfileStore[] = [
    store(STORE_1, 'Store one'),
    store(STORE_2, 'Store two'),
  ];
  const repository = {
    findCredentials: jest.fn(
      async () => credentials as LoginCredentials | null,
    ),
    loadProfile: jest.fn(async () => profile() as EmployeeProfile | null),
    loadMeExtras: jest.fn(
      async () =>
        ({ lastLoginAt: LAST_LOGIN, pinSet: true }) as {
          lastLoginAt: Date | null;
          pinSet: boolean;
        } | null,
    ),
    activeStores: jest.fn(async () => stores),
    updateLanguage: jest.fn(async () => undefined),
    changePassword: jest.fn(async () => true),
  };
  const hasher = {
    verify: jest.fn(async (secret: string) => secret === CURRENT),
    hash: jest.fn(async () => ({ phc: '$scrypt$fresh', pepperVersion: 2 })),
  };
  const tokens = { sign: jest.fn(async () => 'signed.jwt.token') };
  const sessions = new FakeSessionStore(db);
  const audits: RecordedAudit[] = [];
  const audit = {
    append: jest.fn(async (trx: TenantTransaction, event: AuditEvent) => {
      audits.push({ trx, event, tenantId: getRequestContext()?.tenantId });
    }),
  };
  const service = new MeService(
    db as unknown as TenantDatabase,
    repository as unknown as EmployeeAuthRepository,
    hasher as unknown as PasswordHasher,
    tokens as unknown as SessionTokenService,
    sessions,
    audit as unknown as AuditService,
    config,
  );
  return {
    service,
    db,
    repository,
    hasher,
    tokens,
    sessions,
    audit,
    audits,
    setStores: (next: ProfileStore[]) => {
      stores = next;
    },
  };
}

const asEmployee = <T>(
  fn: () => Promise<T>,
  who: EmployeePrincipal = principal(),
) =>
  runWithContext(
    { correlationId: 'corr-me-1', tenantId: TENANT, principal: who },
    fn,
  );

async function problemOf(promise: Promise<unknown>): Promise<ProblemException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error('expected a ProblemException');
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(T0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MeService.get', () => {
  it('builds EmployeeMe from the database and the session', async () => {
    const t = setup();

    const me = await asEmployee(() => t.service.get());

    expect(me).toEqual({
      id: EMPLOYEE,
      fullName: 'Farida R.',
      login: 'farida.r',
      phone: '+992900000101',
      roleName: 'Кассир',
      scope: 'stores',
      storeNames: ['Store one', 'Store two'],
      lastLoginAt: '2026-10-04T18:30:00.000Z',
      locale: 'ru',
      pinSet: true,
    });
    expect(t.repository.loadProfile).toHaveBeenCalledWith(
      t.db.trxs[0],
      TENANT,
      EMPLOYEE,
    );
    expect(t.repository.activeStores).toHaveBeenCalledWith(
      t.db.trxs[0],
      TENANT,
      [STORE_1, STORE_2],
    );
  });

  it('names the role in the session language and reports the whole network for scope all', async () => {
    const t = setup();

    const me = await asEmployee(
      () => t.service.get(),
      principal({ locale: 'tg', storeScope: 'all' }),
    );

    expect(me.roleName).toBe('Хазинадор');
    expect(me.scope).toBe('network');
    expect(me.locale).toBe('tg');
    expect(t.repository.activeStores).toHaveBeenCalledWith(
      t.db.trxs[0],
      TENANT,
      'all',
    );
  });

  it('reports no PIN, no last sign-in and an empty phone as they are', async () => {
    const t = setup();
    t.repository.loadMeExtras.mockResolvedValue({
      lastLoginAt: null,
      pinSet: false,
    });
    t.repository.loadProfile.mockResolvedValue(
      profile({
        employee: {
          id: EMPLOYEE,
          fullName: 'Farida R.',
          login: 'farida.r',
          phone: null,
          language: null,
        },
      }),
    );

    const me = await asEmployee(() => t.service.get());

    expect(me.lastLoginAt).toBeNull();
    expect(me.pinSet).toBe(false);
    expect(me.phone).toBe('');
  });

  it('answers 401 unauthenticated when the employee of the session is gone', async () => {
    const t = setup();
    t.repository.loadProfile.mockResolvedValue(null);

    const problem = await problemOf(asEmployee(() => t.service.get()));

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('unauthenticated');
  });
});

describe('MeService.updateLocale', () => {
  it('stores the language of the employee (tg is tj in the database) and the session locale', async () => {
    const t = setup();

    const me = await asEmployee(() => t.service.updateLocale('tg'));

    expect(t.repository.updateLanguage).toHaveBeenCalledWith(
      t.db.trxs[0],
      TENANT,
      EMPLOYEE,
      'tj',
    );
    expect(t.sessions.updates).toEqual([[OLD_SESSION, { locale: 'tg' }]]);
    expect(me.locale).toBe('tg');
    expect(me.roleName).toBe('Хазинадор');
  });

  it('stores ru as ru', async () => {
    const t = setup();

    await asEmployee(
      () => t.service.updateLocale('ru'),
      principal({ locale: 'tg' }),
    );

    expect(t.repository.updateLanguage).toHaveBeenCalledWith(
      t.db.trxs[0],
      TENANT,
      EMPLOYEE,
      'ru',
    );
    expect(t.sessions.updates).toEqual([[OLD_SESSION, { locale: 'ru' }]]);
  });
});

describe('MeService.changePassword — rejections', () => {
  it('answers 401 invalid_credentials for a wrong current password and changes nothing', async () => {
    const t = setup();

    const problem = await problemOf(
      asEmployee(() => t.service.changePassword('not the password', NEXT)),
    );

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_credentials');
    expect(t.hasher.verify).toHaveBeenCalledWith(
      'not the password',
      '$scrypt$stored',
      1,
    );
    expect(t.hasher.hash).not.toHaveBeenCalled();
    expect(t.repository.changePassword).not.toHaveBeenCalled();
    expect(t.audit.append).not.toHaveBeenCalled();
    expect(t.sessions.created).toEqual([]);
    expect(t.sessions.destroyed).toEqual([]);
    expect(t.sessions.destroyedAll).toEqual([]);
    expect(t.tokens.sign).not.toHaveBeenCalled();
  });

  it('answers 401 invalid_credentials when the employee has no password', async () => {
    const t = setup();
    t.repository.findCredentials.mockResolvedValue({
      status: 'active',
      passwordHash: null,
      passwordPepperVersion: null,
    });

    const problem = await problemOf(
      asEmployee(() => t.service.changePassword(CURRENT, NEXT)),
    );

    expect(problem.code).toBe('invalid_credentials');
    expect(t.hasher.verify).not.toHaveBeenCalled();
  });

  it('answers 401 unauthenticated when the employee of the session is gone', async () => {
    const t = setup();
    t.repository.findCredentials.mockResolvedValue(null);

    const problem = await problemOf(
      asEmployee(() => t.service.changePassword(CURRENT, NEXT)),
    );

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('unauthenticated');
  });

  it('answers 422 password_policy after the current password was verified', async () => {
    const t = setup();

    const problem = await problemOf(
      asEmployee(() => t.service.changePassword(CURRENT, 'short')),
    );

    expect(problem.getStatus()).toBe(422);
    expect(problem.code).toBe('password_policy');
    expect(t.hasher.verify).toHaveBeenCalledTimes(1);
    expect(t.hasher.hash).not.toHaveBeenCalled();
    expect(t.repository.changePassword).not.toHaveBeenCalled();
    expect(t.audit.append).not.toHaveBeenCalled();
    expect(t.sessions.destroyedAll).toEqual([]);
  });

  it('checks the current password before the policy: a wrong current password wins over a weak new one', async () => {
    const t = setup();

    const problem = await problemOf(
      asEmployee(() => t.service.changePassword('wrong', 'short')),
    );

    expect(problem.code).toBe('invalid_credentials');
  });

  it('answers 401 unauthenticated when the session record is already gone', async () => {
    const t = setup();
    t.sessions.found = null;

    const problem = await problemOf(
      asEmployee(() => t.service.changePassword(CURRENT, NEXT)),
    );

    expect(problem.code).toBe('unauthenticated');
    expect(t.repository.changePassword).not.toHaveBeenCalled();
    expect(t.sessions.created).toEqual([]);
  });

  it('answers 409 when the password changed meanwhile and leaves every session alone', async () => {
    const t = setup();
    t.repository.changePassword.mockResolvedValue(false);

    const problem = await problemOf(
      asEmployee(() => t.service.changePassword(CURRENT, NEXT)),
    );

    expect(problem.getStatus()).toBe(409);
    expect(t.audit.append).not.toHaveBeenCalled();
    expect(t.sessions.created).toEqual([]);
    expect(t.sessions.destroyed).toEqual([]);
    expect(t.sessions.destroyedAll).toEqual([]);
  });
});

describe('MeService.changePassword — success', () => {
  it('hashes the new password outside any transaction and stores it guarded by the verified hash', async () => {
    const t = setup();
    let openAtHash = -1;
    t.hasher.hash.mockImplementation(async () => {
      openAtHash = t.db.open;
      return { phc: '$scrypt$fresh', pepperVersion: 2 };
    });

    await asEmployee(() => t.service.changePassword(CURRENT, NEXT));

    expect(t.hasher.hash).toHaveBeenCalledWith(NEXT);
    expect(openAtHash).toBe(0);
    expect(t.repository.changePassword.mock.calls[0]).toEqual([
      t.db.trxs[t.db.trxs.length - 1],
      TENANT,
      EMPLOYEE,
      '$scrypt$stored',
      { phc: '$scrypt$fresh', pepperVersion: 2 },
    ]);
  });

  it('writes the hash, the audit and the new session in one transaction, the session last', async () => {
    const t = setup();
    const order: string[] = [];
    t.repository.changePassword.mockImplementation(async () => {
      order.push('hash');
      return true;
    });
    t.audit.append.mockImplementation(async () => {
      order.push('audit');
    });
    const create = t.sessions.create.bind(t.sessions);
    t.sessions.create = async (record) => {
      order.push('session');
      await create(record);
    };

    await asEmployee(() => t.service.changePassword(CURRENT, NEXT));

    expect(order).toEqual(['hash', 'audit', 'session']);
    expect(t.sessions.createdInTransaction).toEqual([true]);
  });

  it('records auth.password-changed in the same transaction, without any secret', async () => {
    const t = setup();

    await asEmployee(() => t.service.changePassword(CURRENT, NEXT));

    const [changeTrx] = t.repository.changePassword.mock.calls[0] as unknown[];
    expect(t.audits).toHaveLength(1);
    expect(t.audits[0].trx).toBe(changeTrx);
    expect(t.audits[0].tenantId).toBe(TENANT);
    expect(t.audits[0].event).toEqual({
      action: 'auth.password-changed',
      entityType: 'employee',
      entityId: EMPLOYEE,
    });
  });

  it('rotates the session: a new record from the old one, a new token and the cookie lifetime', async () => {
    const t = setup();

    const result = await asEmployee(() =>
      t.service.changePassword(CURRENT, NEXT),
    );

    const [created] = t.sessions.created;
    expect(created.sessionId).not.toBe(OLD_SESSION);
    expect(created).toEqual({
      ...oldRecord,
      sessionId: created.sessionId,
      authenticatedAt: new Date(T0).toISOString(),
      absoluteExpiresAt: new Date(T0 + 43200 * 1000).toISOString(),
    });
    expect(t.tokens.sign).toHaveBeenCalledWith(
      { jti: created.sessionId, sub: EMPLOYEE, tid: TENANT, aud: 'web' },
      43200,
    );
    expect(result).toEqual({ token: 'signed.jwt.token', maxAgeSeconds: 43200 });
  });

  it('after the commit destroys the old session and every other session except the new one', async () => {
    const t = setup();

    await asEmployee(() => t.service.changePassword(CURRENT, NEXT));

    const [created] = t.sessions.created;
    expect(t.sessions.destroyed).toEqual([OLD_SESSION]);
    expect(t.sessions.destroyedAll).toEqual([
      [TENANT, EMPLOYEE, created.sessionId],
    ]);
    expect(t.sessions.openAtDestroy).toEqual([0, 0]);
    expect(t.sessions.events.indexOf('create')).toBeLessThan(
      t.sessions.events.indexOf(`destroy:${OLD_SESSION}`),
    );
  });

  it('destroys nothing when the transaction fails, so the old sessions stay valid', async () => {
    const t = setup();
    t.audit.append.mockRejectedValue(new Error('audit down'));

    await expect(
      asEmployee(() => t.service.changePassword(CURRENT, NEXT)),
    ).rejects.toThrow('audit down');

    expect(t.sessions.created).toEqual([]);
    expect(t.sessions.destroyed).toEqual([]);
    expect(t.sessions.destroyedAll).toEqual([]);
  });

  it('fails (rolling the password back) when the new session cannot be stored', async () => {
    const t = setup();
    t.sessions.failCreate = true;

    await expect(
      asEmployee(() => t.service.changePassword(CURRENT, NEXT)),
    ).rejects.toThrow('redis down');

    expect(t.sessions.destroyed).toEqual([]);
    expect(t.sessions.destroyedAll).toEqual([]);
  });

  it('logs a failed destruction with the correlation id and still succeeds', async () => {
    const t = setup();
    t.sessions.failDestroy = true;
    t.sessions.failDestroyAll = true;
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const result = await asEmployee(() =>
      t.service.changePassword(CURRENT, NEXT),
    );

    expect(result.token).toBe('signed.jwt.token');
    expect(error).toHaveBeenCalledTimes(2);
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).toContain('corr-me-1');
    expect(logged).not.toContain(NEXT);
    expect(logged).not.toContain(CURRENT);
    expect(logged).not.toContain('signed.jwt.token');
  });

  it('still tries the other sessions when the old one could not be destroyed', async () => {
    const t = setup();
    t.sessions.failDestroy = true;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await asEmployee(() => t.service.changePassword(CURRENT, NEXT));

    expect(t.sessions.destroyedAll).toHaveLength(1);
  });
});
