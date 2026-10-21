import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';

/** Envelopes cleared by one pass in one network. */
const PURGE_BATCH = 1000;

// The prescription data in the raw envelopes of the sales of offline stores (spec 2026-10-21-pos-offline-limits, P5;
// data model 06): in a `receipt.completed` received before the retention term of the network, the note and the file
// of every ПКУ record become null. The payload hash stays: a repeat of the operation is compared with the hash of
// what the store sent. Called by the hourly pass of `platform/retention` after the records of `pos`.
@Injectable()
export class InboxRetention {
  constructor(private readonly db: TenantDatabase) {}

  purgeExpired(tenantId: string, retentionDays: number): Promise<number> {
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    return runWithContext({ correlationId, tenantId, principal: null }, () =>
      this.db.tenantTransaction(async (trx) => {
        const result = await sql`
          with picked as (
            select i.store_id, i.operation_id from pharmacy.sync_inbox i
            where i.tenant_id = ${tenantId} and i.type = 'receipt.completed'
              and i.received_at < now() - make_interval(days => ${retentionDays})
              and exists (
                select 1
                from jsonb_array_elements(
                  coalesce(i.envelope -> 'payload' -> 'controlledRecords', '[]'::jsonb)) r
                where r -> 'prescriptionNote' <> 'null'::jsonb
                   or r -> 'prescriptionFileId' <> 'null'::jsonb)
            limit ${PURGE_BATCH})
          update pharmacy.sync_inbox i
          set envelope = jsonb_set(i.envelope, '{payload,controlledRecords}', (
            select coalesce(jsonb_agg(
                     e.r || jsonb_build_object('prescriptionNote', null, 'prescriptionFileId', null)
                     order by e.ord), '[]'::jsonb)
            from jsonb_array_elements(i.envelope -> 'payload' -> 'controlledRecords')
                 with ordinality as e(r, ord)))
          from picked p
          where i.tenant_id = ${tenantId} and i.store_id = p.store_id
            and i.operation_id = p.operation_id`.execute(trx);
        return Number(result.numAffectedRows ?? 0n);
      }),
    );
  }
}
