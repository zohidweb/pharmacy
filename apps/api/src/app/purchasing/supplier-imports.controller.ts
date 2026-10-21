import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import type {
  SupplierImportCheck,
  SupplierImportResult,
} from '@pharmacy/shared-dto';
import { idempotencyKeyOf } from '../../core/imports';
import { RequirePermission } from '../auth/decorators';
import { SupplierImportRequestDto } from './dto/supplier-import.dto';
import { SupplierImportService } from './supplier-import.service';

// Loading the suppliers from a file (spec 2026-10-20-data-import, section 7).
@Controller({ path: 'supplier-imports', version: '1' })
export class SupplierImportsController {
  constructor(private readonly imports: SupplierImportService) {}

  /** 200: the dry run — what would be created, the names the network has, every refused row. */
  @RequirePermission('purchasing:create')
  @Post('checks')
  @HttpCode(200)
  check(@Body() body: SupplierImportRequestDto): Promise<SupplierImportCheck> {
    return this.imports.check(body);
  }

  /** 201; 400 without an Idempotency-Key, 409 `idempotency_conflict`, 422 `import_invalid` — nothing written. */
  @RequirePermission('purchasing:create')
  @Post()
  apply(
    @Body() body: SupplierImportRequestDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<SupplierImportResult> {
    return this.imports.apply(body, idempotencyKeyOf(key));
  }
}
