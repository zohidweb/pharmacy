import axios, { type AxiosResponse } from 'axios';
import { API_BASE_URL, WEB_ORIGIN } from '../support/env';
import {
  blockEmployee,
  closeSeed,
  seedOwner,
  type SeededUser,
} from '../support/seed';

// Employee authentication end to end (auth design 2026-10-02, sections 6, 7 and 14): the API runs as
// a separate process with APP_ENV=test and AUTH_TEST_COOKIES=true (cookie `sid`, no Secure), on
// PostgreSQL and Redis. Every test seeds its own network, so tests do not depend on each other.

const COOKIE_NAME = 'sid';

type Headers = Record<string, string | undefined>;

interface Call {
  data?: unknown;
  cookie?: string;
  headers?: Headers;
}

const client = axios.create({
  baseURL: API_BASE_URL,
  // Every status is an answer to assert on, not an exception.
  validateStatus: () => true,
  maxRedirects: 0,
});

// Same-origin browser requests: the Origin of the web app and Fetch Metadata. A header set to
// undefined in `headers` is dropped.
function request(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  { data, cookie, headers }: Call = {},
): Promise<AxiosResponse> {
  const merged: Headers = {
    Origin: WEB_ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    ...(cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {}),
    ...headers,
  };
  const cleaned = Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return client.request({ method, url, data, headers: cleaned });
}

const get = (url: string, call?: Call) => request('GET', url, call);
const post = (url: string, call?: Call) => request('POST', url, call);
const put = (url: string, call?: Call) => request('PUT', url, call);
const del = (url: string, call?: Call) => request('DELETE', url, call);

// The session JWT out of the Set-Cookie header of a sign-in answer.
function sessionCookie(res: AxiosResponse): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : [];
  const own = cookies.find((value) => value.startsWith(`${COOKIE_NAME}=`));
  if (!own) throw new Error('The answer has no session cookie');
  return own.slice(COOKIE_NAME.length + 1).split(';')[0];
}

const activate = (user: SeededUser) =>
  post('/api/v1/activations', {
    data: {
      login: user.login,
      code: user.activationCode,
      newPassword: user.password,
    },
  });

const signIn = (identifier: string, password: string) =>
  post('/api/v1/sessions', { data: { login: identifier, password } });

// An owner who is activated and signed in; the cookie is the session JWT.
async function activatedAndSignedIn(
  options?: Parameters<typeof seedOwner>[0],
): Promise<{ user: SeededUser; cookie: string }> {
  const user = await seedOwner(options);
  expect((await activate(user)).status).toBe(204);
  const res = await signIn(user.login, user.password);
  expect(res.status).toBe(201);
  return { user, cookie: sessionCookie(res) };
}

// Every object key of a JSON value, at any depth.
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [key, ...keysOf(item)]);
  }
  return [];
}

