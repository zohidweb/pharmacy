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
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProblemException } from '../../../../common/errors/problem.exception';
import { IsCalendarDate } from '../../../../common/validation/calendar-date';
import { uiLocales } from '../../../auth/dto/me.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const LEGAL_KINDS: readonly LegalDocumentKind[] = ['offer', 'privacy'];

/** The kind of a path; an unknown one is an unknown resource: 404 `not_found`. */
export function legalKind(value: string): LegalDocumentKind {
  const kind = LEGAL_KINDS.find((known) => known === value);
  if (kind === undefined) throw new ProblemException(404, 'not_found');
  return kind;
}

/** The language of a path; an unknown one is an unknown resource: 404 `not_found`. */
export function legalLocale(value: string): UiLocale {
  const locale = uiLocales.find((known) => known === value);
  if (locale === undefined) throw new ProblemException(404, 'not_found');
  return locale;
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

  // A real calendar day `YYYY-MM-DD` (common/validation/calendar-date).
  @IsCalendarDate()
  effectiveFrom!: string;
}

/** GET /api/v1/public/legal-documents/{kind}: the language of the text, `ru` when omitted. */
export class PublicLegalQueryDto {
  @IsOptional()
  @IsIn(uiLocales)
  locale?: UiLocale;
}
