import { auditGroups } from '@pharmacy/shared-domain';
import type { AuditAction, AuditQuery } from '@pharmacy/shared-dto';
import { EXPORT_ROW_LIMIT } from '@pharmacy/shared-util';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/calendar-date';

/** GET /api/v1/audit-log (spec 2026-10-14-owner-cabinet, 5.5). */
export class AuditJournalQueryDto implements AuditQuery {
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsIn(auditGroups)
  action?: AuditAction;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // the Excel export asks for the whole period at once; past 100 — audit:export (ADR-0015, amendment 2026-10-27)
  @Max(EXPORT_ROW_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
