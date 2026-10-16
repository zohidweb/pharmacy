import type { NavCountersQuery } from '@pharmacy/shared-dto';
import { IsOptional, IsUUID } from 'class-validator';

/** GET /api/v1/nav-counters. */
export class NavCountersQueryDto implements NavCountersQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;
}
