import type { CookieOptions, Request, Response } from 'express';
import type { SessionCookieEnv } from './session-cookie';

// Device cookie of a bound terminal (auth design 2026-10-02, section 8): the value is the device
// secret (32 random bytes, base64url); the database keeps only its SHA-256. Same attributes and
// the same e2e relaxation as the session cookie.

export type DeviceCookieName = '__Host-term' | 'term';

/** 400 days, the longest lifetime browsers accept for a cookie. */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 34_560_000;

// base64url of 32 bytes; anything else is not a device secret and is ignored.
const DEVICE_SECRET = /^[A-Za-z0-9_-]{43}$/;

export function deviceCookieName(env: SessionCookieEnv): DeviceCookieName {
  return env.AUTH_TEST_COOKIES ? 'term' : '__Host-term';
}

function baseOptions(env: SessionCookieEnv): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: !env.AUTH_TEST_COOKIES,
  };
}

export function setDeviceCookie(
  res: Response,
  env: SessionCookieEnv,
  secret: string,
): void {
  res.cookie(deviceCookieName(env), secret, {
    ...baseOptions(env),
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS * 1000,
  });
}

export function clearDeviceCookie(res: Response, env: SessionCookieEnv): void {
  res.clearCookie(deviceCookieName(env), baseOptions(env));
}

/** The device secret of this browser, or null when there is none or it is malformed. */
export function readDeviceSecret(
  req: Request,
  env: SessionCookieEnv,
): string | null {
  const cookies: unknown = (req as { cookies?: unknown }).cookies;
  if (cookies === null || typeof cookies !== 'object') return null;
  const name = deviceCookieName(env);
  // Own properties only; cookie-parser may also turn a `j:` value into an object.
  if (!Object.prototype.hasOwnProperty.call(cookies, name)) return null;
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && DEVICE_SECRET.test(value) ? value : null;
}
