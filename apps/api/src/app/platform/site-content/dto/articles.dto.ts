import type {
  ArticleStatus,
  ArticleTranslation,
  SaveArticleRequest,
  UiLocale,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  Max,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const ARTICLE_STATUSES: ArticleStatus[] = [
  'draft',
  'published',
  'unpublished',
  'archived',
];
export const ARTICLE_LOCALES: UiLocale[] = ['ru', 'tg'];

/** One language of an article. The lengths are the checks of the table; the minimal title is checked by the service. */
export class ArticleTranslationDto implements ArticleTranslation {
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  title!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  excerpt!: string;

  // The restricted Markdown (spec 6.6).
  @Transform(trim)
  @IsString()
  @MaxLength(100000)
  body!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(70)
  seoTitle!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(160)
  seoDescription!: string;
}

export class ArticleTranslationsDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ArticleTranslationDto)
  ru?: ArticleTranslation;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ArticleTranslationDto)
  tg?: ArticleTranslation;
}

const notNull = (_: unknown, value: unknown) => value !== null;

/** POST /api/v1/operator/articles (no `version`) and PUT /api/v1/operator/articles/{id} (with `version`). */
export class SaveArticleDto implements SaveArticleRequest {
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug!: string;

  @ValidateIf(notNull)
  @IsUUID()
  coverMediaId!: string | null;

  @IsObject()
  @ValidateNested()
  @Type(() => ArticleTranslationsDto)
  translations!: Partial<Record<UiLocale, ArticleTranslation>>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  version?: number;
}

/** GET /api/v1/operator/articles. Without `status` the archived ones are left out. */
export class ArticleListQueryDto {
  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: ArticleStatus;

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
  offset?: number;
}

/** GET /api/v1/public/articles. */
export class PublicArticleListQueryDto {
  @IsOptional()
  @IsIn(ARTICLE_LOCALES)
  locale?: UiLocale;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** GET /api/v1/public/articles/{slug}. */
export class PublicArticleQueryDto {
  @IsOptional()
  @IsIn(ARTICLE_LOCALES)
  locale?: UiLocale;
}
