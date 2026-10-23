import { Injectable } from '@nestjs/common';
import type {
  Page,
  PaymentListItem,
  TenantPaymentItem,
} from '@pharmacy/shared-dto';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { DEFAULT_PAGE_LIMIT } from '../../../common/pagination';
import { requestHash } from '../../../common/request-hash';
import type { DB } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { TenantAllocation } from './allocation';
import type {
  PaymentListQueryDto,
  RecordPaymentDto,
  UpdatePaymentDto,
} from './dto/payments.dto';
import { InvoicesRepository } from './invoices.repository';
import { type PaymentRow, PaymentsRepository } from './payments.repository';

const notFound = () => new ProblemException(404, 'not_found');
const cancelled = () => new ProblemException(409, 'payment_cancelled');
const future = () =>
  new FieldProblemException(400, 'validation_failed', [
    { field: 'paidOn', code: 'future' },
  ]);

// Payments of networks for the operator (spec 2026-10-15-billing-services, B1, B2, A7, A9): the
// client id is the idempotency key, the hash of the first request answers its repeats. Every change
// takes the row of the network first and computes the allocation of its payments again.
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly payments: PaymentsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly allocation: TenantAllocation,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  /** The same request gets the payment as it is now; another one 409 `idempotency_conflict`. */
  private replay(
    trx: Transaction<DB>,
    row: PaymentRow,
    hash: Buffer,
  ): Promise<PaymentListItem> {
    if (!Buffer.from(row.requestHash).equals(hash)) {
      throw new ProblemException(409, 'idempotency_conflict');
    }
    return this.payments.item(trx, row.id);
  }

  /** 201; 400, 404 (network, invoice), 409 `invoice_paid`, `idempotency_conflict`. */
  async record(input: RecordPaymentDto): Promise<PaymentListItem> {
    const actor = this.actor();
    const id = input.id.toLowerCase();
    const tenantId = input.tenantId.toLowerCase();
    const invoiceId = input.invoiceId?.toLowerCase() ?? null;
    const comment = input.comment ?? null;
    const hash = requestHash({
      tenantId,
      amountMinor: input.amountMinor,
      paidOn: input.paidOn,
      method: input.method,
      invoiceId,
      comment,
    });
    return this.db.platformTransaction(actor, async (trx) => {
      const existing = await this.payments.find(trx, id);
      if (existing !== null) return this.replay(trx, existing, hash);
      if (!(await this.payments.lockTenant(trx, tenantId))) throw notFound();
      // a parallel repeat with the key committed while this request waited for the lock
      const raced = await this.payments.find(trx, id);
      if (raced !== null) return this.replay(trx, raced, hash);
      if (input.paidOn > (await this.invoices.today(trx))) throw future();
      if (invoiceId !== null) {
        const invoice = await this.payments.invoiceOf(trx, invoiceId);
        if (invoice === null || invoice.tenantId !== tenantId) throw notFound();
        if (Number(invoice.paidDirams) >= Number(invoice.totalDirams)) {
          throw new ProblemException(409, 'invoice_paid');
        }
      }
      const inserted = await this.payments.insert(trx, {
        id,
        tenantId,
        amountMinor: input.amountMinor,
        paidOn: input.paidOn,
        method: input.method,
        comment,
        invoiceId,
        recordedBy: actor.operatorId,
        requestHash: hash,
      });
      if (!inserted) {
        const winner = await this.payments.find(trx, id);
        if (winner === null) throw new Error('The payment key is not readable');
        return this.replay(trx, winner, hash);
      }
      await this.allocation.recompute(trx, tenantId);
      await this.audit.append(trx, {
        action: 'payment.recorded',
        tenantId,
        entityType: 'payment',
        entityId: id,
        details: {
          amountMinor: input.amountMinor,
          paidOn: input.paidOn,
          method: input.method,
          invoiceId,
        },
      });
      return this.payments.item(trx, id);
    });
  }

  /** The payment after the lock of its network; 404, 409 `payment_cancelled`. */
  private async lockedActive(
    trx: Transaction<DB>,
    id: string,
  ): Promise<PaymentRow> {
    const probe = await this.payments.find(trx, id);
    if (probe === null) throw notFound();
    await this.payments.lockTenant(trx, probe.tenantId);
    const row = await this.payments.find(trx, id, true);
    if (row === null) throw notFound();
    if (row.status === 'cancelled') throw cancelled();
    return row;
  }

  /** The allocation is computed again, as if the payment had been entered right (A7). */
  update(paymentId: string, input: UpdatePaymentDto): Promise<PaymentListItem> {
    const actor = this.actor();
    const id = paymentId.toLowerCase();
    return this.db.platformTransaction(actor, async (trx) => {
      const row = await this.lockedActive(trx, id);
      if (input.paidOn > (await this.invoices.today(trx))) throw future();
      await this.payments.update(trx, id, {
        amountMinor: input.amountMinor,
        paidOn: input.paidOn,
        method: input.method,
        comment: input.comment,
      });
      await this.allocation.recompute(trx, row.tenantId);
      await this.audit.append(trx, {
        action: 'payment.updated',
        tenantId: row.tenantId,
        entityType: 'payment',
        entityId: id,
        details: {
          previous: {
            amountMinor: Number(row.amountDirams),
            paidOn: row.paidOn,
            method: row.method,
          },
          amountMinor: input.amountMinor,
          paidOn: input.paidOn,
          method: input.method,
        },
      });
      return this.payments.item(trx, id);
    });
  }

  /** Cancelled, never deleted; the reason stays with the payment, not in the journal. */
  cancel(paymentId: string, reason: string): Promise<PaymentListItem> {
    const actor = this.actor();
    const id = paymentId.toLowerCase();
    return this.db.platformTransaction(actor, async (trx) => {
      const row = await this.lockedActive(trx, id);
      await this.payments.cancel(trx, id, reason, actor.operatorId);
      await this.allocation.recompute(trx, row.tenantId);
      await this.audit.append(trx, {
        action: 'payment.cancelled',
        tenantId: row.tenantId,
        entityType: 'payment',
        entityId: id,
        details: { amountMinor: Number(row.amountDirams) },
      });
      return this.payments.item(trx, id);
    });
  }

  list(query: PaymentListQueryDto): Promise<Page<PaymentListItem>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = query.offset ?? 0;
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const page = await this.payments.list(
        trx,
        query.tenantId?.toLowerCase() ?? null,
        limit,
        offset,
      );
      return { ...page, limit, offset };
    });
  }

  /** 404 for an unknown network. */
  tenantPayments(tenantIdParam: string): Promise<TenantPaymentItem[]> {
    const tenantId = tenantIdParam.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      if (!(await this.invoices.tenantExists(trx, tenantId))) throw notFound();
      return this.payments.ofTenant(trx, tenantId);
    });
  }
}
