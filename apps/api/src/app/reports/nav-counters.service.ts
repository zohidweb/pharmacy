import { Injectable } from '@nestjs/common';
import { hasPermissions, type Permission } from '@pharmacy/shared-domain';
import type { NavCounters, NavCountersQuery } from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { TenantDatabase } from '../../core/database';
import { StockAlerts } from '../inventory/stock-alerts';
import { PriceProblems } from '../pricing/price-problems';
import { ReportsRepository } from './reports.repository';
import { scopeOf } from './scope';

// Numbers of the side menu (spec 2026-10-15-nav-counters, E1–E5): products below the minimum, transfers
// in transit to the stores, price problems of the pharmacies — each only with its permission. The
// stores are the active stores of the scope, or the one `storeId` of it; a PIN session — its terminal's
// store. The rules are the exports of the domain modules, the same the screens filter by.
@Injectable()
export class NavCountersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: ReportsRepository,
    private readonly alerts: StockAlerts,
    private readonly problems: PriceProblems,
  ) {}

  async get(query: NavCountersQuery): Promise<NavCounters> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    const scope = scopeOf(principal);
    const storeId = query.storeId?.toLowerCase();
    if (storeId && scope !== 'all' && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    const has = (permission: Permission) =>
      hasPermissions(principal.permissions, permission);
    return this.db.tenantTransaction(async (trx) => {
      const stores = (
        await this.repository.activeStores(trx, tenantId, scope)
      ).filter((store) => !storeId || store.id === storeId);
      const storeIds = stores.map((store) => store.id);
      const counters: NavCounters = {};
      // one pass over the movements gives the products below the minimum and those in stock
      const signals = has('inventory:view')
        ? await this.alerts.stockSignals(trx, tenantId, storeIds)
        : null;
      if (signals) counters.lowStock = signals.lines.length;
      if (has('inventory:receive')) {
        counters.incomingTransfers = (
          await this.alerts.transfersInTransit(trx, tenantId, storeIds)
        ).length;
      }
      if (has('pricing:view')) {
        counters.priceProblems = await this.problems.count(
          trx,
          tenantId,
          stores
            .filter((store) => store.kind === 'pharmacy')
            .map((store) => store.id),
          has('finance:view-cost'),
          signals?.stocked,
        );
      }
      return counters;
    });
  }
}
