import type {
  ConnectionRequestNoteRequest,
  ConnectionRequestStatus,
  RejectConnectionRequestRequest,
  SubmitConnectionRequest,
  UiLocale,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { uiLocales } from '../../../auth/dto/me.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const CONNECTION_REQUEST_STATUSES: ConnectionRequestStatus[] = [
  'new',
  'in_progress',
  'connected',
  'rejected',
  'spam',
];

/**
 * POST /api/v1/public/connection-requests (spec 2026-10-28-public-site-design, 6.4, 7.3). The lengths are the checks of
 * the table; the phone and the e-mail are normalized by the service. `website` and `openedAt` are never refused for
 * their content: a filled trap or an implausible time makes the request spam, answered as any other (A2).
 */
export class SubmitConnectionRequestDto implements SubmitConnectionRequest {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  networkName!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 120)
  city!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  storeCount!: number;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  contactName!: string;

  // E.164 by `normalizeIdentifier`; the shape is checked by the service (400 on `phone`).
  @IsString()
  @MaxLength(32)
  phone!: string;

  // An empty value is no value.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(254)
  email?: string;

  // INN of Tajikistan: 9 digits, or empty.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^(\d{9})?$/)
  inn?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  callTime?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment?: string;

  @IsIn(uiLocales)
  locale!: UiLocale;

  @Equals(true)
  consent!: true;

  // The hidden trap field: anything in it makes the request spam.
  @IsOptional()
  @IsString()
  website?: string;

  // The instant the form was opened (ISO); an unparsable value is spam, not a refusal.
  @IsString()
  @MaxLength(64)
  openedAt!: string;
}

// `status=new,in_progress` and `status=new&status=in_progress` are the same filter.
const statusList = ({ value }: { value: unknown }) => {
  const parts = (Array.isArray(value) ? value : [value]).flatMap((part) =>
    typeof part === 'string' ? part.split(',') : [part],
  );
  return parts.map((part) => (typeof part === 'string' ? part.trim() : part));
};

/**
 * GET /api/v1/operator/connection-requests. Without `status` — the open ones (`new` and `in_progress`); several
 * statuses are separated by commas. `q` — a part of the network name, or of the phone when `q` looks like one.
 */
export class ConnectionRequestListQueryDto {
  @IsOptional()
  @Transform(statusList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsIn(CONNECTION_REQUEST_STATUSES, { each: true })
  status?: ConnectionRequestStatus[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

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
  @Max(100000)
  offset?: number;
}

/** POST /api/v1/operator/connection-requests/{id}/reject: 5–500 characters, the check of the table. */
export class RejectConnectionRequestDto implements RejectConnectionRequestRequest {
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  reason!: string;
}

/** PUT /api/v1/operator/connection-requests/{id}/note: up to 1000 characters; an empty note removes it. */
export class ConnectionRequestNoteDto implements ConnectionRequestNoteRequest {
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note!: string;
}
