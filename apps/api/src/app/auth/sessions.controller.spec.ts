import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import { ProblemException } from '../../common/errors/problem.exception';
import {
  IS_AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
} from '../../common/guards/decorators';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

// SessionsController over real HTTP (Express adapter, /api/v1 prefix and the global
// ValidationPipe as in main.ts) with a fake SessionsService. The guards are wired in a later task;
// here the route markers are checked as metadata.

const STORE = '0197a1b2-0000-7000-8000-000000000011';

const session: EmployeeSession = {
  employee: { id: 'e', fullName: 'Farida R.', login: 'farida.r', phone: '' },
  tenant: { id: 't', name: 'Test network' },
  role: { id: 'r', name: 'Кассир', system: false, templateKey: 'cashier' },
  permissions: ['pos:view'],
  scope: 'stores',
  stores: [],
  currentStoreId: null,
  auth: 'password',
  authenticatedAt: '2026-10-02T09:00:00.000Z',
  terminalId: null,
  impersonation: null,
  locale: 'ru',
};

const fake = {
  login: jest.fn(async () => ({
    token: 'signed.jwt.token',
    maxAgeSeconds: 43200,
    session,
  })),
  current: jest.fn(async () => session),
  selectStore: jest.fn(async () => ({ ...session, currentStoreId: STORE })),
  logout: jest.fn(async () => undefined),
};

let app: INestApplication;
let base: string;

async function start(testCookies: boolean): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    controllers: [SessionsController],
    providers: [
      { provide: SessionsService, useValue: fake },
      {
        provide: ConfigService,
        useValue: new ConfigService({ AUTH_TEST_COOKIES: testCookies }),
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1/sessions`;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => jest.clearAllMocks());

describe('SessionsController (HTTP)', () => {
  beforeAll(() => start(false));
  afterAll(() => app.close());

  it('POST /sessions → 201 with the session and the __Host-sid cookie', async () => {
    const response = await fetch(
      base,
      json('POST', { login: 'Farida.R', password: 'secret-1' }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(session);
    expect(fake.login).toHaveBeenCalledWith(
      'Farida.R',
      'secret-1',
      expect.any(String),
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-sid=signed\.jwt\.token;/);
    expect(cookie).toContain('Max-Age=43200');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    // The token travels only in the cookie.
    expect(JSON.stringify(session)).not.toContain('signed.jwt.token');
  });

  it.each([
    ['a missing password', { login: 'farida.r' }],
    ['a non-string login', { login: 42, password: 'x' }],
    ['a login over 254 characters', { login: 'a'.repeat(255), password: 'x' }],
    [
      'a password over the policy maximum',
      { login: 'farida.r', password: 'p'.repeat(PASSWORD_MAX_LENGTH + 1) },
    ],
    ['an unknown field', { login: 'farida.r', password: 'x', tenantId: 't' }],
  ])('POST /sessions → 400 for %s, before the service', async (_, body) => {
    const response = await fetch(base, json('POST', body));
    expect(response.status).toBe(400);
    expect(fake.login).not.toHaveBeenCalled();
  });

  it('POST /sessions passes the service error through without a cookie', async () => {
    fake.login.mockRejectedValueOnce(
      new ProblemException(401, 'invalid_credentials'),
    );

    const response = await fetch(
      base,
      json('POST', { login: 'farida.r', password: 'wrong' }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('GET /sessions/current → 200 with the session', async () => {
    const response = await fetch(`${base}/current`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(session);
  });

  it('PUT /sessions/current/store → 200 with the new current store', async () => {
    const response = await fetch(
      `${base}/current/store`,
      json('PUT', { storeId: STORE }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      currentStoreId: STORE,
    });
    expect(fake.selectStore).toHaveBeenCalledWith(STORE);
  });

  it.each([['not-a-uuid'], [42], [undefined]])(
    'PUT /sessions/current/store → 400 for storeId %p',
    async (storeId) => {
      const response = await fetch(
        `${base}/current/store`,
        json('PUT', { storeId }),
      );
      expect(response.status).toBe(400);
      expect(fake.selectStore).not.toHaveBeenCalled();
    },
  );

  it('DELETE /sessions/current → 204 and clears the cookie', async () => {
    const response = await fetch(`${base}/current`, { method: 'DELETE' });

    expect(response.status).toBe(204);
    expect(fake.logout).toHaveBeenCalledTimes(1);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-sid=;/);
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(cookie).toContain('Secure');
  });
});

describe('SessionsController (e2e cookie mode)', () => {
  beforeAll(() => start(true));
  afterAll(() => app.close());

  it('uses the plain sid cookie without Secure when AUTH_TEST_COOKIES is on', async () => {
    const response = await fetch(
      base,
      json('POST', { login: 'farida.r', password: 'x' }),
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^sid=signed\.jwt\.token;/);
    expect(cookie).not.toContain('Secure');
  });
});

describe('SessionsController route markers', () => {
  const reflector = new Reflector();
  const proto = SessionsController.prototype;

  it('login is public; the other routes need a principal', () => {
    expect(reflector.get(IS_PUBLIC_KEY, proto.login)).toBe(true);
    for (const handler of [proto.current, proto.selectStore, proto.logout]) {
      expect(reflector.get(IS_AUTHENTICATED_KEY, handler)).toBe(true);
      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
    }
    expect(reflector.get(IS_PUBLIC_KEY, SessionsController)).toBeUndefined();
  });
});
