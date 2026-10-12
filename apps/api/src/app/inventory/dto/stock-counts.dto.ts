import type {
  FoundLineInput,
  SaveStockCountRequest,
  StartStockCountRequest,
  StockCount,
  StockCountEntryRequest,
  StockCountListQuery,
  StockCountScope,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// Limits of spec 2026-10-12-write-offs-stock-counts, section 5; the scope, the line and the rights
// are checked by the service.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** POST /api/v1/stock-counts. */
export class StartStockCountDto implements StartStockCountRequest {
  @IsUUID()
  storeId!: string;

  @IsIn(['all', 'category'])
  scope!: StockCountScope;

  /** Required for the scope `category` (the service says so at `categoryId`). */
  @ValidateIf((input: StartStockCountDto) => input.categoryId !== null)
  @IsUUID()
  categoryId!: string | null;
}

/** PUT /api/v1/stock-counts/{id}. */
export class SaveStockCountDto implements SaveStockCountRequest {
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;
}

/** POST /api/v1/stock-counts/{id}/entries. */
export class StockCountEntryDto implements StockCountEntryRequest {
  /** The idempotency key of the tablet (UUIDv7). */
  @IsUUID()
  id!: string;

  @IsUUID()
  lineId!: string;

  /** Pieces; 0 — «counted none», negative — a correction. */
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  pieces!: number;
}

/** POST /api/v1/stock-counts/{id}/found-lines, PUT …/found-lines/{lineId}. */
export class FoundLineDto implements FoundLineInput {
  @IsUUID()
  productId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  batchNumber!: string;

  @ValidateIf((input: FoundLineDto) => input.expiresOn !== null)
  @Matches(DATE)
  expiresOn!: string | null;

  /** A pack; taken only with `finance:view-cost`. */
  @ValidateIf((input: FoundLineDto) => input.costMinor !== null)
  @IsInt()
  @Min(0)
  @Max(10_000_000_000)
  costMinor!: number | null;
}

/** GET /api/v1/stock-counts. */
export class StockCountListQueryDto implements StockCountListQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsIn(['in_progress', 'posted', 'cancelled'])
  status?: StockCount['status'];

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
