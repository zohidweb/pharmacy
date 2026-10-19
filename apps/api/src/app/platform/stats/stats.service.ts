import { Injectable, Logger } from '@nestjs/common';
import type {
  DashboardResponse,
  OperatorQueueItem,
  TenantStats,
  UsageStatsQuery,
  UsageStatsResponse,
  UsageStoreRow,
  UsageTenantRow,
} from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requireOperator,
} from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { PlatformDatabase } from '../../../core/database/platform';
import { StoreSalesExport } from '../../pos/store-sales-export';
import { BillingOverview } from '../billing/billing-overview';
import { StatsRepository, type UsageStoreFigures } from './stats.repository';

/** The first period of the statistics (spec 2026-10-19-admin-dashboard-stats, 6). */
const FIRST_PERIOD = '2026-01';
/** The items of the operator queue shown (D13); the tile counts all of them. */
const QUEUE_LIMIT = 20;
/** The days of the sales chart, today included. */
const CHART_DAYS = 14;

const average = (sales: number, receipts: number): number =>
  receipts > 0 ? Math.round(sales / receipts) : 0;

/** YYYY-MM-DD `days` before the date given. */
const daysBefore = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** The latest of the times given, null — none. */
const latest = (values: ReadonlyArray<string | null>): string | null =>
  values.reduce<string | null>(
    (max, value) =>
      value !== null && (max === null || value > max) ? value : max,
    null,
  );

const errorCode = (error: unknown): string =>
  (error as { code?: unknown })?.code !== undefined
    ? String((error as { code: unknown }).code)
    : error instanceof Error
      ? error.name
      : 'unknown';

