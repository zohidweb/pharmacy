import type {
  CreateStoreRequest,
  LegalEntityInput,
  StoreKind,
  UpdateLegalEntityRequest,
  UpdateOwnerStoreRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Limits of spec 2026-10-06-owner-stores, section 7.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
// An optional text field: blank means "not set".
const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const TAX_ID = /^\d{9}$/;
const STORE_CODE = /^[A-Z0-9]{1,8}$/;
const PHONE = /^\+[1-9][0-9]{7,14}$/;
const KINDS: StoreKind[] = ['pharmacy', 'warehouse'];

export class LegalEntityInputDto implements LegalEntityInput {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @Transform(trim)
  @IsString()
  @Matches(TAX_ID)
  taxId!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 300)
  legalAddress!: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @Matches(PHONE)
  phone!: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email!: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bankDetails!: string | null;
}

/** PATCH /api/v1/legal-entities/{id}: only the fields that are sent change. */
export class UpdateLegalEntityDto implements UpdateLegalEntityRequest {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(TAX_ID)
  taxId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 300)
  legalAddress?: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @Matches(PHONE)
  phone?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bankDetails?: string | null;
}

/** POST /api/v1/stores; "exactly one of legalEntityId / newLegalEntity" is checked by the service. */
export class CreateStoreDto implements CreateStoreRequest {
  @IsOptional()
  @IsUUID()
  legalEntityId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LegalEntityInputDto)
  newLegalEntity?: LegalEntityInputDto;

  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @Transform(upper)
  @IsString()
  @Matches(STORE_CODE)
  code!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 300)
  address!: string;

  @IsIn(KINDS)
  kind!: StoreKind;

  @IsBoolean()
  printReceiptDefault!: boolean;
}

/** PUT /api/v1/stores/{id}: code and kind are fixed after creation. */
export class UpdateStoreDto implements UpdateOwnerStoreRequest {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 300)
  address!: string;

  @IsUUID()
  legalEntityId!: string;

  @IsBoolean()
  printReceiptDefault!: boolean;
}
