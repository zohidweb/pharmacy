import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BoundTerminal, TenantTerminal, TerminalCashier } from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requirePrincipal,
  runWithContext,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { randomToken, sha256Hex } from '../../core/crypto';
import {
  ContextResolvers,
  newId,
  type ResolvedTerminal,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { SessionStore } from '../../core/sessions';
import { AuditService } from '../audit/audit.service';
import { sessionStoreMode } from '../auth/session-profile';
import { isUniqueViolation, TerminalsRepository } from './terminals.repository';

export interface BindResult {
  /** The device secret for the device-cookie; never in a response body or a log. */
  secret: string;
  terminal: BoundTerminal;
}

/** A terminal resolved from this browser's device-cookie. */
export interface DeviceTerminal extends ResolvedTerminal {
  /** Hex SHA-256 of the device secret, kept in a PIN session. */
  credentialHash: string;
}

const notBound = () => new ProblemException(404, 'not_bound');

/** «Имя Ф.» from a full name «Фамилия Имя [Отчество]»; a single word stays as it is. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[1]} ${parts[0].charAt(0)}.`;
}

// Terminals of the web contour (auth design 2026-10-02, section 8): binding a browser to a store,
// the terminal of this browser and revocation. The device secret lives only in the device-cookie;
// the database and the session keep its SHA-256.
@Injectable()
export class TerminalsService {
  private readonly logger = new Logger(TerminalsService.name);
  private readonly revocationTtlSeconds: number;

  constructor(
    private readonly resolvers: ContextResolvers,
    private readonly db: TenantDatabase,
    private readonly repository: TerminalsRepository,
    private readonly sessions: SessionStore,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    // The revocation flag outlives every session created before the revocation.
    this.revocationTtlSeconds = config.getOrThrow<number>(
      'SESSION_ABSOLUTE_TTL_SECONDS',
    );
  }

  /**
   * The terminal of a device secret, or 404 not_bound when there is none, it is revoked or its
   * network is not active.
   */
  async resolveDevice(secret: string | null): Promise<DeviceTerminal> {
    if (secret === null) throw notBound();
    const credentialHash = sha256Hex(secret);
    const resolved = await this.resolvers.resolveTerminal(
      Buffer.from(credentialHash, 'hex'),
    );
    if (
      resolved === null ||
      resolved.revoked ||
      resolved.tenantStatus !== 'active'
    ) {
      throw notBound();
    }
    return { ...resolved, credentialHash };
  }

  /** GET /terminals/current: runs in the terminal's tenant, without a principal. */
  async current(secret: string | null): Promise<BoundTerminal> {
    const device = await this.resolveDevice(secret);
    return this.inTerminalTenant(device, async () =>
      this.db.tenantTransaction(async (trx) => {
        await this.repository.touchLastSeen(
          trx,
          device.tenantId,
          device.terminalId,
        );
        const view = await this.view(trx, device.tenantId, device.terminalId);
        if (view === null) throw notBound();
        return view;
      }),
    );
  }

  /** Runs work in the tenant of a resolved terminal, keeping the request's correlation id. */
  inTerminalTenant<T>(device: ResolvedTerminal, work: () => Promise<T>): Promise<T> {
    return runWithContext(
      {
        correlationId: getRequestContext()?.correlationId ?? randomUUID(),
        tenantId: device.tenantId,
        principal: null,
      },
      work,
    );
  }

  /**
   * POST /terminals. A terminal this browser already holds in the same network is revoked first;
   * the new row, its audit and the old one's revocation commit together.
   */
  async bind(
    currentSecret: string | null,
    storeId: string,
    name: string,
  ): Promise<BindResult> {
    const principal = requirePrincipal();
    const store = storeId.toLowerCase();
    const previous = await this.previousTerminal(currentSecret, principal.tenantId);

    const secret = randomToken(32);
    const credentialHash = Buffer.from(sha256Hex(secret), 'hex');
    const terminalId = newId();

    const terminal = await this.db.tenantTransaction(async (trx) => {
      const row = await this.repository.findStore(trx, principal.tenantId, store);
      if (row === null || row.status !== 'active') {
        throw new ProblemException(404, 'not_found');
      }
      if (row.kind !== 'pharmacy') {
        throw new ProblemException(422, 'store_not_pharmacy');
      }
      if (previous !== null) {
        await this.revokeInTransaction(trx, principal.tenantId, previous, principal.employeeId);
      }
      try {
        await this.repository.insertTerminal(trx, {
          tenantId: principal.tenantId,
          id: terminalId,
          storeId: store,
          name,
          credentialHash,
          boundBy: principal.employeeId,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ProblemException(409, 'terminal_name_taken');
        }
        throw error;
      }
      await this.audit.append(trx, {
        action: 'terminal.bound',
        entityType: 'terminal',
        entityId: terminalId,
        details: { storeId: store, name },
      });
      const view = await this.view(trx, principal.tenantId, terminalId);
      if (view === null) throw new Error('The terminal just bound is not readable');
      return view;
    });

    if (previous !== null) {
      await this.afterRevoke(principal.tenantId, previous);
    }
    return { secret, terminal };
  }

  /** GET /terminals — active terminals of the stores in the principal's scope (spec 2026-10-06-staff-design). */
  async list(): Promise<TenantTerminal[]> {
    const { tenantId, storeScope } = requirePrincipal();
    return this.db.tenantTransaction((trx) =>
      this.repository.listTerminals(trx, tenantId, storeScope),
    );
  }

  /**
   * DELETE /terminals/{id}. A terminal outside the principal's store scope does not exist for
   * him (404). Revoking an already revoked terminal repeats only the session cleanup, so a retry
   * after a Redis failure completes it.
   */
  async revoke(terminalId: string): Promise<void> {
    const principal = requirePrincipal();
    const id = terminalId.toLowerCase();
    await this.db.tenantTransaction(async (trx) => {
      const terminal = await this.repository.findTerminal(trx, principal.tenantId, id);
      if (
        terminal === null ||
        (principal.storeScope !== 'all' &&
          !principal.storeScope.includes(terminal.storeId))
      ) {
        throw new ProblemException(404, 'not_found');
      }
      if (terminal.revokedAt === null) {
        await this.revokeInTransaction(trx, principal.tenantId, id, principal.employeeId);
      }
    });
    await this.afterRevoke(principal.tenantId, id);
  }

  // The active terminal this browser holds in the principal's network, if any.
  private async previousTerminal(
    secret: string | null,
    tenantId: string,
  ): Promise<string | null> {
    if (secret === null) return null;
    const resolved = await this.resolvers.resolveTerminal(
      Buffer.from(sha256Hex(secret), 'hex'),
    );
    if (resolved === null || resolved.revoked || resolved.tenantId !== tenantId) {
      return null;
    }
    return resolved.terminalId;
  }

  private async revokeInTransaction(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
    revokedBy: string,
  ): Promise<void> {
    if (await this.repository.revoke(trx, tenantId, terminalId, revokedBy)) {
      await this.audit.append(trx, {
        action: 'terminal.revoked',
        entityType: 'terminal',
        entityId: terminalId,
      });
    }
  }

  // After the commit: the flag every PIN session of the terminal checks, then its live session.
  // A failure is answered as an error, so the caller retries; the database already says revoked.
  private async afterRevoke(tenantId: string, terminalId: string): Promise<void> {
    try {
      await this.sessions.markTerminalRevoked(
        tenantId,
        terminalId,
        this.revocationTtlSeconds,
      );
      await this.sessions.destroyForTerminal(tenantId, terminalId);
    } catch (error) {
      this.logger.error(
        `Terminal sessions were not ended after revocation (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
      throw error;
    }
  }

  private async view(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<BoundTerminal | null> {
    const terminal = await this.repository.findTerminal(trx, tenantId, terminalId);
    if (terminal === null || terminal.revokedAt !== null) return null;
    const store = await this.repository.findStore(trx, tenantId, terminal.storeId);
    if (store === null) return null;
    const cashiers: TerminalCashier[] = (
      await this.repository.cashiers(trx, tenantId, terminal.storeId)
    ).map((row) => ({ employeeId: row.employeeId, shortName: shortName(row.fullName) }));
    return {
      id: terminal.id,
      name: terminal.name,
      store: {
        id: store.id,
        name: store.name,
        address: store.address,
        mode: sessionStoreMode(store.mode),
      },
      cashiers,
      pinLength: await this.repository.pinMinLength(trx, tenantId),
    };
  }
}