// The JWT with another tenant id in its payload and the original signature.
function withForgedTenant(token: string, tenantId: string): string {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  claims.tid = tenantId;
  const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${forged}.${signature}`;
}

afterAll(closeSeed);

describe('activation and sign-in', () => {
  it('activates an owner, then signs in by login, phone and e-mail', async () => {
    const user = await seedOwner();

    const activation = await activate(user);
    expect(activation.status).toBe(204);
    // No cookie before the sign-in.
    expect(activation.headers['set-cookie']).toBeUndefined();

    for (const identifier of [user.login, user.phone, user.email]) {
      const res = await signIn(identifier, user.password);

      expect(res.status).toBe(201);
      const cookie = res.headers['set-cookie']?.[0] ?? '';
      expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=`));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(res.data.employee.login).toBe(user.login);
      expect(res.data.tenant.id).toBe(user.tenantId);
      // The answer carries no secrets: not the password, not the session JWT, no secret-shaped keys.
      // (`auth: 'password'` is a legitimate value, so the word itself is not searched for.)
      const text = JSON.stringify(res.data);
      expect(text).not.toContain(user.password);
      expect(text).not.toContain(sessionCookie(res));
      const keys = keysOf(res.data).map((key) => key.toLowerCase());
      for (const secret of ['token', 'jwt', 'passwordhash', 'password_hash', 'hash']) {
        expect(keys).not.toContain(secret);
      }
    }
  });

  it('serves the session profile with the cookie and refuses without it', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    const current = await get('/api/v1/sessions/current', { cookie });
    expect(current.status).toBe(200);
    expect(current.data.employee.login).toBe(user.login);
    expect(current.data.auth).toBe('password');
    expect(current.data.stores).toHaveLength(2);

    const anonymous = await get('/api/v1/sessions/current');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(anonymous.data.code).toBe('unauthenticated');
    expect(typeof anonymous.data.correlationId).toBe('string');
    expect(anonymous.headers['x-correlation-id']).toBe(
      anonymous.data.correlationId,
    );
  });

  it('rejects the activation code the second time', async () => {
    const user = await seedOwner();
    expect((await activate(user)).status).toBe(204);

    const again = await activate(user);

    expect(again.status).toBe(401);
    expect(again.data.code).toBe('invalid_code');
  });

  it('answers a wrong password and an unknown login with the same invalid_credentials', async () => {
    const { user } = await activatedAndSignedIn();

    const wrong = await signIn(user.login, 'Wrong-Passw0rd');
    const unknown = await signIn(`nobody-${user.login}`, 'Wrong-Passw0rd');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.data.code).toBe('invalid_credentials');
    expect(unknown.data.code).toBe('invalid_credentials');
  });

  it('locks the identifier after 5 wrong passwords with 429 login_locked', async () => {
    const { user } = await activatedAndSignedIn();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await signIn(user.login, 'Wrong-Passw0rd');
      expect(res.status).toBe(401);
    }
    // Locked: even the right password is refused.
    const locked = await signIn(user.login, user.password);

    expect(locked.status).toBe(429);
    expect(locked.data.code).toBe('login_locked');
  });

  it('answers a malformed body with a problem and no echo of the input', async () => {
    const res = await post('/api/v1/sessions', {
      data: { login: 12345, password: 'SECRET-VALUE-9', extra: 'ECHOED-FIELD' },
    });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.data.code).toBe('validation_failed');
    // errors[] (ADR-0015): the DTO field with a stable code, and one nameless entry for the
    // unknown property; the client's names and values never come back.
    expect(res.data.errors).toEqual(
      expect.arrayContaining([
        { field: 'login', code: expect.stringMatching(/^[a-z_]+$/) },
        { field: '', code: 'unknown_property' },
      ]),
    );
    expect(res.data.errors).toHaveLength(2);
    const text = JSON.stringify(res.data);
    expect(text).not.toContain('SECRET-VALUE-9');
    expect(text).not.toContain('ECHOED-FIELD');
  });
});

describe('session lifetime', () => {
  it('logout invalidates the token', async () => {
    const { cookie } = await activatedAndSignedIn();
    expect((await get('/api/v1/sessions/current', { cookie })).status).toBe(200);

    const out = await del('/api/v1/sessions/current', { cookie });
    expect(out.status).toBe(204);

    // The same JWT, still well-formed and unexpired, no longer has a server-side session.
    const after = await get('/api/v1/sessions/current', { cookie });
    expect(after.status).toBe(401);
  });

  it('a blocked employee loses the session on the next request', async () => {
    const { user, cookie } = await activatedAndSignedIn();
    expect((await get('/api/v1/sessions/current', { cookie })).status).toBe(200);

    await blockEmployee(user);

    const after = await get('/api/v1/sessions/current', { cookie });
    expect(after.status).toBe(401);
    // The employee cannot sign in again either.
    const again = await signIn(user.login, user.password);
    expect(again.status).toBe(401);
  });

  it('a token with a changed tid is rejected', async () => {
    const { user, cookie } = await activatedAndSignedIn();
    const other = await seedOwner();

    const forged = withForgedTenant(cookie, other.tenantId);

    expect(forged).not.toBe(cookie);
    const res = await get('/api/v1/sessions/current', { cookie: forged });
    expect(res.status).toBe(401);
    // The genuine token still works: the forgery did not touch the session.
    expect((await get('/api/v1/sessions/current', { cookie })).status).toBe(200);
    expect(user.tenantId).not.toBe(other.tenantId);
  });
});

