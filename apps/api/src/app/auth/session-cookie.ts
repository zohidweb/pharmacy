import type { CookieOptions, Response } from 'express';

// Session cookie of the web contour (ADR-0008; auth design 2026-10-02, section 5): the value is
// the session JWT. `__Host-` requires Secure, Path=/ and no Domain. The e2e mode
// (AUTH_TEST_COOKIES=true, allowed only with APP_ENV=test by the env validation) uses plain `sid`
// without Secure, so tests can run over http.

export interface SessionCookieEnv {
  AUTH_TEST_COOKIES: boolean;
}

export type SessionCookieName = '__Host-sid' | 'sid';

export function sessionCookieName(env: SessionCookieEnv): SessionCookieName {
  return env.AUTH_TEST_COOKIES ? 'sid' : '__Host-sid';
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
