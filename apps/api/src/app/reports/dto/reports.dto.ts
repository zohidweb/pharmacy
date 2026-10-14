import type { ReportKind } from '@pharmacy/shared-dto';
import { IsOptional, IsUUID } from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/calendar-date';

export const REPORT_KINDS: readonly ReportKind[] = [
  'sales_by_store',
  'sales_by_category',
  'stock',
  'movement',
  'supplier_debts',
  'cashiers',
  'losses',
  'controlled',
  'controlled_summary',
];

/** GET /api/v1/reports/{kind}?from=&to=&storeId= (spec 2026-10-14-owner-cabinet, 5.3). */
export class ReportQueryDto {
  @IsCalendarDate()
  from!: string;

  @IsCalendarDate()
  to!: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;
}
