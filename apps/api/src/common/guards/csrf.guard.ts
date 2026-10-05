import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ProblemException } from '../errors/problem.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// A request carries a body when it declares a non-zero length or a chunked transfer.
function hasBody(req: Request): boolean {
  const length = header(req, 'content-length');
  return (
    header(req, 'transfer-encoding') !== undefined ||
    (length !== undefined && length.trim() !== '0')
  );
}

// application/json, optionally with parameters (charset); the media type is case-insensitive.
function isJson(contentType: string): boolean {
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

// Global CSRF guard of the web contour (ADR-0008; auth design 2026-10-02, section 7, guard 2).
// Applies to every route, @Public() ones included (login is a public POST). For unsafe methods:
// Sec-Fetch-Site, when present, must be same-origin; without it the Origin must equal WEB_ORIGIN
// exactly; a body (or a declared content type) must be JSON, which rules out form posts and
// other "simple" cross-site requests. The operator contour (ADMIN_ORIGIN) arrives with part 3.
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly webOrigin: string;

  constructor(config: ConfigService) {
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

    const fetchSite = header(req, 'sec-fetch-site');
    const sameOrigin =
      fetchSite !== undefined
        ? fetchSite === 'same-origin'
        : header(req, 'origin') === this.webOrigin;
    if (!sameOrigin) throw new ProblemException(403, 'csrf_rejected');

    const contentType = header(req, 'content-type');
    if (contentType !== undefined ? !isJson(contentType) : hasBody(req)) {
      throw new ProblemException(403, 'csrf_rejected');
    }
    return true;
  }
}
