import { Injectable, Logger } from '@nestjs/common';
import type {
  SyncBatchResponse,
  SyncEnvelope,
  SyncOperation,
  SyncOperationResult,
} from '@pharmacy/shared-dto';
import { getRequestContext } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import {
  payloadHash,
  SYNC_BATCH_LIMITS,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import { InboxRepository, type InboxRow } from './inbox.repository';
import { type RunCounters, SyncRunsRepository } from './sync-runs.repository';
import type { SyncStore } from './sync-store.context';
import { upcast } from './upcasters';

// Retries of the waiting operations of a store after one batch; each pass needs progress to go on.
const MAX_PENDING_PASSES = 10;

// The intake of a batch of an offline store (ADR-0014 §2, §4; spec 2026-10-16-offline-sync, E14, E15): every
// operation in the order of the store and in its own tenant transaction — the advisory lock of the store, the
// inbox gate, the hash, the upcast and the applier of the owning module; a failure rolls back that operation
// only and records it as quarantined or waiting for a dependency. Waiting operations are retried at the end.
@Injectable()
export class SyncApplyService {
  private readonly logger = new Logger(SyncApplyService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly inbox: InboxRepository,
    private readonly runs: SyncRunsRepository,
    private readonly appliers: SyncAppliers,
    private readonly audit: AuditService,
  ) {}

  async applyBatch(
    store: SyncStore,
    envelope: SyncEnvelope,
    bytes: number,
  ): Promise<SyncBatchResponse> {
    if (!store.license.acceptsOperations) {
      throw new ProblemException(403, 'license_expired');
    }
    if (envelope.protocolVersion < store.settings.minSupportedProtocol) {
      throw new ProblemException(426, 'protocol_unsupported');
    }
    if (envelope.operations.length > SYNC_BATCH_LIMITS.maxOperations) {
      throw new ProblemException(413, 'batch_too_large');
    }

    const results = new Map<string, SyncOperationResult>();
    const ordered = [...envelope.operations].sort(
      (a, b) => a.storeSeq - b.storeSeq,
    );
    for (const operation of ordered) {
      results.set(operation.operationId, await this.applyNew(store, operation));
    }
    for (const result of await this.retryPending(store)) {
      // An operation of this batch that waited and is now applied reports its final state.
      if (results.has(result.operationId))
        results.set(result.operationId, result);
    }

    const orderedResults = envelope.operations.map(
      (operation) => results.get(operation.operationId) as SyncOperationResult,
    );
    await this.closeBatch(store, envelope, orderedResults, bytes);
    return { results: orderedResults };
  }

  /** The first arrival of an operation, or a repeat of one already in the inbox. */
  private async applyNew(
    store: SyncStore,
    operation: SyncOperation,
  ): Promise<SyncOperationResult> {
    const { operationId } = operation;
    let hashOk = false;
    try {
      hashOk = payloadHash(operation.payload) === operation.payloadHash;
    } catch {
      hashOk = false;
    }
    try {
      return await this.db.withTenant(store.tenantId, async (trx) => {
        await this.inbox.lockStore(trx, store.storeId);
        const existing = await this.inbox.find(
          trx,
          store.tenantId,
          store.storeId,
          operationId,
        );
        if (existing) return repeatOf(existing, operation);
        if (!hashOk) {
          await this.inbox.insert(trx, {
            tenantId: store.tenantId,
            storeId: store.storeId,
            operation,
            status: 'rejected',
            reason: 'hash_mismatch',
          });
          return { operationId, status: 'rejected', reason: 'hash_mismatch' };
        }
        await this.inbox.insert(trx, {
          tenantId: store.tenantId,
          storeId: store.storeId,
          operation,
          status: 'applied',
          reason: null,
        });
        await this.applyFact(trx, store, operation);
        return { operationId, status: 'applied' };
      });
    } catch (error) {
      const failure = this.failureOf(error, operation);
      await this.db.withTenant(store.tenantId, async (trx) => {
        await this.inbox.lockStore(trx, store.storeId);
        const inserted = await this.inbox.insert(trx, {
          tenantId: store.tenantId,
          storeId: store.storeId,
          operation,
          status: failure.status,
          reason: failure.reason,
        });
        // A concurrent request stored the same operation meanwhile: its state stands.
        if (!inserted) return;
      });
      return { operationId, ...failure };
    }
  }

  /** Re-applies the waiting operations of the store while each pass makes progress. */
  private async retryPending(store: SyncStore): Promise<SyncOperationResult[]> {
    const outcomes = new Map<string, SyncOperationResult>();
    for (let pass = 0; pass < MAX_PENDING_PASSES; pass += 1) {
      const waiting = await this.db.withTenant(store.tenantId, (trx) =>
        this.inbox.pending(trx, store.tenantId, store.storeId),
      );
      let progress = false;
      for (const { operationId } of waiting) {
        const result = await this.applyStored(store, operationId);
        outcomes.set(operationId, result);
        if (result.status !== 'pending_dependency') progress = true;
      }
      if (!progress) break;
    }
    return [...outcomes.values()];
  }

  private async applyStored(
    store: SyncStore,
    operationId: string,
  ): Promise<SyncOperationResult> {
    let operation: SyncOperation | undefined;
    try {
      return await this.db.withTenant(store.tenantId, async (trx) => {
        await this.inbox.lockStore(trx, store.storeId);
        const row = await this.inbox.find(
          trx,
          store.tenantId,
          store.storeId,
          operationId,
        );
        // Applied by a concurrent batch meanwhile.
        if (!row || row.status !== 'pending_dependency') {
          return {
            operationId,
            status: row?.status ?? 'quarantined',
            ...(row?.reason ? { reason: row.reason } : {}),
          } as SyncOperationResult;
        }
        operation = row.envelope;
        await this.inbox.setStatus(trx, {
          tenantId: store.tenantId,
          storeId: store.storeId,
          operationId,
          status: 'applied',
          reason: null,
          countAttempt: true,
        });
        await this.applyFact(trx, store, operation);
        return { operationId, status: 'applied' };
      });
    } catch (error) {
      const failure = this.failureOf(error, operation);
      await this.db.withTenant(store.tenantId, (trx) =>
        this.inbox.setStatus(trx, {
          tenantId: store.tenantId,
          storeId: store.storeId,
          operationId,
          status: failure.status,
          reason: failure.reason,
          countAttempt: true,
        }),
      );
      return { operationId, ...failure };
    }
  }

  private async applyFact(
    trx: TenantTransaction,
    store: SyncStore,
    operation: SyncOperation,
  ): Promise<void> {
    const applier = this.appliers.applierOf(operation.type);
    if (!applier) throw new SyncApplyError('unsupported_type');
    const current = upcast(operation);
    await applier.apply(trx, {
      ...current,
      tenantId: store.tenantId,
      storeId: store.storeId,
    });
    // The first applied fact of a store that got its kit makes it offline (E31).
    if (store.storeMode === 'offline_pending') {
      await trx
        .updateTable('stores')
        .set({ mode: 'offline' })
        .where('tenantId', '=', store.tenantId)
        .where('id', '=', store.storeId)
        .where('mode', '=', 'offline_pending')
        .execute();
    }
  }

  private failureOf(
    error: unknown,
    operation: SyncOperation | undefined,
  ): { status: 'quarantined' | 'pending_dependency'; reason: string } {
    if (error instanceof SyncApplyError) {
      return error.kind === 'dependency'
        ? { status: 'pending_dependency', reason: `missing_${error.code}` }
        : { status: 'quarantined', reason: error.code };
    }
    // An unexpected failure: the class and the database code only, never the payload or the message.
    const code = (error as { code?: unknown })?.code;
    const sqlstate =
      typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'error';
    this.logger.warn(
      `Sync operation ${operation?.operationId ?? '?'} (${operation?.type ?? '?'}) quarantined: ` +
        `${error instanceof Error ? error.name : typeof error} ${sqlstate} ` +
        `[correlationId=${getRequestContext()?.correlationId ?? ''}]`,
    );
    return { status: 'quarantined', reason: `apply_failed:${sqlstate}` };
  }

  /** The counters of the batch go to its run; the store status and the journal get one line. */
  private async closeBatch(
    store: SyncStore,
    envelope: SyncEnvelope,
    results: SyncOperationResult[],
    bytes: number,
  ): Promise<void> {
    const count = (status: SyncOperationResult['status']) =>
      results.filter((result) => result.status === status).length;
    const counters: RunCounters = {
      operationsReceived: results.length,
      applied: count('applied'),
      duplicate: count('duplicate'),
      quarantined: count('quarantined'),
      rejected: count('rejected'),
      pendingDependency: count('pending_dependency'),
      bytesReceived: bytes,
    };
    await this.db.withTenant(store.tenantId, async (trx) => {
      await this.runs.addBatch(
        trx,
        store.tenantId,
        store.storeId,
        envelope.syncRunId,
        counters,
      );
      await this.runs.refreshQuarantined(trx, store.tenantId, store.storeId);
      await this.audit.append(trx, {
        action: 'sync.batch-applied',
        entityType: 'store',
        entityId: store.storeId,
        storeId: store.storeId,
        details: { batchId: envelope.batchId, ...counters },
      });
    });
  }
}

/** The answer to an operation already in the inbox: the same body — its state, another body — refused. */
function repeatOf(
  existing: InboxRow,
  operation: SyncOperation,
): SyncOperationResult {
  const { operationId } = operation;
  if (existing.payloadHash !== operation.payloadHash) {
    return { operationId, status: 'rejected', reason: 'id_reused' };
  }
  if (existing.status === 'applied')
    return { operationId, status: 'duplicate' };
  return {
    operationId,
    status: existing.status,
    ...(existing.reason ? { reason: existing.reason } : {}),
  };
}
