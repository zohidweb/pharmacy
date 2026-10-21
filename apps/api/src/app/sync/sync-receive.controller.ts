import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  SyncBatchResponse,
  SyncChangesResponse,
  SyncHandshakeResponse,
} from '@pharmacy/shared-dto';
import { ProblemException } from '../../common/errors/problem.exception';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { Public } from '../../common/guards/decorators';
import {
  SyncChangesQueryDto,
  SyncEnvelopeDto,
  SyncHandshakeDto,
  SyncRunCompleteDto,
} from './dto/sync.dto';
import { LicenseKeyGuard } from './license-key.guard';
import { SyncApplyService } from './sync-apply.service';
import { SyncFeedService } from './sync-feed.service';
import { SyncRunsService } from './sync-runs.service';
import { type SyncStore, SyncStoreParam } from './sync-store.context';

// The sync contour of offline stores in the cloud (ADR-0014 §6; spec 2026-10-16-offline-sync, section 7): no
// session — the license key of the store (LicenseKeyGuard). Every call runs in the context of the network of
// the key, without a principal.
@Controller({ path: 'sync', version: '1' })
@Public()
@UseGuards(LicenseKeyGuard)
export class SyncReceiveController {
  constructor(
    private readonly runs: SyncRunsService,
    private readonly apply: SyncApplyService,
    private readonly feed: SyncFeedService,
  ) {}

  @Post('runs')
  handshake(
    @SyncStoreParam() store: SyncStore,
    @Body() body: SyncHandshakeDto,
  ): Promise<SyncHandshakeResponse> {
    return inStore(store, () => this.runs.handshake(store, body));
  }

  /** A batch of operations; `Idempotency-Key` is the batch id (ADR-0014 §6). */
  @Post('operations')
  @HttpCode(200)
  operations(
    @SyncStoreParam() store: SyncStore,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: SyncEnvelopeDto,
  ): Promise<SyncBatchResponse> {
    if (idempotencyKey?.toLowerCase() !== body.batchId.toLowerCase()) {
      throw new ProblemException(400, 'idempotency_key_mismatch');
    }
    const bytes = Buffer.byteLength(JSON.stringify(body));
    return inStore(store, () => this.apply.applyBatch(store, body, bytes));
  }

  /** The change feed after `cursor` (ADR-0014 §3): 410 `resync_required`, 403 `feed_closed`. */
  @Get('changes')
  changes(
    @SyncStoreParam() store: SyncStore,
    @Query() query: SyncChangesQueryDto,
  ): Promise<SyncChangesResponse> {
    return inStore(store, () =>
      this.feed.changes(store, query.cursor ?? null, query.limit ?? 500),
    );
  }

  @Post('runs/:id/complete')
  @HttpCode(204)
  complete(
    @SyncStoreParam() store: SyncStore,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SyncRunCompleteDto,
  ): Promise<void> {
    return inStore(store, () =>
      this.runs.complete(store, id.toLowerCase(), body),
    );
  }
}

/** Runs the work in the network of the store, keeping the correlation id of the request. */
export function inStore<T>(
  store: SyncStore,
  work: () => Promise<T>,
): Promise<T> {
  const correlationId = getRequestContext()?.correlationId ?? '';
  return runWithContext(
    { correlationId, tenantId: store.tenantId, principal: null },
    work,
  );
}
