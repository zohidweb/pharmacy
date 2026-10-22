import { Injectable } from '@nestjs/common';
import type { HeldReceipt } from '@pharmacy/shared-dto';
import { ProblemException } from '../../common/errors/problem.exception';
import {
  type FieldError,
  FieldProblemException,
} from '../../common/errors/validation-failed.exception';
import { TenantDatabase } from '../../core/database';
import { ProductsReader } from '../catalog/products-reader';
import { PosStock } from '../inventory/pos-stock';
import type { HoldReceiptDto } from './dto/pos.dto';
import { PosContext } from './pos-context';
import { type HeldReceiptRow, ShiftsRepository } from './shifts.repository';

function toHeld(row: HeldReceiptRow): HeldReceipt {
  return {
    id: row.id,
    lines: row.payload,
    subtotalMinor: Number(row.subtotalDirams),
    heldAt: row.heldAt.toISOString(),
    heldBy: row.heldByName,
  };
}

// Held receipts of a store (spec 2026-10-13-pos-shift-sale, 4.6, E12): put aside on a terminal with
// an open shift, seen by every cashier of the store, deleted when paid (by the POS), by hand or at
// the close of their shift. Online only: not through the buffer, the client id makes a repeat return
// the same receipt.
@Injectable()
export class HeldReceiptsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly context: PosContext,
    private readonly shifts: ShiftsRepository,
    private readonly products: ProductsReader,
    private readonly stock: PosStock,
  ) {}

  async list(storeId: string): Promise<HeldReceipt[]> {
    const session = this.context.terminalSession();
    const id = storeId.toLowerCase();
    this.context.inScope(id);
    return this.db.tenantTransaction(async (trx) =>
      (
        await this.shifts.heldReceipts(trx, session.tenantId, { storeId: id })
      ).map(toHeld),
    );
  }

  async hold(body: HoldReceiptDto): Promise<HeldReceipt> {
    const session = this.context.terminalSession();
    if (body.storeId.toLowerCase() !== session.storeId) {
      throw new ProblemException(409, 'wrong_terminal');
    }
    const id = body.id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const { tenantId, storeId } = session;
      const [existing] = await this.shifts.heldReceipts(trx, tenantId, { id });
      // a repeat answers with the held receipt of the store of the session only: the id of another store's one is a
      // conflict, its lines are not given away
      if (existing && existing.storeId !== storeId) {
        throw new ProblemException(409, 'idempotency_conflict');
      }
      if (existing) return toHeld(existing);
      await this.context.cloudStore(trx, tenantId, storeId);
      const open = await this.shifts.openShiftOfTerminal(
        trx,
        tenantId,
        session.terminalId,
      );
      // locked with the closing's lock in mind: a closing either waits or has deleted the shift's
      // held receipts before this one is checked (M7)
      const shift =
        open && (await this.shifts.lockShift(trx, tenantId, open.id, 'share'));
      if (!shift || shift.status !== 'open') {
        throw new ProblemException(409, 'no_open_shift');
      }
      const known = new Set(
        (
          await this.products.listForPos(
            trx,
            tenantId,
            body.lines.map((l) => l.productId.toLowerCase()),
          )
        ).map((p) => p.id),
      );
      const batches = await this.stock.productsOfBatches(
        trx,
        tenantId,
        storeId,
        body.lines.map((l) => l.batchId.toLowerCase()),
      );
      const errors: FieldError[] = [];
      body.lines.forEach((line, i) => {
        const productId = line.productId.toLowerCase();
        if (!known.has(productId)) {
          errors.push({ field: `lines.${i}.productId`, code: 'unknown_product' });
        } else if (batches.get(line.batchId.toLowerCase()) !== productId) {
          errors.push({ field: `lines.${i}.batchId`, code: 'unknown_batch' });
        }
      });
      if (errors.length > 0) {
        throw new FieldProblemException(400, 'validation_failed', errors);
      }
      await this.shifts.insertHeld(trx, tenantId, {
        id,
        storeId,
        shiftId: shift.id,
        heldBy: session.employeeId,
        subtotalDirams: body.subtotalMinor,
        payload: body.lines.map((line) => ({
          productId: line.productId.toLowerCase(),
          productName: line.productName,
          batchId: line.batchId.toLowerCase(),
          unit: line.unit,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          amountMinor: line.amountMinor,
        })),
      });
      const [created] = await this.shifts.heldReceipts(trx, tenantId, { id });
      return toHeld(created);
    });
  }

  /** Deletes a held receipt of the store of the session; an absent one — nothing to do. */
  async remove(id: string): Promise<void> {
    const session = this.context.terminalSession();
    await this.db.tenantTransaction(async (trx) => {
      const [held] = await this.shifts.heldReceipts(trx, session.tenantId, {
        id: id.toLowerCase(),
      });
      if (!held) return;
      this.context.inScope(held.storeId);
      await this.shifts.deleteHeld(trx, session.tenantId, { id: held.id });
    });
  }
}
