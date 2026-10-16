import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SyncHandshakeResponse } from '@pharmacy/shared-dto';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { Public } from '../../common/guards/decorators';
import { SyncHandshakeDto, SyncRunCompleteDto } from './dto/sync.dto';
import { LicenseKeyGuard } from './license-key.guard';
import { SyncRunsService } from './sync-runs.service';
import { type SyncStore, SyncStoreParam } from './sync-store.context';

// The sync contour of offline stores in the cloud (ADR-0014 §6; spec 2026-10-16-offline-sync, section 7): no
// session — the license key of the store (LicenseKeyGuard). Every call runs in the context of the network of
// the key, without a principal.
@Controller({ path: 'sync', version: '1' })
@Public()
@UseGuards(LicenseKeyGuard)
export class SyncReceiveController {
  constructor(private readonly runs: SyncRunsService) {}

  @Post('runs')
  handshake(
    @SyncStoreParam() store: SyncStore,
    @Body() body: SyncHandshakeDto,
  ): Promise<SyncHandshakeResponse> {
    return inStore(store, () => this.runs.handshake(store, body));
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
