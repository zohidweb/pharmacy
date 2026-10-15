import type {
  AddTenantServiceRequest,
  ApproveServiceRequest,
  CancelTenantServiceRequest,
  PlatformRequisites,
  PlatformSettings,
  ProvideTenantServiceRequest,
  RejectServiceRequest,
  TenantServiceQuery,
  TenantServiceStatus,
  UpdateTenantServiceRequest,
  UpsertServiceRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  Contains,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PRINTABLE_NAME } from '../../operators/dto/operator.dto';

// Limits of spec 2026-10-15-billing-services (A14, A20, section 11).
export const MAX_MONEY_MINOR = 10_000_000_000;
/** A description may keep line breaks; other control and invisible characters are refused. */
const PRINTABLE_TEXT = /^(?:[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|\n)*$/u;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A trimmed optional text; an empty one is none. */
export const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** The requisites of the platform printed on invoices. */
export class PlatformRequisitesDto implements PlatformRequisites {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  @Matches(PRINTABLE_NAME)
  name!: string;

  @Matches(/^\d{9}$/)
  inn!: string;

  @Matches(/^\d{20}$/)
  bankAccount!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  @Matches(PRINTABLE_NAME)
  bankName!: string;

  @Matches(/^\d{9}$/)
  bankBik!: string;

  @Matches(/^\d{20}$/)
  bankCorrAccount!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  @Matches(PRINTABLE_NAME)
  @Contains('{number}')
  paymentPurposeTemplate!: string;
}

/** PUT /api/v1/operator/settings — the whole settings. */
export class UpdatePlatformSettingsDto implements PlatformSettings {
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  pricePerStoreMinor!: number;

  @IsInt()
  @Min(0)
  @Max(99)
  vatRatePercent!: number;

  @IsObject()
  @ValidateNested()
  @Type(() => PlatformRequisitesDto)
  supplier!: PlatformRequisitesDto;
}

/** POST /api/v1/operator/services, PUT /api/v1/operator/services/{id} — the whole service. */
export class UpsertServiceDto implements UpsertServiceRequest {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PRINTABLE_NAME)
  nameRu!: string;

  /** Optional: owners with the Tajik interface then see the Russian name. */
  @Transform(optionalText)
  @ValidateIf((body: UpsertServiceDto) => body.nameTj !== null)
  @IsString()
  @Length(1, 120)
  @Matches(PRINTABLE_NAME)
  nameTj!: string | null;

  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  @Matches(PRINTABLE_TEXT)
  descriptionRu!: string;

  @Transform(optionalText)
  @ValidateIf((body: UpsertServiceDto) => body.descriptionTj !== null)
  @IsString()
  @Length(1, 1000)
  @Matches(PRINTABLE_TEXT)
  descriptionTj!: string | null;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  basePriceMinor!: number;

  @IsBoolean()
  visible!: boolean;

  @IsBoolean()
  archived!: boolean;
}

/** A reason the owner sees: 5–500 characters, line breaks kept. */
class ReasonDto {
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  @Matches(PRINTABLE_TEXT)
  reason!: string;
}

class PriceDto {
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  priceMinor!: number;
}

/** POST /api/v1/operator/service-requests/{id}/approval */
export class ApproveServiceRequestDto
  extends PriceDto
  implements ApproveServiceRequest {}

/** POST /api/v1/operator/service-requests/{id}/rejection */
export class RejectServiceRequestDto
  extends ReasonDto
  implements RejectServiceRequest {}

/** PATCH /api/v1/operator/tenant-services/{id} */
export class UpdateTenantServiceDto
  extends PriceDto
  implements UpdateTenantServiceRequest {}

/** POST /api/v1/operator/tenant-services/{id}/cancellation */
export class CancelTenantServiceDto
  extends ReasonDto
  implements CancelTenantServiceRequest {}

/** POST /api/v1/operator/tenants/{id}/services */
export class AddTenantServiceDto
  extends PriceDto
  implements AddTenantServiceRequest
{
  /** The idempotency key made by the client (B17). */
  @IsUUID()
  id!: string;

  @IsUUID()
  serviceId!: string;
}

/** POST /api/v1/operator/tenant-services/{id}/provision — a calendar date; the service checks the range. */
export class ProvideTenantServiceDto implements ProvideTenantServiceRequest {
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  providedOn!: string;
}

const STATUSES: TenantServiceStatus[] = [
  'approved',
  'rejected',
  'cancelled',
  'provided',
];

/** GET /api/v1/operator/tenant-services?status&tenantId */
export class TenantServiceQueryDto implements TenantServiceQuery {
  @IsOptional()
  @IsIn(STATUSES)
  status?: TenantServiceStatus;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
