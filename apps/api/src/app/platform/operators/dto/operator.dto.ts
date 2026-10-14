import type { CreateOperatorRequest } from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
import { IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * POST /api/v1/operator/operators. The bounds are those of create-operator.mjs; the service checks
 * that the login is an e-mail (400 `email_format`).
 */
export class CreateOperatorDto implements CreateOperatorRequest {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  fullName!: string;

  // An e-mail (RFC 5321 path limit).
  @IsString()
  @MaxLength(254)
  login!: string;
}
