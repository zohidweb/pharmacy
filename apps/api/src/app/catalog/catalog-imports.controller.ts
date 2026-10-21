import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import type {
  CatalogImportCheck,
  CatalogImportResult,
} from '@pharmacy/shared-dto';
import { idempotencyKeyOf } from '../../core/imports';
import { RequirePermission } from '../auth/decorators';
import { CatalogImportService } from './catalog-import.service';
import { CatalogImportRequestDto } from './dto/catalog-import.dto';

// Loading the catalog from a file (spec 2026-10-20-data-import, section 7).
@Controller({ path: 'catalog-imports', version: '1' })
export class CatalogImportsController {
  constructor(private readonly imports: CatalogImportService) {}

  /** 200: the dry run — what would be created, what is already in the catalog, every refused row. */
  @RequirePermission('catalog:create')
  @Post('checks')
  @HttpCode(200)
  check(@Body() body: CatalogImportRequestDto): Promise<CatalogImportCheck> {
    return this.imports.check(body);
  }

  /** 201; 400 without an Idempotency-Key, 409 `idempotency_conflict`, 422 `import_invalid` — nothing written. */
  @RequirePermission('catalog:create')
  @Post()
  apply(
    @Body() body: CatalogImportRequestDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<CatalogImportResult> {
    return this.imports.apply(body, idempotencyKeyOf(key));
  }
}
