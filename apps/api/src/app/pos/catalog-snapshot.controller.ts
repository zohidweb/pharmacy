import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { CatalogSnapshot } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { CatalogSnapshotService } from './catalog-snapshot.service';
import { CatalogSnapshotQueryDto } from './dto/pos.dto';

// The catalog snapshot of the POS (spec 2026-10-13-pos-shift-sale, 4.1, 4.3).
@Controller({ version: '1' })
export class CatalogSnapshotController {
  constructor(private readonly snapshots: CatalogSnapshotService) {}

  /** 403 `store_not_in_scope`, 404 `not_found`, 409 `offline_store_read_only`. */
  @RequirePermission('pos:view')
  @Get('stores/:storeId/catalog-snapshot')
  snapshot(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Query() query: CatalogSnapshotQueryDto,
  ): Promise<CatalogSnapshot> {
    return this.snapshots.snapshot(storeId, query.sinceVersion);
  }
}
