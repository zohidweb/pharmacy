import { ConfigService } from '@nestjs/config';
import {
  getRequestContext,
  requireTenantId,
  runWithContext,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { sha256Hex } from '../../core/crypto';
import type { PasswordHasher } from '../../core/crypto';
import type {
  ContextResolvers,
  TenantDatabase,
  TenantTransaction,
} from '../../core/database';
import { SessionStore } from '../../core/sessions';
import type { AuditEvent, AuditService } from '../audit/audit.service';
import { activationLimiterKey } from './activation-code';
import { ActivationsService } from './activations.service';
import type { EmployeeAuthRepository } from './employee-auth.repository';
import { LoginClock } from './login-clock';
import type { LoginLimiter } from './login-limiter';

// ActivationsService (auth design 2026-10-02, section 6) with fakes of the resolver, the
// repository, the hasher, the session store, the limiter and the audit.

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const EMPLOYEE = '0197a1b2-0000-7000-8000-000000000002';
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 26);
const DISPLAY = 'abcd-efgh-ijkl-mnop-qrst-uvwx-yz';
const PASSWORD = 'Correct1horse';
const KEY = activationLimiterKey('login', 'owner.one');

const config = new ConfigService({ LOGIN_FAILURE_FLOOR_MS: 400 });
const JITTER_MS = 7;
const FLOOR_MS = 400 + JITTER_MS;

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
}

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
  readonly destroyedAll: [string, string][] = [];
  readonly openAtDestroy: number[] = [];
  constructor(private readonly db: FakeTenantDatabase) {
    super();
  }
  async create(): Promise<void> {
    throw new Error('not used');
  }
  async lookup(): Promise<never> {
    throw new Error('not used');
  }
  async update(): Promise<void> {
    throw new Error('not used');
  }
  async touch(): Promise<void> {
    throw new Error('not used');
  }
  async destroy(): Promise<void> {
    throw new Error('not used');
  }
  async destroyAllFor(tenantId: string, employeeId: string): Promise<void> {
    this.openAtDestroy.push(this.db.open);
    this.destroyedAll.push([tenantId, employeeId]);
  }
  async destroyForTerminal(): Promise<void> {
    throw new Error('not used');
  }
  async markTerminalRevoked(): Promise<void> {
    throw new Error('not used');
  }
  async markTenantBlocked(): Promise<void> {
    throw new Error('not used');
  }
  async clearTenantBlocked(): Promise<void> {
    throw new Error('not used');
  }
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
  const repository = {
    consumeActivationCode: jest.fn(async () => true),
  };
  const hasher = {
    hash: jest.fn(async () => ({ phc: '$scrypt$fresh', pepperVersion: 2 })),
    verifyDummy: jest.fn(async () => false as const),
  };
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
  const audits: {
    trx: TenantTransaction;
    event: AuditEvent;
    tenantId: string | undefined;
  }[] = [];
  const audit = {
    append: jest.fn(async (trx: TenantTransaction, event: AuditEvent) => {
      audits.push({ trx, event, tenantId: getRequestContext()?.tenantId });
    }),
  };
  const service = new ActivationsService(
    resolvers as unknown as ContextResolvers,
    db as unknown as TenantDatabase,
    repository as unknown as EmployeeAuthRepository,
    hasher as unknown as PasswordHasher,
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
    repository,
    hasher,
    sessions,
    limiter,
    clock,
    audit,
    audits,
  };
}

