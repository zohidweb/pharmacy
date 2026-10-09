import { Injectable } from '@nestjs/common';
import { hasPermissions, supplierDebt } from '@pharmacy/shared-domain';
import type {
  SupplierCard,
  SupplierInput,
  SupplierLedgerEntry,
  SupplierListItem,
  SupplierListResponse,
  SupplierOption,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  PurchasingRepository,
  type ReceiptRow,
  type SupplierRow,
  type SupplierValues,
} from './purchasing.repository';

const notFound = () => new ProblemException(404, 'not_found');
const scopeIds = (storeScope: 'all' | readonly string[]) =>
  storeScope === 'all' ? null : storeScope;

function valuesOf(input: SupplierInput): SupplierValues {
  return {
    name: input.name.trim(),
    taxId: input.taxId.trim() || null,
    phone: input.phone.trim() || null,
    address: input.address.trim() || null,
    paymentTermDays: input.paymentDelayDays,
  };
}

/**
 * Debt fields of a supplier: the posted receipts minus the credits, covered FIFO by due date
 * (`supplierDebt`). In this iteration there are no payments, so the credits are 0.
 */
function debtOf(
  supplier: SupplierRow,
  receipts: readonly ReceiptRow[],
  creditsMinor: number,
  today: string,
  canSeeCost: boolean,
): SupplierListItem {
  const debt = supplierDebt(
    receipts.map((r) => ({
      document: r.number,
      dueOn: r.dueDate ?? r.documentDate,
      amountMinor: Number(r.totalDirams),
    })),
    creditsMinor,
    today,
  );
  return {
    id: supplier.id,
    name: supplier.name,
    taxId: supplier.taxId ?? '',
    phone: supplier.phone ?? '',
    address: supplier.address ?? '',
    paymentDelayDays: supplier.paymentTermDays,
    debtState:
      debt.debtMinor === 0
        ? 'none'
        : debt.overdueMinor > 0
          ? 'overdue'
          : 'on_time',
    ...(canSeeCost
      ? { debtMinor: debt.debtMinor, overdueMinor: debt.overdueMinor }
      : {}),
    nextDueOn: debt.nextDueOn,
    overdueDays: debt.overdueDays,
  };
}

// Suppliers of the network (spec 2026-10-09-inventory-purchasing, section 5.1): the directory, the
// debt by posted receipts and the ledger. Names are unique in the network whatever the case.
@Injectable()
export class SuppliersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: PurchasingRepository,
    private readonly audit: AuditService,
  ) {}

  async options(): Promise<SupplierOption[]> {
    const { tenantId } = requirePrincipal();
    const rows = await this.db.tenantTransaction((trx) =>
      this.repository.listSuppliers(trx, tenantId),
    );
    return rows
      .filter((r) => r.status === 'active')
      .map((r) => ({ id: r.id, name: r.name }));
  }

  async list(query: {
    limit?: number;
    offset?: number;
  }): Promise<SupplierListResponse> {
    const { tenantId, permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const today = await this.repository.businessDate(trx, tenantId);
      const suppliers = await this.repository.listSuppliers(trx, tenantId);
      const receipts = await this.repository.postedReceipts(
        trx,
        tenantId,
        null,
      );
      const items = suppliers.map((s) =>
        debtOf(
          s,
          receipts.filter((r) => r.supplierId === s.id),
          0,
          today,
          canSeeCost,
        ),
      );
      return {
        items: items.slice(offset, offset + limit),
        total: items.length,
        limit,
        offset,
        ...(canSeeCost
          ? {
              totals: {
                debtMinor: items.reduce(
                  (sum, s) => sum + (s.debtMinor ?? 0),
                  0,
                ),
                overdueMinor: items.reduce(
                  (sum, s) => sum + (s.overdueMinor ?? 0),
                  0,
                ),
              },
            }
          : {}),
      };
    });
  }

  async card(id: string): Promise<SupplierCard> {
    const { tenantId, storeScope, permissions } = requirePrincipal();
    // the card is the debt and the ledger: it needs the cost right as well (ADR-0018, п. 6)
    if (!hasPermissions(permissions, 'finance:view-cost')) {
      throw new ProblemException(403, 'forbidden');
    }
    const supplierId = id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const supplier = await this.repository.findSupplier(
        trx,
        tenantId,
        supplierId,
      );
      if (supplier === null) throw notFound();
      const today = await this.repository.businessDate(trx, tenantId);
      const receipts = await this.repository.postedReceipts(
        trx,
        tenantId,
        supplierId,
      );
      const scope = scopeIds(storeScope);
      return {
        ...debtOf(supplier, receipts, 0, today, true),
        orders: [],
        receipts: receipts
          .filter((r) => scope === null || scope.includes(r.storeId))
          .map((r) => ({
            id: r.id,
            number: r.number,
            date: r.documentDate,
            storeName: r.storeName,
            totalMinor: Number(r.totalDirams),
          })),
        ledger: await this.ledger(trx, tenantId, supplierId),
      };
    });
  }

  async create(input: SupplierInput): Promise<SupplierListItem> {
    const { tenantId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      const values = valuesOf(input);
      await this.checkName(trx, tenantId, values.name, null);
      await this.repository.insertSupplier(trx, tenantId, id, values);
      await this.audit.append(trx, {
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: id,
        details: { name: values.name },
      });
      return this.item(trx, tenantId, id);
    });
  }

  async update(id: string, input: SupplierInput): Promise<SupplierListItem> {
    const { tenantId } = requirePrincipal();
    const supplierId = id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      if (
        (await this.repository.findSupplier(trx, tenantId, supplierId)) === null
      ) {
        throw notFound();
      }
      const values = valuesOf(input);
      await this.checkName(trx, tenantId, values.name, supplierId);
      await this.repository.updateSupplier(trx, tenantId, supplierId, values);
      await this.audit.append(trx, {
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: supplierId,
        details: { name: values.name },
      });
      return this.item(trx, tenantId, supplierId);
    });
  }

  private async item(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<SupplierListItem> {
    const { permissions } = requirePrincipal();
    const supplier = await this.repository.findSupplier(trx, tenantId, id);
    if (supplier === null)
      throw new Error('The supplier just written is not readable');
    const today = await this.repository.businessDate(trx, tenantId);
    const receipts = await this.repository.postedReceipts(trx, tenantId, id);
    return debtOf(
      supplier,
      receipts,
      0,
      today,
      hasPermissions(permissions, 'finance:view-cost'),
    );
  }

  private async checkName(
    trx: TenantTransaction,
    tenantId: string,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    if (await this.repository.nameTaken(trx, tenantId, name, exceptId)) {
      throw new FieldProblemException(409, 'supplier_name_taken', [
        { field: 'name', code: 'supplier_name_taken' },
      ]);
    }
  }

  /** The ledger in the shape of the card: newest first, with the running debt. */
  private async ledger(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
  ): Promise<SupplierLedgerEntry[]> {
    const rows = await this.repository.ledger(trx, tenantId, supplierId);
    let balance = 0;
    const entries = rows.map((row): SupplierLedgerEntry => {
      const amount = Number(row.amountDirams);
      balance += amount;
      return {
        date: row.businessDate,
        kind: row.kind === 'payment' ? 'payment' : 'receipt',
        document: row.documentNumber ?? '',
        comment: '',
        amountMinor: amount,
        balanceMinor: balance,
      };
    });
    return entries.reverse();
  }
}
