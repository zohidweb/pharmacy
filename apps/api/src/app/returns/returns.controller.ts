import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import type {
  CreatedReturn,
  ReturnListResponse,
  SaleSearchItem,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  CreateReturnDto,
  ReturnListQueryDto,
  SalesSearchQueryDto,
} from './dto/returns.dto';
import { ReturnableService } from './returnable.service';
import { ReturnsService } from './returns.service';

// Customer returns (spec 2026-10-13-customer-returns, 4.1): the return on the terminal of the PIN
// session (`Idempotency-Key` = the id of the body), the sales of a product without the receipt and
// the journal; codes in the JSDoc of CreateReturnRequest (libs/shared/dto).
@Controller({ path: 'returns', version: '1' })
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly returnable: ReturnableService,
  ) {}

  @RequirePermission('returns:without-receipt')
  @Get('sales-search')
  salesSearch(@Query() query: SalesSearchQueryDto): Promise<SaleSearchItem[]> {
    return this.returnable.salesSearch(query);
  }

  @RequirePermission('returns:create')
  @Post()
  create(
    @Body() body: CreateReturnDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<CreatedReturn> {
    return this.returns.create(body, key);
  }

  @RequirePermission('returns:view')
  @Get()
  list(@Query() query: ReturnListQueryDto): Promise<ReturnListResponse> {
    return this.returns.list(query);
  }
}
