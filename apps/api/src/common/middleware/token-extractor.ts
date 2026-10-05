import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { readDeviceSecret } from '../../app/auth/device-cookie';
import {
  cookieEnvFrom,
  type OperatorCookieName,
  operatorCookieName,
  sessionCookieName,
  type SessionCookieEnv,
  type SessionCookieName,
} from '../../app/auth/session-cookie';

// Port: gets the session token out of a request (auth design 2026-10-02, section 4). For web and
// admin — the cookie only; a Bearer header for aud=mobile needs its own ADR. DI token.
export abstract class TokenExtractor {
  abstract extract(req: Request): string | null;

  // The device secret of a bound terminal (device-cookie), checked against a PIN session.
  abstract extractDeviceSecret(req: Request): string | null;

  // The operator token of the admin contour (__Host-op_sid).
  abstract extractOperator(req: Request): string | null;
}

function cookieValue(req: Request, name: string): string | null {
  const cookies: unknown = (req as { cookies?: unknown }).cookies;
  if (cookies === null || typeof cookies !== 'object') return null;
  // Own properties only; cookie-parser may also turn a `j:` value into an object.
  if (!Object.prototype.hasOwnProperty.call(cookies, name)) return null;
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Reads the web session cookie from req.cookies (filled by cookie-parser, wired in main.ts).
@Injectable()
export class CookieTokenExtractor extends TokenExtractor {
  private readonly cookieEnv: SessionCookieEnv;
  private readonly cookieName: SessionCookieName;
  private readonly operatorCookie: OperatorCookieName;

  constructor(config: ConfigService) {
    super();
    this.cookieEnv = cookieEnvFrom(config);
    this.cookieName = sessionCookieName(this.cookieEnv);
    this.operatorCookie = operatorCookieName(this.cookieEnv);
  }

  extractOperator(req: Request): string | null {
    return cookieValue(req, this.operatorCookie);
  }

  extractDeviceSecret(req: Request): string | null {
    return readDeviceSecret(req, this.cookieEnv);
  }

  extract(req: Request): string | null {
    const cookies: unknown = (req as { cookies?: unknown }).cookies;
    if (cookies === null || typeof cookies !== 'object') return null;
    // Own properties only; cookie-parser may also turn a `j:` value into an object.
    if (!Object.prototype.hasOwnProperty.call(cookies, this.cookieName))
      return null;
    const value: unknown = (cookies as Record<string, unknown>)[
      this.cookieName
    ];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
