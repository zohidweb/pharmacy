import { Injectable } from '@nestjs/common';
import type {
  SyncHandshakeRequest,
  SyncHandshakeResponse,
  SyncRunCompleteRequest,
} from '@pharmacy/shared-dto';
import { getRequestContext } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { newId, TenantDatabase } from '../../core/database';
import { SYNC_BATCH_LIMITS } from '../../core/sync/protocol';
import { SyncRunsRepository } from './sync-runs.repository';
import type { SyncStore } from './sync-store.context';

// The handshake and the outcome of a run of an offline store (ADR-0014 §6, §8; spec 2026-10-16-offline-sync,
// E12, E20): a handshake opens a sync_runs row and refreshes store_sync_status; the outcome closes the run and,
// when it went well, marks the last success of the store.
@Injectable()
export class SyncRunsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runs: SyncRunsRepository,
  ) {}

  async handshake(
    store: SyncStore,
    request: SyncHandshakeRequest,
  ): Promise<SyncHandshakeResponse> {
    if (request.protocolVersion < store.settings.minSupportedProtocol) {
      throw new ProblemException(426, 'protocol_unsupported');
    }
    const runId = newId();
    const correlationId = getRequestContext()?.correlationId ?? runId;
    const quarantined = await this.db.withTenant(
      store.tenantId,
      async (trx) => {
        await this.runs.openRun(trx, {
          tenantId: store.tenantId,
          runId,
          storeId: store.storeId,
          request,
          correlationId,
        });
        await this.runs.touchStore(trx, {
          tenantId: store.tenantId,
          storeId: store.storeId,
          runId,
          request,
          licenseStatus: store.license.status,
        });
        return this.runs.refreshQuarantined(trx, store.tenantId, store.storeId);
      },
    );
    return {
      syncRunId: runId,
      license: {
        status: store.license.status,
        validUntil: store.license.validUntil,
      },
      minSupportedProtocol: store.settings.minSupportedProtocol,
      recommendedProtocol: store.settings.recommendedProtocol,
      limits: { ...SYNC_BATCH_LIMITS },
      serverTime: new Date().toISOString(),
      quarantined,
    };
  }

  /** Closes the run with the report of the store; a run of another store is not found. */
  async complete(
    store: SyncStore,
    runId: string,
    report: SyncRunCompleteRequest,
  ): Promise<void> {
    await this.db.withTenant(store.tenantId, async (trx) => {
      const run = await this.runs.runOf(trx, store.tenantId, runId);
      if (!run || run.storeId !== store.storeId) {
        throw new ProblemException(404, 'not_found');
      }
      const ok =
        report.clientErrors.length === 0 &&
        report.quarantined === 0 &&
        report.rejected === 0;
      await this.runs.completeRun(trx, store.tenantId, runId, report, ok);
      if (ok) await this.runs.markSuccess(trx, store.tenantId, store.storeId);
    });
  }
}
