import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hasPermissions, returnLineRefund } from '@pharmacy/shared-domain';
import type {
  CreatedReturn,
  ReceiptPaymentMethod,
  ReturnListResponse,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import {
  getRequestContext,
  requirePrincipal,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import {
  type FieldError,
  FieldProblemException,
} from '../../common/errors/validation-failed.exception';
import { TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { CustomerReturnNumbers } from '../inventory/customer-return-numbers';
import { Numbering } from '../inventory/numbering';
import { ReturnStock } from '../inventory/return-stock';
import { PosIdempotency } from '../pos/idempotency';
import { PosContext } from '../pos/pos-context';
import { PosShifts } from '../pos/pos-shifts';
import { ShiftReturns } from '../pos/shift-returns';
import { SoldReceipts } from '../pos/sold-receipts';
import type { CreateReturnDto, ReturnListQueryDto } from './dto/returns.dto';
import {
  daysLeft,
  kindOf,
  refundable,
  unitPieces,
} from './returnable.service';
import { ReturnsRepository } from './returns.repository';

const PAGE = 20;

const invalid = (errors: FieldError[]) =>
  new FieldProblemException(400, 'validation_failed', errors);

// A customer return (spec 2026-10-13-customer-returns, 4.3): online, on the terminal of the PIN
// session with its open shift, under the idempotency key of the client. The receipt of the store,
// its lines up to what is left of them, the money back by the ways it was paid, the goods back into
// their batches — or written off at once for a defect or an expired batch — in one transaction.
// The returns of a shift and the numbers of the returns reach the POS and the stock through the
// ports they declare (E16).
@Injectable()
export class ReturnsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly context: PosContext,
    private readonly idempotency: PosIdempotency,
    private readonly shifts: PosShifts,
    private readonly sold: SoldReceipts,
    private readonly repository: ReturnsRepository,
    private readonly products: ProductsReader,
    private readonly stock: ReturnStock,
    private readonly numbering: Numbering,
    private readonly audit: AuditService,
    shiftReturns: ShiftReturns,
    returnNumbers: CustomerReturnNumbers,
  ) {
    shiftReturns.register((trx, tenantId, shiftId) =>
      this.repository.shiftTotals(trx, tenantId, shiftId),
    );
    returnNumbers.register((trx, tenantId, ids) =>
      this.repository.numbers(trx, tenantId, ids),
    );
  }

  async create(body: CreateReturnDto, key?: string): Promise<CreatedReturn> {
    const principal = requirePrincipal();
    const id = body.id.toLowerCase();
    // a repeat of an accepted return gets its answer before any check of the session (as the POS)
    const replay = await this.idempotency.replay<CreatedReturn>(
      principal.tenantId,
      'return',
      id,
      body,
    );
    if (replay) return replay.response;
    this.idempotency.checkHeader(key, body.id);
    const session = this.context.terminalSession();
    if (
      body.storeId.toLowerCase() !== session.storeId ||
      (body.terminalId ?? '').toLowerCase() !== session.terminalId ||
      body.employeeId.toLowerCase() !== session.employeeId
    ) {
      throw new ProblemException(409, 'wrong_terminal');
    }
    const foundProductId = body.foundProductId?.toLowerCase() ?? null;
    if (
      foundProductId !== null &&
      !hasPermissions(principal.permissions, 'returns:without-receipt')
    ) {
      throw new ProblemException(403, 'forbidden');
    }
    const { tenantId, storeId, terminalId, employeeId } = session;
    return this.db.tenantTransaction((trx) =>
      this.idempotency.run(trx, tenantId, 'return', id, body, 201, async () => {
        await this.context.cloudStore(trx, tenantId, storeId);
        const shift = await this.shifts.lockOpenShiftOfTerminal(
          trx,
          tenantId,
          terminalId,
        );
        // the shift of a return is a shift of its store (composite key, cr-M9)
        if (
          !shift ||
          shift.id !== body.shiftId.toLowerCase() ||
          shift.storeId !== storeId
        ) {
          throw new ProblemException(409, 'no_open_shift');
        }
        const receiptId = body.receiptId.toLowerCase();
        // the returns of one receipt one after another: what is left of its lines and payments is
        // read under the lock (E19); the rows of the receipt are append-only, no FOR UPDATE on them
        // the key names its kind and tenant, as the other advisory keys of the code
        await sql`select pg_advisory_xact_lock(hashtextextended(${`customer-return:${tenantId}:${receiptId}`}, 0))`.execute(
          trx,
        );
        const settings = await this.repository.settings(trx, tenantId);
        const receipt = await this.sold.find(trx, tenantId, storeId, {
          id: receiptId,
        });
        if (!receipt) throw new ProblemException(404, 'not_found');
        if (daysLeft(receipt, settings) < 0) {
          throw new ProblemException(422, 'return_window_expired');
        }

        // the lines: of the receipt, once each, not above what is left of them (E5)
        const returned = await this.repository.returnedPieces(
          trx,
          tenantId,
          receipt.lines.map((l) => l.id),
        );
        const seen = new Set<string>();
        const malformed: FieldError[] = [];
        const exceeded: FieldError[] = [];
        const picked = body.lines.flatMap((item, i) => {
          const lineId = item.lineId.toLowerCase();
          const line = receipt.lines.find((l) => l.id === lineId);
          if (!line) {
            malformed.push({ field: `lines.${i}.lineId`, code: 'unknown_line' });
            return [];
          }
          if (seen.has(lineId)) {
            malformed.push({ field: `lines.${i}.lineId`, code: 'duplicate' });
            return [];
          }
          seen.add(lineId);
          const per = unitPieces(line);
          const returnedQuantity = (returned.get(line.id) ?? 0) / per;
          if (item.quantity > line.qtyPieces / per - returnedQuantity) {
            exceeded.push({
              field: `lines.${i}.quantity`,
              code: 'return_exceeds_sold',
            });
          }
          return [{ index: i, line, quantity: item.quantity, returnedQuantity }];
        });
        if (malformed.length > 0) throw invalid(malformed);
        if (exceeded.length > 0) {
          throw new FieldProblemException(409, 'return_exceeds_sold', exceeded);
        }

        // a sale found without the receipt returns only the product of the search (R8); the policy
        // of the network closes kinds for a return at the customer's wish (R3)
        const products = new Map(
          (
            await this.products.listForPos(
              trx,
              tenantId,
              picked.map((p) => p.line.productId),
            )
          ).map((p) => [p.id, p]),
        );
        const refused: FieldError[] = [];
        let controlled = false;
        for (const p of picked) {
          const field = `lines.${p.index}.lineId`;
          if (foundProductId !== null && p.line.productId !== foundProductId) {
            refused.push({ field, code: 'other_product' });
            continue;
          }
          const kind = kindOf(p.line, products.get(p.line.productId)?.prescription);
          if (kind === 'controlled') controlled = true;
          if (body.reason === 'customer' && !settings.customerReturns[kind]) {
            refused.push({ field, code: 'return_not_allowed' });
          }
        }
        if (refused.length > 0) {
          throw new FieldProblemException(422, 'return_not_allowed', refused);
        }
        // A ПКУ line is returned only by a cashier who may sell it (E8): sold as ПКУ, or ПКУ in the
        // catalog now (marked after the sale, or sold from the buffer without its record).
        if (
          controlled &&
          !hasPermissions(principal.permissions, 'pos:sell-controlled')
        ) {
          throw new ProblemException(403, 'forbidden');
        }

        // the money: the price less the share of the discount (R1, E6), back by the ways the
        // receipt was paid, never above what is left of a way (E7)
        const refunds = picked.map((p) =>
          returnLineRefund({
            soldQuantity: p.line.qtyPieces / unitPieces(p.line),
            unitPriceMinor: p.line.unitPriceDirams,
            discountShareMinor: p.line.discountShareDirams,
            returnedQuantity: p.returnedQuantity,
            quantity: p.quantity,
          }),
        );
        const refundTotal = refunds.reduce((sum, r) => sum + r.refundMinor, 0);
        const discountTotal = refunds.reduce((sum, r) => sum + r.discountMinor, 0);
        if (refundTotal !== body.refundMinor) {
          throw invalid([{ field: 'refundMinor', code: 'total_mismatch' }]);
        }
        const left = new Map(
          refundable(
            receipt,
            await this.repository.refundedByKind(trx, tenantId, receipt.id),
          ).map((p) => [p.method, p.amountMinor]),
        );
        const kinds = new Set<ReceiptPaymentMethod>();
        const money: FieldError[] = [];
        body.refunds.forEach((refund, i) => {
          if (!left.has(refund.method) || kinds.has(refund.method)) {
            money.push({ field: `refunds.${i}.method`, code: 'unknown_method' });
          } else if (refund.amountMinor > (left.get(refund.method) ?? 0)) {
            money.push({
              field: `refunds.${i}.amountMinor`,
              code: 'refund_exceeds_paid',
            });
          }
          kinds.add(refund.method);
        });
        const refunded = body.refunds.reduce((sum, r) => sum + r.amountMinor, 0);
        if (refunded !== refundTotal) {
          money.push({ field: 'refunds', code: 'total_mismatch' });
        }
        if (money.length > 0) throw invalid(money);

        // the date of the return: today of the network, never in a closed period (E11)
        const store = await this.stock.storeForReturn(
          trx,
          tenantId,
          storeId,
          settings.today,
        );
        const number = await this.numbering.next(
          trx,
          tenantId,
          store,
          'customer_return',
          settings.today,
        );
        await this.repository.insertReturn(trx, tenantId, {
          id,
          storeId,
          shiftId: shift.id,
          terminalId,
          cashierId: employeeId,
          receiptId: receipt.id,
          number,
          businessDate: settings.today,
          reason: body.reason,
          foundWithoutReceipt: foundProductId !== null,
          discountReturnedDirams: discountTotal,
          refundDirams: refundTotal,
          // never empty: unreachable today (the principal needs a request), kept so that a
          // financial operation always carries a correlation id
          correlationId: getRequestContext()?.correlationId ?? randomUUID(),
        });
        const lineIds = await this.repository.insertLines(
          trx,
          tenantId,
          id,
          receipt.id,
          picked.map((p, i) => ({
            receiptLineId: p.line.id,
            qtyPieces: p.quantity * unitPieces(p.line),
            amountDirams: refunds[i].amountMinor,
            discountShareDirams: refunds[i].discountMinor,
          })),
        );
        await this.repository.insertRefunds(
          trx,
          tenantId,
          id,
          body.refunds.map((r) => ({ kind: r.method, amountDirams: r.amountMinor })),
        );

        // the goods back into their batches; a defect and an expired batch leave them again (E9)
        const batches = await this.stock.batches(
          trx,
          tenantId,
          storeId,
          picked.map((p) => p.line.batchId),
        );
        const written = await this.stock.receive(trx, {
          tenantId,
          storeId,
          employeeId,
          businessDate: settings.today,
          customerReturnId: id,
          customerReturnNumber: number,
          writeOffReason:
            body.reason === 'defect'
              ? 'customer_return_defect'
              : 'customer_return_expired',
          lines: picked.map((p, i) => ({
            lineId: lineIds[i],
            batchId: p.line.batchId,
            productId: p.line.productId,
            qtyPieces: p.quantity * unitPieces(p.line),
            unit: p.line.saleUnit,
            writeOff:
              body.reason === 'defect' ||
              (batches.get(p.line.batchId)?.expiryDate ?? settings.today) <
                settings.today,
          })),
        });
        await this.audit.append(trx, {
          action: 'return.completed',
          entityType: 'customer_return',
          entityId: id,
          storeId,
          details: {
            number,
            receipt: receipt.number,
            reason: body.reason,
            refundMinor: refundTotal,
            terminalId,
            foundWithoutReceipt: foundProductId !== null,
            writeOff: written.writeOffNumber,
          },
        });
        return {
          id,
          number,
          refundMinor: refundTotal,
          writeOffNumber: written.writeOffNumber,
        };
      }),
    );
  }

  /** The journal of the stores of the scope (a PIN session — its own store), the newest first. */
  list(query: ReturnListQueryDto): Promise<ReturnListResponse> {
    const principal = requirePrincipal();
    const limit = query.limit ?? PAGE;
    const offset = query.offset ?? 0;
    let storeIds: readonly string[] | null;
    if (query.storeId) {
      const storeId = query.storeId.toLowerCase();
      this.context.inScope(storeId);
      storeIds = [storeId];
    } else if (principal.auth === 'pin') {
      storeIds = principal.currentStoreId ? [principal.currentStoreId] : [];
    } else {
      storeIds = principal.storeScope === 'all' ? null : principal.storeScope;
    }
    return this.db.tenantTransaction(async (trx) => {
      const { tenantId } = principal;
      const { rows, total } = await this.repository.list(trx, tenantId, {
        storeIds,
        reason: query.reason,
        limit,
        offset,
      });
      const ids = rows.map((r) => r.id);
      const first = await this.repository.firstLines(trx, tenantId, ids);
      const lines = await this.sold.linesByIds(
        trx,
        tenantId,
        [...first.values()].map((f) => f.receiptLineId),
      );
      const names = new Map(
        (
          await this.products.listForPos(
            trx,
            tenantId,
            [...lines.values()].map((l) => l.productId),
          )
        ).map((p) => [p.id, p.name]),
      );
      const methods = await this.repository.refundKinds(trx, tenantId, ids);
      const writeOffs = await this.stock.writeOffsOf(trx, tenantId, ids);
      return {
        items: rows.map((row) => {
          const head = first.get(row.id);
          const line = head ? lines.get(head.receiptLineId) : undefined;
          const name = line ? (names.get(line.productId) ?? '—') : '—';
          return {
            id: row.id,
            number: row.number,
            at: row.returnedAt.toISOString(),
            storeName: row.storeName,
            receiptNumber: line?.receiptNumber ?? '—',
            summary:
              head && head.lines > 1 ? `${name} +${head.lines - 1}` : name,
            reason: row.reason,
            refundMinor: row.refundDirams,
            methods: methods.get(row.id) ?? [],
            cashierName: row.cashierName,
            foundWithoutReceipt: row.foundWithoutReceipt,
            writeOffNumber: writeOffs.get(row.id)?.number ?? null,
          };
        }),
        total,
        limit,
        offset,
      };
    });
  }
}
