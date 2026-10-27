import { Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  ReceiptPaymentMethod,
  Shift,
  ShiftDetails,
  ShiftListItem,
  ShiftListResponse,
  ZReport,
} from '@pharmacy/shared-dto';
import {
  type EmployeePrincipal,
  requirePrincipal,
  requireTenantId,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { Numbering } from '../inventory/numbering';
import { TerminalRevocationChecks } from '../terminals/terminal-revocation-checks';
import { TerminalsService } from '../terminals/terminals.service';
import type {
  CashMovementDto,
  CloseShiftDto,
  ForceCloseShiftDto,
  OpenShiftDto,
  ShiftListQueryDto,
} from './dto/pos.dto';
import { PosIdempotency } from './idempotency';
import {
  boundedMoment,
  PosContext,
  type PosOperation,
  terminalAuthor,
  terminalVia,
} from './pos-context';
import { PosRepository } from './pos.repository';
import { ShiftMapper } from './shift-mapper';
import {
  isOpenShiftConflict,
  type ShiftRow,
  ShiftsRepository,
} from './shifts.repository';

const IN_REASONS = new Set(['change_fund', 'other']);
const DEFAULT_LIMIT = 20;
const OUT_REASONS = new Set(['collection', 'expense']);
const BANK: Array<Exclude<ReceiptPaymentMethod, 'cash'>> = ['card', 'qr', 'nfc'];

/** The stores whose shifts an employee sees: a PIN session — the store of its terminal only. */
function viewScope(principal: EmployeePrincipal): 'all' | readonly string[] {
  if (principal.auth === 'pin') {
    return principal.currentStoreId ? [principal.currentStoreId] : [];
  }
  return principal.storeScope;
}

/** A buffered operation is never older than this (a broken clock of the PC, M8). */
/** The moment of an operation (E4), see `boundedMoment`. */
export function operationMoment(op: PosOperation, floor: Date | null): Date {
  return boundedMoment(op.occurredAt, op.receivedAt, floor);
}

// The shift of a terminal (spec 2026-10-13-pos-shift-sale, 4.4, K5, E24): one open per terminal,
// cash in and out, the closing as a fact with the Z-report saved for a reprint. Every operation of
// the buffer runs under its idempotency key (E11).
@Injectable()
export class ShiftsService implements OnModuleInit {
  constructor(
    private readonly db: TenantDatabase,
    private readonly context: PosContext,
    private readonly idempotency: PosIdempotency,
    private readonly repository: PosRepository,
    private readonly shifts: ShiftsRepository,
    private readonly mapper: ShiftMapper,
    private readonly numbering: Numbering,
    private readonly audit: AuditService,
    private readonly revocations: TerminalRevocationChecks,
    private readonly terminals: TerminalsService,
  ) {}

  onModuleInit(): void {
    // a terminal with an open shift is not unbound: close the shift first (E14)
    this.revocations.register(async (trx, tenantId, terminalId) => {
      if (await this.shifts.openShiftOfTerminal(trx, tenantId, terminalId)) {
        throw new ProblemException(409, 'shift_open');
      }
    });
  }

  /**
   * The open shift of the terminal locked for the transaction, else 409: none or of another
   * terminal — `no_open_shift`, closed — `shift_closed`. `accept-forced` returns a shift of the terminal closed from
   * another computer too (plan 2026-10-27-shift-history, S4): its late operations are kept; the caller reads
   * `status`.
   */
  async lockOpenShift(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
    terminalId: string,
    mode: 'share' | 'update',
    late: 'refuse' | 'accept-forced' = 'refuse',
  ): Promise<ShiftRow> {
    const shift = await this.shifts.lockShift(
      trx,
      tenantId,
      shiftId.toLowerCase(),
      mode,
    );
    if (shift === null || shift.terminalId !== terminalId) {
      throw new ProblemException(409, 'no_open_shift');
    }
    if (shift.status !== 'open' && !(late === 'accept-forced' && shift.forced)) {
      throw new ProblemException(409, 'shift_closed');
    }
    return shift;
  }

  /** GET /shifts/current — the open shift of the terminal of the session. */
  async current(): Promise<Shift> {
    const session = this.context.terminalSession();
    return this.db.tenantTransaction(async (trx) => {
      const shift = await this.shifts.openShiftOfTerminal(
        trx,
        session.tenantId,
        session.terminalId,
      );
      if (shift === null) throw new ProblemException(404, 'no_open_shift');
      return this.mapper.view(trx, session.tenantId, shift);
    });
  }

  async open(
    body: OpenShiftDto,
    key: string | undefined,
    sentAt?: string,
  ): Promise<Shift> {
    this.idempotency.checkHeader(key, body.id);
    this.context.requireStore(body.storeId);
    const id = body.id.toLowerCase();
    const replay = await this.idempotency.replay<Shift>(
      requireTenantId(),
      'shift.open',
      id,
      body,
    );
    if (replay) return replay.response;
    const op = await this.context.operation(
      body,
      'shifts:create',
      sentAt,
      'shift-opening',
    );
    return this.db.tenantTransaction((trx) =>
      this.idempotency.run(trx, op.tenantId, 'shift.open', id, body, 201, async () => {
        // the store first, then the terminal — the order of a store closing, which holds the
        // store row and revokes the terminals (final review I2)
        const store = await this.context.cloudStore(trx, op.tenantId, op.storeId, {
          lock: 'share',
        });
        // a terminal being revoked gets no shift; a revocation waits for this opening (M7)
        if (!(await this.terminals.holdForShift(trx, op.tenantId, op.terminalId))) {
          throw new ProblemException(403, 'terminal_required');
        }
        if (await this.shifts.openShiftOfTerminal(trx, op.tenantId, op.terminalId)) {
          throw new ProblemException(409, 'shift_open');
        }
        // not before the closing of the previous shift of the terminal (E4), as P10 checked the author; a closing
        // committed after P10 read its floor means the author was checked against an older one — a quarantine
        const lastClosed = await this.shifts.lastClosedAt(trx, op.tenantId, op.terminalId);
        if (
          op.authorFloor !== undefined &&
          lastClosed?.getTime() !== op.authorFloor?.getTime()
        ) {
          throw new ProblemException(409, 'shift_open');
        }
        const openedAt = operationMoment(op, lastClosed);
        const date = await this.repository.businessDate(trx, op.tenantId, openedAt);
        const number = await this.numbering.next(trx, op.tenantId, store, 'z_report', date);
        try {
          await this.shifts.insertShift(trx, op.tenantId, {
            id,
            storeId: op.storeId,
            terminalId: op.terminalId,
            number,
            openedBy: op.author.id,
            openedAt,
            receivedAt: op.receivedAt,
            openingCashDirams: body.openingCashMinor,
            openedAuthorFlagged: op.author.flagged,
          });
        } catch (error) {
          if (isOpenShiftConflict(error)) {
            throw new ProblemException(409, 'shift_open');
          }
          throw error;
        }
        await this.audit.append(trx, {
          action: 'shift.opened',
          entityType: 'shift',
          entityId: id,
          storeId: op.storeId,
          ...terminalAuthor(op),
          details: {
            number,
            authorId: op.author.id,
            openingCashMinor: body.openingCashMinor,
            authorFlagged: op.author.flagged,
            ...terminalVia(op),
          },
        });
        return this.viewOf(trx, op.tenantId, id);
      }),
    );
  }

  async cashMovement(
    shiftId: string,
    body: CashMovementDto,
    key: string | undefined,
    sentAt?: string,
  ): Promise<Shift> {
    this.idempotency.checkHeader(key, body.id);
    this.sameShift(shiftId, body.shiftId);
    this.context.requireStore(body.storeId);
    const replay = await this.idempotency.replay<Shift>(
      requireTenantId(),
      'shift.cash',
      body.id.toLowerCase(),
      body,
    );
    if (replay) return replay.response;
    const reasons = body.kind === 'in' ? IN_REASONS : OUT_REASONS;
    if (!reasons.has(body.reason)) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'reason', code: 'invalid' },
      ]);
    }
    const op = await this.context.operation(body, 'shifts:update', sentAt, {
      shiftId: shiftId.toLowerCase(),
    });
    const id = body.id.toLowerCase();
    return this.db.tenantTransaction((trx) =>
      this.idempotency.run(trx, op.tenantId, 'shift.cash', id, body, 201, async () => {
        const shift = await this.lockOpenShift(
          trx,
          op.tenantId,
          shiftId,
          op.terminalId,
          'share',
          'accept-forced',
        );
        // the shift was closed from another computer meanwhile: kept, not in its Z-report (S4)
        const afterClosing = shift.status === 'closed';
        // a cash-out above the expected cash is accepted: the screen only warns (E15)
        await this.shifts.insertCashOperation(trx, op.tenantId, {
          id,
          shiftId: shift.id,
          kind: body.kind === 'in' ? 'deposit' : 'withdrawal',
          amountDirams: body.amountMinor,
          reason: body.reason,
          comment: body.comment === '' ? null : body.comment,
          employeeId: op.author.id,
          occurredAt: operationMoment(op, shift.openedAt),
          receivedAt: op.receivedAt,
          authorFlagged: op.author.flagged,
          afterClosing,
        });
        await this.audit.append(trx, {
          action: body.kind === 'in' ? 'shift.cash-in' : 'shift.cash-out',
          entityType: 'shift',
          entityId: shift.id,
          storeId: op.storeId,
          ...terminalAuthor(op),
          details: {
            operationId: id,
            authorId: op.author.id,
            amountMinor: body.amountMinor,
            reason: body.reason,
            authorFlagged: op.author.flagged,
            ...(afterClosing && { afterClosing }),
            ...terminalVia(op),
          },
        });
        return this.viewOf(trx, op.tenantId, shift.id);
      }),
    );
  }

  async close(
    shiftId: string,
    body: CloseShiftDto,
    key: string | undefined,
    sentAt?: string,
  ): Promise<ZReport> {
    this.idempotency.checkHeader(key, body.id);
    this.sameShift(shiftId, body.shiftId);
    this.context.requireStore(body.storeId);
    const replay = await this.idempotency.replay<ZReport>(
      requireTenantId(),
      'shift.close',
      body.id.toLowerCase(),
      body,
    );
    if (replay) return replay.response;
    const op = await this.context.operation(body, 'shifts:update', sentAt, {
      shiftId: shiftId.toLowerCase(),
    });
    const id = body.id.toLowerCase();
    return this.db.tenantTransaction((trx) =>
      this.idempotency.run(trx, op.tenantId, 'shift.close', id, body, 201, async () => {
        const shift = await this.lockOpenShift(
          trx,
          op.tenantId,
          shiftId,
          op.terminalId,
          'update',
          'accept-forced',
        );
        if (shift.status === 'closed') {
          // closed from another computer meanwhile (S4): the till's own closing gets the saved report and is not
          // left in the quarantine of the buffer; what the till counted goes to the journal
          await this.audit.append(trx, {
            action: 'shift.close-superseded',
            entityType: 'shift',
            entityId: shift.id,
            storeId: op.storeId,
            ...terminalAuthor(op),
            details: {
              number: shift.number,
              authorId: op.author.id,
              actualCashMinor: body.actualCashMinor,
              ...terminalVia(op),
            },
          });
          return shift.zReport as ZReport;
        }
        const reason = body.discrepancyReason;
        const { report, expected, discrepancy } = await this.closeWith(
          trx,
          op.tenantId,
          shift,
          {
            id: op.author.id,
            name: await this.employeeName(trx, op, shift),
            flagged: op.author.flagged,
            at: operationMoment(op, shift.openedAt),
          },
          {
            actualCashMinor: body.actualCashMinor,
            terminalTotals: body.terminalTotals,
            reason,
          },
          null,
        );
        await this.audit.append(trx, {
          action: 'shift.closed',
          entityType: 'shift',
          entityId: shift.id,
          storeId: op.storeId,
          ...terminalAuthor(op),
          details: {
            number: shift.number,
            authorId: op.author.id,
            expectedMinor: expected,
            actualCashMinor: body.actualCashMinor,
            discrepancyMinor: discrepancy,
            reasonMissing: report.discrepancyReasonMissing,
            authorFlagged: op.author.flagged,
            ...terminalVia(op),
          },
        });
        return report;
      }),
    );
  }

  /**
   * POST /shifts/{id}/forced-closure — a manager closes the open shift of another till from another computer (plan
   * 2026-10-27-shift-history, S3): any session of the scope, online only, a fresh sign-in (the controller). The
   * expected cash and the Z-report as at a closing (E24), with who closed it and why. The late operations of the till
   * are kept (S4). 404 outside the scope, 409 `shift_closed`.
   */
  async forceClose(
    shiftId: string,
    body: ForceCloseShiftDto,
    key: string | undefined,
  ): Promise<ZReport> {
    this.idempotency.checkHeader(key, body.id);
    const principal = requirePrincipal();
    const { tenantId } = principal;
    const id = body.id.toLowerCase();
    const replay = await this.idempotency.replay<ZReport>(
      tenantId,
      'shift.force-close',
      id,
      body,
    );
    if (replay) return replay.response;
    const scope = viewScope(principal);
    return this.db.tenantTransaction((trx) =>
      this.idempotency.run(trx, tenantId, 'shift.force-close', id, body, 201, async () => {
        const shift = await this.shifts.lockShift(
          trx,
          tenantId,
          shiftId.toLowerCase(),
          'update',
        );
        if (shift === null || (scope !== 'all' && !scope.includes(shift.storeId))) {
          throw new ProblemException(404, 'not_found');
        }
        if (shift.status !== 'open') {
          throw new ProblemException(409, 'shift_closed');
        }
        const closer = await trx
          .selectFrom('employees')
          .select('fullName')
          .where('tenantId', '=', tenantId)
          .where('id', '=', principal.employeeId)
          .executeTakeFirst();
        const byName = closer?.fullName ?? '';
        const { report, expected, discrepancy } = await this.closeWith(
          trx,
          tenantId,
          shift,
          { id: principal.employeeId, name: byName, flagged: false, at: new Date() },
          {
            actualCashMinor: body.actualCashMinor,
            terminalTotals: body.terminalTotals,
            reason: body.reason,
          },
          { byName, reason: body.reason },
        );
        await this.audit.append(trx, {
          action: 'shift.force-closed',
          entityType: 'shift',
          entityId: shift.id,
          storeId: shift.storeId,
          details: {
            operationId: id,
            number: shift.number,
            terminalId: shift.terminalId,
            expectedMinor: expected,
            actualCashMinor: body.actualCashMinor,
            discrepancyMinor: discrepancy,
            reason: body.reason,
          },
        });
        return report;
      }),
    );
  }

  /**
   * The closing of an open shift and its Z-report (E24): by its till, or from another computer with `forced` (S3).
   * The expected cash is counted by the server; held receipts end with their shift (ТЗ, E12).
   */
  private async closeWith(
    trx: TenantTransaction,
    tenantId: string,
    shift: ShiftRow,
    closer: { id: string; name: string; flagged: boolean; at: Date },
    input: {
      actualCashMinor: number;
      terminalTotals: Record<Exclude<ReceiptPaymentMethod, 'cash'>, number>;
      reason: string;
    },
    forced: { byName: string; reason: string } | null,
  ): Promise<{ report: ZReport; expected: number; discrepancy: number }> {
    const open = await this.mapper.view(trx, tenantId, shift);
    const expected = open.cash.expectedMinor;
    const discrepancy = input.actualCashMinor - expected;
    const closedRow: ShiftRow = {
      ...shift,
      status: 'closed',
      closedBy: closer.id,
      closedByName: closer.name,
      closedAt: closer.at,
      countedCashDirams: BigInt(input.actualCashMinor),
      closedAuthorFlagged: closer.flagged,
      forced: forced !== null,
      forcedReason: forced?.reason ?? null,
    };
    const closed = await this.mapper.view(trx, tenantId, closedRow);
    const report: ZReport = {
      shift: { ...closed, status: 'closed' },
      actualCashMinor: input.actualCashMinor,
      discrepancyMinor: discrepancy,
      terminalDiff: Object.fromEntries(
        BANK.map((m) => [
          m,
          // the sales less the returns of the kind (spec 2026-10-13-customer-returns, E13)
          input.terminalTotals[m] -
            (open.byMethod[m].amountMinor - open.returnsByMethod[m].amountMinor),
        ]),
      ) as ZReport['terminalDiff'],
      // the closing is a fact (E24): no reason at a discrepancy is marked, not refused
      discrepancyReasonMissing: discrepancy !== 0 && input.reason === '',
      ...(forced && { forced }),
    };
    await this.shifts.closeShift(trx, tenantId, shift.id, {
      closedBy: closer.id,
      closedAt: closer.at,
      closedAuthorFlagged: closer.flagged,
      expectedCashDirams: expected,
      countedCashDirams: input.actualCashMinor,
      discrepancyDirams: discrepancy,
      discrepancyReason: input.reason === '' ? null : input.reason,
      terminalTotals: {
        card: input.terminalTotals.card,
        qr: input.terminalTotals.qr,
        nfc: input.terminalTotals.nfc,
      },
      forced: forced !== null,
      forcedReason: forced?.reason ?? null,
      zReport: report,
    });
    await this.shifts.deleteHeld(trx, tenantId, { shiftId: shift.id });
    return { report, expected, discrepancy };
  }

  /**
   * GET /shifts — the shift history of the stores of the scope (plan 2026-10-27-shift-history, S1): a closed shift
   * reads its totals from its Z-report, an open one is counted as on the shift screen. 403 `store_not_in_scope`.
   */
  async list(query: ShiftListQueryDto): Promise<ShiftListResponse> {
    const principal = requirePrincipal();
    const scope = viewScope(principal);
    const storeId = query.storeId?.toLowerCase();
    if (storeId && scope !== 'all' && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total } = await this.shifts.list(
        trx,
        principal.tenantId,
        scope,
        { storeId, from: query.from, to: query.to, status: query.status, limit, offset },
      );
      const items: ShiftListItem[] = [];
      for (const row of rows) {
        const z = row.status === 'closed' ? (row.zReport as ZReport | null) : null;
        // an open shift is counted now; there are as many as tills (S1)
        const totals = z?.shift ?? (await this.mapper.view(trx, principal.tenantId, row));
        items.push({
          id: row.id,
          number: row.number,
          storeId: row.storeId,
          storeName: row.storeName,
          terminalName: row.terminalName,
          status: row.status,
          openedAt: row.openedAt.toISOString(),
          openedByName: row.openedByName,
          closedAt: row.closedAt?.toISOString() ?? null,
          closedByName: row.closedByName,
          forced: row.forced,
          receipts: totals.receipts,
          revenueMinor: totals.revenueMinor,
          discrepancyMinor: z ? z.discrepancyMinor : null,
          discrepancyReceipts: totals.discrepancyReceipts,
          reasonMissing: z?.discrepancyReasonMissing ?? false,
          afterClosingReceipts: row.afterClosingReceipts,
        });
      }
      return { items, total, limit, offset };
    });
  }

  /**
   * GET /shifts/{id} — the card of a shift of the scope (S2): an open one now, a closed one as in its Z-report, the
   * late operations of a forced closing, when its till was last heard from. 404 outside the scope.
   */
  async details(shiftId: string): Promise<ShiftDetails> {
    const principal = requirePrincipal();
    const scope = viewScope(principal);
    return this.db.tenantTransaction(async (trx) => {
      const { tenantId } = principal;
      const row = await this.shifts.findShift(trx, tenantId, shiftId.toLowerCase());
      if (row === null || (scope !== 'all' && !scope.includes(row.storeId))) {
        throw new ProblemException(404, 'not_found');
      }
      const store = await this.repository.store(trx, tenantId, row.storeId);
      if (store === null) throw new ProblemException(404, 'not_found');
      const zReport = row.status === 'closed' ? (row.zReport as ZReport | null) : null;
      const lastActivity = await this.shifts.lastActivityAt(trx, tenantId, row.id);
      return {
        shift: zReport?.shift ?? (await this.mapper.view(trx, tenantId, row)),
        storeName: store.name,
        terminalName: await this.shifts.terminalName(trx, tenantId, row.terminalId),
        closedByName: row.closedByName,
        zReport,
        afterClosing: await this.shifts.afterClosing(trx, tenantId, row.id),
        lastActivityAt: lastActivity?.toISOString() ?? null,
        print: { storeName: store.name, storeAddress: store.address, taxId: store.taxId },
      };
    });
  }

  /** GET /shifts/{id}/z-report — the Z-report saved at the closing of a shift of the scope. */
  async zReport(shiftId: string): Promise<ZReport> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const shift = await this.shifts.findShift(
        trx,
        tenantId,
        shiftId.toLowerCase(),
      );
      if (shift === null || shift.status !== 'closed' || shift.zReport === null) {
        throw new ProblemException(404, 'not_found');
      }
      this.context.inScope(shift.storeId);
      return shift.zReport as ZReport;
    });
  }

  private async viewOf(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
  ): Promise<Shift> {
    const shift = await this.shifts.findShift(trx, tenantId, shiftId);
    if (shift === null) throw new ProblemException(404, 'not_found');
    return this.mapper.view(trx, tenantId, shift);
  }

  private sameShift(path: string, body: string): void {
    if (path.toLowerCase() !== body.toLowerCase()) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'shiftId', code: 'mismatch' },
      ]);
    }
  }

  /** Name of the author of the closing for the Z-report (the opener's is already in the row). */
  private async employeeName(
    trx: TenantTransaction,
    op: PosOperation,
    shift: ShiftRow,
  ): Promise<string> {
    if (op.author.id === shift.openedBy) return shift.openedByName;
    const row = await trx
      .selectFrom('employees')
      .select('fullName')
      .where('tenantId', '=', op.tenantId)
      .where('id', '=', op.author.id)
      .executeTakeFirst();
    return row?.fullName ?? '';
  }
}
