import { Controller, Get, Param, Query } from '@nestjs/common';
import type { ReportTable } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { ReportQueryDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';

// The reports of the owner cabinet (spec 2026-10-14-owner-cabinet, 5.1, 5.3).
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * 404 for an unknown kind; 403 `store_not_in_scope`; 422 `validation_failed` (`from` > `to`, `to`
   * after today, a period longer than 366 days).
   */
  @RequirePermission('reports:view')
  @Get(':kind')
  get(
    @Param('kind') kind: string,
    @Query() query: ReportQueryDto,
  ): Promise<ReportTable> {
    return this.reports.get(kind, query);
  }
}