// The operator dashboard, the usage statistics and the statistics of a network (spec
// 2026-10-19-admin-dashboard-stats; ADR-0013, amendment 2026-10-19). Before an answer the networks whose
// marts are older than 5 minutes are refreshed one by one in their own context (`StoreSalesExport` of
// `pos`); a network that fails keeps its previous marts (D7). Then one platform transaction reads the
// marts, the registry and the platform tables.
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: StatsRepository,
    private readonly billing: BillingOverview,
    private readonly sales: StoreSalesExport,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  /** Refreshes the networks given (all — null) whose marts are stale; a failure is logged, not thrown. */
  private async refresh(ids: readonly string[] | null): Promise<void> {
    const stale = await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.staleTenants(trx, ids),
    );
    for (const tenantId of stale) {
      try {
        await this.sales.refresh(tenantId);
      } catch (error) {
        this.logger.warn(
          `Statistics marts of a network not refreshed (${errorCode(error)}) [tenantId=${tenantId}] [correlationId=${getRequestContext()?.correlationId}]`,
        );
      }
    }
  }

  /** 404 for an unknown network, before any refresh. */
  private async requireTenant(id: string): Promise<void> {
    const exists = await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.tenantExists(trx, id),
    );
    if (!exists) throw new ProblemException(404, 'not_found');
  }

  async dashboard(): Promise<DashboardResponse> {
    await this.refresh(null);
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const today = await this.repository.today(trx);
      const counts = await this.repository.counts(trx);
      const last = await this.billing.lastInvoicedPeriod(trx);
      const overdue = await this.billing.overdueInvoices(trx, today);
      const keys = await this.repository.expiringKeys(trx, today);
      const stale = await this.repository.staleStores(trx, today);
      const requests = await this.billing.pendingRequests(trx);
      const sales = await this.repository.salesByDay(
        trx,
        daysBefore(today, CHART_DAYS - 1),
        today,
        null,
      );
      const asOf = await this.repository.asOf(trx, null);
      // the order of D13: invoices, keys, sync, requests — the oldest first within each
      const queue: OperatorQueueItem[] = [
        ...overdue.map((invoice) => ({
          id: `invoice:${invoice.id}`,
          kind: 'invoice_overdue' as const,
          params: {
            tenantName: invoice.tenantName,
            invoiceNumber: invoice.number,
            amountMinor: invoice.remainingMinor,
          },
          target: { screen: 'tenant' as const, id: invoice.tenantId },
          at: new Date(`${invoice.dueOn}T00:00:00+05:00`).toISOString(),
        })),
        ...keys.map((key) => ({
          id: `key:${key.id}`,
          kind: 'key_expiring' as const,
          params: {
            tenantName: key.tenantName,
            storeName: key.storeName,
            days: key.days,
          },
          target: { screen: 'tenant' as const, id: key.tenantId },
          at: key.validUntil,
        })),
        ...stale.map((store) => ({
          id: `sync:${store.storeId}`,
          kind: 'sync_stale' as const,
          params: {
            tenantName: store.tenantName,
            storeName: store.storeName,
            days: store.days,
          },
          target: { screen: 'tenant' as const, id: store.tenantId },
          at: store.since,
        })),
        ...requests.map((request) => ({
          id: `request:${request.id}`,
          kind: 'service_requested' as const,
          params: {
            tenantName: request.tenantName,
            serviceName: request.serviceName,
          },
          target: { screen: 'services' as const },
          at: request.requestedAt,
        })),
      ];
      return {
        summary: {
          ...counts,
          accruedMinor: last?.totalMinor ?? 0,
          accruedPeriod: last?.period ?? null,
          attention: {
            overdueInvoices: overdue.length,
            expiringKeys: keys.length,
            serviceRequests: requests.length,
            staleSync: stale.length,
          },
        },
        sales,
        queue: queue.slice(0, QUEUE_LIMIT),
        asOf,
      };
    });
  }

  async usage(query: UsageStatsQuery): Promise<UsageStatsResponse> {
    const tenantId = query.tenantId?.toLowerCase() ?? null;
    const today = await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.today(trx),
    );
    if (query.period < FIRST_PERIOD || query.period > today.slice(0, 7)) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'period', code: 'range' },
      ]);
    }
    if (tenantId !== null) await this.requireTenant(tenantId);
    await this.refresh(tenantId === null ? null : [tenantId]);
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const month = `${query.period}-01`;
      const tenants = await this.repository.tenants(trx, tenantId);
      const stores = await this.repository.usageStores(trx, month, tenantId);
      const cashiers = await this.repository.cashiers(trx, month, tenantId);
      const asOf = await this.repository.asOf(
        trx,
        tenantId === null ? null : [tenantId],
      );
      const rows: UsageTenantRow[] = tenants.map((tenant) => {
        const own = stores
          .filter((store) => store.tenantId === tenant.id)
          .map(storeRow);
        const receipts = sum(own, (store) => store.receipts);
        const salesMinor = sum(own, (store) => store.salesMinor);
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          receipts,
          salesMinor,
          averageReceiptMinor: average(salesMinor, receipts),
          lastActivityAt: latest(own.map((store) => store.lastActivityAt)),
          stores: own,
        };
      });
      const receipts = sum(rows, (row) => row.receipts);
      const salesMinor = sum(rows, (row) => row.salesMinor);
      return {
        period: query.period,
        kpi: {
          receipts,
          salesMinor,
          averageReceiptMinor: average(salesMinor, receipts),
          activeCashiers: sum(rows, (row) => cashiers.get(row.tenantId) ?? 0),
        },
        rows,
        asOf,
      };
    });
  }

  async tenant(id: string): Promise<TenantStats> {
    const tenantId = id.toLowerCase();
    await this.requireTenant(tenantId);
    await this.refresh([tenantId]);
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const today = await this.repository.today(trx);
      const month = `${today.slice(0, 7)}-01`;
      const stores = await this.repository.usageStores(trx, month, tenantId);
      const cashiers = await this.repository.cashiers(trx, month, tenantId);
      const daily = await this.repository.salesByDay(
        trx,
        daysBefore(today, CHART_DAYS - 1),
        today,
        tenantId,
      );
      const asOf = await this.repository.asOf(trx, [tenantId]);
      const receipts = sum(stores, (store) => store.receipts);
      const salesMinor = sum(stores, (store) => store.salesMinor);
      return {
        receipts,
        salesMinor,
        averageReceiptMinor: average(salesMinor, receipts),
        activeCashiers: cashiers.get(tenantId) ?? 0,
        daily,
        asOf,
      };
    });
  }
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function storeRow(store: UsageStoreFigures): UsageStoreRow {
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    mode: store.online ? 'cloud' : 'offline',
    receipts: store.receipts,
    salesMinor: store.salesMinor,
    averageReceiptMinor: average(store.salesMinor, store.receipts),
    lastActivityAt: store.lastActivityAt,
  };
}
