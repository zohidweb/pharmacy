import { Body, Controller, Headers, Post } from '@nestjs/common';
import type { CreatedReceipt } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { BufferedOperation } from './buffer-replay.interceptor';
import { CreateReceiptDto } from './dto/pos.dto';
import { ReceiptsService } from './receipts.service';

// The sale of the POS (spec 2026-10-13-pos-shift-sale, 4.1, 4.5): `Idempotency-Key` = the id of the
// body; codes in the JSDoc of CreateReceiptRequest (libs/shared/dto).
@Controller({ path: 'receipts', version: '1' })
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @RequirePermission('pos:create')
  @BufferedOperation()
  @Post()
  create(
    @Body() body: CreateReceiptDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-client-sent-at') sentAt?: string,
  ): Promise<CreatedReceipt> {
    return this.receipts.create(body, key, sentAt);
  }
}
