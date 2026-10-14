import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  SupplierLedgerEntry,
  SupplierPaymentRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { ValidationFailedException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { PaymentAllocation } from './allocation';
import { type PaymentRow, PurchasingRepository } from './purchasing.repository';
import { ledgerEntries } from './suppliers.service';

const notFound = () => new ProblemException(404, 'not_found');
const invalid = (field: string, code: string) =>
  new ValidationFailedException([{ field, code }]);
const METHODS = { cash: 'cash', bank: 'bank_transfer' } as const;

/** A real calendar day (the DTO checks only the shape). */
function isDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// Payments to suppliers (spec 2026-10-09-inventory-purchasing, section 5.2) — a financial operation:
// the id of the client is the idempotency key, a repeat with the same body gets the same answer.
// A payment is a ledger entry of the supplier × legal entity and covers its open receipts; the rest
// is a prepayment.
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: PurchasingRepository,
    private readonly allocation: PaymentAllocation,
    private readonly audit: AuditService,
  ) {}

  /** 400, 403, 404 (supplier, legal entity), 409 `idempotency_conflict`. */
  async pay(
    supplierIdParam: string,
    input: SupplierPaymentRequest,
  ): Promise<SupplierLedgerEntry> {
    const { tenantId, employeeId, permissions } = requirePrincipal();
    // a payment is the debt: it needs the cost right as well (ADR-0018, п. 6)
    if (!hasPermissions(permissions, 'finance:view-cost')) {
      throw new ProblemException(403, 'forbidden');
    }
    if (!isDay(input.date)) throw invalid('date', 'invalid');
    const supplierId = supplierIdParam.toLowerCase();
    const paymentId = input.id.toLowerCase();
    const requestedEntity = input.legalEntityId?.toLowerCase() ?? null;

    return this.db.tenantTransaction(async (trx) => {
      const existing = await this.repository.findPayment(
        trx,
        tenantId,
        paymentId,
      );
      if (existing !== null) {
        return this.replay(trx, tenantId, existing, supplierId, input);
      }
      if (
        (await this.repository.findSupplier(trx, tenantId, supplierId)) === null
      ) {
        throw notFound();
      }
      const entities = await this.repository.activeLegalEntities(trx, tenantId);
      let legalEntityId: string;
      if (requestedEntity !== null) {
        if (!entities.includes(requestedEntity)) throw notFound();
        legalEntityId = requestedEntity;
      } else if (entities.length === 1) {
        legalEntityId = entities[0];
      } else {
        throw invalid('legalEntityId', 'required');
      }
      const today = await this.repository.businessDate(trx, tenantId);
      if (input.date > today) throw invalid('date', 'future');

      await this.repository.lockSettlement(
        trx,
        tenantId,
        supplierId,
        legalEntityId,
      );
      const inserted = await this.repository.insertPayment(trx, tenantId, {
        id: paymentId,
        supplierId,
        legalEntityId,
        amountDirams: input.amountMinor,
        paidOn: input.date,
        method: METHODS[input.method],
        comment: input.comment.trim() || null,
        createdBy: employeeId,
      });
      if (!inserted) {
        // a concurrent request with this key committed first
        const winner = await this.repository.findPayment(
          trx,
          tenantId,
          paymentId,
        );
        if (winner === null) throw new Error('The payment key is not readable');
        return this.replay(trx, tenantId, winner, supplierId, input);
      }
      await this.repository.appendLedger(trx, tenantId, {
        supplierId,
        legalEntityId,
        kind: 'payment',
        amountDirams: -input.amountMinor,
        dueDate: null,
        sourceType: 'payment',
        sourceId: paymentId,
        businessDate: input.date,
        recordedBy: employeeId,
      });
      await this.allocation.allocate(trx, tenantId, supplierId, legalEntityId);
      await this.audit.append(trx, {
        action: 'supplier.payment',
        entityType: 'supplier',
        entityId: supplierId,
        details: {
          paymentId,
          legalEntityId,
          amountMinor: input.amountMinor,
          date: input.date,
          method: input.method,
        },
      });
      return this.entryOf(trx, tenantId, supplierId, paymentId);
    });
  }

  /**
   * The same body gets the same payment (id, amount, date, method) with the balance as it is now;
   * another body is a conflict.
   */
  private async replay(
    trx: TenantTransaction,
    tenantId: string,
    payment: PaymentRow,
    supplierId: string,
    input: SupplierPaymentRequest,
  ): Promise<SupplierLedgerEntry> {
    const requestedEntity = input.legalEntityId?.toLowerCase();
    const same =
      payment.supplierId === supplierId &&
      (requestedEntity === undefined ||
        payment.legalEntityId === requestedEntity) &&
      Number(payment.amountDirams) === input.amountMinor &&
      payment.paidOn === input.date &&
      payment.method === METHODS[input.method];
    if (!same) throw new ProblemException(409, 'idempotency_conflict');
    return this.entryOf(trx, tenantId, supplierId, payment.id);
  }

  private async entryOf(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    paymentId: string,
  ): Promise<SupplierLedgerEntry> {
    const rows = await this.repository.ledger(trx, tenantId, supplierId);
    const entry = ledgerEntries(rows).find(
      (e) => e.sourceType === 'payment' && e.sourceId === paymentId,
    );
    if (entry === undefined) throw new Error('The payment has no ledger entry');
    return entry.entry;
  }
}
