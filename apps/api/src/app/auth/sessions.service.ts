import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requirePrincipal,
  runWithContext,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { PasswordHasher } from '../../core/crypto';
import {
  ContextResolvers,
  type ResolvedLogin,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { SessionStore } from '../../core/sessions';
import { AuditService } from '../audit/audit.service';
import {
  EmployeeAuthRepository,
  type LoginCredentials,
} from './employee-auth.repository';
import { normalizeIdentifier } from './identifier';
import { LoginClock, padFailure } from './login-clock';
import { LoginLimiter, loginLimiterKey } from './login-limiter';
import { PrincipalLoader } from './principal-loader';
import { SessionIssuer } from './session-issuer';
import { buildEmployeeSession, type SessionView } from './session-profile';

export interface LoginResult {
  /** Session JWT for the cookie; never in a response body or a log. */
  token: string;
  maxAgeSeconds: number;
  session: EmployeeSession;
}

/** Why a sign-in of a known employee failed: audit details, never shown to the client. */
type FailureReason =
  | 'invalid_password'
  | 'no_password'
  | 'unknown_employee'
  | 'tenant_blocked'
  | 'employee_inactive';

type PasswordCheck =
  | { ok: true; status: string; phc: string; pepperVersion: number }
  | { ok: false; reason: FailureReason };

// One answer for every failure: an unknown identifier and a wrong password are indistinguishable.
const invalidCredentials = () =>
  new ProblemException(401, 'invalid_credentials');

// Sign-in by password, the session profile, the working store and sign-out (auth design
// 2026-10-02, section 6). Passwords, hashes, tokens and identifier values are never logged or
// audited.
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly failureFloorMs: number;

  constructor(
    private readonly resolvers: ContextResolvers,
    private readonly db: TenantDatabase,
    private readonly repository: EmployeeAuthRepository,
    private readonly loader: PrincipalLoader,
    private readonly hasher: PasswordHasher,
    private readonly issuer: SessionIssuer,
    private readonly sessions: SessionStore,
    private readonly limiter: LoginLimiter,
    private readonly audit: AuditService,
    private readonly clock: LoginClock,
    config: ConfigService,
  ) {
    this.failureFloorMs = config.getOrThrow<number>('LOGIN_FAILURE_FLOOR_MS');
  }

  async login(raw: string, password: string, ip: string): Promise<LoginResult> {
    const started = this.clock.now();
    try {
      return await this.attemptLogin(raw, password, ip);
    } catch (error) {
      // Every 401 invalid_credentials takes at least the floor (plus jitter) from the start, so
      // the timing does not tell an unknown identifier, a wrong password, a blocked employee or
      // network apart: their paths differ in database work. Successes and 429 are not padded.
      if (
        error instanceof ProblemException &&
        error.code === 'invalid_credentials'
      ) {
        await padFailure(this.clock, this.failureFloorMs, started);
      }
      throw error;
    }
  }

  private async attemptLogin(
    raw: string,
    password: string,
    ip: string,
  ): Promise<LoginResult> {
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();

    // Step 2. Nothing can match an identifier that does not normalize, so there is nothing to
    // guess and no limiter key is spent on it (the IP throttler still applies); the dummy check
    // keeps the answer and its timing those of a wrong password.
    const identifier = normalizeIdentifier(raw);
    if (identifier === null) {
      await this.hasher.verifyDummy(password);
      throw invalidCredentials();
    }

    // Step 3: the attempt is reserved atomically before any hashing or database call, so a
    // burst of concurrent requests gets no more guesses than LOGIN_MAX_FAILURES per window.
    const key = loginLimiterKey(identifier.kind, identifier.value);
    const attempt = await this.limiter.tryAcquire(key);
    if (!attempt.allowed) {
      throw new ProblemException(429, 'login_locked');
    }

    // Step 4: the tenant of the identifier.
    const resolved = await this.resolvers.resolveLogin(
      identifier.kind,
      identifier.value,
    );
    if (resolved === null) {
      await this.hasher.verifyDummy(password);
      // No tenant, so no audit_log: the application log only, without the identifier.
      this.logger.warn(
        `Sign-in failed: unknown ${identifier.kind} [correlationId=${correlationId}]`,
      );
      throw invalidCredentials();
    }

    // Steps 5-7 run in the tenant of the identifier, so the audit and the transactions see it.
    return runWithContext(
      { correlationId, tenantId: resolved.tenantId, principal: null },
      () => this.loginInTenant(resolved, password, ip, key),
    );
  }

  async current(): Promise<EmployeeSession> {
    const principal = requirePrincipal();
    return this.db.tenantTransaction((trx) => this.profileOf(trx, principal));
  }

  async selectStore(storeId: string): Promise<EmployeeSession> {
    const principal = requirePrincipal();
    // Ids from the database are lower-case; the DTO accepts any case.
    const id = storeId.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      // The active stores of the scope: the whole network for 'all'.
      const stores = await this.repository.activeStores(
        trx,
        principal.tenantId,
        principal.storeScope,
      );
      if (!stores.some((store) => store.id === id)) {
        throw new ProblemException(403, 'forbidden');
      }
      const profile = await this.requireProfile(
        trx,
        principal.tenantId,
        principal.employeeId,
      );
      await this.sessions.update(principal.sessionId, { currentStoreId: id });
      return buildEmployeeSession(profile, stores, {
        ...principal,
        currentStoreId: id,
      });
    });
  }

  async logout(): Promise<void> {
    await this.sessions.destroy(requirePrincipal().sessionId);
  }

  /**
   * POST /sessions/current/confirmation (ADR-0008, amendment 2026-10-06): the password of the
   * current session renews its fresh sign-in, so actions behind RequireFreshAuth work again without
   * a new sign-in. Only a password session; failures count in the same lockout as a sign-in.
   */
  async confirm(password: string): Promise<void> {
    const principal = requirePrincipal();
    if (principal.auth !== 'password') {
      throw new ProblemException(403, 'password_session_required');
    }
    const { tenantId, employeeId } = principal;
    // Reserved atomically before any hashing or database call (see LoginLimiter).
    const limiterKey = `reconfirm:${tenantId}:${employeeId}`;
    const attempt = await this.limiter.tryAcquire(limiterKey);
    if (!attempt.allowed) throw new ProblemException(429, 'login_locked');

    const credentials = await this.db.tenantTransaction((trx) =>
      this.repository.findCredentials(trx, tenantId, employeeId),
    );
    const phc = credentials?.passwordHash ?? null;
    const pepperVersion = credentials?.passwordPepperVersion ?? null;
    const verified =
      phc !== null && pepperVersion !== null
        ? await this.hasher.verify(password, phc, pepperVersion)
        : await this.hasher.verifyDummy(password);
    if (!verified) {
      await this.db.tenantTransaction((trx) =>
        this.audit.append(trx, {
          action: 'auth.reconfirm-failed',
          entityType: 'employee',
          entityId: employeeId,
        }),
      );
      throw new FieldProblemException(422, 'invalid_current_password', [
        { field: 'password', code: 'invalid_current_password' },
      ]);
    }
    await this.limiter.reset(limiterKey);
    await this.sessions.update(principal.sessionId, {
      authenticatedAt: new Date().toISOString(),
    });
    await this.db.tenantTransaction((trx) =>
      this.audit.append(trx, {
        action: 'auth.reconfirmed',
        entityType: 'employee',
        entityId: employeeId,
      }),
    );
  }

  private async loginInTenant(
    resolved: ResolvedLogin,
    password: string,
    ip: string,
    key: string,
  ): Promise<LoginResult> {
    const { tenantId, employeeId } = resolved;
    const credentials = await this.db.tenantTransaction((trx) =>
      this.repository.findCredentials(trx, tenantId, employeeId),
    );

    // The password is checked (or a dummy hash, at the same cost) whatever the statuses, so the
    // timing does not tell a blocked network or employee apart. No transaction is held open
    // during scrypt.
    const verified = await this.checkPassword(credentials, password);
    if (!verified.ok) return this.fail(employeeId, verified.reason, ip);
    if (resolved.tenantStatus !== 'active')
      return this.fail(employeeId, 'tenant_blocked', ip);
    if (verified.status !== 'active')
      return this.fail(employeeId, 'employee_inactive', ip);

    // Snapshot of the role's permissions (the owner role: the whole catalog), scope and version.
    const snapshot = await this.loader.reload(tenantId, employeeId);
    if (snapshot === null || snapshot.status !== 'active') {
      return this.fail(employeeId, 'employee_inactive', ip);
    }

    const rehash = this.hasher.needsRehash(verified.phc, verified.pepperVersion)
      ? await this.hasher.hash(password)
      : null;

    const issued = await this.db.tenantTransaction(async (trx) => {
      if (rehash !== null) {
        await this.repository.updatePasswordHash(
          trx,
          tenantId,
          employeeId,
          verified.phc,
          rehash,
        );
      }
      // The success audit, last_login_at and the session commit together.
      await this.audit.append(trx, {
        action: 'auth.login-succeeded',
        entityType: 'employee',
        entityId: employeeId,
        details: { ip },
      });
      return this.issuer.issue(trx, {
        tenantId,
        employeeId,
        auth: 'password',
        snapshot,
      });
    });
    await this.issuer.seedVersion(
      tenantId,
      employeeId,
      snapshot.permissionsVersion,
    );

    await this.limiter.reset(key);
    return {
      token: issued.token,
      maxAgeSeconds: issued.maxAgeSeconds,
      session: issued.session,
    };
  }

  // Exactly one scrypt check per call: the stored hash, or the dummy one when there is none.
  private async checkPassword(
    credentials: LoginCredentials | null,
    password: string,
  ): Promise<PasswordCheck> {
    if (credentials === null) {
      await this.hasher.verifyDummy(password);
      return { ok: false, reason: 'unknown_employee' };
    }
    const {
      status,
      passwordHash: phc,
      passwordPepperVersion: pepperVersion,
    } = credentials;
    if (phc === null || pepperVersion === null) {
      await this.hasher.verifyDummy(password);
      return { ok: false, reason: 'no_password' };
    }
    const ok = await this.hasher.verify(password, phc, pepperVersion);
    return ok
      ? { ok: true, status, phc, pepperVersion }
      : { ok: false, reason: 'invalid_password' };
  }

  // A failed sign-in of a known identifier (already counted by tryAcquire): audited in the tenant,
  // answered as 401.
  private async fail(
    employeeId: string,
    reason: FailureReason,
    ip: string,
  ): Promise<never> {
    try {
      await this.db.tenantTransaction((trx) =>
        this.audit.append(trx, {
          action: 'auth.login-failed',
          entityType: 'employee',
          entityId: employeeId,
          details: { reason, ip },
        }),
      );
    } catch (error) {
      // The answer must stay the same 401: an error here would tell that the identifier exists.
      // Logged, not swallowed silently; the error name only (the message may carry values).
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.error(
        `Could not write the auth.login-failed audit (${name}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
    throw invalidCredentials();
  }

  private async profileOf(
    trx: TenantTransaction,
    view: SessionView & { tenantId: string; employeeId: string },
  ): Promise<EmployeeSession> {
    const profile = await this.requireProfile(
      trx,
      view.tenantId,
      view.employeeId,
    );
    const stores = await this.repository.activeStores(
      trx,
      view.tenantId,
      view.storeScope,
    );
    return buildEmployeeSession(profile, stores, view);
  }

  private async requireProfile(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ) {
    const profile = await this.repository.loadProfile(
      trx,
      tenantId,
      employeeId,
    );
    // The employee of a live session or of a verified password is gone: no profile to show.
    if (profile === null) throw new ProblemException(401, 'unauthenticated');
    return profile;
  }
}
