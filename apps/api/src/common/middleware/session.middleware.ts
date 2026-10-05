import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  PrincipalLoader,
  type PrincipalSnapshot,
} from '../../app/auth/principal-loader';
import { SessionTokenService, sha256Hex } from '../../core/crypto';
import {
  PermissionsVersionCache,
  SessionStore,
  type SessionPatch,
  type SessionRecord,
} from '../../core/sessions';
import {
  type EmployeePrincipal,
  runWithContext,
} from '../context/request-context';
import { TokenExtractor } from './token-extractor';

// The idle lifetime is extended at most once per this interval per session (design, section 7, step 5).
export const TOUCH_INTERVAL_MS = 60_000;

// Upper bound of the per-process touch map; the oldest entries are evicted first.
const MAX_TRACKED_SESSIONS = 10_000;

// The operator contour (aud=admin, __Host-op_sid) arrives with part 3 of the auth design; until
// then its routes get a guest context and never an employee principal.
const OPERATOR_PREFIX = '/api/v1/operator';

function isOperatorPath(originalUrl: string): boolean {
  // Express routing is case-insensitive by default, so the comparison is too.
  const path = originalUrl.split('?')[0].toLowerCase();
  return path === OPERATOR_PREFIX || path.startsWith(`${OPERATOR_PREFIX}/`);
}

// Last touch time per session id, kept in process memory. A Map iterates in insertion order, so
// re-inserting on every touch keeps the oldest entry first for eviction.
class TouchThrottle {
  private readonly touchedAt = new Map<string, number>();

  /** True (and the touch is recorded) when the session was not touched in the last interval. */
  claim(sessionId: string, now: number): boolean {
    const last = this.touchedAt.get(sessionId);
    if (last !== undefined && now - last < TOUCH_INTERVAL_MS) return false;
    this.touchedAt.delete(sessionId);
    if (this.touchedAt.size >= MAX_TRACKED_SESSIONS) {
      const oldest = this.touchedAt.keys().next();
      if (!oldest.done) this.touchedAt.delete(oldest.value);
    }
    this.touchedAt.set(sessionId, now);
    return true;
  }

  release(sessionId: string): void {
    this.touchedAt.delete(sessionId);
  }
}

function toPrincipal(record: SessionRecord): EmployeePrincipal {
  return {
    kind: 'employee',
    tenantId: record.tenantId,
    employeeId: record.employeeId,
    sessionId: record.sessionId,
    auth: record.auth,
    authenticatedAt: record.authenticatedAt,
    permissions: record.permissions,
    storeScope: record.storeScope,
    currentStoreId: record.currentStoreId,
    terminalId: record.terminalId,
    locale: record.locale,
  };
}

