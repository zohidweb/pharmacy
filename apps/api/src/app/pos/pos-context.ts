import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hasPermissions, type Permission } from '@pharmacy/shared-domain';
import type { PosOperationContext } from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requirePrincipal,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import type { TenantTransaction } from '../../core/database';
import { PrincipalLoader } from '../auth/principal-loader';
import { PosRepository, type PosStore } from './pos.repository';

/** The PIN session of a bound terminal: the only place the POS works (K6). */
export interface TerminalSession {
  tenantId: string;
  storeId: string;
  terminalId: string;
  employeeId: string;
}

/** The author of an operation as of now (K7): a mark instead of a refusal. */
export interface OperationAuthor {
  id: string;
  /** Inactive now, the store out of the scope, or without the right of the operation. */
  flagged: boolean;
  /** Rights of the author now: the rights of the lines of a receipt are checked by them (E7). */
  permissions: readonly Permission[];
}

/** A buffered operation of the POS, checked against the session (spec 4.2). */
export interface PosOperation extends TerminalSession {
  author: OperationAuthor;
  /** The moment of the PC (untrusted): the caller clamps it (E4). */
  occurredAt: Date;
  receivedAt: Date;
  correlationId: string;
}

/** An operation delivered within this of its moment was made online (`origin`, M10). */
export const ONLINE_WITHIN_MS = 60_000;

// The context of the POS operations (spec 2026-10-13-pos-shift-sale, 4.2, K6, K7, E3): the PIN
// session of the terminal, the operation of this terminal and store, the author as of now.
@Injectable()
export class PosContext {
  constructor(
    private readonly repository: PosRepository,
    private readonly principals: PrincipalLoader,
  ) {}

  /** The PIN session of a bound terminal, else 403 `terminal_required`. */
  terminalSession(): TerminalSession {
    const principal = requirePrincipal();
    if (
      principal.auth !== 'pin' ||
      principal.terminalId === null ||
      principal.currentStoreId === null
    ) {
      throw new ProblemException(403, 'terminal_required');
    }
    return {
      tenantId: principal.tenantId,
      storeId: principal.currentStoreId,
      terminalId: principal.terminalId,
      employeeId: principal.employeeId,
    };
  }

  /**
   * An operation of the buffer: of the terminal and store of the session (409 `wrong_terminal` —
   * a quarantine, not a pause of the buffer), the author an employee of the network (422
   * `author_not_allowed`), flagged when inactive, out of the store or without `right` now.
   */
  async operation(
    body: PosOperationContext,
    right: Permission,
    sentAt?: string,
  ): Promise<PosOperation> {
    const session = this.terminalSession();
    if (
      body.storeId.toLowerCase() !== session.storeId ||
      (body.terminalId ?? '').toLowerCase() !== session.terminalId
    ) {
      throw new ProblemException(409, 'wrong_terminal');
    }
    const stated = new Date(body.occurredAt);
    if (Number.isNaN(stated.getTime())) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'occurredAt', code: 'date' },
      ]);
    }
    const receivedAt = new Date();
    // the clock of the PC may be off: the terminal states when it sent the operation, and the
    // difference with the clock of the server moves the moment of the operation (M8)
    const sent = sentAt ? new Date(sentAt) : null;
    const skew =
      sent && !Number.isNaN(sent.getTime())
        ? receivedAt.getTime() - sent.getTime()
        : 0;
    const occurredAt = new Date(stated.getTime() + skew);
    const author = await this.author(
      session,
      body.employeeId.toLowerCase(),
      right,
    );
    // an online operation of another employee than the one signed in is marked too (M10)
    if (
      author.id !== session.employeeId &&
      receivedAt.getTime() - occurredAt.getTime() < ONLINE_WITHIN_MS
    ) {
      author.flagged = true;
    }
    return {
      ...session,
      author,
      occurredAt,
      receivedAt,
      // never empty: unreachable today (the principal needs a request), kept so that a
      // financial operation always carries a correlation id
      correlationId: getRequestContext()?.correlationId ?? randomUUID(),
    };
  }

  /**
   * An active cloud store of the network, else 404 / 409 `offline_store_read_only` (E19). The opening
   * of a shift reads it `FOR SHARE`: a closing of the store (spec 2026-10-15-store-closing) holds the
   * row `FOR UPDATE`, so the opening waits and sees the store `closing`.
   */
  async cloudStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    options: { lock?: 'share' } = {},
  ): Promise<PosStore> {
    const store = await this.repository.store(trx, tenantId, storeId, options);
    if (store === null || store.status !== 'active') {
      throw new ProblemException(404, 'not_found');
    }
    if (store.mode !== 'online') {
      throw new ProblemException(409, 'offline_store_read_only');
    }
    return store;
  }

  /** The store is in the scope of the session (a PIN session — its own store only). */
  inScope(storeId: string): void {
    const principal = requirePrincipal();
    const allowed =
      principal.auth === 'pin'
        ? principal.currentStoreId === storeId
        : principal.storeScope === 'all' ||
          principal.storeScope.includes(storeId);
    if (!allowed) throw new ProblemException(403, 'store_not_in_scope');
  }

  private async author(
    session: TerminalSession,
    employeeId: string,
    right: Permission,
  ): Promise<OperationAuthor> {
    if (employeeId === session.employeeId) {
      const principal = requirePrincipal();
      return {
        id: employeeId,
        flagged: !hasPermissions(principal.permissions, right),
        permissions: principal.permissions,
      };
    }
    // another cashier of the terminal sold it and the buffer sends it now (E3)
    const snapshot = await this.principals.reload(session.tenantId, employeeId);
    if (snapshot === null) {
      throw new ProblemException(422, 'author_not_allowed');
    }
    const inStore =
      snapshot.storeScope === 'all' ||
      snapshot.storeScope.includes(session.storeId);
    return {
      id: employeeId,
      flagged:
        snapshot.status !== 'active' ||
        snapshot.tenantStatus !== 'active' ||
        !inStore ||
        !hasPermissions(snapshot.permissions, right),
      permissions:
        snapshot.status === 'active' && inStore ? snapshot.permissions : [],
    };
  }
}
