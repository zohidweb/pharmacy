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

  async receiptUnposted(
    trx: TenantTransaction,
    e: Omit<ReceiptLedgerEvent, 'dueDate'>,
  ): Promise<void> {
    if (e.amountDirams === 0) return;
    await this.repository.appendLedger(trx, e.tenantId, {
      supplierId: e.supplierId,
      legalEntityId: e.legalEntityId,
      kind: 'reversal',
      amountDirams: -e.amountDirams,
      dueDate: null,
      sourceType: 'document',
      sourceId: e.documentId,
      businessDate: e.businessDate,
      recordedBy: e.employeeId,
    });
  }
}
