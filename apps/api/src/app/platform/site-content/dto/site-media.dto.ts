import type {
  SiteMediaType,
  UploadSiteMediaRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const TYPES: SiteMediaType[] = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * POST /api/v1/operator/site-media. The length of the base64 is bounded by the body limit of the route (3 MiB);
 * the size of the decoded file (2 MiB) is checked by the service, which answers 413.
 */
export class UploadSiteMediaDto implements UploadSiteMediaRequest {
  @IsIn(TYPES)
  contentType!: SiteMediaType;

  @IsString()
  @MaxLength(3 * 1024 * 1024)
  dataBase64!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  alt!: string;
}

/** GET /api/v1/operator/site-media. */
export class SiteMediaListQueryDto {
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
