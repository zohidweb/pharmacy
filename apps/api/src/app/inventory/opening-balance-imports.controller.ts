import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import type {
  OpeningBalanceImportCheck,
  OpeningBalanceImportResult,
} from '@pharmacy/shared-dto';
import { idempotencyKeyOf } from '../../core/imports';
import { RequirePermission } from '../auth/decorators';
import { OpeningBalanceImportRequestDto } from './dto/opening-balance-import.dto';
import { OpeningBalanceImportService } from './opening-balance-import.service';

// Loading the opening balances of a store from a file (spec 2026-10-20-data-import, section 7); the cost permission
// and the store are checked by the service, as for a draft saved by hand.
@Controller({ path: 'opening-balance-imports', version: '1' })
export class OpeningBalanceImportsController {
  constructor(private readonly imports: OpeningBalanceImportService) {}

  /** 200: the dry run — drafts to create, warnings, every refused row; 403, 404, 409 `offline_store_read_only`. */
  @RequirePermission('inventory:create')
  @Post('checks')
  @HttpCode(200)
  check(
    @Body() body: OpeningBalanceImportRequestDto,
  ): Promise<OpeningBalanceImportCheck> {
    return this.imports.check(body);
  }

  /** 201: drafts of 500 lines; 400 without an Idempotency-Key, 409 `idempotency_conflict`, 422 `import_invalid`. */
  @RequirePermission('inventory:create')
  @Post()
  apply(
    @Body() body: OpeningBalanceImportRequestDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<OpeningBalanceImportResult> {
    return this.imports.apply(body, idempotencyKeyOf(key));
  }
}
