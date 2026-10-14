import type { DashboardPeriod, DashboardQuery } from '@pharmacy/shared-dto';
import { IsIn, IsOptional } from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/calendar-date';

export const DASHBOARD_PERIODS: DashboardPeriod[] = [
  'today',
  'week',
  'month',
  'custom',
];

/** GET /api/v1/dashboard (spec 2026-10-14-owner-cabinet, 5.2). */
export class DashboardQueryDto implements DashboardQuery {
  @IsIn(DASHBOARD_PERIODS)
  period!: DashboardPeriod;

  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
