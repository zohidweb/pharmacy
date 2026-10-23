import { Injectable } from '@nestjs/common';
import { StatsService } from './stats.service';

export interface StoreMonthFigures {
  receipts: number;
  salesMinor: number;
}

export interface NetworkMonthFigures {
  /** Pharmacies with receipts this month or open; a warehouse or a closed store without receipts is absent. */
  stores: ReadonlyMap<string, StoreMonthFigures>;
  /** The time of the last refresh of the marts of the network; null — never refreshed. */
  asOf: string | null;
}

// The receipts and sales of the stores of a network this month for the store list and the store card of the admin
// (spec 2026-10-23-admin-store-card-tenant-log, A3): the marts of the network are refreshed first when older than 5
// minutes, as for its statistics. Exported by PlatformStatsModule (`platform/stats` → `platform/tenants`); opens its
// own platform transactions.
@Injectable()
export class StoreMonthSales {
  constructor(private readonly stats: StatsService) {}

  ofNetwork(tenantId: string): Promise<NetworkMonthFigures> {
    return this.stats.storesMonth(tenantId.toLowerCase());
  }

  async of(
    tenantId: string,
    storeId: string,
  ): Promise<StoreMonthFigures & { asOf: string | null }> {
    const network = await this.ofNetwork(tenantId);
    const store = network.stores.get(storeId.toLowerCase());
    return {
      receipts: store?.receipts ?? 0,
      salesMinor: store?.salesMinor ?? 0,
      asOf: network.asOf,
    };
  }
}
