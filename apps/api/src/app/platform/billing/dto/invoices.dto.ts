import type {
  GenerateInvoicesRequest,
  InvoiceListFilter,
  InvoiceListQuery,
} from '@pharmacy/shared-dto';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** YYYY-MM with a real month. */
export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const FILTERS: InvoiceListFilter[] = ['all', 'unpaid', 'overdue', 'paid'];

/** GET /api/v1/operator/invoices */
export class InvoiceListQueryDto implements InvoiceListQuery {
  @IsOptional()
  @IsIn(FILTERS)
  filter?: InvoiceListFilter;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @Matches(PERIOD)
  period?: string;

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

/** GET …/billing/summary — the previous month when left out. */
export class SummaryQueryDto {
  @IsOptional()
  @Matches(PERIOD)
  period?: string;
}

/** GET …/invoices/generation-preview, POST …/invoices/generations. */
export class PeriodDto implements GenerateInvoicesRequest {
  @Matches(PERIOD)
  period!: string;
}
