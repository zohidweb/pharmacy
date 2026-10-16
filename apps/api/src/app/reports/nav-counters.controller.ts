import { Controller, Get, Query } from '@nestjs/common';
import type { NavCounters } from '@pharmacy/shared-dto';
import { Authenticated } from '../../common/guards/decorators';
import { NavCountersQueryDto } from './dto/nav-counters.dto';
import { NavCountersService } from './nav-counters.service';

// The numbers of the side menu (spec 2026-10-15-nav-counters, E1): any signed-in employee; a number
// without its permission is absent. `storeId` outside the scope — 403 `store_not_in_scope`.
@Controller({ path: 'nav-counters', version: '1' })
export class NavCountersController {
  constructor(private readonly counters: NavCountersService) {}

  @Authenticated()
  @Get()
  get(@Query() query: NavCountersQueryDto): Promise<NavCounters> {
    return this.counters.get(query);
  }
}
