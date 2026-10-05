import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { readDeviceSecret } from '../../app/auth/device-cookie';
import {
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
}

// Reads the web session cookie from req.cookies (filled by cookie-parser, wired in main.ts).
@Injectable()
export class CookieTokenExtractor extends TokenExtractor {
  private readonly cookieEnv: SessionCookieEnv;
  private readonly cookieName: SessionCookieName;

  constructor(config: ConfigService) {
    super();
    this.cookieEnv = {
      AUTH_TEST_COOKIES: config.get<boolean>('AUTH_TEST_COOKIES') === true,
    };
    this.cookieName = sessionCookieName(this.cookieEnv);
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
