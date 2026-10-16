import { Injectable } from '@nestjs/common';
import type {
  StockCheckpointPayload,
  SyncOperationType,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { StockFacts } from '../inventory/stock-facts';

// The stock checkpoint of an offline store (ADR-0014 §4; spec 2026-10-16-offline-sync, E19): the store sends its
// batches, total and hash at a position of its outbox; the cloud compares them with the sum of the movements of
// the store it holds. A mismatch is a red state for the owner and the operator — never a correction.
@Injectable()
export class CheckpointFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = ['stock.checkpoint'];

  constructor(
    appliers: SyncAppliers,
    private readonly stock: StockFacts,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    const { tenantId, storeId, payload } =
      operation as AppliedOperation<StockCheckpointPayload>;
    if (
      !Number.isSafeInteger(payload.atStoreSeq) ||
      !Number.isSafeInteger(payload.batches) ||
      !Number.isSafeInteger(payload.totalPieces) ||
      !/^[0-9a-f]{64}$/.test(payload.hash)
    ) {
      throw new SyncApplyError('checkpoint_invalid');
    }
    const cloud = await this.stock.summary(trx, tenantId, storeId);
    const mismatch =
      cloud.batches !== payload.batches ||
      cloud.totalPieces !== payload.totalPieces ||
      cloud.hash !== payload.hash;
    await trx
      .updateTable('storeSyncStatus')
      .set({
        lastCheckpoint: JSON.stringify({
          atStoreSeq: payload.atStoreSeq,
          store: {
            batches: payload.batches,
            totalPieces: payload.totalPieces,
            hash: payload.hash,
          },
          cloud,
          checkedAt: new Date().toISOString(),
        }),
        checkpointMismatch: mismatch,
        updatedAt: sql<Date>`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .execute();
  }
}
