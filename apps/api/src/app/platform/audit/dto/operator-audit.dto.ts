import type { OperatorActionType, OperatorAuditQuery } from '@pharmacy/shared-dto';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
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

  // The pattern keeps the shape, the strict ISO check refuses 2026-02-31 before PostgreSQL does.
  @IsOptional()
  @Matches(DATE)
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @Matches(DATE)
  @IsISO8601({ strict: true })
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
