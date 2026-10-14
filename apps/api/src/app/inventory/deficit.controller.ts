import { Controller, Get, Query } from '@nestjs/common';
import type { DeficitLine } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { DeficitQueryDto } from './dto/stock.dto';
import { StockService } from './stock.service';

// «Заполнить по дефициту» of a purchase order (spec 2026-10-09-inventory-purchasing, section 4.2):
// the stock is the stock module's, so the route is under its prefix — not under /purchase-orders,
// where it would depend on being registered before `purchase-orders/:id`.
@Controller({ path: 'stock', version: '1' })
export class DeficitController {
  constructor(private readonly stock: StockService) {}

  /** Needs `finance:view-cost` as well; 403 `store_not_in_scope`. */
  @RequirePermission('purchasing:view')
  @Get('deficit')
  deficit(@Query() query: DeficitQueryDto): Promise<DeficitLine[]> {
    return this.stock.deficit(query);
  }
}
