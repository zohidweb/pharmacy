import type { CreateServiceRequestBody } from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

/** A comment may keep line breaks; other control and invisible characters are refused. */
const PRINTABLE_TEXT = /^(?:[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|\n)*$/u;

/** A trimmed comment; an empty one is no comment. */
const commentOf = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** POST /api/v1/service-requests (spec 2026-10-15-billing-services, A12). */
export class CreateServiceRequestDto implements CreateServiceRequestBody {
  @IsUUID()
  serviceId!: string;

  @Transform(commentOf)
  @ValidateIf((body: CreateServiceRequestDto) => body.comment !== null)
  @IsString()
  @Length(1, 500)
  @Matches(PRINTABLE_TEXT)
  comment!: string | null;
}
