import { Injectable } from '@nestjs/common';
import type { SyncOperation, SyncOperationStatus } from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export type InboxStatus = Exclude<SyncOperationStatus, 'duplicate'>;

export interface InboxRow {
  operationId: string;
  storeSeq: bigint;
  payloadHash: string;
  envelope: SyncOperation;
  status: InboxStatus;
  reason: string | null;
  attempts: number;
}

// The idempotency gate of the operations of offline stores (ADR-0014 §2, §4; spec 2026-10-16-offline-sync, E14,
// E40): one row per (network, store, operation id), never deleted; the raw operation is kept for a re-apply.
@Injectable()
export class InboxRepository {
  /** Serializes the operations of one store (ADR-0014 §2) until the end of the transaction. */
  async lockStore(trx: TenantTransaction, storeId: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext('sync-apply'), hashtext(${storeId}))`.execute(
      trx,
    );
  }

  async find(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    operationId: string,
  ): Promise<InboxRow | undefined> {
    return (await trx
      .selectFrom('syncInbox')
      .select([
        'operationId',
        'storeSeq',
        'payloadHash',
        'envelope',
        'status',
        'reason',
        'attempts',
      ])
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('operationId', '=', operationId)
      .forUpdate()
      .executeTakeFirst()) as InboxRow | undefined;
  }

  /** A new row; a concurrent insert of the same key is left alone (the caller re-reads it). */
  async insert(
    trx: TenantTransaction,
    input: {
      tenantId: string;
      storeId: string;
      operation: SyncOperation;
      status: InboxStatus;
      reason: string | null;
    },
  ): Promise<boolean> {
    const { operation } = input;
    const result = await trx
      .insertInto('syncInbox')
      .values({
        tenantId: input.tenantId,
        storeId: input.storeId,
        operationId: operation.operationId,
        storeSeq: BigInt(operation.storeSeq),
        type: operation.type,
        typeVersion: operation.typeVersion,
        payloadHash: operation.payloadHash,
        envelope: JSON.stringify(operation),
        status: input.status,
        reason: input.reason,
        appliedAt: input.status === 'applied' ? sql<Date>`now()` : null,
        attempts: input.status === 'pending_dependency' ? 1 : 0,
      })
      .onConflict((oc) =>
        oc.columns(['tenantId', 'storeId', 'operationId']).doNothing(),
      )
      .returning('operationId')
      .executeTakeFirst();
    return result !== undefined;
  }

  async setStatus(
    trx: TenantTransaction,
    input: {
      tenantId: string;
      storeId: string;
      operationId: string;
      status: InboxStatus;
      reason: string | null;
      countAttempt: boolean;
    },
  ): Promise<void> {
    await trx
      .updateTable('syncInbox')
      .set((eb) => ({
        status: input.status,
        reason: input.reason,
        appliedAt: input.status === 'applied' ? sql<Date>`now()` : null,
        attempts: input.countAttempt
          ? eb('attempts', '+', 1)
          : eb.ref('attempts'),
      }))
      .where('tenantId', '=', input.tenantId)
      .where('storeId', '=', input.storeId)
      .where('operationId', '=', input.operationId)
      .execute();
  }

  /** Operations of the store waiting for a fact they refer to, in the order of the store. */
  async pending(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<Array<{ operationId: string }>> {
    return trx
      .selectFrom('syncInbox')
      .select('operationId')
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('status', '=', 'pending_dependency')
      .orderBy('storeSeq')
      .execute();
  }
}
