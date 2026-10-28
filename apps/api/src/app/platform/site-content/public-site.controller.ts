import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  LegalDocumentRevision,
  Page,
  PublicArticle,
  PublicArticleListItem,
  PublicSiteInfo,
  PublicSitemap,
} from '@pharmacy/shared-dto';
import type { Response } from 'express';
import { PUBLIC_READ_LIMIT } from '../../../common/throttling/public-limits';
import { ProblemException } from '../../../common/errors/problem.exception';
import { Public } from '../../../common/guards/decorators';
import { isUuid } from '../../../core/database';
import { ArticlesService } from './articles.service';
import {
  PublicArticleListQueryDto,
  PublicArticleQueryDto,
} from './dto/articles.dto';
import { legalKind, PublicLegalQueryDto } from './dto/legal-documents.dto';
import { LegalDocumentsService } from './legal-documents.service';
import { sendMedia } from './media-response';
import { SiteMediaService } from './site-media.service';
import { SiteSettingsService } from './site-settings.service';

// The public contour of the site (ADR-0023, spec 2026-10-28-public-site-design, 7.2): no session, reads only.
@Public()
@Throttle({ default: PUBLIC_READ_LIMIT })
@Controller({ path: 'public', version: '1' })
export class PublicSiteController {
  constructor(
    private readonly settings: SiteSettingsService,
    private readonly media: SiteMediaService,
    private readonly legal: LegalDocumentsService,
    private readonly articles: ArticlesService,
  ) {}

  /** The settings of the site and the tariffs in one answer; the site keeps it for 60 seconds (A5). */
  @Get('site-info')
  siteInfo(): Promise<PublicSiteInfo> {
    return this.settings.siteInfo();
  }

  /**
   * The picture; the id never changes its content, so the answer is cached for a year. 404 `media_not_found` (also
   * for a malformed id) stays `no-store`: the header is set only with the image.
   */
  @Get('media/:id')
  async mediaFile(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!isUuid(id)) throw new ProblemException(404, 'media_not_found');
    const media = await this.media.publicContent(id);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    sendMedia(res, media);
  }

  /**
   * The offer or the privacy policy in force; the language asked, else RU. 404 `not_found` (unknown kind, or nothing
   * published); 400 `validation_failed` (a language other than `ru` and `tg`).
   */
  @Get('legal-documents/:kind')
  legalDocument(
    @Param('kind') kind: string,
    @Query() query: PublicLegalQueryDto,
  ): Promise<LegalDocumentRevision> {
    return this.legal.publicCurrent(legalKind(kind), query.locale ?? 'ru');
  }

  /** The published articles that have a text in the language (RU when omitted), the newest first; 12 by default, 50 at most. */
  @Get('articles')
  async articleList(
    @Query() query: PublicArticleListQueryDto,
  ): Promise<Page<PublicArticleListItem>> {
    const limit = query.limit ?? 12;
    const offset = query.offset ?? 0;
    const page = await this.articles.publicList(
      query.locale ?? 'ru',
      limit,
      offset,
    );
    return { ...page, limit, offset };
  }

  /** 404 `article_not_found`: not published, or no text in the language (P11); 400 `validation_failed` (a bad language). */
  @Get('articles/:slug')
  article(
    @Param('slug') slug: string,
    @Query() query: PublicArticleQueryDto,
  ): Promise<PublicArticle> {
    return this.articles.publicArticle(slug, query.locale ?? 'ru');
  }

  /** The slugs and dates of the articles and legal documents by language, for sitemap.xml of the site. */
  @Get('sitemap')
  sitemap(): Promise<PublicSitemap> {
    return this.articles.sitemap();
  }
}
