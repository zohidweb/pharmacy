import { Injectable } from '@nestjs/common';
import { hasPermissions, prorateExpense } from '@pharmacy/shared-domain';
import type { ReportKind, ReportTable } from '@pharmacy/shared-dto';
import {
  type EmployeePrincipal,
  requirePrincipal,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { StockFigures } from '../inventory/stock-figures';
import { SalesFigures } from '../pos/sales-figures';
import { SupplierDues } from '../purchasing/supplier-dues';
import { ReturnFigures } from '../returns/return-figures';
import { daysBetween } from './dashboard-period';
import { ExpensesRepository } from './expenses.repository';
import { REPORT_KINDS, type ReportQueryDto } from './dto/reports.dto';
import * as build from './report-builders';
import { ReportsRepository } from './reports.repository';
import { scopeOf } from './scope';

/** The longest period of a report (spec 2026-10-14-owner-cabinet, E1). */
const MAX_REPORT_DAYS = 366;

function nameIn(names: unknown, locale: 'ru' | 'tg'): string {
  if (typeof names !== 'object' || names === null) return '—';
  const map = names as Record<string, unknown>;
  for (const key of [locale === 'tg' ? 'tj' : 'ru', 'ru', 'tj']) {
    const value = map[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return '—';
}

// The reports of the owner cabinet (spec 2026-10-14-owner-cabinet, 5.3, E3, E18, E19): one table per
// kind over a period of business dates and the stores of the scope (or one of them).
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: ReportsRepository,
    private readonly sales: SalesFigures,
    private readonly refunds: ReturnFigures,
    private readonly stock: StockFigures,
    private readonly dues: SupplierDues,
    private readonly expenses: ExpensesRepository,
  ) {}

  get(kind: string, query: ReportQueryDto): Promise<ReportTable> {
    if (!REPORT_KINDS.includes(kind as ReportKind)) {
      throw new ProblemException(404, 'not_found');
    }
    const reportKind = kind as ReportKind;
    const principal = requirePrincipal();
    const scope = scopeOf(principal);
    if (query.storeId && scope !== 'all' && !scope.includes(query.storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    return this.db.tenantTransaction(async (trx) => {
      const { today, expiryDays } = await this.repository.context(
        trx,
        principal.tenantId,
      );
      const { from, to } = query;
      if (from > to || to > today || daysBetween(from, to) >= MAX_REPORT_DAYS) {
        throw new FieldProblemException(422, 'validation_failed', [
          { field: 'from', code: 'range' },
        ]);
      }
      const stores = (
        await this.repository.reportStores(trx, principal.tenantId, scope, from)
      ).filter((store) => !query.storeId || store.id === query.storeId);
      const body = await this.body(
        trx,
        principal,
        reportKind,
        stores,
        { from, to, today, expiryDays },
        // the records of the whole network count only for the whole network, without a store filter
        scope === 'all' && !query.storeId,
      );
      return { kind: reportKind, ...body };
    });
  }

  private async body(
    trx: TenantTransaction,
    principal: EmployeePrincipal,
    kind: ReportKind,
    stores: readonly { id: string; name: string; kind: string }[],
    period: { from: string; to: string; today: string; expiryDays: number },
    network: boolean,
  ): Promise<Omit<ReportTable, 'kind'>> {
    const { tenantId, locale } = principal;
    const { from, to } = period;
    const canSeeCost = hasPermissions(
      principal.permissions,
      'finance:view-cost',
    );
    const storeIds = stores.map((store) => store.id);
    const storeName = (id: string) =>
      stores.find((store) => store.id === id)?.name ?? '—';
    const products = async (ids: readonly string[]) => {
      const names = await this.repository.productNames(trx, tenantId, [
        ...new Set(ids),
      ]);
      return (id: string) => nameIn(names.get(id), locale);
    };
    const employees = async (ids: readonly string[]) => {
      const names = await this.repository.employeeNames(trx, tenantId, [
        ...new Set(ids),
      ]);
      return (id: string) => names.get(id) ?? '—';
    };

    switch (kind) {
      case 'sales_by_store':
        // every store of the selection: a warehouse sells nothing, but its write-offs and
        // stock-count differences lower the profit of the network (final review I2)
        return build.salesByStore(
          stores,
          await this.sales.byStore(trx, tenantId, storeIds, from, to),
          await this.refunds.byStore(trx, tenantId, storeIds, from, to),
          await this.stock.lossesByStore(trx, tenantId, storeIds, from, to),
          canSeeCost,
          canSeeCost &&
            hasPermissions(principal.permissions, 'expenses:view')
            ? await this.expensesOf(trx, principal, storeIds, period, network)
            : null,
        );
      case 'sales_by_category': {
        const names = await this.repository.categoryNames(trx, tenantId);
        return build.salesByCategory(
          [...names].map(([id, name]) => ({ id, name: nameIn(name, locale) })),
          await this.sales.byCategory(trx, tenantId, storeIds, from, to),
          await this.refunds.byCategory(trx, tenantId, storeIds, from, to),
          canSeeCost,
        );
      }
      case 'stock':
        return build.stock(
          stores,
          await this.stock.stockAt(
            trx,
            tenantId,
            storeIds,
            to,
            period.expiryDays,
          ),
          canSeeCost,
        );
      case 'movement': {
        const rows = await this.stock.movement(
          trx,
          tenantId,
          storeIds,
          from,
          to,
        );
        return build.movement(
          rows,
          await products(rows.map((row) => row.productId)),
        );
      }
      case 'supplier_debts':
        // today, whatever the period (E18); the whole network — every store, closed ones too, as the
        // supplier list (spec 2026-10-15-store-closing, E13)
        return build.supplierDebts(
          await this.dues.debts(
            trx,
            tenantId,
            period.today,
            network ? undefined : storeIds,
          ),
          canSeeCost,
        );
      case 'cashiers': {
        const sold = await this.sales.byCashier(
          trx,
          tenantId,
          storeIds,
          from,
          to,
        );
        const back = await this.refunds.byCashier(
          trx,
          tenantId,
          storeIds,
          from,
          to,
        );
        return build.cashiers(
          sold,
          back,
          await employees([...sold, ...back].map((row) => row.cashierId)),
          storeName,
        );
      }
      case 'losses': {
        const lines = await this.stock.lossLines(
          trx,
          tenantId,
          storeIds,
          from,
          to,
        );
        return build.losses(
          lines,
          storeName,
          await products(lines.map((line) => line.productId)),
          canSeeCost,
        );
      }
      case 'controlled': {
        const sales = await this.sales.controlledSales(
          trx,
          tenantId,
          storeIds,
          from,
          to,
        );
        return build.controlled(
          sales,
          storeName,
          await products(sales.map((sale) => sale.productId)),
          await employees(sales.map((sale) => sale.cashierId)),
        );
      }
      case 'controlled_summary': {
        const rows = await this.stock.controlledSummary(
          trx,
          tenantId,
          storeIds,
          from,
          to,
        );
        return build.controlledSummary(
          rows,
          await products(rows.map((row) => row.productId)),
          storeName,
        );
      }
    }
  }
  /**
   * The expenses of the period (spec E16): each record of a month overlapping the period gives its
   * share of days (prorateExpense); the records of the network only when `network`; the cash
   * withdrawals «на расходы» of the stores whole.
   */
  private async expensesOf(
    trx: TenantTransaction,
    principal: EmployeePrincipal,
    storeIds: readonly string[],
    period: { from: string; to: string },
    network: boolean,
  ): Promise<build.StoreExpenses> {
    const { tenantId } = principal;
    const { from, to } = period;
    const records = await this.expenses.ofMonths(
      trx,
      tenantId,
      from.slice(0, 7),
      to.slice(0, 7),
    );
    const byStore = new Map<string, number>();
    let networkMinor = 0;
    for (const record of records) {
      const share = prorateExpense(record.amountMinor, record.month, from, to);
      if (record.storeId === null) {
        if (network) networkMinor += share;
      } else if (storeIds.includes(record.storeId)) {
        byStore.set(record.storeId, (byStore.get(record.storeId) ?? 0) + share);
      }
    }
    const cash = await this.sales.cashExpensesByStore(
      trx,
      tenantId,
      storeIds,
      from,
      to,
    );
    return { byStore, networkMinor, cash };
  }
}
