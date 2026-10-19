import type { UsageStatsQuery } from '@pharmacy/shared-dto';
import { IsOptional, IsUUID, Matches } from 'class-validator';

/** YYYY-MM; the range (2026-01 to the current month) is checked by the service. */
export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** GET /api/v1/operator/usage-stats (spec 2026-10-19-admin-dashboard-stats, 6). */
export class UsageStatsQueryDto implements UsageStatsQuery {
  @Matches(PERIOD)
  period!: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
