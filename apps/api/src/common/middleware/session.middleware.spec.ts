import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type {
  PrincipalLoader,
  PrincipalSnapshot,
} from '../../app/auth/principal-loader';
import { SessionTokenService } from '../../core/crypto/session-token.service';
import {
  PermissionsVersionCache,
  SessionStore,
  type SessionLookup,
  type SessionPatch,
  type SessionRecord,
} from '../../core/sessions';
import {
  getRequestContext,
  type RequestContext,
  type EmployeePrincipal,
} from '../context/request-context';
import { SessionMiddleware } from './session.middleware';
import { CookieTokenExtractor } from './token-extractor';

// SessionMiddleware (auth design 2026-10-02, section 7, steps 1-6) with in-memory fakes of the
// session store, the version cache and the principal loader; the token service is the real one.

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const EMPLOYEE = '0197a1b2-0000-7000-8000-000000000002';
const SESSION = '0197a1b2-0000-7000-8000-000000000003';
const STORE_1 = '0197a1b2-0000-7000-8000-0000000000s1';
const STORE_2 = '0197a1b2-0000-7000-8000-0000000000s2';
const CORRELATION = 'corr-0000-0001';
const T0 = Date.parse('2026-10-02T09:00:00.000Z');

function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: SESSION,
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    auth: 'password',
    authenticatedAt: '2026-10-02T08:00:00.000Z',
    permissions: ['pos:view', 'catalog:view'],
    permissionsVersion: 3,
    storeScope: [STORE_1, STORE_2],
    currentStoreId: STORE_1,
    terminalId: null,
    terminalCredentialHash: null,
    locale: 'ru',
    idleTtlSeconds: 900,
    absoluteExpiresAt: '2026-10-02T20:00:00.000Z',
    ...overrides,
  };
}

class FakeSessionStore extends SessionStore {
  record: SessionRecord | null = sessionRecord();
  cachedVersion: number | null = 3;
  failLookup = false;

  readonly lookupCalls = jest.fn();
  readonly updateCalls = jest.fn();
  readonly touchCalls = jest.fn();
  readonly destroyAllCalls = jest.fn();

  async create(): Promise<void> {
    throw new Error('not used');
  }

  async lookup(
    sessionId: string,
    tenantId: string,
    employeeId: string,
  ): Promise<SessionLookup> {
    this.lookupCalls(sessionId, tenantId, employeeId);
    if (this.failLookup)
      throw new Error(`redis down while reading sess:${sessionId}`);
    const record = this.record;
    const matches =
      record !== null &&
      record.sessionId === sessionId &&
      record.tenantId === tenantId &&
      record.employeeId === employeeId;
    return matches
      ? { session: { ...record }, permissionsVersion: this.cachedVersion, terminalRevoked: false, tenantBlocked: false }
      : { session: null, permissionsVersion: null, terminalRevoked: false, tenantBlocked: false };
  }

  async update(sessionId: string, patch: SessionPatch): Promise<void> {
    this.updateCalls(sessionId, patch);
    if (this.record) this.record = { ...this.record, ...patch };
  }

  async touch(sessionId: string, idleTtlSeconds: number): Promise<void> {
    this.touchCalls(sessionId, idleTtlSeconds);
  }

  async destroy(): Promise<void> {
    throw new Error('not used');
  }

