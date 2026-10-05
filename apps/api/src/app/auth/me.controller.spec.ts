import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import type { EmployeeMe } from '@pharmacy/shared-dto';
import {
  IS_AUTHENTICATED_KEY,
  REQUIRE_FRESH_AUTH_KEY,
} from '../../common/guards/decorators';
import { MeController } from './me.controller';
import { MeService } from './me.service';

// MeController over real HTTP (Express adapter, /api/v1 prefix and the global ValidationPipe as
// in main.ts) with a fake MeService. The guards are covered by their own specs; here the route
// markers are checked as metadata.

const me: EmployeeMe = {
  id: 'e',
  fullName: 'Farida R.',
  login: 'farida.r',
  phone: '',
  roleName: 'Кассир',
  scope: 'stores',
  storeNames: ['Store one'],
  lastLoginAt: null,
  locale: 'ru',
  pinSet: false,
};

const fake = {
  get: jest.fn(async () => me),
  updateLocale: jest.fn(async () => ({ ...me, locale: 'tg' as const })),
  changePassword: jest.fn(async () => ({
    token: 'signed.jwt.token',
    maxAgeSeconds: 43200,
  })),
};

let app: INestApplication;
let base: string;

async function start(testCookies: boolean): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    controllers: [MeController],
    providers: [
      { provide: MeService, useValue: fake },
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
  base = `${await app.getUrl()}/api/v1/me`;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

afterEach(async () => {
  jest.clearAllMocks();
  await app?.close();
});

describe('MeController', () => {
  it('GET /me returns the profile', async () => {
    await start(false);

    const res = await fetch(base);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(me);
  });

  it('PATCH /me passes the locale on and returns the profile', async () => {
    await start(false);

    const res = await fetch(base, json('PATCH', { locale: 'tg' }));

    expect(res.status).toBe(200);
    expect(fake.updateLocale).toHaveBeenCalledWith('tg');
    expect(((await res.json()) as EmployeeMe).locale).toBe('tg');
  });

  it.each([
    [{ locale: 'tj' }],
    [{ locale: 'en' }],
    [{ locale: 5 }],
    [{}],
    [{ locale: 'ru', extra: true }],
  ])('PATCH /me rejects the body %j with 400', async (body) => {
    await start(false);

    const res = await fetch(base, json('PATCH', body));

    expect(res.status).toBe(400);
    expect(fake.updateLocale).not.toHaveBeenCalled();
  });

  it('POST /me/password answers 204 with no body and sets the rotated session cookie', async () => {
    await start(false);

    const res = await fetch(
      `${base}/password`,
      json('POST', {
        currentPassword: 'old one',
        newPassword: 'Correct1horse',
      }),
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(fake.changePassword).toHaveBeenCalledWith(
      'old one',
      'Correct1horse',
    );
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('__Host-sid=signed.jwt.token');
    expect(cookie).toContain('Max-Age=43200');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('POST /me/password uses the plain cookie in the e2e mode', async () => {
    await start(true);

    const res = await fetch(
      `${base}/password`,
      json('POST', {
        currentPassword: 'old one',
        newPassword: 'Correct1horse',
      }),
    );

    expect(res.headers.get('set-cookie') ?? '').toContain(
      'sid=signed.jwt.token',
    );
  });

  it.each([
    [{ currentPassword: 'old one' }],
    [{ newPassword: 'Correct1horse' }],
    [{ currentPassword: 1, newPassword: 'Correct1horse' }],
    [
      {
        currentPassword: 'x'.repeat(PASSWORD_MAX_LENGTH + 1),
        newPassword: 'Correct1horse',
      },
    ],
    [
      {
        currentPassword: 'old one',
        newPassword: 'x'.repeat(PASSWORD_MAX_LENGTH + 1),
      },
    ],
    [{ currentPassword: 'old one', newPassword: 'Correct1horse', login: 'x' }],
  ])('POST /me/password rejects the body with 400', async (body) => {
    await start(false);

    const res = await fetch(`${base}/password`, json('POST', body));

    expect(res.status).toBe(400);
    expect(fake.changePassword).not.toHaveBeenCalled();
  });

  it('marks every route @Authenticated and only the password change @RequireFreshAuth', () => {
    const reflector = new Reflector();
    const proto = MeController.prototype;

    for (const handler of [proto.get, proto.update, proto.changePassword]) {
      expect(reflector.get(IS_AUTHENTICATED_KEY, handler)).toBe(true);
    }
    expect(reflector.get(REQUIRE_FRESH_AUTH_KEY, proto.changePassword)).toBe(
      true,
    );
    expect(reflector.get(REQUIRE_FRESH_AUTH_KEY, proto.get)).toBeUndefined();
    expect(reflector.get(REQUIRE_FRESH_AUTH_KEY, proto.update)).toBeUndefined();
  });
});
