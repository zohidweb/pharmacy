import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { type CreditRest, PurchasingRepository } from './purchasing.repository';

/** A posted goods receipt with what is still owed by it. */
export interface OpenReceipt {
  documentId: string;
  remainingDirams: bigint;
}

type Credit = CreditRest & { kind: 'payment' | 'return' };

const byAge = (a: Credit, b: Credit) =>
  a.date.localeCompare(b.date) ||
  a.at.getTime() - b.at.getTime() ||
  a.id.localeCompare(b.id);

// Allocation of the credits of a supplier to goods receipts (spec 2026-10-09-inventory-purchasing,
// section 5.2; 2026-10-12-supplier-returns-transfers, 2.1 p. 3): within one supplier × legal entity
// the oldest credits with a rest — payments and posted supplier returns — cover the open receipts
// from the earliest due date; what a credit does not cover waits for the next receipt (a payment's
// rest is a prepayment). Allocations of one supplier × legal entity are serialised by an advisory
// lock, so two payments, or a payment and a posting, never cover the same remainder twice. Runs in
// the caller's transaction.
@Injectable()
export class PaymentAllocation {
  constructor(private readonly repository: PurchasingRepository) {}

  /**
   * Covers the open receipts of the supplier × legal entity with the rests of its credits.
   * `first` is a receipt being posted (not yet `posted`): it takes the credits before the others.
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
    const credits = await this.credits(
      trx,
      tenantId,
      supplierId,
      legalEntityId,
    );
    if (credits.length === 0) return;
    const receipts = [
      ...(first === null ? [] : [first]),
      // a receipt of an offline store is applied as already `posted`: it is `first`, never a second time
      ...(
        await this.repository.openReceipts(
          trx,
          tenantId,
          supplierId,
          legalEntityId,
        )
      ).filter((r) => r.documentId !== first?.documentId),
    ].map((r) => ({ ...r, remainingDirams: BigInt(r.remainingDirams) }));
    let c = 0;
    for (const receipt of receipts) {
      while (receipt.remainingDirams > 0n && c < credits.length) {
        const credit = credits[c];
        const rest = BigInt(credit.restDirams);
        const amount =
          rest < receipt.remainingDirams ? rest : receipt.remainingDirams;
        await this.add(trx, tenantId, credit, receipt.documentId, amount);
        receipt.remainingDirams -= amount;
        credit.restDirams = rest - amount;
        if (credit.restDirams === 0n) c += 1;
      }
      if (c >= credits.length) return;
    }
  }

  /**
   * The credit of a posted return covers the receipts its batches came from first, each by at most
   * `maxDirams` (the amount of its lines of that receipt). Under the settlement lock of the pair.
   */
  async allocateToReceipts(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    legalEntityId: string,
    returnId: string,
    targets: ReadonlyArray<{ documentId: string; maxDirams: bigint }>,
  ): Promise<void> {
    await this.repository.lockSettlement(
      trx,
      tenantId,
      supplierId,
      legalEntityId,
    );
    const credit = (
      await this.repository.returnsWithRest(
        trx,
        tenantId,
        supplierId,
        legalEntityId,
      )
    ).find((r) => r.id === returnId);
    if (!credit) return;
    let rest = BigInt(credit.restDirams);
    const open = new Map(
      (
        await this.repository.openReceipts(
          trx,
          tenantId,
          supplierId,
          legalEntityId,
        )
      ).map((r) => [r.documentId, BigInt(r.remainingDirams)]),
    );
    for (const target of targets) {
      const remaining = open.get(target.documentId) ?? 0n;
      let amount = remaining < target.maxDirams ? remaining : target.maxDirams;
      if (rest < amount) amount = rest;
      if (amount <= 0n) continue;
      await this.repository.addReturnAllocation(
        trx,
        tenantId,
        returnId,
        target.documentId,
        amount,
      );
      rest -= amount;
    }
  }

  private async credits(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    legalEntityId: string,
  ): Promise<Credit[]> {
    // one connection in a transaction: the queries go one after the other
    const payments = await this.repository.paymentsWithRest(
      trx,
      tenantId,
      supplierId,
      legalEntityId,
    );
    const returns = await this.repository.returnsWithRest(
      trx,
      tenantId,
      supplierId,
      legalEntityId,
    );
    return [
      ...payments.map((p): Credit => ({ ...p, kind: 'payment' })),
      ...returns.map((r): Credit => ({ ...r, kind: 'return' })),
    ].sort(byAge);
  }

  private add(
    trx: TenantTransaction,
    tenantId: string,
    credit: Credit,
    documentId: string,
    amount: bigint,
  ): Promise<void> {
    return credit.kind === 'payment'
      ? this.repository.addAllocation(
          trx,
          tenantId,
          credit.id,
          documentId,
          amount,
        )
      : this.repository.addReturnAllocation(
          trx,
          tenantId,
          credit.id,
          documentId,
          amount,
        );
  }
}
