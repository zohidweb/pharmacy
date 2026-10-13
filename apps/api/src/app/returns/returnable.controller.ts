import { Controller, Get, Query } from '@nestjs/common';
import type { ReturnableReceipt } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { ReturnableQueryDto } from './dto/returns.dto';
import { ReturnableService } from './returnable.service';

// A receipt of the store for a return (spec 2026-10-13-customer-returns, 4.2): by its number or the
// id of its QR; with `productId` — a sale found without the receipt (`returns:without-receipt`).
@Controller({ path: 'receipts', version: '1' })
export class ReturnableController {
  constructor(private readonly returnable: ReturnableService) {}

  /** 404 `not_found`; 422 `return_window_expired`. */
  @RequirePermission('returns:create')
  @Get('returnable')
  find(@Query() query: ReturnableQueryDto): Promise<ReturnableReceipt> {
    return this.returnable.find(query);
  }
}
