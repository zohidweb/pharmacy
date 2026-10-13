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

/** A line of a supplier return: its amount and the goods receipt its batch came from, if any. */
export interface ReturnCreditLine {
  receiptId: string | null;
  amountDirams: number;
}

const pairKey = (supplierId: string, legalEntityId: string) =>
  `${supplierId}/${legalEntityId}`;

// Settlements with suppliers as the stock module drives them (spec 2026-10-09, sections 5.1–5.2;
// 2026-10-12-supplier-returns-transfers, 2.1 p. 3): a posted goods receipt is a debt of the legal
// entity of its store and takes the credits (prepayments, returns) of that supplier × legal entity;
// a posted supplier return is a credit allocated like a payment, to the receipts of its batches
// first; an unposting releases the allocations and reverses the entry. The ledger is append-only —
// a correction is a new entry. Runs in the caller's transaction.
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
    const released =
      (await this.repository.releaseAllocations(
        trx,
        e.tenantId,
        e.documentId,
      )) +
      (await this.repository.releaseReturnAllocations(trx, e.tenantId, {
        receiptId: e.documentId,
      }));
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

  /**
   * A posted supplier return: per supplier × legal entity — of the receipt a line's batch came from
   * (the debt is there), else of the store of the return (E1, E2) — a `supplier_return` entry minus
   * the amount; the credit covers the receipts of its lines first, then the other open receipts;
   * the rest waits for the next receipt. A zero amount writes nothing.
   */
  async returnPosted(
    trx: TenantTransaction,
    e: {
      tenantId: string;
      supplierId: string;
      storeLegalEntityId: string;
      documentId: string;
      businessDate: string;
      employeeId: string;
      lines: readonly ReturnCreditLine[];
    },
  ): Promise<void> {
    const pairs = new Map<
      string,
      { legalEntityId: string; amount: number; receipts: Map<string, number> }
    >();
    const entityOf = new Map<string, string>();
    for (const line of e.lines) {
      if (line.amountDirams === 0) continue;
      let legalEntityId = e.storeLegalEntityId;
      if (line.receiptId !== null) {
        if (!entityOf.has(line.receiptId)) {
          const own = (
            await this.repository.balancesOfSource(
              trx,
              e.tenantId,
              line.receiptId,
            )
          ).find((b) => b.supplierId === e.supplierId && b.amountDirams > 0);
          entityOf.set(
            line.receiptId,
            own?.legalEntityId ?? e.storeLegalEntityId,
          );
        }
        legalEntityId = entityOf.get(line.receiptId) ?? legalEntityId;
      }
      const key = pairKey(e.supplierId, legalEntityId);
      const pair = pairs.get(key) ?? {
        legalEntityId,
        amount: 0,
        receipts: new Map<string, number>(),
      };
      pair.amount += line.amountDirams;
      if (line.receiptId !== null) {
        pair.receipts.set(
          line.receiptId,
          (pair.receipts.get(line.receiptId) ?? 0) + line.amountDirams,
        );
      }
      pairs.set(key, pair);
    }
    // a fixed order of the settlement locks: two returns never wait for each other's pair
    for (const pair of [...pairs.values()].sort((a, b) =>
      a.legalEntityId.localeCompare(b.legalEntityId),
    )) {
      await this.repository.lockSettlement(
        trx,
        e.tenantId,
        e.supplierId,
        pair.legalEntityId,
      );
      await this.repository.appendLedger(trx, e.tenantId, {
        supplierId: e.supplierId,
        legalEntityId: pair.legalEntityId,
        kind: 'supplier_return',
        amountDirams: -pair.amount,
        dueDate: null,
        sourceType: 'document',
        sourceId: e.documentId,
        businessDate: e.businessDate,
        recordedBy: e.employeeId,
      });
      await this.allocation.allocateToReceipts(
        trx,
        e.tenantId,
        e.supplierId,
        pair.legalEntityId,
        e.documentId,
        [...pair.receipts].map(([documentId, amount]) => ({
          documentId,
          maxDirams: BigInt(amount),
        })),
      );
      await this.allocation.allocate(
        trx,
        e.tenantId,
        e.supplierId,
        pair.legalEntityId,
      );
    }
  }

  /**
   * Unposting of a supplier return: its allocations are released and its entries reversed, per
   * supplier and legal entity as they were written; the released receipts are covered again by the
   * other credits.
   */
  async returnUnposted(
    trx: TenantTransaction,
    e: {
      tenantId: string;
      documentId: string;
      businessDate: string;
      employeeId: string;
    },
  ): Promise<void> {
    const balances = (
      await this.repository.balancesOfSource(trx, e.tenantId, e.documentId)
    ).sort((a, b) =>
      pairKey(a.supplierId, a.legalEntityId).localeCompare(
        pairKey(b.supplierId, b.legalEntityId),
      ),
    );
    for (const balance of balances) {
      await this.repository.lockSettlement(
        trx,
        e.tenantId,
        balance.supplierId,
        balance.legalEntityId,
      );
    }
    const released = await this.repository.releaseReturnAllocations(
      trx,
      e.tenantId,
      { returnId: e.documentId },
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
