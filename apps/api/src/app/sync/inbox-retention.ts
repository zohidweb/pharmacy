import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';

/** Envelopes cleared by one pass in one network. */
const PURGE_BATCH = 1000;

/**
 * The envelopes that still hold prescription data (lax jsonpath: an envelope of another shape is skipped, never an
 * error). The same predicate as the partial index `sync_inbox_prescription_purge_idx` (migration pos-offline-limits).
 */
const WITH_PRESCRIPTION = sql.lit(
  '$.payload.controlledRecords[*] ? (@.prescriptionNote != null || @.prescriptionFileId != null)',
);

// The prescription data in the raw envelopes of the sales of offline stores (spec 2026-10-21-pos-offline-limits, P5;
// data model 06): in a `receipt.completed` received before the retention term of the network, the note and the file
// of every ПКУ record become null — `controlledRecords` as a list of records or a single one; any other value holds no
// record and stays. The payload hash stays: a repeat of the operation is compared with the hash of what the store
// sent. Called by the hourly pass of `platform/retention` after the records of `pos`; a try-lock per network keeps two
// API instances from counting the same envelopes, and the event of the journal goes in the same transaction.
@Injectable()
export class InboxRetention {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  purgeExpired(tenantId: string, retentionDays: number): Promise<number> {
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    return runWithContext({ correlationId, tenantId, principal: null }, () =>
      this.db.tenantTransaction(async (trx) => {
        const { rows } = await sql<{ locked: boolean }>`
          select pg_try_advisory_xact_lock(
            hashtextextended(${`prescription-purge-inbox:${tenantId}`}, 0)) as locked`.execute(
          trx,
        );
        if (!rows[0].locked) return 0;
        // the mark lets an envelope applied later (from quarantine) create its record purged, not «no data»
        const cleared = sql`jsonb_build_object('prescriptionNote', null, 'prescriptionFileId', null, 'prescriptionPurged', true)`;
        const result = await sql`
          with picked as (
            select i.store_id, i.operation_id from pharmacy.sync_inbox i
            where i.tenant_id = ${tenantId} and i.type = 'receipt.completed'
              and i.envelope @? ${WITH_PRESCRIPTION}
              and i.received_at < now() - make_interval(days => ${retentionDays})
            limit ${PURGE_BATCH})
          update pharmacy.sync_inbox i
          set envelope = jsonb_set(i.envelope, '{payload,controlledRecords}',
            case jsonb_typeof(i.envelope -> 'payload' -> 'controlledRecords')
              when 'array' then (
                select coalesce(jsonb_agg(
                         case when jsonb_typeof(e.r) = 'object' then e.r || ${cleared} else e.r end
                         order by e.ord), '[]'::jsonb)
                from jsonb_array_elements(i.envelope -> 'payload' -> 'controlledRecords')
                     with ordinality as e(r, ord))
              else (i.envelope -> 'payload' -> 'controlledRecords') || ${cleared}
            end)
          from picked p
          where i.tenant_id = ${tenantId} and i.store_id = p.store_id
            and i.operation_id = p.operation_id`.execute(trx);
        const envelopes = Number(result.numAffectedRows ?? 0n);
        if (envelopes > 0) {
          await this.audit.append(trx, {
            action: 'controlled.prescriptions-purged',
            entityType: 'tenant',
            entityId: tenantId,
            details: { envelopes },
          });
        }
        return envelopes;
      }),
    );
  }
}