describe('password change', () => {
  const NEW_PASSWORD = 'Fresh-Passw0rd-7';

  it('answers a wrong current password with 422 invalid_current_password on the field', async () => {
    const { cookie } = await activatedAndSignedIn();

    const res = await post('/api/v1/me/password', {
      cookie,
      data: { currentPassword: 'Wrong-Passw0rd', newPassword: NEW_PASSWORD },
    });

    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.data.code).toBe('invalid_current_password');
    expect(res.data.errors).toEqual([
      { field: 'currentPassword', code: 'invalid_current_password' },
    ]);
    // Not a lost session: the same cookie still works.
    expect((await get('/api/v1/sessions/current', { cookie })).status).toBe(200);
  });

  it('locks the change after 5 wrong current passwords with 429 login_locked', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await post('/api/v1/me/password', {
        cookie,
        data: { currentPassword: 'Wrong-Passw0rd', newPassword: NEW_PASSWORD },
      });
      expect(res.status).toBe(422);
    }
    // Locked: even the right current password is refused.
    const locked = await post('/api/v1/me/password', {
      cookie,
      data: { currentPassword: user.password, newPassword: NEW_PASSWORD },
    });

    expect(locked.status).toBe(429);
    expect(locked.data.code).toBe('login_locked');
  });

  it('changes the password, rotates the session and ends the old one', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    const res = await post('/api/v1/me/password', {
      cookie,
      data: { currentPassword: user.password, newPassword: NEW_PASSWORD },
    });

    expect(res.status).toBe(204);
    const rotated = sessionCookie(res);
    expect(rotated).not.toBe(cookie);
    expect((await get('/api/v1/sessions/current', { cookie })).status).toBe(401);
    expect(
      (await get('/api/v1/sessions/current', { cookie: rotated })).status,
    ).toBe(200);
    expect((await signIn(user.login, NEW_PASSWORD)).status).toBe(201);
  });
});

describe('CSRF', () => {
  it('rejects a foreign Origin on PUT /sessions/current/store', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    const res = await put('/api/v1/sessions/current/store', {
      cookie,
      data: { storeId: user.storeIds[0] },
      // No Fetch Metadata: the Origin decides.
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': undefined },
    });

    expect(res.status).toBe(403);
    expect(res.data.code).toBe('csrf_rejected');
  });

  it('rejects a cross-site Fetch Metadata value', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    const res = await put('/api/v1/sessions/current/store', {
      cookie,
      data: { storeId: user.storeIds[0] },
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });

    expect(res.status).toBe(403);
    expect(res.data.code).toBe('csrf_rejected');
  });

  it('rejects a form body', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    const res = await put('/api/v1/sessions/current/store', {
      cookie,
      data: `storeId=${user.storeIds[0]}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    expect(res.status).toBe(403);
    expect(res.data.code).toBe('csrf_rejected');
  });

  it('did not change the working store after a rejected request', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    await put('/api/v1/sessions/current/store', {
      cookie,
      data: { storeId: user.storeIds[0] },
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': undefined },
    });

    const current = await get('/api/v1/sessions/current', { cookie });
    expect(current.data.currentStoreId).toBeNull();
  });
});

describe('store selection', () => {
  it('selects a store of the scope and reports it as the working store', async () => {
    const { user, cookie } = await activatedAndSignedIn();

    const res = await put('/api/v1/sessions/current/store', {
      cookie,
      data: { storeId: user.storeIds[1] },
    });

    expect(res.status).toBe(200);
    expect(res.data.currentStoreId).toBe(user.storeIds[1]);
    const current = await get('/api/v1/sessions/current', { cookie });
    expect(current.data.currentStoreId).toBe(user.storeIds[1]);
  });

  it('refuses a store outside the scope with 403', async () => {
    const { user, cookie } = await activatedAndSignedIn({
      scope: 'first-store',
    });

    // The only store of the scope is chosen automatically at sign-in.
    const current = await get('/api/v1/sessions/current', { cookie });
    expect(current.data.stores).toHaveLength(1);

    const res = await put('/api/v1/sessions/current/store', {
      cookie,
      data: { storeId: user.storeIds[1] },
    });

    expect(res.status).toBe(403);
    expect(res.data.code).toBe('forbidden');
  });
});
