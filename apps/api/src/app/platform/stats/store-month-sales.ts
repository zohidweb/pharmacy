import { Injectable } from '@nestjs/common';
import { StatsService } from './stats.service';

export interface StoreMonthFigures {
  receipts: number;
  salesMinor: number;
  /** The time of the last refresh of the marts of the network; null — never refreshed. */
  asOf: string | null;
}

// The receipts and sales of a store this month for its card in the admin (spec
// 2026-10-23-admin-store-card-tenant-log, A3): the marts of the network are refreshed first when older than 5
// minutes, as for its statistics. Exported by PlatformStatsModule (`platform/stats` → `platform/tenants`); opens
// its own platform transactions.
@Injectable()
export class StoreMonthSales {
  constructor(private readonly stats: StatsService) {}

  of(tenantId: string, storeId: string): Promise<StoreMonthFigures> {
    return this.stats.storeMonth(tenantId, storeId);
  }
}
