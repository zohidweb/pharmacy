import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { PurchasingRepository } from './purchasing.repository';

/** A posted goods receipt with what is still owed by it. */
export interface OpenReceipt {
  documentId: string;
  remainingDirams: bigint;
}

// Allocation of payments to goods receipts (spec 2026-10-09-inventory-purchasing, section 5.2):
// within one supplier × legal entity the oldest payments with a rest cover the open receipts from
// the earliest due date; what a payment does not cover is a prepayment. Allocations of one supplier
// × legal entity are serialised by an advisory lock, so two payments, or a payment and a posting,
// never cover the same remainder twice. Runs in the caller's transaction.
@Injectable()
export class PaymentAllocation {
  constructor(private readonly repository: PurchasingRepository) {}

  /**
   * Covers the open receipts of the supplier × legal entity with the rests of its payments.
   * `first` is a receipt being posted (not yet `posted`): it takes the prepayments before the
   * others.
   */
  async allocate(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    legalEntityId: string,
    first: OpenReceipt | null = null,
  ): Promise<void> {
    await this.repository.lockSettlement(
      trx,
      tenantId,
      supplierId,
      legalEntityId,
    );
    const payments = await this.repository.paymentsWithRest(
      trx,
      tenantId,
      supplierId,
      legalEntityId,
    );
    if (payments.length === 0) return;
    const receipts = [
      ...(first === null ? [] : [first]),
      ...(await this.repository.openReceipts(
        trx,
        tenantId,
        supplierId,
        legalEntityId,
      )),
    ].map((r) => ({ ...r, remainingDirams: BigInt(r.remainingDirams) }));
    let p = 0;
    for (const receipt of receipts) {
      while (receipt.remainingDirams > 0n && p < payments.length) {
        const payment = payments[p];
        const rest = BigInt(payment.restDirams);
        const amount =
          rest < receipt.remainingDirams ? rest : receipt.remainingDirams;
        await this.repository.addAllocation(
          trx,
          tenantId,
          payment.paymentId,
          receipt.documentId,
          amount,
        );
        receipt.remainingDirams -= amount;
        payment.restDirams = rest - amount;
        if (payment.restDirams === 0n) p += 1;
      }
      if (p >= payments.length) return;
    }
  }
}