  async destroyAllFor(tenantId: string, employeeId: string): Promise<void> {
    this.destroyAllCalls(tenantId, employeeId);
    this.record = null;
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

class FakeVersionCache extends PermissionsVersionCache {
  value: number | null = null;
  readonly setIfGreaterCalls = jest.fn();

  async get(): Promise<number | null> {
    throw new Error('not used: the version comes with the session lookup');
  }

  async setIfGreater(
    tenantId: string,
    employeeId: string,
    version: number,
  ): Promise<void> {
    this.setIfGreaterCalls(tenantId, employeeId, version);
    if (this.value === null || this.value < version) this.value = version;
  }
}

const tokens = new SessionTokenService({
  activeId: 'k1',
  keys: new Map([['k1', randomBytes(32)]]),
});

let store: FakeSessionStore;
let versions: FakeVersionCache;
let reload: jest.Mock<Promise<PrincipalSnapshot | null>, [string, string]>;
let middleware: SessionMiddleware;
let token: string;

beforeAll(async () => {
  token = await tokens.sign(
    { jti: SESSION, sub: EMPLOYEE, tid: TENANT, aud: 'web' },
    3600,
  );
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(T0);
  store = new FakeSessionStore();
  versions = new FakeVersionCache();
  reload = jest.fn();
  const loader = { reload } as unknown as PrincipalLoader;
  const extractor = new CookieTokenExtractor(
    new ConfigService({ AUTH_TEST_COOKIES: false }),
  );
  middleware = new SessionMiddleware(
    extractor,
    tokens,
    store,
    versions,
    loader,
  );
});

afterEach(() => jest.restoreAllMocks());

function request(
  options: { cookie?: string | null; path?: string } = {},
): Request {
  const cookie = options.cookie === undefined ? token : options.cookie;
  return {
    originalUrl: options.path ?? '/api/v1/products?limit=20',
    cookies: cookie === null ? {} : { '__Host-sid': cookie },
    correlationId: CORRELATION,
  } as unknown as Request;
}

// The web contour only ever yields an employee principal.
type EmployeeContext = Omit<RequestContext, 'principal'> & {
  principal: EmployeePrincipal | null;
};

// Runs the middleware and returns the context seen by the next handler.
async function handle(
  req: Request = request(),
): Promise<EmployeeContext | undefined> {
  let seen: RequestContext | undefined;
  const next = jest.fn(() => {
    seen = getRequestContext();
  });
  await middleware.use(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith();
  return seen as EmployeeContext | undefined;
}

const GUEST: RequestContext = { correlationId: CORRELATION, principal: null };

const snapshot = (
  overrides: Partial<PrincipalSnapshot> = {},
): PrincipalSnapshot => ({
  status: 'active',
  tenantStatus: 'active',
  permissions: ['pos:view', 'pos:create', 'catalog:view'],
  storeScope: [STORE_1],
  permissionsVersion: 4,
  ...overrides,
});

describe('SessionMiddleware', () => {
  it('without a cookie runs the request as a guest', async () => {
    await expect(handle(request({ cookie: null }))).resolves.toEqual(GUEST);
    expect(store.lookupCalls).not.toHaveBeenCalled();
  });

  it('with a bad token runs the request as a guest', async () => {
    await expect(handle(request({ cookie: `${token}x` }))).resolves.toEqual(
      GUEST,
    );
    await expect(handle(request({ cookie: 'garbage' }))).resolves.toEqual(
      GUEST,
    );
    expect(store.lookupCalls).not.toHaveBeenCalled();
  });

  it('without a session record runs the request as a guest', async () => {
    store.record = null;
    await expect(handle()).resolves.toEqual(GUEST);
    expect(store.lookupCalls).toHaveBeenCalledWith(SESSION, TENANT, EMPLOYEE);
    expect(reload).not.toHaveBeenCalled();
  });

  it('matching version: the principal comes from the record, the loader is not called', async () => {
    const context = await handle();
    expect(context).toEqual({
      correlationId: CORRELATION,
      tenantId: TENANT,
      principal: {
        kind: 'employee',
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        sessionId: SESSION,
        auth: 'password',
        authenticatedAt: '2026-10-02T08:00:00.000Z',
        permissions: ['pos:view', 'catalog:view'],
        storeScope: [STORE_1, STORE_2],
        currentStoreId: STORE_1,
        terminalId: null,
        locale: 'ru',
      },
    });
    expect(Object.isFrozen(context?.principal?.permissions)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(store.updateCalls).not.toHaveBeenCalled();
    expect(versions.setIfGreaterCalls).not.toHaveBeenCalled();
  });

  it('grown version: reloads, updates the snapshot and uses the fresh values', async () => {
    store.cachedVersion = 4;
    reload.mockResolvedValue(snapshot());

    const context = await handle();

    expect(reload).toHaveBeenCalledWith(TENANT, EMPLOYEE);
    expect(store.updateCalls).toHaveBeenCalledWith(SESSION, {
      permissions: ['pos:view', 'pos:create', 'catalog:view'],
      permissionsVersion: 4,
      storeScope: [STORE_1],
    });
    expect(context?.principal).toMatchObject({
      permissions: ['pos:view', 'pos:create', 'catalog:view'],
      storeScope: [STORE_1],
      currentStoreId: STORE_1,
    });
    expect(versions.setIfGreaterCalls).not.toHaveBeenCalled();
  });

  it('a narrowed scope drops a current store that left it', async () => {
    store.cachedVersion = 4;
    reload.mockResolvedValue(snapshot({ storeScope: [STORE_2] }));

    const context = await handle();

    expect(store.updateCalls).toHaveBeenCalledWith(SESSION, {
      permissions: ['pos:view', 'pos:create', 'catalog:view'],
      permissionsVersion: 4,
      storeScope: [STORE_2],
      currentStoreId: null,
    });
    expect(context?.principal).toMatchObject({
      storeScope: [STORE_2],
      currentStoreId: null,
    });
  });

  it('cache miss reloads from the database and caches the version', async () => {
    store.cachedVersion = null;
    reload.mockResolvedValue(snapshot({ permissionsVersion: 3 }));

    const context = await handle();

    expect(reload).toHaveBeenCalledWith(TENANT, EMPLOYEE);
    expect(versions.setIfGreaterCalls).toHaveBeenCalledWith(TENANT, EMPLOYEE, 3);
    // Same version as the record: the snapshot is still current, nothing to rewrite.
    expect(store.updateCalls).not.toHaveBeenCalled();
    expect(context?.principal?.permissions).toEqual([
      'pos:view',
      'catalog:view',
    ]);
  });

  it('cache miss with a newer database version updates the snapshot', async () => {
    store.cachedVersion = null;
    reload.mockResolvedValue(snapshot({ permissionsVersion: 5 }));

    const context = await handle();

    expect(versions.setIfGreaterCalls).toHaveBeenCalledWith(TENANT, EMPLOYEE, 5);
    expect(store.updateCalls).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ permissionsVersion: 5 }),
    );
    expect(context?.principal?.permissions).toEqual([
      'pos:view',
      'pos:create',
      'catalog:view',
    ]);
  });

  it('cache miss never overwrites a newer version written meanwhile', async () => {
    store.cachedVersion = null;
    // An admin commits version 6 and its post-commit write lands while the middleware is
    // still reloading version 5 from the database.
    reload.mockImplementation(async () => {
      await versions.setIfGreater(TENANT, EMPLOYEE, 6);
      return snapshot({ permissionsVersion: 5 });
    });

    await handle();

    expect(versions.setIfGreaterCalls).toHaveBeenCalledWith(TENANT, EMPLOYEE, 5);
    expect(versions.value).toBe(6);

    // The next request sees 6 against the stored snapshot 5 and reloads again.
    store.cachedVersion = versions.value;
    reload.mockReset();
    reload.mockResolvedValue(
      snapshot({ permissionsVersion: 6, permissions: ['pos:view'] }),
    );

    const context = await handle();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.updateCalls).toHaveBeenLastCalledWith(
      SESSION,
      expect.objectContaining({
        permissionsVersion: 6,
        permissions: ['pos:view'],
      }),
    );
    expect(context?.principal?.permissions).toEqual(['pos:view']);
  });

  it.each([
    ['blocked', snapshot({ status: 'blocked' })],
    ['archived', snapshot({ status: 'archived' })],
    ['gone', null],
  ])(
    'an employee who is %s loses every session and becomes a guest',
    async (_, fresh) => {
      store.cachedVersion = 4;
      reload.mockResolvedValue(fresh);

      await expect(handle()).resolves.toEqual(GUEST);
      expect(store.destroyAllCalls).toHaveBeenCalledWith(TENANT, EMPLOYEE);
      expect(store.updateCalls).not.toHaveBeenCalled();
      expect(store.touchCalls).not.toHaveBeenCalled();
    },
  );

  it('touches the session at most once per 60 s', async () => {
    await handle();
    expect(store.touchCalls).toHaveBeenCalledTimes(1);
    expect(store.touchCalls).toHaveBeenCalledWith(SESSION, 900);

    jest.spyOn(Date, 'now').mockReturnValue(T0 + 30_000);
    await handle();
    jest.spyOn(Date, 'now').mockReturnValue(T0 + 59_999);
    await handle();
    expect(store.touchCalls).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockReturnValue(T0 + 60_000);
    await handle();
    expect(store.touchCalls).toHaveBeenCalledTimes(2);
  });

  it('a failure fails closed to a guest and logs neither the token nor the record', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    store.failLookup = true;

    await expect(handle()).resolves.toEqual(GUEST);

    const output = JSON.stringify([...logged.mock.calls, ...errors.mock.calls]);
    expect(logged.mock.calls.length + errors.mock.calls.length).toBe(1);
    expect(output).toContain(CORRELATION);
    expect(output).not.toContain(token);
    expect(output).not.toContain(SESSION);
    expect(output).not.toContain('redis down');
  });

  it('a loader failure fails closed to a guest', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    store.cachedVersion = 4;
    reload.mockRejectedValue(new Error('database unavailable'));

    await expect(handle()).resolves.toEqual(GUEST);
    expect(store.updateCalls).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v1/operator/tenants',
    '/api/v1/operator',
    '/API/V1/Operator/tenants?x=1',
  ])(
    'operator contour %s gets a guest context even with a valid employee cookie',
    async (path) => {
      await expect(handle(request({ path }))).resolves.toEqual(GUEST);
      expect(store.lookupCalls).not.toHaveBeenCalled();
    },
  );

  it('a path that only starts like the operator contour stays on the web contour', async () => {
    const context = await handle(request({ path: '/api/v1/operators-report' }));
    expect(context?.principal?.employeeId).toBe(EMPLOYEE);
  });
});
