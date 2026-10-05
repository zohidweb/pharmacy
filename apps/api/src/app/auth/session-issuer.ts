import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import { getRequestContext } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { SessionTokenService } from '../../core/crypto';
import type { TenantTransaction } from '../../core/database';
import {
  PermissionsVersionCache,
  type SessionRecord,
  SessionStore,
} from '../../core/sessions';
import { EmployeeAuthRepository } from './employee-auth.repository';
import type { PrincipalSnapshot } from './principal-loader';
import {
  buildEmployeeSession,
  idleTtlSeconds,
  uiLocale,
} from './session-profile';

/** The terminal a PIN session is bound to (auth design 2026-10-02, section 8). */
export interface SessionTerminal {
  terminalId: string;
  storeId: string;
  /** Hex SHA-256 of the device secret. */
  credentialHash: string;
}

export interface IssueSessionInput {
  tenantId: string;
  employeeId: string;
  auth: 'password' | 'pin';
  /** Permissions, scope and version the session snapshot is built from. */
  snapshot: PrincipalSnapshot;
  terminal?: SessionTerminal;
}

export interface IssuedSession {
  /** Session JWT for the cookie; never in a response body or a log. */
  token: string;
  maxAgeSeconds: number;
  session: EmployeeSession;
  record: SessionRecord;
}

// Creates a server session and its JWT for an employee whose credentials the caller has already
// verified (password sign-in, PIN sign-in). Runs inside the caller's tenant transaction, so the
// caller's audit and last_login_at commit with it; the session is stored last, so a store failure
// rolls them back. A PIN session's scope and working store are the terminal's store only.
@Injectable()
export class SessionIssuer {
  private readonly logger = new Logger(SessionIssuer.name);
  private readonly idleMinSeconds: number;
  private readonly idleMaxSeconds: number;
  private readonly absoluteTtlSeconds: number;

  constructor(
    private readonly repository: EmployeeAuthRepository,
    private readonly tokens: SessionTokenService,
    private readonly sessions: SessionStore,
    private readonly versions: PermissionsVersionCache,
    config: ConfigService,
  ) {
    this.idleMinSeconds = config.getOrThrow<number>(
      'SESSION_IDLE_TIMEOUT_MIN_SECONDS',
    );
    this.idleMaxSeconds = config.getOrThrow<number>(
      'SESSION_IDLE_TIMEOUT_MAX_SECONDS',
    );
    this.absoluteTtlSeconds = config.getOrThrow<number>(
      'SESSION_ABSOLUTE_TTL_SECONDS',
    );
  }

  get absoluteTtl(): number {
    return this.absoluteTtlSeconds;
  }

  async issue(
    trx: TenantTransaction,
    input: IssueSessionInput,
  ): Promise<IssuedSession> {
    const { tenantId, employeeId, snapshot, terminal } = input;
    const now = Date.now();
    const sessionId = randomUUID();
    const token = await this.tokens.sign(
      { jti: sessionId, sub: employeeId, tid: tenantId, aud: 'web' },
      this.absoluteTtlSeconds,
    );

    const profile = await this.repository.loadProfile(trx, tenantId, employeeId);
    // The employee of a verified credential is gone: no profile to show.
    if (profile === null) throw new ProblemException(401, 'unauthenticated');
    const storeScope: 'all' | string[] = terminal
      ? [terminal.storeId]
      : snapshot.storeScope;
    const stores = await this.repository.activeStores(trx, tenantId, storeScope);
    await this.repository.recordLogin(trx, tenantId, employeeId);

    const record: SessionRecord = {
      sessionId,
      tenantId,
      employeeId,
      auth: input.auth,
      authenticatedAt: new Date(now).toISOString(),
      permissions: snapshot.permissions,
      permissionsVersion: snapshot.permissionsVersion,
      storeScope,
      // A terminal works in its store; otherwise the only store of the scope is chosen and the
      // web asks when there are several (section 6, step 6).
      currentStoreId: terminal
        ? terminal.storeId
        : stores.length === 1
          ? stores[0].id
          : null,
      terminalId: terminal?.terminalId ?? null,
      terminalCredentialHash: terminal?.credentialHash ?? null,
      locale: uiLocale(
        profile.employee.language,
        profile.settings.defaultLanguage,
      ),
      idleTtlSeconds: idleTtlSeconds(
        profile.settings.cashierSessionIdleMin,
        this.idleMinSeconds,
        this.idleMaxSeconds,
      ),
      absoluteExpiresAt: new Date(
        now + this.absoluteTtlSeconds * 1000,
      ).toISOString(),
    };
    await this.sessions.create(record);
    return {
      token,
      maxAgeSeconds: this.absoluteTtlSeconds,
      session: buildEmployeeSession(profile, stores, record),
      record,
    };
  }

  // After the commit: seed the cache with the version the snapshot was built from, so the first
  // request of the session does not take the cache-miss path. Only a hint: a failure is logged
  // and does not undo the sign-in.
  async seedVersion(
    tenantId: string,
    employeeId: string,
    version: number,
  ): Promise<void> {
    try {
      await this.versions.setIfGreater(tenantId, employeeId, version);
    } catch (error) {
      this.logger.warn(
        `Permissions version seed failed (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
  }
}
