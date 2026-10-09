import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { UnpostCheck } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import type { StockDocumentType } from './documents.repository';
import { StockDocumentsService } from './stock-documents.service';

const KINDS: Record<string, StockDocumentType> = {
  'goods-receipts': 'goods_receipt',
  'opening-balances': 'opening_balance',
};

// Whether a posted document can be unposted (spec 2026-10-09, section 4.1); the other kinds of the
// contract come with their documents.
@Controller({ path: 'stock-documents', version: '1' })
export class UnpostingCheckController {
  constructor(private readonly documents: StockDocumentsService) {}

  @RequirePermission('inventory:unpost')
  @Get(':kind/:id/unposting-check')
  check(
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UnpostCheck> {
    const type = KINDS[kind];
    if (!type) throw new BadRequestException();
    return this.documents.unpostCheck(type, id);
  }
}
