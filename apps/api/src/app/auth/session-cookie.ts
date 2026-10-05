import type { CookieOptions, Response } from 'express';

// Session cookie of the web contour (ADR-0008; auth design 2026-10-02, section 5): the value is
// the session JWT. `__Host-` requires Secure, Path=/ and no Domain. The e2e mode
// (AUTH_TEST_COOKIES=true, allowed only with APP_ENV=test by the env validation) uses plain `sid`
// without Secure, so tests can run over http; an offline store uses plain `sid` with Secure.

export interface SessionCookieEnv {
  AUTH_TEST_COOKIES: boolean;
  /** Absent means cloud. An offline store drops the `__Host-` prefix but keeps Secure. */
  STORE_MODE?: 'cloud' | 'offline';
}

/** The cookie settings of this process, from the validated configuration. */
export function cookieEnvFrom(config: {
  get<T>(key: string): T | undefined;
}): SessionCookieEnv {
  return {
    AUTH_TEST_COOKIES: config.get<boolean>('AUTH_TEST_COOKIES') === true,
    STORE_MODE:
      config.get<string>('STORE_MODE') === 'offline' ? 'offline' : 'cloud',
  };
}

// Plain names in e2e mode and on an offline store: Chrome does not accept a `__Host-` cookie over
// http://localhost, where an offline store is reached (auth design, section 10).
function plainNames(env: SessionCookieEnv): boolean {
  return env.AUTH_TEST_COOKIES || env.STORE_MODE === 'offline';
}

export type SessionCookieName = '__Host-sid' | 'sid';

export function sessionCookieName(env: SessionCookieEnv): SessionCookieName {
  return plainNames(env) ? 'sid' : '__Host-sid';
}

function baseOptions(env: SessionCookieEnv): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: !env.AUTH_TEST_COOKIES,
  };
}

export function setSessionCookie(
  res: Response,
  token: string,
  maxAgeSeconds: number,
  env: SessionCookieEnv,
): void {
  // Express takes maxAge in milliseconds and writes Max-Age in seconds (plus Expires).
  res.cookie(sessionCookieName(env), token, {
    ...baseOptions(env),
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearSessionCookie(res: Response, env: SessionCookieEnv): void {
  // The attributes must match the set cookie, otherwise the browser keeps the original.
  res.clearCookie(sessionCookieName(env), baseOptions(env));
}

// Operator cookie of the admin contour (auth design, section 9): the operator's JWT (aud=admin).

export type OperatorCookieName = '__Host-op_sid' | 'op_sid';

export function operatorCookieName(env: SessionCookieEnv): OperatorCookieName {
  return env.AUTH_TEST_COOKIES ? 'op_sid' : '__Host-op_sid';
}

export function setOperatorCookie(
  res: Response,
  token: string,
  maxAgeSeconds: number,
  env: SessionCookieEnv,
): void {
  res.cookie(operatorCookieName(env), token, {
    ...baseOptions(env),
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearOperatorCookie(
  res: Response,
  env: SessionCookieEnv,
): void {
  res.clearCookie(operatorCookieName(env), baseOptions(env));
}
