import { type ExpenseKind, expenseKinds } from '@pharmacy/shared-domain';
import type {
  CreateExpenseRequest,
  ExpenseQuery,
} from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
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

// Limits of spec 2026-10-14-owner-cabinet, E16, 5.6; the month against today and the store against
// the scope are checked by the service.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONEY_MINOR = 10_000_000_000;

/** A trimmed comment; an empty one is no comment. */
const commentOf = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** GET /api/v1/expenses?month=YYYY-MM&storeId= */
export class ExpenseQueryDto implements ExpenseQuery {
  @Matches(MONTH)
  month!: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;
}

/** POST /api/v1/expenses, PUT /api/v1/expenses/{id} — the whole record. */
export class ExpenseBodyDto implements CreateExpenseRequest {
  @Matches(MONTH)
  month!: string;

  /** `null` — the whole network. */
  @ValidateIf((body: ExpenseBodyDto) => body.storeId !== null)
  @IsUUID()
  storeId!: string | null;

  @IsIn(expenseKinds)
  kind!: ExpenseKind;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  amountMinor!: number;

  @Transform(commentOf)
  @ValidateIf((body: ExpenseBodyDto) => body.comment !== null)
  @IsString()
  @MaxLength(500)
  comment!: string | null;
}
