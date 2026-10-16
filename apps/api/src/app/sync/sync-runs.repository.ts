import { Injectable } from '@nestjs/common';
import type {
  SyncHandshakeRequest,
  SyncRunCompleteRequest,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface RunCounters {
  operationsReceived: number;
  applied: number;
  duplicate: number;
  quarantined: number;
  rejected: number;
  pendingDependency: number;
  bytesReceived: number;
}

// Runs of offline stores and their last state (ADR-0014 §8; spec 2026-10-16-offline-sync, E20): sync_runs is one
// row per handshake, store_sync_status one row per store, read by the owner and the operator.
@Injectable()
export class SyncRunsRepository {
  async openRun(
    trx: TenantTransaction,
    input: {
      tenantId: string;
      runId: string;
      storeId: string;
      request: SyncHandshakeRequest;
      correlationId: string;
    },
  ): Promise<void> {
    const { request } = input;
    await trx
      .insertInto('syncRuns')
      .values({
        tenantId: input.tenantId,
        id: input.runId,
        storeId: input.storeId,
        protocolVersion: request.protocolVersion,
        appVersion: request.appVersion,
        schemaVersion: request.schemaVersion,
        outboxDepth: request.outboxDepth,
        oldestPendingAt: request.oldestPendingAt,
        feedCursor: request.feedCursor,
        correlationId: input.correlationId,
      })
      .execute();
  }

  /** The last contact of the store: versions, outbox, cursor, clock skew and the license state. */
  async touchStore(
    trx: TenantTransaction,
    input: {
      tenantId: string;
      storeId: string;
      runId: string;
      request: SyncHandshakeRequest;
      licenseStatus: string;
    },
  ): Promise<void> {
    const { request } = input;
    const skew = Math.round(
      (Date.parse(request.storeTime) - Date.now()) / 1000,
    );
    const values = {
      lastContactAt: sql<Date>`now()`,
      lastRunId: input.runId,
      protocolVersion: request.protocolVersion,
      appVersion: request.appVersion,
      schemaVersion: request.schemaVersion,
      outboxDepth: request.outboxDepth,
      oldestPendingAt: request.oldestPendingAt,
      feedCursor: request.feedCursor,
      // Clamped to the integer column; a wild clock is still visible as a huge skew.
      clockSkewSec: Math.max(-2_000_000_000, Math.min(2_000_000_000, skew)),
      licenseStatus: input.licenseStatus,
      updatedAt: sql<Date>`now()`,
    };
    await trx
      .insertInto('storeSyncStatus')
      .values({ tenantId: input.tenantId, storeId: input.storeId, ...values })
      .onConflict((oc) =>
        oc.columns(['tenantId', 'storeId']).doUpdateSet(values),
      )
      .execute();
  }

  async runOf(
    trx: TenantTransaction,
    tenantId: string,
    runId: string,
  ): Promise<{ storeId: string; result: string } | undefined> {
    return trx
      .selectFrom('syncRuns')
      .select(['storeId', 'result'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', runId)
      .executeTakeFirst();
  }

  /** Adds the counters of one batch to its run (a run of another store is ignored). */
  async addBatch(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    runId: string,
    counters: RunCounters,
  ): Promise<void> {
    await trx
      .updateTable('syncRuns')
      .set((eb) => ({
        operationsReceived: eb(
          'operationsReceived',
          '+',
          counters.operationsReceived,
        ),
        applied: eb('applied', '+', counters.applied),
        duplicate: eb('duplicate', '+', counters.duplicate),
        quarantined: eb('quarantined', '+', counters.quarantined),
        rejected: eb('rejected', '+', counters.rejected),
        pendingDependency: eb(
          'pendingDependency',
          '+',
          counters.pendingDependency,
        ),
        bytesReceived: eb('bytesReceived', '+', BigInt(counters.bytesReceived)),
      }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', runId)
      .where('storeId', '=', storeId)
      .execute();
  }

  async completeRun(
    trx: TenantTransaction,
    tenantId: string,
    runId: string,
    report: SyncRunCompleteRequest,
    ok: boolean,
  ): Promise<void> {
    await trx
      .updateTable('syncRuns')
      .set({
        finishedAt: sql<Date>`now()`,
        clientReport: JSON.stringify(report),
        result: ok ? 'ok' : 'errors',
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', runId)
      .where('result', '=', 'open')
      .execute();
  }

  async markSuccess(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<void> {
    await trx
      .updateTable('storeSyncStatus')
      .set({ lastSuccessAt: sql<Date>`now()`, updatedAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .execute();
  }

  /** Operations of the store in quarantine, kept in its status row. */
  async refreshQuarantined(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<number> {
    const row = await trx
      .selectFrom('syncInbox')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('status', '=', 'quarantined')
      .executeTakeFirstOrThrow();
    const quarantined = Number(row.count);
    await trx
      .updateTable('storeSyncStatus')
      .set({ quarantined, updatedAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .execute();
    return quarantined;
  }
}
