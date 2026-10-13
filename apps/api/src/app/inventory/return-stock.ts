import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ProblemException } from '../../common/errors/problem.exception';
import { newId, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { DocumentsRepository } from './documents.repository';
import { InventoryRepository } from './inventory.repository';
import { Numbering } from './numbering';
import { checkDocumentDate } from './posting';
import { WriteOffsRepository } from './write-offs.repository';

/** A returned line: its pieces go back into the batch of the receipt line. */
export interface ReturnedBatchLine {
  /** `customer_return_lines.id` — the source line of the movements. */
  lineId: string;
  batchId: string;
  productId: string;
  qtyPieces: number;
  unit: 'pack' | 'piece';
  /** A defect, or the batch has expired (E9): it leaves the batch again by a write-off. */
  writeOff: boolean;
}

export interface ReturnStockInput {
  tenantId: string;
  storeId: string;
  employeeId: string;
  businessDate: string;
  customerReturnId: string;
  customerReturnNumber: string;
  writeOffReason: 'customer_return_defect' | 'customer_return_expired';
  lines: readonly ReturnedBatchLine[];
}

// The stock of the customer returns (spec 2026-10-13-customer-returns, E9–E11): the goods go back
// into the batch of the receipt line with `customer_return` movements; a defect and an expired batch
// leave it again by one posted write-off linked to the return. The write-off is made by the system:
// the freeze of a running stock count and the minus check do not apply (its movements net to zero
// on the batch, E10). Runs in the caller's transaction.
@Injectable()
export class ReturnStock {
  constructor(
    private readonly documents: DocumentsRepository,
    private readonly inventory: InventoryRepository,
    private readonly writeOffs: WriteOffsRepository,
    private readonly numbering: Numbering,
    private readonly audit: AuditService,
  ) {}

  /** Lot number and expiry of the batches of the store. */
  async batches(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    batchIds: readonly string[],
  ): Promise<Map<string, { lotNumber: string | null; expiryDate: string }>> {
    const ids = [...new Set(batchIds)];
    if (ids.length === 0) return new Map();
    const result = await sql<{
      id: string;
      lotNumber: string | null;
      expiryDate: string;
    }>`
      select b.id, b.lot_number, b.expiry_date::text as expiry_date
      from pharmacy.batches b
      where b.tenant_id = ${tenantId} and b.store_id = ${storeId}
        and b.id in (${sql.join(ids)})`.execute(trx);
    return new Map(
      result.rows.map((row) => [
        row.id,
        { lotNumber: row.lotNumber, expiryDate: row.expiryDate },
      ]),
    );
  }

  /** The store for a return dated `businessDate`: 422 `period_closed` in the closed period (E11). */
  async storeForReturn(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    businessDate: string,
  ): Promise<{ id: string; code: string }> {
    const store = await this.inventory.store(trx, tenantId, storeId);
    if (store === null) throw new ProblemException(404, 'not_found');
    const settings = await this.inventory.settings(trx, tenantId);
    checkDocumentDate(settings, store, businessDate, { backdating: false });
    return { id: store.id, code: store.code };
  }

  /** `customer_return` movements, then one posted write-off of the `writeOff` lines (E9). */
  async receive(
    trx: TenantTransaction,
    input: ReturnStockInput,
  ): Promise<{ writeOffId: string | null; writeOffNumber: string | null }> {
    const { tenantId, storeId, businessDate } = input;
    // in the order of ids, as every other writer of batches: no deadlock with a sale
    await this.documents.lockBatches(
      trx,
      tenantId,
      input.lines.map((l) => l.batchId),
    );
    await this.documents.insertMovements(
      trx,
      tenantId,
      input.lines.map((line) => ({
        storeId,
        batchId: line.batchId,
        qtyDeltaPieces: line.qtyPieces,
        kind: 'customer_return',
        sourceType: 'customer_return',
        sourceId: input.customerReturnId,
        sourceLineId: line.lineId,
        businessDate,
        reversesMovementId: null,
      })),
    );
    const lines = input.lines.filter((line) => line.writeOff);
    if (lines.length === 0) return { writeOffId: null, writeOffNumber: null };

    const store = await this.storeForReturn(trx, tenantId, storeId, businessDate);
    const writeOffId = newId();
    const number = await this.numbering.next(
      trx,
      tenantId,
      store,
      'write_off',
      businessDate,
    );
    await this.documents.insertDocument(
      trx,
      tenantId,
      writeOffId,
      'write_off',
      number,
      input.employeeId,
      {
        storeId,
        documentDate: businessDate,
        comment: input.customerReturnNumber,
        totalDirams: 0,
        supplierId: null,
        supplierInvoiceNumber: null,
        paymentDueDate: null,
        purchaseOrderId: null,
        writeOffReason: input.writeOffReason,
        sourceCustomerReturnId: input.customerReturnId,
      },
    );
    await this.writeOffs.replaceLines(
      trx,
      tenantId,
      writeOffId,
      lines.map((line) => ({
        batchId: line.batchId,
        productId: line.productId,
        qtyPieces: line.qtyPieces,
        unit: line.unit,
      })),
    );
    const written = await this.writeOffs.lines(trx, tenantId, writeOffId);
    await this.documents.insertMovements(
      trx,
      tenantId,
      written.map((line) => ({
        storeId,
        batchId: line.batchId,
        qtyDeltaPieces: -line.qtyPieces,
        kind: 'write_off',
        sourceId: writeOffId,
        sourceLineId: line.id,
        businessDate,
        reversesMovementId: null,
      })),
    );
    const total = written.reduce(
      (sum, line) => sum + line.qtyPieces * Number(line.costPerPieceDirams),
      0,
    );
    await this.documents.markPosted(
      trx,
      tenantId,
      writeOffId,
      input.employeeId,
      total,
    );
    await this.audit.append(trx, {
      action: 'document.posted',
      entityType: 'document',
      entityId: writeOffId,
      storeId,
      details: {
        type: 'write_off',
        number,
        reason: input.writeOffReason,
        customerReturn: input.customerReturnNumber,
        lines: written.length,
        totalMinor: total,
      },
    });
    return { writeOffId, writeOffNumber: number };
  }
}
