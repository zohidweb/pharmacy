import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { PosRepository } from './pos.repository';

/** Records purged by one pass in one network: the transaction stays short, the next pass goes on. */
const PURGE_BATCH = 5000;

// The purge of the prescription data of ПКУ sales by the retention term of the network (spec
// 2026-10-21-pos-offline-limits, P3, P4; data model 04): the note and the file of a record sold before the term are
// cleared and `prescription_purged_at` is set; the record and the ПКУ journal stay. Called by the hourly pass of
// `platform/retention` for each network, in its own context and transaction (`pos` → `platform/retention`), with the
// event of the journal in the same transaction.
@Injectable()
export class PrescriptionRetention {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: PosRepository,
    private readonly audit: AuditService,
  ) {}

  /** null — another pass is purging the network now. */
  purgeExpired(
    tenantId: string,
  ): Promise<{ purged: number; retentionDays: number } | null> {
    return this.inTenant(tenantId, () =>
      this.db.tenantTransaction(async (trx) => {
        const { rows } = await sql<{ locked: boolean }>`
          select pg_try_advisory_xact_lock(
            hashtextextended(${`prescription-purge:${tenantId}`}, 0)) as locked`.execute(
          trx,
        );
        if (!rows[0].locked) return null;
        const { retentionDays } = await this.repository.settings(trx, tenantId);
        const result = await sql`
          update pharmacy.controlled_sale_records c
          set prescription_note = null, prescription_file_id = null, prescription_purged_at = now()
          where c.tenant_id = ${tenantId} and c.id in (
            select r.id from pharmacy.controlled_sale_records r
            where r.tenant_id = ${tenantId} and r.prescription_purged_at is null
              and (r.prescription_note is not null or r.prescription_file_id is not null)
              and r.recorded_at < now() - make_interval(days => ${retentionDays})
            order by r.recorded_at
            limit ${PURGE_BATCH})`.execute(trx);
        const purged = Number(result.numAffectedRows ?? 0n);
        // the event goes with the purge in its transaction: the counts only, never the data (data model 06)
        if (purged > 0) {
          await this.audit.append(trx, {
            action: 'controlled.prescriptions-purged',
            entityType: 'tenant',
            entityId: tenantId,
            details: { records: purged },
          });
        }
        return { purged, retentionDays };
      }),
    );
  }

  private inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    return runWithContext({ correlationId, tenantId, principal: null }, work);
  }
}
