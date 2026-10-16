import type {
  AddTenantDiscountRequest,
  ShortenTenantDiscountRequest,
} from '@pharmacy/shared-dto';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { PERIOD } from './invoices.dto';

/** POST /api/v1/operator/tenants/{id}/discounts — 1–100 % in basis points, months YYYY-MM. */
export class AddTenantDiscountDto implements AddTenantDiscountRequest {
  @IsInt()
  @Min(100)
  @Max(10_000)
  percentBp!: number;

  @Matches(PERIOD)
  fromMonth!: string;

  @Matches(PERIOD)
  toMonth!: string;
}

/** PATCH /api/v1/operator/discounts/{id} */
export class ShortenTenantDiscountDto implements ShortenTenantDiscountRequest {
  @Matches(PERIOD)
  toMonth!: string;
}
