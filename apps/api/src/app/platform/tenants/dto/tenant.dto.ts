import type {
  BlockTenantRequest,
  CreateTenantRequest,
  TenantListFilter,
  TenantListQuery,
  TenantOwner,
  TenantSortKey,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const FILTERS: TenantListFilter[] = ['all', 'active', 'unpaid', 'blocked'];
const SORTS: TenantSortKey[] = ['name', 'owner', 'stores', 'paidUntil', 'monthlyCharge'];

/** GET /api/v1/operator/tenants. */
export class TenantListQueryDto implements TenantListQuery {
  @IsOptional()
  @IsIn(FILTERS)
  filter?: TenantListFilter;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(SORTS)
  sort?: TenantSortKey;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

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

export class TenantOwnerDto implements TenantOwner {
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
}

/** POST /api/v1/operator/tenants. */
export class CreateTenantDto implements CreateTenantRequest {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 120)
  city!: string;

  // INN of Tajikistan: 9 digits.
  @Transform(trim)
  @IsString()
  @Matches(/^\d{9}$/)
  inn!: string;

  @ValidateNested()
  @Type(() => TenantOwnerDto)
  owner!: TenantOwnerDto;
}

/** POST /api/v1/operator/tenants/{id}/block. */
export class BlockTenantDto implements BlockTenantRequest {
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  reason!: string;
}
