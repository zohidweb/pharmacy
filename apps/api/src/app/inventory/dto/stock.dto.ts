import type {
  ReorderQuery,
  StockListQuery,
  StockSortKey,
  StockStateFilter,
} from '@pharmacy/shared-dto';
import { EXPORT_ROW_LIMIT } from '@pharmacy/shared-util';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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
export class ReorderQueryDto implements ReorderQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

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
  // the Excel export asks for the whole list at once; past 100 — inventory:export (ADR-0015, amendment 2026-10-27)
  @Max(EXPORT_ROW_LIMIT)
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

  /** Only the expired batches with stock, of every product of the store (spec 2026-10-12, B4). */
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  @IsBoolean()
  expired?: boolean;

  /** Comma-separated product ids, ≤ 500: exactly these products, any status. */
  @IsOptional()
  @Matches(/^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36}){0,499}$/)
  ids?: string;

  /** Only the batches of this supplier (a supplier return); products without them are left out. */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** Only the batches of this goods receipt still in stock; no search, no page limit. */
  @IsOptional()
  @IsUUID()
  receiptId?: string;
}

/** GET /api/v1/stock/deficit. */
export class DeficitQueryDto {
  @IsUUID()
  storeId!: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;
}
