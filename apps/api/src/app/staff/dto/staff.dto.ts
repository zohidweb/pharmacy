import {
  PASSWORD_MAX_LENGTH,
  PIN_MAX_LENGTH,
  type Permission,
} from '@pharmacy/shared-domain';
import type {
  CreateEmployeeRequest,
  EmployeeListQuery,
  EmployeeStatus,
  ResetEmployeePasswordRequest,
  RoleInput,
  SetEmployeePinRequest,
  SetEmployeeStatusRequest,
  UiLocale,
  UpdateEmployeeRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// Limits of spec 2026-10-06-staff-design, section 4; identifiers are checked by
// normalizeIdentifier in the service, the password and PIN policies too.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const STATUSES: EmployeeStatus[] = ['active', 'blocked'];
const LOCALES: UiLocale[] = ['ru', 'tg'];
const MAX_STORES = 500;

/** GET /api/v1/employees. */
export class EmployeeListQueryDto implements EmployeeListQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: EmployeeStatus;

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

/** PUT /api/v1/employees/{id}: `email` left out keeps the current one, '' clears it. */
export class UpdateEmployeeDto implements UpdateEmployeeRequest {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsString()
  @MaxLength(128)
  login!: string;

  @IsUUID()
  roleId!: string;

  /** null — the whole network. */
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(MAX_STORES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  storeIds!: string[] | null;

  @IsIn(LOCALES)
  locale!: UiLocale;
}

/** POST /api/v1/employees. */
export class CreateEmployeeDto
  extends UpdateEmployeeDto
  implements CreateEmployeeRequest
{
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  /** '' — no PIN, the employee signs in by password only. */
  @IsString()
  @Matches(/^\d*$/)
  @MaxLength(PIN_MAX_LENGTH)
  pin!: string;
}

export class ResetEmployeePasswordDto implements ResetEmployeePasswordRequest {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

export class SetEmployeeStatusDto implements SetEmployeeStatusRequest {
  @IsIn(STATUSES)
  status!: EmployeeStatus;
}

export class SetEmployeePinDto implements SetEmployeePinRequest {
  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(PIN_MAX_LENGTH)
  pin!: string;
}

/** POST /api/v1/roles, PUT /api/v1/roles/{id}. */
export class RoleInputDto implements RoleInput {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  /** Strings of the catalog; unknown ones are rejected by the service (400 `validation_failed`). */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions!: Permission[];
}
