import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Permission, permissions } from '@pharmacy/shared-domain';
import {
  type EmployeePrincipal,
  getRequestContext,
  requireTenantId,
  runWithContext,
  UnauthenticatedError,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import type { PasswordHasher, SessionTokenService } from '../../core/crypto';
import type {
  ContextResolvers,
  TenantDatabase,
  TenantTransaction,
} from '../../core/database';
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
import { LoginClock } from './login-clock';
import { type LoginLimiter, loginLimiterKey } from './login-limiter';
import type { PrincipalLoader, PrincipalSnapshot } from './principal-loader';
import { SessionsService } from './sessions.service';

// SessionsService (auth design 2026-10-02, section 6) with fakes of the resolver, the repository,
// the hasher, the session store, the token service, the limiter, the loader and the audit.

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const EMPLOYEE = '0197a1b2-0000-7000-8000-000000000002';
const ROLE = '0197a1b2-0000-7000-8000-000000000003';
const STORE_1 = '0197a1b2-0000-7000-8000-000000000011';
const STORE_2 = '0197a1b2-0000-7000-8000-000000000012';
const SESSION = '0197a1b2-0000-7000-8000-000000000021';
const PASSWORD = 'correct horse battery';
const IP = '192.0.2.10';
const T0 = Date.parse('2026-10-02T09:00:00.000Z');
const KEY = loginLimiterKey('login', 'farida.r');

const config = new ConfigService({
  SESSION_IDLE_TIMEOUT_MIN_SECONDS: 300,
  SESSION_IDLE_TIMEOUT_MAX_SECONDS: 43200,
  SESSION_ABSOLUTE_TTL_SECONDS: 43200,
  LOGIN_FAILURE_FLOOR_MS: 400,
});

const JITTER_MS = 7;
const FLOOR_MS = 400 + JITTER_MS;

// A manual clock: sleep() records the wait and moves the time forward instantly.
class FakeClock extends LoginClock {
  time = 1_000;
  readonly sleeps: number[] = [];

  now(): number {
    return this.time;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }
  jitterMs(): number {
    return JITTER_MS;
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

function store(id: string, name: string): ProfileStore {
  return { id, name, address: `${name} address`, mode: 'online' };
}

function employeeProfile(
  overrides: Partial<EmployeeProfile> = {},
): EmployeeProfile {
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
    settings: { defaultLanguage: 'tj', cashierSessionIdleMin: 15 },
    ...overrides,
  };
}

// Emulates TenantDatabase.tenantTransaction: the tenant must be in the request context; every
// transaction gets its own trx object, so a test can tell which calls shared one.
class FakeTenantDatabase {
  readonly tenants: string[] = [];
  open = 0;
  private next = 0;

  async tenantTransaction<T>(
    work: (trx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    this.tenants.push(requireTenantId());
    const trx = { trxId: ++this.next } as unknown as TenantTransaction;
    this.open++;
    try {
      return await work(trx);
    } finally {
      this.open--;
    }
  }
}

class FakeSessionStore extends SessionStore {
  readonly created: SessionRecord[] = [];
  readonly updates: [string, SessionPatch][] = [];
  readonly destroyed: string[] = [];
  readonly createdInTransaction: boolean[] = [];
  failCreate = false;

  constructor(private readonly db: FakeTenantDatabase) {
    super();
  }

  async create(record: SessionRecord): Promise<void> {
    if (this.failCreate) throw new Error('redis down');
    this.createdInTransaction.push(this.db.open > 0);
    this.created.push(record);
  }
  async lookup(): Promise<never> {
    throw new Error('not used');
  }
  async update(sessionId: string, patch: SessionPatch): Promise<void> {
    this.updates.push([sessionId, patch]);
  }
  async touch(): Promise<void> {
    throw new Error('not used');
  }
  async destroy(sessionId: string): Promise<void> {
    this.destroyed.push(sessionId);
  }
  async destroyAllFor(): Promise<void> {
    throw new Error('not used');
  }
}

interface RecordedAudit {
  trx: TenantTransaction;
  event: AuditEvent;
  tenantId: string | undefined;
  principal: unknown;
  correlationId: string | undefined;
}

function setup() {
  const resolvers = {
    resolveLogin: jest.fn().mockResolvedValue({
      tenantId: TENANT,
      employeeId: EMPLOYEE,
      tenantStatus: 'active',
    }),
  };
  const db = new FakeTenantDatabase();
  const credentials: LoginCredentials = {
    status: 'active',
    passwordHash: '$scrypt$stored',
    passwordPepperVersion: 1,
  };
  let stores: ProfileStore[] = [store(STORE_1, 'Store one')];
  const repository = {
    findCredentials: jest.fn(
      async () => credentials as LoginCredentials | null,
    ),
    loadProfile: jest.fn(
      async () => employeeProfile() as EmployeeProfile | null,
    ),
    activeStores: jest.fn(async () => stores),
    recordLogin: jest.fn(async () => undefined),
    updatePasswordHash: jest.fn(async () => undefined),
  };
  const snapshot: PrincipalSnapshot = {
    status: 'active',
    permissions: ['pos:view', 'catalog:view'],
    storeScope: [STORE_1],
    permissionsVersion: 4,
  };
  const loader = {
    reload: jest.fn(async () => snapshot as PrincipalSnapshot | null),
  };
  const hasher = {
    verify: jest.fn(async (secret: string) => secret === PASSWORD),
    verifyDummy: jest.fn(async () => false as const),
    needsRehash: jest.fn(() => false),
    hash: jest.fn(async () => ({ phc: '$scrypt$fresh', pepperVersion: 2 })),
  };
  const tokens = { sign: jest.fn(async () => 'signed.jwt.token') };
  const sessions = new FakeSessionStore(db);
  const limiter = {
    tryAcquire: jest.fn(
      async () =>
        ({ allowed: true }) as
          { allowed: true } | { allowed: false; retryAfterSeconds: number },
    ),
    reset: jest.fn(async () => undefined),
  };
  const clock = new FakeClock();
  const audits: RecordedAudit[] = [];
  const audit = {
    append: jest.fn(async (trx: TenantTransaction, event: AuditEvent) => {
      const context = getRequestContext();
      audits.push({
        trx,
        event,
        tenantId: context?.tenantId,
        principal: context?.principal,
        correlationId: context?.correlationId,
      });
    }),
  };

  const service = new SessionsService(
    resolvers as unknown as ContextResolvers,
    db as unknown as TenantDatabase,
    repository as unknown as EmployeeAuthRepository,
    loader as unknown as PrincipalLoader,
    hasher as unknown as PasswordHasher,
    tokens as unknown as SessionTokenService,
    sessions,
    limiter as unknown as LoginLimiter,
    audit as unknown as AuditService,
    clock,
    config,
  );

  return {
    service,
    resolvers,
    db,
    credentials,
    repository,
    snapshot,
    loader,
    hasher,
    tokens,
    sessions,
    limiter,
    clock,
    audit,
    audits,
    setStores: (next: ProfileStore[]) => {
      stores = next;
    },
  };
}

const inRequest = <T>(fn: () => Promise<T>, correlationId = 'corr-login-1') =>
  runWithContext({ correlationId, principal: null }, fn);

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

describe('SessionsService.login — failures', () => {
  it('rejects an identifier that cannot be normalized with a dummy check, without the limiter', async () => {
    const t = setup();

    const problem = await problemOf(
      inRequest(() => t.service.login('two words', PASSWORD, IP)),
    );

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_credentials');
    expect(t.hasher.verifyDummy).toHaveBeenCalledWith(PASSWORD);
    expect(t.limiter.tryAcquire).not.toHaveBeenCalled();
    expect(t.resolvers.resolveLogin).not.toHaveBeenCalled();
  });

  it('answers an unknown identifier like a wrong password: dummy check, failure recorded, app log only', async () => {
    const t = setup();
    t.resolvers.resolveLogin.mockResolvedValue(null);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const problem = await problemOf(
      inRequest(() => t.service.login(' Farida.R ', PASSWORD, IP)),
    );

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_credentials');
    expect(t.resolvers.resolveLogin).toHaveBeenCalledWith('login', 'farida.r');
    expect(t.hasher.verifyDummy).toHaveBeenCalledWith(PASSWORD);
    expect(t.hasher.verify).not.toHaveBeenCalled();
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(KEY);
    expect(t.limiter.tryAcquire.mock.invocationCallOrder[0]).toBeLessThan(
      t.hasher.verifyDummy.mock.invocationCallOrder[0],
    );
    expect(t.audit.append).not.toHaveBeenCalled();
    expect(t.db.tenants).toEqual([]);
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged.toLowerCase()).not.toContain('farida');
    expect(logged).not.toContain(PASSWORD);
    expect(logged).toContain('corr-login-1');
  });

  it('rejects a wrong password: failure recorded and audited in the tenant, no session', async () => {
    const t = setup();

    const problem = await problemOf(
      inRequest(() => t.service.login('farida.r', 'wrong', IP)),
    );

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_credentials');
    expect(t.hasher.verify).toHaveBeenCalledWith('wrong', '$scrypt$stored', 1);
    // The attempt is reserved before the password is hashed.
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(KEY);
    expect(t.limiter.tryAcquire.mock.invocationCallOrder[0]).toBeLessThan(
      t.hasher.verify.mock.invocationCallOrder[0],
    );
    expect(t.limiter.reset).not.toHaveBeenCalled();
    expect(t.sessions.created).toEqual([]);
    expect(t.tokens.sign).not.toHaveBeenCalled();
    expect(t.audits).toHaveLength(1);
    expect(t.audits[0]).toMatchObject({
      tenantId: TENANT,
      principal: null,
      correlationId: 'corr-login-1',
      event: {
        action: 'auth.login-failed',
        entityType: 'employee',
        entityId: EMPLOYEE,
        details: { reason: 'invalid_password', ip: IP },
      },
    });
    expect(JSON.stringify(t.audits[0].event)).not.toContain('wrong');
  });

  it('checks a dummy hash when the employee has no password yet', async () => {
    const t = setup();
    t.credentials.passwordHash = null;
    t.credentials.passwordPepperVersion = null;

    const problem = await problemOf(
      inRequest(() => t.service.login('farida.r', PASSWORD, IP)),
    );

    expect(problem.code).toBe('invalid_credentials');
    expect(t.hasher.verifyDummy).toHaveBeenCalledWith(PASSWORD);
    expect(t.hasher.verify).not.toHaveBeenCalled();
    expect(t.audits[0].event.details).toMatchObject({ reason: 'no_password' });
  });

  it('rejects a blocked network even with the right password, after the same password check', async () => {
    const t = setup();
    t.resolvers.resolveLogin.mockResolvedValue({
      tenantId: TENANT,
      employeeId: EMPLOYEE,
      tenantStatus: 'blocked',
    });

    const problem = await problemOf(
      inRequest(() => t.service.login('farida.r', PASSWORD, IP)),
    );

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_credentials');
    expect(t.hasher.verify).toHaveBeenCalled();
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(KEY);
    expect(t.limiter.reset).not.toHaveBeenCalled();
    expect(t.sessions.created).toEqual([]);
    expect(t.audits[0].event).toMatchObject({
      action: 'auth.login-failed',
      details: { reason: 'tenant_blocked' },
    });
  });

  it.each(['blocked', 'archived'])(
    'rejects an employee with status %s',
    async (status) => {
      const t = setup();
      t.credentials.status = status;

      const problem = await problemOf(
        inRequest(() => t.service.login('farida.r', PASSWORD, IP)),
      );

      expect(problem.getStatus()).toBe(401);
      expect(problem.code).toBe('invalid_credentials');
      expect(t.sessions.created).toEqual([]);
      expect(t.audits[0].event.details).toMatchObject({
        reason: 'employee_inactive',
      });
    },
  );

  it('rejects when the employee was blocked between the password check and the snapshot', async () => {
    const t = setup();
    t.loader.reload.mockResolvedValue({ ...t.snapshot, status: 'blocked' });

    const problem = await problemOf(
      inRequest(() => t.service.login('farida.r', PASSWORD, IP)),
    );

    expect(problem.code).toBe('invalid_credentials');
    expect(t.sessions.created).toEqual([]);
  });

  it('answers 429 login_locked for a refused attempt before any hashing, without the floor', async () => {
    const t = setup();
    t.limiter.tryAcquire.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 840,
    });

    const problem = await problemOf(
      inRequest(() => t.service.login('Farida.R', PASSWORD, IP)),
    );

    expect(problem.getStatus()).toBe(429);
    expect(problem.code).toBe('login_locked');
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(KEY);
    expect(t.hasher.verify).not.toHaveBeenCalled();
    expect(t.hasher.verifyDummy).not.toHaveBeenCalled();
    expect(t.resolvers.resolveLogin).not.toHaveBeenCalled();
    expect(t.clock.sleeps).toEqual([]);
  });

  it('still answers 401 when writing the failure audit fails', async () => {
    const t = setup();
    t.audit.append.mockRejectedValueOnce(new Error('db down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const problem = await problemOf(
      inRequest(() => t.service.login('farida.r', 'wrong', IP)),
    );

    expect(problem.code).toBe('invalid_credentials');
  });
});

describe('SessionsService.login — failure floor', () => {
  const elapsed = (t: ReturnType<typeof setup>, start: number) =>
    t.clock.now() - start;

  it.each([
    ['an unnormalizable identifier', 'two words', PASSWORD],
    ['an unknown identifier', 'farida.r', PASSWORD],
    ['a wrong password', 'farida.r', 'wrong'],
  ])(
    'pads %s to the floor plus jitter from the start of login()',
    async (name, login, password) => {
      const t = setup();
      if (name === 'an unknown identifier') {
        t.resolvers.resolveLogin.mockResolvedValue(null);
      }
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      // The work before the answer takes 120 ms of the clock.
      t.hasher.verify.mockImplementation(async (secret: string) => {
        t.clock.advance(120);
        return secret === PASSWORD;
      });
      t.hasher.verifyDummy.mockImplementation(async () => {
        t.clock.advance(120);
        return false;
      });
      const start = t.clock.now();

      const problem = await problemOf(
        inRequest(() => t.service.login(login, password, IP)),
      );

      expect(problem.code).toBe('invalid_credentials');
      expect(t.clock.sleeps).toEqual([FLOOR_MS - 120]);
      expect(elapsed(t, start)).toBe(FLOOR_MS);
    },
  );

  it('pads a blocked employee the same way', async () => {
    const t = setup();
    t.credentials.status = 'blocked';
    const start = t.clock.now();

    await problemOf(inRequest(() => t.service.login('farida.r', PASSWORD, IP)));

    expect(elapsed(t, start)).toBeGreaterThanOrEqual(FLOOR_MS);
  });

  it('does not add the floor on top when the work already took longer', async () => {
    const t = setup();
    t.hasher.verify.mockImplementation(async () => {
      t.clock.advance(FLOOR_MS + 200);
      return false;
    });

    await problemOf(inRequest(() => t.service.login('farida.r', 'wrong', IP)));

    expect(t.clock.sleeps).toEqual([]);
  });

  it('does not pad a successful login', async () => {
    const t = setup();

    await inRequest(() => t.service.login('farida.r', PASSWORD, IP));

    expect(t.clock.sleeps).toEqual([]);
  });
});

describe('SessionsService.login — success', () => {
  it('creates the session with the role snapshot and returns the token and the profile', async () => {
    const t = setup();

    const result = await inRequest(() =>
      t.service.login('Farida.R', PASSWORD, IP),
    );

    expect(t.sessions.created).toHaveLength(1);
    const record = t.sessions.created[0];
    expect(record).toEqual({
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      tenantId: TENANT,
      employeeId: EMPLOYEE,
      auth: 'password',
      authenticatedAt: '2026-10-02T09:00:00.000Z',
      permissions: ['pos:view', 'catalog:view'],
      permissionsVersion: 4,
      storeScope: [STORE_1],
      currentStoreId: STORE_1,
      terminalId: null,
      terminalCredentialHash: null,
      locale: 'tg',
      idleTtlSeconds: 900,
      absoluteExpiresAt: '2026-10-02T21:00:00.000Z',
    });
    expect(t.loader.reload).toHaveBeenCalledWith(TENANT, EMPLOYEE);
    expect(t.tokens.sign).toHaveBeenCalledWith(
      { jti: record.sessionId, sub: EMPLOYEE, tid: TENANT, aud: 'web' },
      43200,
    );
    expect(result.token).toBe('signed.jwt.token');
    expect(result.maxAgeSeconds).toBe(43200);
    expect(result.session).toEqual({
      employee: {
        id: EMPLOYEE,
        fullName: 'Farida R.',
        login: 'farida.r',
        phone: '+992900000101',
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
          id: STORE_1,
          name: 'Store one',
          address: 'Store one address',
          mode: 'cloud',
        },
      ],
      currentStoreId: STORE_1,
      auth: 'password',
      authenticatedAt: '2026-10-02T09:00:00.000Z',
      terminalId: null,
      impersonation: null,
      locale: 'tg',
    });
    expect(t.repository.activeStores).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      [STORE_1],
    );
    expect(t.limiter.tryAcquire).toHaveBeenCalledTimes(1);
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(KEY);
    expect(t.limiter.reset).toHaveBeenCalledWith(KEY);
  });

  it('gives the owner the whole catalog from the snapshot and the network scope', async () => {
    const t = setup();
    t.loader.reload.mockResolvedValue({
      ...t.snapshot,
      permissions: [...permissions],
      storeScope: 'all',
    });
    t.repository.loadProfile.mockResolvedValue(
      employeeProfile({
        role: {
          id: ROLE,
          name: { ru: 'Владелец' },
          isOwner: true,
          templateKey: 'owner',
        },
      }),
    );
    t.setStores([store(STORE_1, 'Store one'), store(STORE_2, 'Store two')]);

    const result = await inRequest(() =>
      t.service.login('farida.r', PASSWORD, IP),
    );

    const record = t.sessions.created[0];
    expect([...record.permissions].sort()).toEqual([...permissions].sort());
    expect(record.storeScope).toBe('all');
    expect(record.currentStoreId).toBeNull();
    expect(result.session.scope).toBe('network');
    expect(result.session.role.system).toBe(true);
    expect(result.session.stores.map((s) => s.id)).toEqual([STORE_1, STORE_2]);
    expect(result.session.currentStoreId).toBeNull();
  });

  it('writes last_login_at and the success audit in the same tenant transaction', async () => {
    const t = setup();

    await inRequest(() => t.service.login('farida.r', PASSWORD, IP));

    expect(t.repository.recordLogin).toHaveBeenCalledTimes(1);
    const [loginTrx, tenantId, employeeId] = t.repository.recordLogin.mock
      .calls[0] as unknown as [TenantTransaction, string, string];
    expect([tenantId, employeeId]).toEqual([TENANT, EMPLOYEE]);
    expect(t.audits).toHaveLength(1);
    expect(t.audits[0].trx).toBe(loginTrx);
    expect(t.audits[0]).toMatchObject({
      tenantId: TENANT,
      principal: null,
      correlationId: 'corr-login-1',
      event: {
        action: 'auth.login-succeeded',
        entityType: 'employee',
        entityId: EMPLOYEE,
        details: { ip: IP },
      },
    });
    expect(t.db.tenants.every((tenant) => tenant === TENANT)).toBe(true);
    // Stored last inside that transaction: a store failure rolls the audit back.
    expect(t.sessions.createdInTransaction).toEqual([true]);
  });

  // The session is stored inside the transaction, so the real one rolls the audit back.
  it('fails the login when the session cannot be stored', async () => {
    const t = setup();
    t.sessions.failCreate = true;

    await expect(
      inRequest(() => t.service.login('farida.r', PASSWORD, IP)),
    ).rejects.toThrow('redis down');
    expect(t.limiter.reset).not.toHaveBeenCalled();
  });

  it('clamps the idle timeout of the network into the configured bounds', async () => {
    const t = setup();
    t.repository.loadProfile.mockResolvedValue(
      employeeProfile({
        settings: { defaultLanguage: 'ru', cashierSessionIdleMin: 1 },
      }),
    );

    await inRequest(() => t.service.login('farida.r', PASSWORD, IP));

    expect(t.sessions.created[0].idleTtlSeconds).toBe(300);
    expect(t.sessions.created[0].locale).toBe('ru');
  });

  it('re-hashes the password when needsRehash says so, guarded by the old hash', async () => {
    const t = setup();
    t.hasher.needsRehash.mockReturnValue(true);

    await inRequest(() => t.service.login('farida.r', PASSWORD, IP));

    expect(t.hasher.needsRehash).toHaveBeenCalledWith('$scrypt$stored', 1);
    expect(t.hasher.hash).toHaveBeenCalledWith(PASSWORD);
    expect(t.repository.updatePasswordHash).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      EMPLOYEE,
      '$scrypt$stored',
      { phc: '$scrypt$fresh', pepperVersion: 2 },
    );
  });

  it('does not re-hash a current hash', async () => {
    const t = setup();

    await inRequest(() => t.service.login('farida.r', PASSWORD, IP));

    expect(t.hasher.hash).not.toHaveBeenCalled();
    expect(t.repository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('works without an incoming request context (own correlation id)', async () => {
    const t = setup();

    await t.service.login('farida.r', PASSWORD, IP);

    expect(t.audits[0].correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.audits[0].tenantId).toBe(TENANT);
  });
});

function principal(
  overrides: Partial<EmployeePrincipal> = {},
): EmployeePrincipal {
  return {
    kind: 'employee',
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    sessionId: SESSION,
    auth: 'password',
    authenticatedAt: '2026-10-02T08:00:00.000Z',
    permissions: ['pos:view'] as Permission[],
    storeScope: [STORE_1, STORE_2],
    currentStoreId: null,
    terminalId: null,
    locale: 'ru',
    ...overrides,
  };
}

const asPrincipal = <T>(p: EmployeePrincipal, fn: () => Promise<T>) =>
  runWithContext(
    { correlationId: 'corr-2', tenantId: p.tenantId, principal: p },
    fn,
  );

describe('SessionsService.current', () => {
  it('returns the profile of the session principal', async () => {
    const t = setup();
    t.setStores([store(STORE_1, 'Store one'), store(STORE_2, 'Store two')]);

    const session = await asPrincipal(
      principal({ currentStoreId: STORE_2 }),
      () => t.service.current(),
    );

    expect(t.repository.loadProfile).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      EMPLOYEE,
    );
    expect(t.repository.activeStores).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      [STORE_1, STORE_2],
    );
    expect(session).toMatchObject({
      permissions: ['pos:view'],
      scope: 'stores',
      currentStoreId: STORE_2,
      auth: 'password',
      authenticatedAt: '2026-10-02T08:00:00.000Z',
      locale: 'ru',
      role: { name: 'Кассир' },
    });
    expect(session.stores).toHaveLength(2);
  });

  it('needs a principal', async () => {
    const t = setup();
    await expect(inRequest(() => t.service.current())).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe('SessionsService.selectStore', () => {
  it('sets an active store of the scope as the current store', async () => {
    const t = setup();
    t.setStores([store(STORE_1, 'Store one'), store(STORE_2, 'Store two')]);

    const session = await asPrincipal(principal(), () =>
      t.service.selectStore(STORE_2),
    );

    expect(t.sessions.updates).toEqual([
      [SESSION, { currentStoreId: STORE_2 }],
    ]);
    expect(session.currentStoreId).toBe(STORE_2);
  });

  it('accepts an upper-case id of a store in the scope', async () => {
    const t = setup();
    t.setStores([store(STORE_1, 'Store one'), store(STORE_2, 'Store two')]);

    const session = await asPrincipal(principal(), () =>
      t.service.selectStore(STORE_2.toUpperCase()),
    );

    expect(session.currentStoreId).toBe(STORE_2);
  });

  it('forbids a store outside the scope', async () => {
    const t = setup();
    const other = '0197a1b2-0000-7000-8000-000000000099';

    const problem = await problemOf(
      asPrincipal(principal(), () => t.service.selectStore(other)),
    );

    expect(problem.getStatus()).toBe(403);
    expect(problem.code).toBe('forbidden');
    expect(t.sessions.updates).toEqual([]);
  });

  it('forbids a store of the scope that is not active', async () => {
    const t = setup();
    t.setStores([store(STORE_1, 'Store one')]);

    const problem = await problemOf(
      asPrincipal(principal(), () => t.service.selectStore(STORE_2)),
    );

    expect(problem.code).toBe('forbidden');
    expect(t.sessions.updates).toEqual([]);
  });

  it('allows any active store of the network for scope all', async () => {
    const t = setup();
    t.setStores([store(STORE_1, 'Store one'), store(STORE_2, 'Store two')]);

    const session = await asPrincipal(principal({ storeScope: 'all' }), () =>
      t.service.selectStore(STORE_2),
    );

    expect(t.repository.activeStores).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      'all',
    );
    expect(session.currentStoreId).toBe(STORE_2);
    expect(session.scope).toBe('network');
  });
});

describe('SessionsService.logout', () => {
  it('destroys the current session', async () => {
    const t = setup();

    await asPrincipal(principal(), () => t.service.logout());

    expect(t.sessions.destroyed).toEqual([SESSION]);
  });

  it('needs a principal', async () => {
    const t = setup();
    await expect(inRequest(() => t.service.logout())).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
