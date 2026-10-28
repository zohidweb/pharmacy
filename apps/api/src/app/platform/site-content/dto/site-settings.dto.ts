import type { SiteText, UpdateSiteSettingsRequest } from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A text in both languages, up to `max` characters each. */
function siteTextDto(max: number) {
  class SiteTextDto implements SiteText {
    @Transform(trim)
    @IsString()
    @MaxLength(max)
    ru!: string;

    @Transform(trim)
    @IsString()
    @MaxLength(max)
    tg!: string;
  }
  return SiteTextDto;
}

const NameDto = siteTextDto(120);
const TaglineDto = siteTextDto(200);
const SeoDescriptionDto = siteTextDto(160);
const AddressDto = siteTextDto(300);
const WorkingHoursDto = siteTextDto(200);

const notNull = (_: unknown, value: unknown) => value !== null;
const notEmpty = (_: unknown, value: unknown) => value !== '';

/** PUT /api/v1/operator/site-settings. */
export class UpdateSiteSettingsDto implements UpdateSiteSettingsRequest {
  @IsObject()
  @ValidateNested()
  @Type(() => NameDto)
  name!: SiteText;

  @IsObject()
  @ValidateNested()
  @Type(() => TaglineDto)
  tagline!: SiteText;

  @IsObject()
  @ValidateNested()
  @Type(() => SeoDescriptionDto)
  seoDescription!: SiteText;

  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address!: SiteText;

  @IsObject()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  workingHours!: SiteText;

  @ValidateIf(notNull)
  @IsUUID()
  logoMediaId!: string | null;

  @ValidateIf(notNull)
  @IsUUID()
  faviconMediaId!: string | null;

  @ValidateIf(notNull)
  @IsUUID()
  ogImageMediaId!: string | null;

  // Empty (not shown) or E.164.
  @Transform(trim)
  @IsString()
  @Matches(/^(\+[0-9]{8,15})?$/)
  phone!: string;

  // Empty (not shown) or an e-mail.
  @Transform(trim)
  @IsString()
  @MaxLength(254)
  @ValidateIf(notEmpty)
  @IsEmail()
  email!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @Matches(/^(https:\/\/t\.me\/\S+)?$/)
  telegramUrl!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @Matches(/^(https:\/\/wa\.me\/\S+)?$/)
  whatsappUrl!: string;
}