const activate = (
  t: ReturnType<typeof setup>,
  login = ' Owner.One ',
  code = DISPLAY,
  password = PASSWORD,
) =>
  runWithContext({ correlationId: 'corr-activation-1', principal: null }, () =>
    t.service.activate(login, code, password),
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

describe('ActivationsService.activate — success', () => {
  it('consumes the code and sets the password in one tenant transaction, audits, then ends the sessions', async () => {
    const t = setup();

    await expect(activate(t)).resolves.toBeUndefined();

    expect(t.resolvers.resolveLogin).toHaveBeenCalledWith('login', 'owner.one');
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(KEY);
    expect(t.hasher.hash).toHaveBeenCalledWith(PASSWORD);
    expect(t.db.tenants).toEqual([TENANT]);
    expect(t.repository.consumeActivationCode).toHaveBeenCalledWith(
      t.db.trxs[0],
      TENANT,
      EMPLOYEE,
      sha256Hex(CODE),
      { phc: '$scrypt$fresh', pepperVersion: 2 },
    );
    expect(t.audits).toHaveLength(1);
    expect(t.audits[0].trx).toBe(t.db.trxs[0]);
    expect(t.audits[0].tenantId).toBe(TENANT);
    expect(t.audits[0].event).toEqual({
      action: 'auth.activated',
      entityType: 'employee',
      entityId: EMPLOYEE,
    });
    // After the commit: no transaction is open when the sessions are destroyed.
    expect(t.sessions.destroyedAll).toEqual([[TENANT, EMPLOYEE]]);
    expect(t.sessions.openAtDestroy).toEqual([0]);
    expect(t.limiter.reset).toHaveBeenCalledWith(KEY);
    expect(t.clock.sleeps).toEqual([]);
  });

  it('does not hash the password while a transaction is open', async () => {
    const t = setup();
    const open: number[] = [];
    t.hasher.hash.mockImplementation(async () => {
      open.push(t.db.open);
      return { phc: '$scrypt$fresh', pepperVersion: 2 };
    });

    await activate(t);

    expect(open).toEqual([0]);
  });

  it('accepts a phone as the login', async () => {
    const t = setup();

    await activate(t, '900000101');

    expect(t.resolvers.resolveLogin).toHaveBeenCalledWith(
      'phone',
      '+992900000101',
    );
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(
      activationLimiterKey('phone', '+992900000101'),
    );
  });
});

describe('ActivationsService.activate — failures', () => {
  it('answers 401 invalid_code for a used, expired or wrong code, padded, with nothing recorded or ended', async () => {
    const t = setup();
    t.repository.consumeActivationCode.mockResolvedValue(false);

    const problem = await problemOf(activate(t));

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_code');
    expect(t.audit.append).not.toHaveBeenCalled();
    expect(t.sessions.destroyedAll).toEqual([]);
    expect(t.limiter.reset).not.toHaveBeenCalled();
    expect(t.clock.sleeps).toEqual([FLOOR_MS]);
  });

  it('records the attempt in the limiter before the code is checked', async () => {
    const t = setup();
    t.repository.consumeActivationCode.mockResolvedValue(false);

    await problemOf(activate(t));

    expect(t.limiter.tryAcquire).toHaveBeenCalledTimes(1);
    expect(t.limiter.tryAcquire.mock.invocationCallOrder[0]).toBeLessThan(
      t.repository.consumeActivationCode.mock.invocationCallOrder[0],
    );
  });

  it('answers an unknown login like a wrong code: dummy hash, padded, no tenant work', async () => {
    const t = setup();
    t.resolvers.resolveLogin.mockResolvedValue(null);

    const problem = await problemOf(activate(t));

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_code');
    expect(t.limiter.tryAcquire).toHaveBeenCalledWith(KEY);
    expect(t.hasher.verifyDummy).toHaveBeenCalledWith(PASSWORD);
    expect(t.hasher.hash).not.toHaveBeenCalled();
    expect(t.db.tenants).toEqual([]);
    expect(t.clock.sleeps).toEqual([FLOOR_MS]);
  });

  it('rejects a login that cannot be normalized, padded, without the limiter or a lookup', async () => {
    const t = setup();

    const problem = await problemOf(activate(t, 'two words'));

    expect(problem.getStatus()).toBe(401);
    expect(problem.code).toBe('invalid_code');
    expect(t.limiter.tryAcquire).not.toHaveBeenCalled();
    expect(t.resolvers.resolveLogin).not.toHaveBeenCalled();
    expect(t.clock.sleeps).toEqual([FLOOR_MS]);
  });

  it.each([
    ['too short', 'ABCD-EFGH'],
    ['outside the alphabet', `${DISPLAY.slice(0, -1)}1`],
    ['empty', ''],
  ])(
    'rejects a code that is %s, padded, without the limiter or a lookup',
    async (_name, code) => {
      const t = setup();

      const problem = await problemOf(activate(t, ' Owner.One ', code));

      expect(problem.code).toBe('invalid_code');
      expect(t.limiter.tryAcquire).not.toHaveBeenCalled();
      expect(t.resolvers.resolveLogin).not.toHaveBeenCalled();
      expect(t.clock.sleeps).toEqual([FLOOR_MS]);
    },
  );

  it('does not consume the code of a blocked network', async () => {
    const t = setup();
    t.resolvers.resolveLogin.mockResolvedValue({
      tenantId: TENANT,
      employeeId: EMPLOYEE,
      tenantStatus: 'blocked',
    });

    const problem = await problemOf(activate(t));

    expect(problem.code).toBe('invalid_code');
    expect(t.repository.consumeActivationCode).not.toHaveBeenCalled();
    expect(t.clock.sleeps).toEqual([FLOOR_MS]);
  });

  it('rejects a weak password with 422 first: no lookup, no limiter, no padding, code kept', async () => {
    const t = setup();

    const problem = await problemOf(
      activate(t, ' Owner.One ', DISPLAY, 'weak'),
    );

    expect(problem.getStatus()).toBe(422);
    expect(problem.code).toBe('password_policy');
    expect(t.limiter.tryAcquire).not.toHaveBeenCalled();
    expect(t.resolvers.resolveLogin).not.toHaveBeenCalled();
    expect(t.repository.consumeActivationCode).not.toHaveBeenCalled();
    expect(t.clock.sleeps).toEqual([]);
  });

  it('checks the password policy even when the code and the login are garbage', async () => {
    const t = setup();

    const problem = await problemOf(activate(t, 'two words', 'x', 'weak'));

    expect(problem.getStatus()).toBe(422);
    expect(t.clock.sleeps).toEqual([]);
  });

  it('answers 429 login_locked when the limiter refuses, not padded, before any lookup', async () => {
    const t = setup();
    t.limiter.tryAcquire.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 600,
    });

    const problem = await problemOf(activate(t));

    expect(problem.getStatus()).toBe(429);
    expect(problem.code).toBe('login_locked');
    expect(t.resolvers.resolveLogin).not.toHaveBeenCalled();
    expect(t.repository.consumeActivationCode).not.toHaveBeenCalled();
    expect(t.clock.sleeps).toEqual([]);
  });

  it('leaves the sessions and the limiter alone when the audit fails (the transaction rolls back)', async () => {
    const t = setup();
    t.audit.append.mockRejectedValue(new Error('audit down'));

    await expect(activate(t)).rejects.toThrow('audit down');

    expect(t.sessions.destroyedAll).toEqual([]);
    expect(t.limiter.reset).not.toHaveBeenCalled();
  });
});
