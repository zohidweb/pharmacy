import { Injectable } from '@nestjs/common';
import { daysInMonth, expenseKinds } from '@pharmacy/shared-domain';
import type {
  CashExpensesOfStore,
  CreateExpenseRequest,
  Expense,
  ExpenseListResponse,
  ExpenseQuery,
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
import { SalesFigures } from '../pos/sales-figures';
import {
  type ExpenseFields,
  type ExpenseRow,
  ExpensesRepository,
} from './expenses.repository';
import { ReportsRepository } from './reports.repository';
import { scopeOf } from './scope';

type Scope = 'all' | readonly string[];

/** A record the employee may see: of a store of the scope, or of the network for the whole network. */
const visible = (scope: Scope, storeId: string | null) =>
  scope === 'all' || (storeId !== null && scope.includes(storeId));

const facts = (record: ExpenseFields) => ({
  month: record.month,
  expenseKind: record.kind,
  amountMinor: record.amountMinor,
  comment: record.comment,
});

/**
 * The previous values of the fields an edit changed, flat, for the journal (final review I1): the
 * month, the kind, the amount and — on a move — the store (`network` for the whole network).
 */
function previousOf(
  before: ExpenseRow,
  after: ExpenseFields,
): Record<string, string | number> {
  const previous: Record<string, string | number> = {};
  if (before.month !== after.month) previous.previousMonth = before.month;
  if (before.kind !== after.kind) previous.previousExpenseKind = before.kind;
  if (before.amountMinor !== after.amountMinor) {
    previous.previousAmountMinor = before.amountMinor;
  }
  if (before.storeId !== after.storeId) {
    previous.previousStore = before.storeName ?? 'network';
  }
  return previous;
}

const fieldsOf = (record: ExpenseRow): ExpenseFields => ({
  month: record.month,
  storeId: record.storeId,
  kind: record.kind,
  amountMinor: record.amountMinor,
  comment: record.comment,
});

const kindOrder = (kind: string) =>
  expenseKinds.indexOf(kind as (typeof expenseKinds)[number]);

// The other expenses of the network (spec 2026-10-14-owner-cabinet, O4, O9, E16, 5.6): the records
// of a month within the scope of the employee, and the cash withdrawals «на расходы» of the month
// read from the shifts. A record of the whole network is seen and changed only by an employee of
// the whole network. Every change is audited with the previous values.
@Injectable()
export class ExpensesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: ExpensesRepository,
    private readonly reports: ReportsRepository,
    private readonly sales: SalesFigures,
    private readonly audit: AuditService,
  ) {}

  list(query: ExpenseQuery): Promise<ExpenseListResponse> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    const scope = scopeOf(principal);
    return this.db.tenantTransaction(async (trx) => {
      const stores = (
        await this.reports.activeStores(trx, tenantId, scope)
      ).filter((store) => !query.storeId || store.id === query.storeId);
      if (query.storeId && stores.length === 0) {
        throw new ProblemException(403, 'store_not_in_scope');
      }
      const items = (
        await this.repository.ofMonths(trx, tenantId, query.month, query.month)
      )
        .filter((row) =>
          query.storeId
            ? row.storeId === query.storeId
            : visible(scope, row.storeId),
        )
        .sort(
          (a, b) =>
            Number(a.storeId !== null) - Number(b.storeId !== null) ||
            (a.storeName ?? '').localeCompare(b.storeName ?? '', 'ru') ||
            kindOrder(a.kind) - kindOrder(b.kind) ||
            b.amountMinor - a.amountMinor,
        );
      const last = `${query.month}-${String(daysInMonth(query.month)).padStart(2, '0')}`;
      const cash = await this.sales.cashExpensesByStore(
        trx,
        tenantId,
        stores.map((store) => store.id),
        `${query.month}-01`,
        last,
      );
      const cashExpenses: CashExpensesOfStore[] = stores.flatMap((store) => {
        const figure = cash.find((row) => row.storeId === store.id);
        return figure
          ? [
              {
                storeId: store.id,
                storeName: store.name,
                amountMinor: figure.amountMinor,
                operations: figure.operations,
              },
            ]
          : [];
      });
      return {
        items: items.map((row) => ({ ...row })),
        totalMinor: items.reduce((sum, row) => sum + row.amountMinor, 0),
        cashExpenses,
      };
    });
  }

  create(body: CreateExpenseRequest): Promise<Expense> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    return this.db.tenantTransaction(async (trx) => {
      await this.checkRecord(trx, tenantId, scopeOf(principal), body);
      const id = newId();
      await this.repository.insert(trx, tenantId, id, body, principal.employeeId);
      await this.audit.append(trx, {
        action: 'expense.created',
        entityType: 'expense',
        entityId: id,
        storeId: body.storeId ?? undefined,
        details: facts(body),
      });
      return this.load(trx, tenantId, id);
    });
  }

  update(id: string, body: CreateExpenseRequest): Promise<Expense> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    const scope = scopeOf(principal);
    return this.db.tenantTransaction(async (trx) => {
      const before = await this.visibleRecord(trx, tenantId, scope, id);
      await this.checkRecord(trx, tenantId, scope, body);
      await this.repository.update(trx, tenantId, id, body, principal.employeeId);
      await this.audit.append(trx, {
        action: 'expense.updated',
        entityType: 'expense',
        entityId: id,
        storeId: body.storeId ?? undefined,
        details: {
          ...facts(body),
          ...previousOf(before, body),
          before: { ...fieldsOf(before) },
          after: { ...body },
        },
      });
      return this.load(trx, tenantId, id);
    });
  }

  remove(id: string): Promise<void> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    const scope = scopeOf(principal);
    return this.db.tenantTransaction(async (trx) => {
      const before = await this.visibleRecord(trx, tenantId, scope, id);
      await this.repository.remove(trx, tenantId, id);
      await this.audit.append(trx, {
        action: 'expense.deleted',
        entityType: 'expense',
        entityId: id,
        storeId: before.storeId ?? undefined,
        details: { ...facts(fieldsOf(before)), before: { ...fieldsOf(before) } },
      });
    });
  }

  /** 404 for an unknown record; 403 for a record of a store outside the scope or of the network. */
  private async visibleRecord(
    trx: TenantTransaction,
    tenantId: string,
    scope: Scope,
    id: string,
  ): Promise<ExpenseRow> {
    const record = await this.repository.find(trx, tenantId, id);
    if (!record) throw new ProblemException(404, 'not_found');
    if (!visible(scope, record.storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    return record;
  }

  /**
   * The month is not later than the current month of the network (422 `range`); the store is an
   * active store of the scope, the whole network — only for an employee of the whole network (403).
   */
  private async checkRecord(
    trx: TenantTransaction,
    tenantId: string,
    scope: Scope,
    body: CreateExpenseRequest,
  ): Promise<void> {
    const { today } = await this.reports.context(trx, tenantId);
    if (body.month > today.slice(0, 7)) {
      throw new FieldProblemException(422, 'validation_failed', [
        { field: 'month', code: 'range' },
      ]);
    }
    if (body.storeId === null) {
      if (scope !== 'all') throw new ProblemException(403, 'store_not_in_scope');
      return;
    }
    const stores = await this.reports.activeStores(trx, tenantId, scope);
    if (!stores.some((store) => store.id === body.storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
  }

  private async load(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<Expense> {
    const record = await this.repository.find(trx, tenantId, id);
    if (!record) throw new ProblemException(404, 'not_found');
    return record;
  }
}
