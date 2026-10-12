import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { PaymentAllocation } from './allocation';
import { PurchasingRepository } from './purchasing.repository';

export interface ReceiptLedgerEvent {
  tenantId: string;
  supplierId: string;
  legalEntityId: string;
  documentId: string;
  amountDirams: number;
  dueDate: string | null;
  businessDate: string;
  employeeId: string;
}

// Settlements with suppliers as the stock module drives them (spec 2026-10-09, sections 5.1–5.2):
// a posted goods receipt is a debt of the legal entity of its store and takes the prepayments of
// that supplier × legal entity; an unposting releases its allocations and reverses the debt. The
// ledger is append-only — a correction is a new entry. Runs in the caller's transaction.
@Injectable()
export class SupplierLedger {
  constructor(
    private readonly repository: PurchasingRepository,
    private readonly allocation: PaymentAllocation,
    private readonly audit: AuditService,
  ) {}

  async receiptPosted(
    trx: TenantTransaction,
    e: ReceiptLedgerEvent,
  ): Promise<void> {
    if (e.amountDirams === 0) return;
    await this.repository.appendLedger(trx, e.tenantId, {
      supplierId: e.supplierId,
      legalEntityId: e.legalEntityId,
      kind: 'goods_receipt',
      amountDirams: e.amountDirams,
      dueDate: e.dueDate,
      sourceType: 'document',
      sourceId: e.documentId,
      businessDate: e.businessDate,
      recordedBy: e.employeeId,
    });
    await this.allocation.allocate(
      trx,
      e.tenantId,
      e.supplierId,
      e.legalEntityId,
      { documentId: e.documentId, remainingDirams: BigInt(e.amountDirams) },
    );
  }

  /**
   * Releases the allocations of the document and reverses what it left in the ledger, per
   * supplier and legal entity as it was written — the legal entity of the store may have changed
   * since the posting. The released payments then cover the other open receipts.
   */
  async receiptUnposted(
    trx: TenantTransaction,
    e: {
      tenantId: string;
      documentId: string;
      businessDate: string;
      employeeId: string;
    },
  ): Promise<void> {
    const balances = await this.repository.balancesOfSource(
      trx,
      e.tenantId,
      e.documentId,
    );
    for (const balance of balances) {
      await this.repository.lockSettlement(
        trx,
        e.tenantId,
        balance.supplierId,
        balance.legalEntityId,
      );
    }
    const released = await this.repository.releaseAllocations(
      trx,
      e.tenantId,
      e.documentId,
    );
    if (released > 0) {
      await this.audit.append(trx, {
        action: 'payment.allocations_released',
        entityType: 'document',
        entityId: e.documentId,
        details: { amountMinor: released },
      });
    }
    for (const balance of balances) {
      if (balance.amountDirams === 0) continue;
      await this.repository.appendLedger(trx, e.tenantId, {
        supplierId: balance.supplierId,
        legalEntityId: balance.legalEntityId,
        kind: 'reversal',
        amountDirams: -balance.amountDirams,
        dueDate: null,
        sourceType: 'document',
        sourceId: e.documentId,
        businessDate: e.businessDate,
        recordedBy: e.employeeId,
      });
    }
    if (released > 0) {
      for (const balance of balances) {
        await this.allocation.allocate(
          trx,
          e.tenantId,
          balance.supplierId,
          balance.legalEntityId,
        );
      }
    }
  }
}
