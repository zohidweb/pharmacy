import type { OperatorActionType, OperatorAuditQuery } from '@pharmacy/shared-dto';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { IsCalendarDate } from '../../../../common/validation/calendar-date';

export const OPERATOR_ACTION_TYPES: OperatorActionType[] = [
  'access',
  'company',
  'payment',
  'key',
  'service',
  'settings',
];

/** GET /api/v1/operator/operator-audit-log. */
export class OperatorAuditQueryDto implements OperatorAuditQuery {
  @IsOptional()
  @IsUUID()
  operatorId?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsIn(OPERATOR_ACTION_TYPES)
  type?: OperatorActionType;

  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