// True when this request carries the device secret of the PIN session's terminal. Hex digests of
// equal length are compared in constant time.
function deviceMatches(record: SessionRecord, secret: string | null): boolean {
  if (secret === null || record.terminalCredentialHash === null) return false;
  const actual = Buffer.from(sha256Hex(secret), 'hex');
  const expected = Buffer.from(record.terminalCredentialHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// The snapshot fields to rewrite after a reload; a current store that left the scope is dropped.
// A PIN session keeps the terminal's store as its only scope (auth design, section 8); null when
// the employee no longer has access to that store, so the session must end.
function snapshotPatch(
  record: SessionRecord,
  fresh: PrincipalSnapshot,
): SessionPatch | null {
  if (record.terminalId !== null) {
    const store = record.currentStoreId;
    if (
      store === null ||
      (fresh.storeScope !== 'all' && !fresh.storeScope.includes(store))
    ) {
      return null;
    }
    return {
      permissions: fresh.permissions,
      permissionsVersion: fresh.permissionsVersion,
      storeScope: [store],
    };
  }
  const patch: SessionPatch = {
    permissions: fresh.permissions,
    permissionsVersion: fresh.permissionsVersion,
    storeScope: fresh.storeScope,
  };
  if (
    record.currentStoreId !== null &&
    fresh.storeScope !== 'all' &&
    !fresh.storeScope.includes(record.currentStoreId)
  ) {
    patch.currentStoreId = null;
  }
  return patch;
}

// Resolves the principal of every request from the session cookie and runs the rest of the
// request inside a frozen RequestContext (auth design 2026-10-02, section 7, steps 1-6). A missing,
// invalid or revoked session gives a guest context; the guards decide whether that is enough.
// Any failure fails closed to a guest. Tokens, cookies and session records are never logged.
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SessionMiddleware.name);
  private readonly touches = new TouchThrottle();

  constructor(
    private readonly extractor: TokenExtractor,
    private readonly tokens: SessionTokenService,
    private readonly sessions: SessionStore,
    private readonly versions: PermissionsVersionCache,
    private readonly loader: PrincipalLoader,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const correlationId = req.correlationId ?? randomUUID();
    let principal: EmployeePrincipal | null = null;
    try {
      principal = await this.resolve(req);
    } catch (error) {
      // The error text may carry keys or values from the store or the database: name only.
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.warn(
        `Session resolution failed (${name}); the request continues as a guest [correlationId=${correlationId}]`,
      );
      principal = null;
    }
    // Outside the try: an error thrown downstream is not a session failure and must not
    // trigger a second next().
    runWithContext(
      { correlationId, tenantId: principal?.tenantId, principal },
      next,
    );
  }

  private async resolve(req: Request): Promise<EmployeePrincipal | null> {
    if (isOperatorPath(req.originalUrl)) return null;

    // Step 1: the token of the web contour.
    const token = this.extractor.extract(req);
    if (token === null) return null;

    // Step 2: signature, algorithm, issuer, audience, expiry.
    const claims = await this.tokens.verify(token, 'web');
    if (claims === null) return null;
    const { jti: sessionId, tid: tenantId, sub: employeeId } = claims;

    // Step 3: the record and the current permissions version in one round trip.
    const { session, permissionsVersion, terminalRevoked } =
      await this.sessions.lookup(
      sessionId,
      tenantId,
      employeeId,
    );

    // Step 4: no record -> guest. A PIN session lives only with its terminal: a revoked terminal
    // or a request without the terminal's device-cookie ends it (a stolen session cookie alone is
    // useless).
    if (session === null) return null;
    if (
      session.terminalId !== null &&
      (terminalRevoked ||
        !deviceMatches(session, this.extractor.extractDeviceSecret(req)))
    ) {
      await this.sessions.destroy(sessionId);
      return null;
    }
    let record = session;
    if (
      permissionsVersion === null ||
      permissionsVersion !== record.permissionsVersion
    ) {
      const fresh = await this.loader.reload(tenantId, employeeId);
      if (fresh === null || fresh.status !== 'active') {
        await this.sessions.destroyAllFor(tenantId, employeeId);
        return null;
      }
      // Cache miss: the database version is cached with set-if-greater, so a newer version written
      // meanwhile by the post-commit writer is never overwritten; then the next request reloads
      // against it.
      if (permissionsVersion === null) {
        await this.versions.setIfGreater(
          tenantId,
          employeeId,
          fresh.permissionsVersion,
        );
      }
      if (fresh.permissionsVersion !== record.permissionsVersion) {
        const patch = snapshotPatch(record, fresh);
        if (patch === null) {
          await this.sessions.destroy(sessionId);
          return null;
        }
        await this.sessions.update(sessionId, patch);
        record = { ...record, ...patch };
      }
    }

    // Step 5: extend the idle lifetime at most once per TOUCH_INTERVAL_MS.
    if (this.touches.claim(sessionId, Date.now())) {
      try {
        await this.sessions.touch(sessionId, record.idleTtlSeconds);
      } catch (error) {
        this.touches.release(sessionId);
        throw error;
      }
    }

    // Step 6: the principal; the caller freezes it into the request context.
    return toPrincipal(record);
  }
}
