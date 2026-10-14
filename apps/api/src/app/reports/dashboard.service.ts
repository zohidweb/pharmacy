import { Injectable } from '@nestjs/common';
import type {
  DailyRevenue,
  DashboardStoreRow,
  TenantDashboard,
} from '@pharmacy/shared-dto';
import { hasPermissions } from '@pharmacy/shared-domain';
import { requirePrincipal } from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { AuditJournal } from '../audit/audit-journal';
import { StockAlerts } from '../inventory/stock-alerts';
import { Reminders } from '../notifications/reminders';
import { SalesFigures } from '../pos/sales-figures';
import { ReturnFigures } from '../returns/return-figures';
import type { DashboardQueryDto } from './dto/dashboard.dto';
import {
  addDays,
  daysBetween,
  resolveDashboardPeriod,
} from './dashboard-period';
import { ReportsRepository } from './reports.repository';
import { scopeOf } from './scope';

const REMINDERS = 5;
const ACTIVITY = 8;
const CRITICAL_DAYS = 7;

/** The stores an employee sees: a PIN session — its terminal's store only. */
// The home of the owner cabinet (spec 2026-10-14-owner-cabinet, E1–E7, 5.2) over the stores of the
// scope: revenue = sales − returns of the customers (by the business date of each), receipts and
// the average receipt of the sales, the stock signals of today, the reminders and the journal.
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: ReportsRepository,
    private readonly sales: SalesFigures,
    private readonly refunds: ReturnFigures,
    private readonly stock: StockAlerts,
    private readonly reminders: Reminders,
    private readonly journal: AuditJournal,
  ) {}

  get(query: DashboardQueryDto): Promise<TenantDashboard> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    return this.db.tenantTransaction(async (trx) => {
      const { today, expiryDays } = await this.repository.context(
        trx,
        tenantId,
      );
      const dates = resolveDashboardPeriod(
        query.period,
        today,
        query.from,
        query.to,
      );
      const stores = await this.repository.activeStores(
        trx,
        tenantId,
        scopeOf(principal),
      );
      const storeIds = stores.map((store) => store.id);
      const first = [dates.prevFrom, dates.chartFrom].sort()[0];
      const sales = await this.sales.byStoreDay(
        trx,
        tenantId,
        storeIds,
        first,
        dates.to,
      );
      const refunds = await this.refunds.byStoreDay(
        trx,
        tenantId,
        storeIds,
        first,
        dates.to,
      );
      const within = (date: string, from: string, to: string) =>
        date >= from && date <= to;
      const sum = <T>(
        rows: readonly T[],
        pick: (row: T) => number,
        keep: (row: T) => boolean,
      ) => rows.reduce((total, row) => total + (keep(row) ? pick(row) : 0), 0);

      const inPeriod = (row: { businessDate: string }) =>
        within(row.businessDate, dates.from, dates.to);
      const inPrevious = (row: { businessDate: string }) =>
        within(row.businessDate, dates.prevFrom, dates.prevTo);
      const salesMinor = sum(sales, (row) => row.salesMinor, inPeriod);
      const receipts = sum(sales, (row) => row.receipts, inPeriod);
      const revenueMinor =
        salesMinor - sum(refunds, (row) => row.refundMinor, inPeriod);
      const previousMinor =
        sum(sales, (row) => row.salesMinor, inPrevious) -
        sum(refunds, (row) => row.refundMinor, inPrevious);

      const rows: DashboardStoreRow[] = stores
        // a warehouse sells nothing: the table is of the pharmacies (plan Task 6)
        .filter((store) => store.kind === 'pharmacy')
        .map((store) => {
          const ofStore = (row: { storeId: string; businessDate: string }) =>
            row.storeId === store.id && inPeriod(row);
          return {
            storeId: store.id,
            name: store.name,
            mode: store.mode === 'online' ? 'cloud' : 'offline',
            // no synchronisation of offline stores yet (ADR-0014)
            lastSyncAt: null,
            receipts: sum(sales, (row) => row.receipts, ofStore),
            revenueMinor:
              sum(sales, (row) => row.salesMinor, ofStore) -
              sum(refunds, (row) => row.refundMinor, ofStore),
          };
        });

      const chartDays = daysBetween(dates.chartFrom, dates.chartTo) + 1;
      const revenueByDay: DailyRevenue[] = Array.from(
        { length: chartDays },
        (_, index) => {
          const date = addDays(dates.chartFrom, index);
          const onDay = (row: { businessDate: string }) =>
            row.businessDate === date;
          return {
            date,
            revenueMinor:
              sum(sales, (row) => row.salesMinor, onDay) -
              sum(refunds, (row) => row.refundMinor, onDay),
          };
        },
      );

      const low = await this.stock.lowStock(trx, tenantId, storeIds);
      const expiring = await this.stock.expiringBatches(
        trx,
        tenantId,
        expiryDays,
        storeIds,
      );
      const critical = addDays(today, CRITICAL_DAYS);

      return {
        period: query.period,
        from: dates.from,
        to: dates.to,
        kpi: {
          revenueMinor,
          revenueChangePercent:
            previousMinor === 0
              ? null
              : Math.round(
                  ((revenueMinor - previousMinor) / Math.abs(previousMinor)) *
                    1000,
                ) / 10,
          receipts,
          averageReceiptMinor: receipts ? Math.round(salesMinor / receipts) : 0,
          lowStockItems: low.reduce(
            (total, store) => total + store.positions,
            0,
          ),
          expiringBatches: expiring.length,
          expiringCritical: expiring.filter(
            (batch) => batch.expiryDate <= critical,
          ).length,
        },
        stores: rows,
        revenueByDay,
        reminders: await this.reminders.forDashboard(trx, REMINDERS),
        // the journal of the home only for those who may read the journal (final review I1)
        recentActivity: hasPermissions(principal.permissions, 'audit:view')
          ? await this.journal.recent(trx, ACTIVITY, [
              'sign_in',
              'access_denied',
            ])
          : [],
      };
    });
  }
}
