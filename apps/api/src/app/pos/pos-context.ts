import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hasPermissions, type Permission } from '@pharmacy/shared-domain';
import type { PosOperationContext } from '@pharmacy/shared-dto';
import {
  getRequestContext,
  getTerminal,
  requirePrincipal,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { PinSignIns } from '../audit/pin-sign-ins';
import { PrincipalLoader } from '../auth/principal-loader';
import { PosRepository, type PosStore } from './pos.repository';
import { ShiftsRepository } from './shifts.repository';
import { AUTHOR_SIGN_IN_TOLERANCE_MS, heldBy } from './terminal-holder';

const HOUR_MS = 3_600_000;

/** The PIN session of a bound terminal: the only place the POS works (K6). */
export interface TerminalSession {
  tenantId: string;
  storeId: string;
  terminalId: string;
  employeeId: string;
}

/**
 * Who sends a buffered operation: the PIN session of the terminal, or the bound terminal itself (spec
 * 2026-10-21-pos-offline-limits, P9) — then `employeeId` is the employee of the session the request had, null
 * without one.
 */
export interface BufferSession extends Omit<TerminalSession, 'employeeId'> {
  employeeId: string | null;
  via: 'session' | 'terminal';
}

/** The author of an operation as of now (K7): a mark instead of a refusal. */
export interface OperationAuthor {
  id: string;
  /** Inactive now, the store out of the scope, or without the right of the operation. */
  flagged: boolean;
  /** Rights of the author now: the rights of the lines of a receipt are checked by them (E7). */
  permissions: readonly Permission[];
}

/** A buffered operation of the POS, checked against the session or the terminal (spec 4.2; P9). */
export interface PosOperation extends BufferSession {
  author: OperationAuthor;
  /** The moment of the PC (untrusted): the caller clamps it (E4). */
  occurredAt: Date;
  receivedAt: Date;
  correlationId: string;
  /**
   * The floor P10 bounded the moment by when it checked the author under the terminal; absent in the PIN session of
   * the author. The opening of a shift compares it with the last closing it reads itself.
   */
  authorFloor?: Date | null;
}

/**
 * The audit of an operation sent under the terminal (spec 2026-10-21-pos-offline-limits, P11): its author is the
 * employee of the row (there is no principal), and the details say `via: 'terminal'`.
 */
export const terminalAuthor = (
  op: PosOperation,
): { employeeId?: string; terminalId?: string } =>
  op.via === 'terminal'
    ? { employeeId: op.author.id, terminalId: op.terminalId }
    : {};
export const terminalVia = (op: PosOperation): { via?: 'terminal' } =>
  op.via === 'terminal' ? { via: 'terminal' } : {};

/** The oldest moment of an operation (E4). */
const HORIZON_MS = 30 * 24 * HOUR_MS;

/**
 * The moment of an operation (E4): the corrected PC clock, but not after the server got it, not before `floor` and not
 * more than 30 days back; never after the server got it, whatever the floor.
 */
export function boundedMoment(
  occurredAt: Date,
  receivedAt: Date,
  floor: Date | null,
): Date {
  const at = Math.max(
    Math.min(occurredAt.getTime(), receivedAt.getTime()),
    receivedAt.getTime() - HORIZON_MS,
  );
  return new Date(
    floor === null
      ? at
      : Math.max(at, Math.min(floor.getTime(), receivedAt.getTime())),
  );
}

/**
 * What the P10 moment of an operation may not precede (E4): the opening of its shift for a receipt or a cash
 * operation, the last closing of a shift of the terminal for an opening. Without the second an opening dated back
 * would name any past holder of the terminal its author and move the floor of its whole shift back with it.
 */
export type MomentFloor = { shiftId: string } | 'shift-opening';

/** An operation delivered within this of its moment was made online (`origin`, M10). */
export const ONLINE_WITHIN_MS = 60_000;

// The context of the POS operations (spec 2026-10-13-pos-shift-sale, 4.2, K6, K7, E3): the PIN
// session of the terminal, the operation of this terminal and store, the author as of now.
@Injectable()
export class PosContext {
  constructor(
    private readonly repository: PosRepository,
    private readonly principals: PrincipalLoader,
    private readonly db: TenantDatabase,
    private readonly signIns: PinSignIns,
    private readonly shifts: ShiftsRepository,
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

  /** The terminal a buffered operation is sent under (BufferReplayInterceptor), else the PIN session. */
  private bufferSession(): BufferSession {
    const terminal = getTerminal();
    if (terminal) {
      return {
        tenantId: terminal.tenantId,
        storeId: terminal.storeId,
        terminalId: terminal.terminalId,
        employeeId: terminal.sessionEmployeeId,
        via: 'terminal',
      };
    }
    return { ...this.terminalSession(), via: 'session' };
  }

  /**
   * The store of a repeat of an accepted operation: its stored answer is read before the rest of the session check
   * (final review M4), so it goes only to the PIN session or the terminal of the operation's store — 409
   * `wrong_terminal` otherwise, as the operation itself. A browser rebound to another store sends no buffer of the old
   * one (У15), so no legitimate repeat is refused.
   */
  requireStore(storeId: string): void {
    if (storeId.toLowerCase() !== this.bufferSession().storeId) {
      throw new ProblemException(409, 'wrong_terminal');
    }
  }

  /**
   * An operation of the buffer: of the terminal and store of the session (409 `wrong_terminal` —
   * a quarantine, not a pause of the buffer), the author an employee of the network (422
   * `author_not_allowed`), flagged when inactive, out of the store or without `right` now.
   */
  async operation(
    body: PosOperationContext,
    right: Permission,
    sentAt: string | undefined,
    floor: MomentFloor,
  ): Promise<PosOperation> {
    const session = this.bufferSession();
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
    // under the terminal the author must have held it at the moment of the operation (P10)
    const checked =
      session.via === 'terminal'
        ? await this.requireHolder(
            session,
            author.id,
            occurredAt,
            receivedAt,
            floor,
          )
        : null;
    // an online operation of another employee than the one signed in is marked too (M10); under the terminal with no
    // session nobody signed in, so a live operation is always marked. The moment is the bounded one: a moment stated
    // before the floor is moved to it and may be live.
    const moment = checked?.moment ?? occurredAt;
    if (
      author.id !== session.employeeId &&
      receivedAt.getTime() - moment.getTime() < ONLINE_WITHIN_MS
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
      ...(checked ? { authorFloor: checked.floor } : {}),
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

  /**
   * The PIN sign-ins of the terminal no older than the buffer limit of the network before the moment: the author
   * held the terminal at `moment ± 5 min`, else 422 `author_session_missing` — the buffer keeps it in quarantine. The
   * moment is the one of E4 (not after the receipt, not older than 30 days, not before `floor`): a moment the client
   * states freely would let it pick any past holder of the terminal.
   */
  private async requireHolder(
    session: BufferSession,
    authorId: string,
    occurredAt: Date,
    receivedAt: Date,
    floor: MomentFloor,
  ): Promise<{ moment: Date; floor: Date | null }> {
    const checked = await this.db.tenantTransaction(async (trx) => {
      const { bufferLimits } = await this.repository.settings(
        trx,
        session.tenantId,
      );
      const from = await this.floorAt(trx, session, floor);
      const moment = boundedMoment(occurredAt, receivedAt, from);
      const signIns = await this.signIns.between(
        trx,
        session.tenantId,
        session.storeId,
        session.terminalId,
        new Date(moment.getTime() - bufferLimits.maxHours * HOUR_MS),
        new Date(moment.getTime() + AUTHOR_SIGN_IN_TOLERANCE_MS),
      );
      const held = heldBy(
        signIns,
        authorId,
        moment,
        AUTHOR_SIGN_IN_TOLERANCE_MS,
      );
      return { held, moment, floor: from };
    });
    if (!checked.held)
      throw new ProblemException(422, 'author_session_missing');
    return { moment: checked.moment, floor: checked.floor };
  }

  private async floorAt(
    trx: TenantTransaction,
    session: BufferSession,
    floor: MomentFloor,
  ): Promise<Date | null> {
    if (floor === 'shift-opening') {
      return this.shifts.lastClosedAt(
        trx,
        session.tenantId,
        session.terminalId,
      );
    }
    const shift = await this.shifts.findShift(
      trx,
      session.tenantId,
      floor.shiftId,
    );
    return shift && shift.terminalId === session.terminalId
      ? shift.openedAt
      : null;
  }

  private async author(
    session: BufferSession,
    employeeId: string,
    right: Permission,
  ): Promise<OperationAuthor> {
    if (session.via === 'session') {
      // another author goes under the terminal (bufferReplayMode): reaching here is a wiring error, refused
      if (employeeId !== session.employeeId) {
        throw new Error(
          'An operation of another author must be sent under the terminal',
        );
      }
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
