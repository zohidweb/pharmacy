import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
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

// Settlements with suppliers as the stock module drives them (spec 2026-10-09, section 5.1): a
// posted goods receipt is a debt of the legal entity of its store, an unposting reverses it. The
// ledger is append-only — a correction is a new entry. Runs in the caller's transaction.
@Injectable()
export class SupplierLedger {
  constructor(private readonly repository: PurchasingRepository) {}

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
  }

  /**
   * Reverses what the document left in the ledger, per supplier and legal entity as it was
   * written — the legal entity of the store may have changed since the posting.
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
  }
}
