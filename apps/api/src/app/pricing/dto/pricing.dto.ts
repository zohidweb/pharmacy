import type {
  DiscountRuleInput,
  DiscountThreshold,
  PriceListQuery,
  UpdatePricesRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Limits of spec 2026-10-07-catalog-pricing, section 6. Scope, store and product rules are
// checked by the services.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_MONEY_MINOR = 10_000_000_000;

/** GET /api/v1/prices. */
export class PriceListQueryDto implements PriceListQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

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

export class StorePriceDto {
  @IsUUID()
  storeId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  priceMinor!: number;
}

/** PUT /api/v1/prices/{productId}. */
export class UpdatePricesDto implements UpdatePricesRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique((price: StorePriceDto) => price.storeId?.toLowerCase())
  @ValidateNested({ each: true })
  @Type(() => StorePriceDto)
  prices!: StorePriceDto[];

  @IsBoolean()
  confirmAboveMax!: boolean;
}

export class DiscountThresholdDto implements DiscountThreshold {
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  minSubtotalMinor!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  percent!: number;
}

export class DiscountPeriodDto {
  @Matches(DATE)
  from!: string;

  @ValidateIf((period: DiscountPeriodDto) => period.to !== null)
  @Matches(DATE)
  to!: string | null;
}

/** POST /api/v1/discount-rules, PUT /api/v1/discount-rules/{id}. */
export class DiscountRuleInputDto implements DiscountRuleInput {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DiscountThresholdDto)
  thresholds!: DiscountThresholdDto[];

  @ValidateIf((input: DiscountRuleInputDto) => input.storeIds !== null)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique((id: string) => id?.toLowerCase())
  @IsUUID('all', { each: true })
  storeIds!: string[] | null;

  @ValidateIf((input: DiscountRuleInputDto) => input.period !== null)
  @ValidateNested()
  @Type(() => DiscountPeriodDto)
  period!: DiscountPeriodDto | null;
}
