import { Controller, Get, Query } from '@nestjs/common';
import type { TenantDashboard } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard.dto';

// The home of the owner cabinet (spec 2026-10-14-owner-cabinet, 5.1, 5.2).
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** `custom` without dates — 400; dates after today or longer than 92 days — 422. */
  @RequirePermission('reports:view')
  @Get()
  get(@Query() query: DashboardQueryDto): Promise<TenantDashboard> {
    return this.dashboard.get(query);
  }
}
