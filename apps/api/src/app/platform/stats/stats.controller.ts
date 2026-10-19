import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type {
  DashboardResponse,
  TenantStats,
  UsageStatsResponse,
} from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { UsageStatsQueryDto } from './dto/usage-stats.dto';
import { StatsService } from './stats.service';

// The operator dashboard, the usage statistics and the statistics tab of a network (spec
// 2026-10-19-admin-dashboard-stats, 6).
@Controller({ path: 'operator', version: '1' })
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @RequireOperatorPermission('platform:view')
  @Get('dashboard')
  dashboard(): Promise<DashboardResponse> {
    return this.stats.dashboard();
  }

  /** 400 `validation_failed` (`period` — format or range), 404 — an unknown network. */
  @RequireOperatorPermission('platform:view')
  @Get('usage-stats')
  usage(@Query() query: UsageStatsQueryDto): Promise<UsageStatsResponse> {
    return this.stats.usage(query);
  }

  /** 404 — an unknown network. */
  @RequireOperatorPermission('tenants:view')
  @Get('tenants/:id/stats')
  tenant(@Param('id', new ParseUUIDPipe()) id: string): Promise<TenantStats> {
    return this.stats.tenant(id);
  }
}
