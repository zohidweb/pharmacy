import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { StoreSalesExportRepository } from './store-sales-export.repository';

// The statistics marts of the admin (spec 2026-10-19-admin-dashboard-stats, D3–D6; ADR-0013, amendment
// 2026-10-19): the platform module calls it for each network in turn before it reads the marts, and it
// runs in the context of that network under pharmacy_app (RLS), with no principal, as a background task
// of a tenant. Exported by PosModule (`pos` → `platform/stats`).
@Injectable()
export class StoreSalesExport {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: StoreSalesExportRepository,
  ) {}

  /**
   * Refreshes the marts of the network in its own transaction; returns at once when another request
   * is refreshing the network (it reads the marts as they are).
   */
  async refresh(tenantId: string): Promise<void> {
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    await runWithContext({ correlationId, tenantId, principal: null }, () =>
      this.db.tenantTransaction(async (trx) => {
        if (!(await this.repository.tryLock(trx, tenantId))) return;
        const months = await this.repository.refreshDays(trx, tenantId);
        await this.repository.refreshCashiers(trx, tenantId, months);
        await this.repository.markRefreshed(trx, tenantId);
      }),
    );
  }
}
