import type {
  StockListQuery,
  StockSortKey,
  StockStateFilter,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
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

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const STATES: StockStateFilter[] = [
  'all',
  'low',
  'expiring',
  'out',
  'negative',
];
const SORTS: StockSortKey[] = ['product', 'expiresOn', 'quantity', 'price'];

/** GET /api/v1/stock. */
export class StockListQueryDto implements StockListQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(STATES)
  state?: StockStateFilter;

  @IsOptional()
  @IsIn(SORTS)
  sort?: StockSortKey;

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

/** GET /api/v1/stores/{storeId}/stock-products. */
export class StockProductsQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
