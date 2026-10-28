import type {
  LegalDocumentKind,
  SaveLegalDocumentDraftRequest,
  UiLocale,
} from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const LEGAL_KINDS: LegalDocumentKind[] = ['offer', 'privacy'];
export const LEGAL_LOCALES: UiLocale[] = ['ru', 'tg'];

/** `YYYY-MM-DD` that exists in the calendar (no 2026-02-31). */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      options,
      validator: { validate: isCalendarDate },
    });
}

/** PUT /api/v1/operator/legal-documents/{kind}/{locale}/draft. The lengths are the checks of the table. */
export class SaveLegalDocumentDraftDto implements SaveLegalDocumentDraftRequest {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  // The restricted Markdown (spec 6.6); an all-blank text is empty after the trim and is refused.
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200000)
  body!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsCalendarDate()
  effectiveFrom!: string;
}

/** GET /api/v1/public/legal-documents/{kind}: the language of the text, `ru` when omitted. */
export class PublicLegalQueryDto {
  @IsOptional()
  @IsIn(LEGAL_LOCALES)
  locale?: UiLocale;
}
