import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import { getRequestContext } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { PasswordHasher } from '../../core/crypto';
import { TenantDatabase } from '../../core/database';
import { SessionStore } from '../../core/sessions';
import { AuditService } from '../audit/audit.service';
import type { LoginLimiter } from '../auth/login-limiter';
import { PrincipalLoader } from '../auth/principal-loader';
import { SessionIssuer } from '../auth/session-issuer';
import { TerminalsRepository } from './terminals.repository';
import { type DeviceTerminal, TerminalsService } from './terminals.service';

/** DI token of the per-terminal PIN failure limiter (TERMINAL_PIN_* settings). */
export const TERMINAL_PIN_LIMITER = Symbol('TERMINAL_PIN_LIMITER');

export interface PinLoginResult {
  /** Session JWT for the cookie; never in a response body or a log. */
  token: string;
  maxAgeSeconds: number;
  session: EmployeeSession;
}

/** Why a PIN sign-in failed: audit details, never shown to the client. */
type PinFailureReason =
  | 'invalid_pin'
  | 'no_pin'
  | 'unknown_employee'
  | 'employee_inactive'
  | 'no_store_access';

// One answer for an unknown, inactive or unassigned employee and a wrong PIN (plan decision P2).
const invalidPin = () => new ProblemException(401, 'invalid_pin');
const pinLocked = () => new ProblemException(423, 'pin_locked');

// PIN sign-in on a bound terminal (auth design 2026-10-02, section 8), checks in order: the
// terminal, its failure counter, the employee (active, with access to the store, a PIN set), the
// PIN lock, scrypt. PINs and hashes are never logged or audited.
@Injectable()
export class TerminalSessionsService {
  private readonly logger = new Logger(TerminalSessionsService.name);

  constructor(
    private readonly terminals: TerminalsService,
    private readonly db: TenantDatabase,
    private readonly repository: TerminalsRepository,
    private readonly loader: PrincipalLoader,
    private readonly hasher: PasswordHasher,
    private readonly issuer: SessionIssuer,
    private readonly sessions: SessionStore,
    @Inject(TERMINAL_PIN_LIMITER) private readonly limiter: LoginLimiter,
    private readonly audit: AuditService,
  ) {}

  async login(
    deviceSecret: string | null,
    employeeId: string,
    pin: string,
  ): Promise<PinLoginResult> {
    // The session this browser already holds (a password session or another cashier's PIN
    // session) ends with the sign-in.
    const previousSessionId = getRequestContext()?.principal?.sessionId ?? null;

    // Step 1: the terminal.
    const device = await this.terminals.resolveDevice(deviceSecret);

    // Step 2: the terminal's counter, reserved before any hashing.
    const key = `terminal-pin:${device.terminalId}`;
    const attempt = await this.limiter.tryAcquire(key);
    if (!attempt.allowed) throw new ProblemException(423, 'terminal_locked');

    const result = await this.terminals.inTerminalTenant(device, () =>
      this.loginInTenant(device, employeeId.toLowerCase(), pin),
    );

    await this.limiter.reset(key);
    if (previousSessionId !== null) {
      await this.sessions.destroy(previousSessionId);
    }
    return result;
  }

  private async loginInTenant(
    device: DeviceTerminal,
    employeeId: string,
    pin: string,
  ): Promise<PinLoginResult> {
    const { tenantId, terminalId, storeId } = device;

    // Step 3: the employee at the terminal's store.
    const candidate = await this.db.tenantTransaction((trx) =>
      this.repository.pinCandidate(trx, tenantId, employeeId, storeId),
    );
    if (candidate === null) {
      return this.fail(device, null, 'unknown_employee');
    }
    if (candidate.status !== 'active') {
      return this.fail(device, employeeId, 'employee_inactive');
    }
    if (!candidate.hasStoreAccess) {
      return this.fail(device, employeeId, 'no_store_access');
    }
    if (candidate.pinHash === null || candidate.pinPepperVersion === null) {
      return this.fail(device, employeeId, 'no_pin');
    }

    // Step 4: a locked PIN signs in by password only.
    if (candidate.pinLockedAt !== null) throw pinLocked();

    // The attempt is counted before scrypt (see reservePinAttempt): a burst of concurrent PINs
    // gets no more than PIN_MAX_FAILED_ATTEMPTS checks before the lock.
    const reserved = await this.db.tenantTransaction((trx) =>
      this.repository.reservePinAttempt(trx, tenantId, employeeId),
    );
    if (reserved === null) throw pinLocked();

    // Step 5: scrypt; no transaction is held open meanwhile.
    const ok = await this.hasher.verify(
      pin,
      candidate.pinHash,
      candidate.pinPepperVersion,
    );
    if (!ok) {
      await this.db.tenantTransaction((trx) =>
        this.audit.append(trx, {
          action: reserved.locked ? 'auth.pin-locked' : 'auth.pin-failed',
          entityType: 'employee',
          entityId: employeeId,
          storeId,
          details: { terminalId, attempts: reserved.attempts },
        }),
      );
      throw reserved.locked ? pinLocked() : invalidPin();
    }

    // The role's permissions and the version; the scope becomes the terminal's store.
    const snapshot = await this.loader.reload(tenantId, employeeId);
    if (snapshot === null || snapshot.status !== 'active') {
      return this.fail(device, employeeId, 'employee_inactive');
    }

    // One PIN session per terminal: the previous cashier's session ends before the new one starts.
    await this.sessions.destroyForTerminal(tenantId, terminalId);

    const issued = await this.db.tenantTransaction(async (trx) => {
      await this.repository.clearPinFailures(trx, tenantId, employeeId);
      await this.repository.touchLastSeen(trx, tenantId, terminalId);
      await this.audit.append(trx, {
        action: 'auth.pin-succeeded',
        entityType: 'employee',
        entityId: employeeId,
        storeId,
        details: { terminalId },
      });
      return this.issuer.issue(trx, {
        tenantId,
        employeeId,
        auth: 'pin',
        snapshot,
        terminal: {
          terminalId,
          storeId,
          credentialHash: device.credentialHash,
        },
      });
    });
    await this.issuer.seedVersion(tenantId, employeeId, snapshot.permissionsVersion);

    return {
      token: issued.token,
      maxAgeSeconds: issued.maxAgeSeconds,
      session: issued.session,
    };
  }

  // A failure that does not count against the employee's PIN (already counted on the terminal):
  // audited when the employee is known, answered as 401 invalid_pin.
  private async fail(
    device: DeviceTerminal,
    employeeId: string | null,
    reason: PinFailureReason,
  ): Promise<never> {
    if (employeeId !== null) {
      try {
        await this.db.tenantTransaction((trx) =>
          this.audit.append(trx, {
            action: 'auth.pin-failed',
            entityType: 'employee',
            entityId: employeeId,
            storeId: device.storeId,
            details: { terminalId: device.terminalId, reason },
          }),
        );
      } catch (error) {
        // The answer must stay the same 401; logged, not swallowed silently.
        this.logger.error(
          `Could not write the auth.pin-failed audit (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
        );
      }
    }
    throw invalidPin();
  }
}
