import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { HeldReceipt } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { HoldReceiptDto } from './dto/pos.dto';
import { HeldReceiptsService } from './held-receipts.service';

// Held receipts (spec 2026-10-13-pos-shift-sale, 4.1, 4.6). A session without a terminal — 403
// `terminal_required`.
@Controller({ version: '1' })
export class HeldReceiptsController {
  constructor(private readonly held: HeldReceiptsService) {}

  /** 403 `store_not_in_scope`. */
  @RequirePermission('pos:view')
  @Get('stores/:storeId/held-receipts')
  list(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
  ): Promise<HeldReceipt[]> {
    return this.held.list(storeId);
  }

  /** 400 `validation_failed` (`unknown_product`, `unknown_batch`), 409 `no_open_shift`. */
  @RequirePermission('pos:create')
  @Post('held-receipts')
  hold(@Body() body: HoldReceiptDto): Promise<HeldReceipt> {
    return this.held.hold(body);
  }

  @RequirePermission('pos:create')
  @Delete('held-receipts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.held.remove(id);
  }
}
